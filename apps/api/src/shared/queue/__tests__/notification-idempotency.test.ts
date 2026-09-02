import { describe, expect, it } from 'vitest';
import {
  buildNotificationClaimKey,
  buildNotificationReconciliationJobId,
  claimNotification,
  classifyNotificationError,
  enqueueNotificationReconciliation,
  getNotificationClaim,
  acquireNotificationReconciliationLease,
  isNotificationClaimOrphaned,
  NOTIFICATION_CLAIM_TTL_SECONDS,
  NOTIFICATION_CLAIM_LEASE_SECONDS,
  acquireNotificationClaim,
  recordNotificationResult,
  recoverNotificationClaim,
  releaseNotificationClaim,
  type NotificationClaimStore,
} from '../notification-idempotency';

function makeStore() {
  const values = new Map<string, string>();
  const calls: unknown[][] = [];
  const store: NotificationClaimStore = {
    async set(...args) {
      calls.push(args);
      const key = args[0];
      const value = args[1];
      const existenceMode = args[4];
      if (existenceMode === 'NX' && values.has(key)) return null;
      values.set(key, value);
      return 'OK';
    },
    async get(key) {
      return values.get(key) ?? null;
    },
    async del(key) {
      values.delete(key);
      return 1;
    },
    async eval(script, _numberOfKeys, key, token, ...args) {
      const current = values.get(key);
      if (!current || !current.includes(`\"token\":\"${token}\"`)) return 0;
      const guardedByStatus = script.includes('local status =');
      const expectedStatus = guardedByStatus ? args[0] : undefined;
      const nextValue = guardedByStatus ? args[1] : args[0];
      if (guardedByStatus) {
        const parsed = JSON.parse(current) as { status?: string };
        if (parsed.status !== expectedStatus) return 0;
      }
      if (nextValue === '__DELETE__') values.delete(key);
      else values.set(key, nextValue);
      return 1;
    },
  };
  return { store, values, calls };
}

