/**
 * Tests d'intégration des routes RGPD via Fastify inject.
 *
 * Vérifie le flow complet :
 *   1. POST /api/rgpd/request-verification (envoie OTP)
 *   2. POST /api/rgpd/confirm-verification (valide OTP, renvoie token)
 *   3. POST /api/rgpd/erase + X-Identity-Token (anonymise)
 *   4. POST /api/rgpd/export + X-Identity-Token (exporte)
 *   5. POST /api/rgpd/withdraw-marketing + X-Identity-Token
 *   6. GET  /api/rgpd/privacy-policy (public)
 *
 * Mocks Telnyx/Brevo + Prisma.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getApp, closeApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';
import { sendSms } from '../../../shared/telnyx/client';
import { sendEmail } from '../../../shared/email';
import { redisCache } from '../../../shared/redis/client';

// Mocks Telnyx et Brevo (hoisted pour être dispo dans le mock factory)
const { sendSmsMock, sendEmailMock } = vi.hoisted(() => ({
  sendSmsMock: vi.fn(),
  sendEmailMock: vi.fn(),
}));
vi.mock('../../../shared/telnyx/client', () => ({
  sendSms: sendSmsMock,
  default: {},
}));
vi.mock('../../../shared/email', () => ({
  sendEmail: sendEmailMock,
}));

// Mocks Redis : on utilise le mock ioredis global (setup.ts) qui retourne
// une instance avec incr/expire/get/del. Pas besoin de re-mocker.

const otpStore = new Map<string, Record<string, unknown>>();
const signedTokenStore = new Map<string, Record<string, unknown>>();

function setupPrismaMocks() {
  vi.mocked(db.reservation.findFirst).mockResolvedValue({ id: 'res-1' } as unknown as Awaited<
    ReturnType<typeof db.reservation.findFirst>
  >);
  vi.mocked(db.reservation.findMany).mockResolvedValue([]);
  vi.mocked(db.reservation.updateMany).mockResolvedValue({ count: 3 } as unknown as Awaited<
    ReturnType<typeof db.reservation.updateMany>
  >);
  vi.mocked(db.customerConsent.findFirst).mockResolvedValue(null);
  vi.mocked(db.customerConsent.findMany).mockResolvedValue([]);
  vi.mocked(db.customerConsent.count).mockResolvedValue(0);
  vi.mocked(db.customerConsent.updateMany).mockResolvedValue({ count: 2 } as unknown as Awaited<
    ReturnType<typeof db.customerConsent.updateMany>
  >);
  vi.mocked(db.call.updateMany).mockResolvedValue({ count: 1 } as unknown as Awaited<
    ReturnType<typeof db.call.updateMany>
  >);
  vi.mocked(db.reservationAuditLog.create).mockResolvedValue({
    id: 'audit-1',
  } as unknown as Awaited<ReturnType<typeof db.reservationAuditLog.create>>);
  vi.mocked(db.$transaction).mockImplementation(async (fn) =>
    (fn as unknown as (tx: unknown) => unknown)({
      reservation: { updateMany: vi.fn().mockResolvedValue({ count: 3 }) },
    }),
  );
  (
    vi.mocked(db.identityVerificationOtp.upsert) as unknown as Mock<(...args: unknown[]) => unknown>
  ).mockImplementation(async (...args: unknown[]) => {
    const { where, create, update } = args[0] as unknown as {
      where: { subject_intent: unknown };
      create: unknown;
      update: unknown;
    };
    const subject_intent = where.subject_intent as unknown as { subject: string; intent: string };
    const key = `${subject_intent.subject}|${subject_intent.intent}`;
    const existing = otpStore.get(key);
    const merged = {
      ...((existing ?? create) as unknown as Record<string, unknown>),
      ...(update as unknown as Record<string, unknown>),
      attempts: 0,
      consumedAt: null,
    };
    otpStore.set(key, merged);
    return merged;
  });
  (
    vi.mocked(db.identityVerificationOtp.findUnique) as unknown as Mock<
      (...args: unknown[]) => unknown
    >
  ).mockImplementation(async (...args: unknown[]) => {
    const { where } = args[0] as unknown as { where: { subject_intent: unknown } };
    const subject_intent = where.subject_intent as unknown as { subject: string; intent: string };
    const key = `${subject_intent.subject}|${subject_intent.intent}`;
    return otpStore.get(key) || null;
  });
  (
    vi.mocked(db.identityVerificationOtp.update) as unknown as Mock<(...args: unknown[]) => unknown>
  ).mockImplementation(async (...args: unknown[]) => {
    const { where, data } = args[0] as unknown as { where: unknown; data: unknown };
    const { id } = where as unknown as { id: string };
    for (const [k, v] of otpStore.entries()) {
      if (v.id === id) {
        Object.assign(v, data as unknown as Record<string, unknown>);
        return v;
      }
    }
    return null;
  });
  (
    vi.mocked(db.signedTokenUsage.create) as unknown as Mock<(...args: unknown[]) => unknown>
  ).mockImplementation(async (...args: unknown[]) => {
    const { data } = args[0] as unknown as { data: unknown };
    const d = data as unknown as { jti: string };
    if (signedTokenStore.has(d.jti)) {
      const err = new Error('Unique constraint failed') as Error & { code: string };
      err.code = 'P2002';
      throw err;
    }
    signedTokenStore.set(d.jti, d as unknown as Record<string, unknown>);
    return d;
  });
  (
    vi.mocked(db.signedTokenUsage.upsert) as unknown as Mock<(...args: unknown[]) => unknown>
  ).mockImplementation(async (...args: unknown[]) => {
    const { where, create, update } = args[0] as unknown as {
      where: { jti: unknown };
      create: unknown;
      update: unknown;
    };
    const { jti } = where as unknown as { jti: string };
    const existing = signedTokenStore.get(jti);
    const merged = {
      ...((existing ?? create) as unknown as Record<string, unknown>),
      ...(update as unknown as Record<string, unknown>),
    };
    signedTokenStore.set(jti, merged);
    return merged;
  });
  (
    vi.mocked(db.signedTokenUsage.findUnique) as unknown as Mock<(...args: unknown[]) => unknown>
  ).mockImplementation(async (...args: unknown[]) => {
    const { where } = args[0] as unknown as { where: { jti: unknown } };
    const { jti } = where as unknown as { jti: string };
    return signedTokenStore.get(jti) || null;
  });
}

/**
 * Helper : exécute le flow complet verify → confirm et renvoie le verificationToken.
 */