describe('notification idempotency claims', () => {
  it('utilise une clé stable et une réservation Redis atomique', async () => {
    const { store, calls } = makeStore();
    const key = buildNotificationClaimKey('confirmation:sms', 'reservation:123');

    expect(key).toBe('notification:confirmation_sms:reservation_123');
    expect(await claimNotification(store, key)).toBe(true);
    expect(await claimNotification(store, key)).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual([
      'notification:confirmation_sms:reservation_123',
      expect.stringContaining('"status":"in_progress"'),
      'EX',
      NOTIFICATION_CLAIM_TTL_SECONDS,
      'NX',
    ]);
    expect(calls[1]).toEqual([
      'notification:confirmation_sms:reservation_123',
      expect.stringContaining('"status":"in_progress"'),
      'EX',
      NOTIFICATION_CLAIM_TTL_SECONDS,
      'NX',
    ]);
  });

  it('libère la claim après un échec provider pour permettre le retry', async () => {
    const { store, values } = makeStore();
    const key = buildNotificationClaimKey('reminder', 'res-1');

    expect(await claimNotification(store, key)).toBe(true);
    await releaseNotificationClaim(store, key);
    expect(values.has(key)).toBe(false);
    expect(await claimNotification(store, key)).toBe(true);
  });

  it('conserve les résultats unknown et success avec une transition protégée par token', async () => {
    const { store, values } = makeStore();
    const key = buildNotificationClaimKey('confirmation', 'res-unknown');
    const attempt = await acquireNotificationClaim(store, key, {
      provider: 'telnyx',
      channel: 'sms',
    });

    expect(attempt.acquired).toBe(true);
    expect(attempt.token).toBeTruthy();
    expect(
      await recordNotificationResult(store, key, attempt.token!, 'unknown', {
        provider: 'telnyx',
        channel: 'sms',
        providerMessageId: 'msg-unknown',
      }),
    ).toBe(true);
    expect(await getNotificationClaim(store, key)).toMatchObject({
      status: 'unknown',
      provider: 'telnyx',
      channel: 'sms',
      providerMessageId: 'msg-unknown',
    });

    expect(
      await recordNotificationResult(store, key, attempt.token!, 'success', {
        provider: 'telnyx',
        channel: 'sms',
        providerMessageId: 'msg-unknown',
      }),
    ).toBe(true);
    expect(await getNotificationClaim(store, key)).toMatchObject({ status: 'success' });
    expect(values.has(key)).toBe(true);
  });

  it('refuse une transition provenant d’un worker qui ne possède plus le token', async () => {
    const { store, values } = makeStore();
    const key = buildNotificationClaimKey('confirmation', 'res-race');
    const first = await acquireNotificationClaim(store, key, {
      provider: 'telnyx',
      channel: 'sms',
    });
    const second = await acquireNotificationClaim(store, key, {
      provider: 'telnyx',
      channel: 'sms',
    });

    expect(second.acquired).toBe(false);
    expect(await recordNotificationResult(store, key, 'stale-token', 'failure_certain')).toBe(
      false,
    );
    expect(values.has(key)).toBe(true);
    expect(await getNotificationClaim(store, key)).toMatchObject({
      status: 'in_progress',
      token: first.token,
    });
  });

  it('classifie les refus explicites et les erreurs ambiguës séparément', () => {
    expect(
      classifyNotificationError(Object.assign(new Error('bad recipient'), { statusCode: 400 })),
    ).toBe('failure_certain');
    expect(
      classifyNotificationError(Object.assign(new Error('provider down'), { statusCode: 503 })),
    ).toBe('unknown');
    expect(
      classifyNotificationError(Object.assign(new Error('socket reset'), { code: 'ECONNRESET' })),
    ).toBe('unknown');
    expect(
      classifyNotificationError(
        Object.assign(new Error('request aborted'), { name: 'AbortError' }),
      ),
    ).toBe('unknown');
  });

  it('utilise un job ID de réconciliation stable pour un même claim', async () => {
    const added = new Set<string>();
    const queue = {
      add: async (_name: string, _data: unknown, options: { jobId: string }) => {
        added.add(options.jobId);
      },
    };
    const key = buildNotificationClaimKey('reminder:sms', 'res-1');

    await Promise.all([
      enqueueNotificationReconciliation(queue, {
        claimKey: key,
        provider: 'telnyx',
        channel: 'sms',
      }),
      enqueueNotificationReconciliation(queue, {
        claimKey: key,
        provider: 'telnyx',
        channel: 'sms',
      }),
    ]);

    expect(added).toEqual(new Set([buildNotificationReconciliationJobId(key)]));
  });

  it('distingue une claim active d’une claim in_progress orpheline', () => {
    const now = Date.parse('2026-09-02T12:00:00.000Z');
    const active = {
      version: 1 as const,
      status: 'in_progress' as const,
      token: ['active', 'token'].join('-'),
      provider: 'telnyx' as const,
      channel: 'sms' as const,
      updatedAt: new Date(now - (NOTIFICATION_CLAIM_LEASE_SECONDS * 1000 - 1)).toISOString(),
    };
    const orphan = {
      ...active,
      updatedAt: new Date(now - (NOTIFICATION_CLAIM_LEASE_SECONDS * 1000 + 1)).toISOString(),
    };

    expect(isNotificationClaimOrphaned(active, now)).toBe(false);
    expect(isNotificationClaimOrphaned(orphan, now)).toBe(true);
    expect(isNotificationClaimOrphaned({ ...active, updatedAt: '' }, now)).toBe(true);
  });

  it('récupère une claim orpheline vers unknown sans appeler de provider', async () => {
    const { store, values } = makeStore();
    const key = buildNotificationClaimKey('reservation-confirmation-sms', 'res-orphan');
    const now = Date.parse('2026-09-02T12:00:00.000Z');
    values.set(
      key,
      JSON.stringify({
        version: 1,
        status: 'in_progress',
        token: ['orphan', 'token'].join('-'),
        provider: 'telnyx',
        channel: 'sms',
        providerMessageId: 'msg-orphan',
        updatedAt: new Date(now - NOTIFICATION_CLAIM_LEASE_SECONDS * 1000 - 1).toISOString(),
      }),
    );

    const result = await recoverNotificationClaim(store, key, now);

    expect(result.status).toBe('recovered');
    expect(await getNotificationClaim(store, key)).toMatchObject({
      status: 'unknown',
      providerMessageId: 'msg-orphan',
    });
  });

  it('ne récupère pas une claim encore active et envoie les anciennes claims à la revue', async () => {
    const { store, values } = makeStore();
    const activeKey = buildNotificationClaimKey('reservation-confirmation-sms', 'res-active');
    await acquireNotificationClaim(store, activeKey, {
      provider: 'telnyx',
      channel: 'sms',
    });
    expect((await recoverNotificationClaim(store, activeKey)).status).toBe('active');

    const legacyKey = buildNotificationClaimKey('reservation-confirmation-sms', 'res-legacy');
    values.set(legacyKey, 'claimed');
    const legacy = await recoverNotificationClaim(store, legacyKey);
    expect(legacy.status).toBe('manual');
    expect(await getNotificationClaim(store, legacyKey)).toMatchObject({
      status: 'in_progress',
    });
  });

  it('n’accorde qu’un seul lease de réconciliation à deux exécutions concurrentes', async () => {
    const { store } = makeStore();
    const key = buildNotificationClaimKey('reservation-confirmation-sms', 'res-race');
    const attempt = await acquireNotificationClaim(store, key, {
      provider: 'telnyx',
      channel: 'sms',
    });
    await recordNotificationResult(store, key, attempt.token!, 'unknown', {
      provider: 'telnyx',
      channel: 'sms',
      providerMessageId: 'msg-race',
    });

    const [first, second] = await Promise.all([
      acquireNotificationReconciliationLease(store, key, '2026-09-02T12:00:00.000Z'),
      acquireNotificationReconciliationLease(store, key, '2026-09-02T12:00:00.000Z'),
    ]);

    expect([first.acquired, second.acquired].filter(Boolean)).toHaveLength(1);
    expect(await getNotificationClaim(store, key)).toMatchObject({ status: 'in_progress' });
  });
});