async function getVerifiedToken(
  app: Awaited<ReturnType<typeof getApp>>,
  subject: string,
  intent: 'erase' | 'export',
): Promise<string> {
  // 1. request
  const reqRes = await app.inject({
    method: 'POST',
    url: '/api/rgpd/request-verification',
    payload: { subject, intent },
  });
  expect(reqRes.statusCode).toBe(200);

  // 2. Récupérer OTP depuis le mock sendSms
  const { sendSms } = await import('../../../shared/telnyx/client');
  const calls = vi.mocked(sendSms).mock.calls;
  const lastCall = calls[calls.length - 1];
  const otp = lastCall[1].match(/\d{6}/)?.[0];
  expect(otp).toBeDefined();

  // 3. confirm
  const confirmRes = await app.inject({
    method: 'POST',
    url: '/api/rgpd/confirm-verification',
    payload: { subject, intent, code: otp },
  });
  expect(confirmRes.statusCode).toBe(200);
  const body = confirmRes.json();
  expect(body.verificationToken).toBeDefined();
  return body.verificationToken;
}

describe('RGPD routes (with identity verification)', () => {
  afterAll(async () => {
    await closeApp();
  });

  beforeEach(() => {
    // Force redisCache.incr/expire to be vi.fn (mock ioredis global ne le fait pas toujours)
    vi.spyOn(redisCache, 'incr').mockResolvedValue(1);
    vi.spyOn(redisCache, 'expire').mockResolvedValue(1);
  });

  afterEach(() => {
    // Ne PAS clear les mocks custom Prisma (déjà mockés par helpers.ts)
    // On clear seulement les mocks Telnyx/Brevo pour réinitialiser les calls
    vi.mocked(sendSms).mockClear();
    vi.mocked(sendEmail).mockClear();
    otpStore.clear();
    signedTokenStore.clear();
  });

  describe('POST /api/rgpd/request-verification', () => {
    it('envoie un OTP SMS par défaut', async () => {
      setupPrismaMocks();
      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/rgpd/request-verification',
        payload: { subject: '+33****0001', intent: 'erase' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().channel).toBe('sms');
    });

    it('rejette payload invalide', async () => {
      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/rgpd/request-verification',
        payload: { subject: 'x' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/rgpd/confirm-link', () => {
    it('confirme un lien email avec token encodé et affiche un verificationToken', async () => {
      setupPrismaMocks();
      const app = await getApp();
      const requestRes = await app.inject({
        method: 'POST',
        url: '/api/rgpd/request-verification',
        payload: {
          subject: '+33****0101',
          intent: 'export',
          email: 'user@example.com',
        },
      });
      expect(requestRes.statusCode).toBe(200);

      const [opts] = vi.mocked(sendEmail).mock.calls[0];
      const tokenMatch = opts.html.match(/token=([^"<&]+)/);
      expect(tokenMatch).toBeDefined();

      const res = await app.inject({
        method: 'GET',
        url: `/api/rgpd/confirm-link?token=${tokenMatch![1]}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('X-Identity-Token');
      expect(res.body).toContain('+33****0101');
    });

    it('refuse le replay du même lien email', async () => {
      setupPrismaMocks();
      const app = await getApp();
      const requestRes = await app.inject({
        method: 'POST',
        url: '/api/rgpd/request-verification',
        payload: {
          subject: '+33****0102',
          intent: 'export',
          email: 'user@example.com',
        },
      });
      expect(requestRes.statusCode).toBe(200);

      const [opts] = vi.mocked(sendEmail).mock.calls[0];
      const tokenMatch = opts.html.match(/token=([^"<&]+)/);
      expect(tokenMatch).toBeDefined();
      const url = `/api/rgpd/confirm-link?token=${tokenMatch![1]}`;

      const first = await app.inject({ method: 'GET', url });
      expect(first.statusCode).toBe(200);

      const replay = await app.inject({ method: 'GET', url });
      expect(replay.statusCode).toBe(400);
      expect(replay.body).toContain('EXPIRED');
    });
  });

  describe('POST /api/rgpd/erase', () => {
    it('refuse 401 sans X-Identity-Token', async () => {
      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/rgpd/erase',
        payload: { subject: '+33****0001' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('IDENTITY_REQUIRED');
    });

    it('anonymise les résas avec token valide', async () => {
      setupPrismaMocks();
      const app = await getApp();
      const token = await getVerifiedToken(app, '+33****0001', 'erase');
      const res = await app.inject({
        method: 'POST',
        url: '/api/rgpd/erase',
        headers: { 'x-identity-token': token },
        payload: { subject: '+33****0001' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.anonymized.reservations).toBe(3);
    });

    it('refuse 403 si subject payload ≠ subject token', async () => {
      setupPrismaMocks();
      const app = await getApp();
      const token = await getVerifiedToken(app, '+33****0001', 'erase');
      const res = await app.inject({
        method: 'POST',
        url: '/api/rgpd/erase',
        headers: { 'x-identity-token': token },
        payload: { subject: '+33****0002' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('retourne 404 si aucune donnée', async () => {
      vi.mocked(db.reservation.findFirst).mockResolvedValue(null);
      vi.mocked(db.customerConsent.findFirst).mockResolvedValue(null);
      const app = await getApp();
      const token = await getVerifiedToken(app, '+33****0003', 'erase');
      const res = await app.inject({
        method: 'POST',
        url: '/api/rgpd/erase',
        headers: { 'x-identity-token': token },
        payload: { subject: '+33****0003' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/rgpd/export', () => {
    it('refuse 401 sans token', async () => {
      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/rgpd/export',
        payload: { subject: '+33****0001' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('exporte les données avec token valide', async () => {
      setupPrismaMocks();
      vi.mocked(db.reservation.findMany).mockResolvedValue([
        {
          id: 'res-1',
          restaurantId: 'r-1',
          startsAt: new Date('2026-06-01T19:00:00Z'),
          endsAt: new Date('2026-06-01T21:00:00Z'),
          partySize: 4,
          state: 'CONFIRMED',
          channel: 'MCP',
          customerName: 'Jean',
          customerPhone: '+33****0001',
          specialRequests: null,
          createdAt: new Date('2026-05-01T10:00:00Z'),
          restaurant: { name: 'Le Bistrot' },
        },
      ] as unknown as Awaited<ReturnType<typeof db.reservation.findMany>>);
      const app = await getApp();
      const token = await getVerifiedToken(app, '+33****0001', 'export');
      const res = await app.inject({
        method: 'POST',
        url: '/api/rgpd/export',
        headers: { 'x-identity-token': token },
        payload: { subject: '+33****0001' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.reservations).toHaveLength(1);
    });
  });

  describe('POST /api/rgpd/withdraw-marketing', () => {
    it('refuse 401 sans token', async () => {
      const app = await getApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/rgpd/withdraw-marketing',
        payload: { subject: '+33****0001' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('update marketingOptIn à false avec token valide', async () => {
      setupPrismaMocks();
      const app = await getApp();
      const token = await getVerifiedToken(app, '+33****0001', 'export');
      const res = await app.inject({
        method: 'POST',
        url: '/api/rgpd/withdraw-marketing',
        headers: { 'x-identity-token': token },
        payload: { subject: '+33****0001' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().updated).toBe(2);
    });
  });

  describe('GET /api/rgpd/privacy-policy', () => {
    it('public, retourne summary + text', async () => {
      const app = await getApp();
      const res = await app.inject({ method: 'GET', url: '/api/rgpd/privacy-policy' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.summary).toBeDefined();
      expect(body.text).toBeDefined();
    });
  });
});
