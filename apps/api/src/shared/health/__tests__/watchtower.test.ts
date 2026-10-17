import { describe, expect, it, vi } from 'vitest';

vi.mock('../../db/client', () => ({ db: { restaurant: { findMany: vi.fn() } } }));
vi.mock('../../redis/client', () => ({ redisCache: {} }));
vi.mock('../../logger/pino', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../observability/alert-dispatcher', () => ({ dispatchAlert: vi.fn() }));

import {
  checkPhoneLine,
  readWorkerHeartbeatAgeMs,
  reportIncident,
  WORKER_HEARTBEAT_KEY,
  type WatchtowerDependencies,
} from '../watchtower';

function makeDependencies() {
  const latched = new Set<string>();
  const dispatch = vi.fn().mockResolvedValue([]);
  const dependencies: WatchtowerDependencies = {
    latch: {
      set: vi.fn(async (key: string) => (latched.has(key) ? null : (latched.add(key), 'OK'))),
      del: vi.fn(async (key: string) => (latched.delete(key) ? 1 : 0)),
    },
    dispatch,
  };
  return { dependencies, dispatch };
}

const incident = (failing: boolean) => ({
  key: 'workers',
  failing,
  summary: 'down',
  detail: 'detail',
  recovered: 'up',
});

describe('reportIncident', () => {
  it('alerte une fois à l’ouverture, puis au rétablissement', async () => {
    const { dependencies, dispatch } = makeDependencies();
    expect(await reportIncident(incident(true), dependencies)).toBe('opened');
    expect(await reportIncident(incident(true), dependencies)).toBe('ongoing');
    expect(await reportIncident(incident(false), dependencies)).toBe('recovered');
    expect(await reportIncident(incident(false), dependencies)).toBe('ok');
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ kind: 'watchtower_workers', severity: 'critical' }),
    );
    expect(dispatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ kind: 'watchtower_workers_recovered', severity: 'info' }),
    );
  });
});

describe('readWorkerHeartbeatAgeMs', () => {
  it('mesure l’âge du dernier battement', async () => {
    const get = vi.fn(async (key: string) => (key === WORKER_HEARTBEAT_KEY ? '1000' : null));
    expect(await readWorkerHeartbeatAgeMs({ get }, 61_000)).toBe(60_000);
    expect(await readWorkerHeartbeatAgeMs({ get: async () => null }, 61_000)).toBeNull();
  });
});

describe('checkPhoneLine', () => {
  const ok = (data: unknown) => ({ ok: true, status: 200, data });

  it('valide un numéro actif relié à une application active qui pointe sur l’API', async () => {
    const get = vi.fn(async (path: string) =>
      path.startsWith('/v2/phone_numbers/')
        ? ok({ status: 'active', connection_id: 'app_1' })
        : ok({ active: true, webhook_event_url: 'https://api.sokar.tech/voice/telnyx' }),
    );
    await expect(checkPhoneLine('num_1', 'https://api.sokar.tech', get)).resolves.toEqual({
      ok: true,
    });
  });

  it('signale un webhook qui pointe ailleurs', async () => {
    const get = vi.fn(async (path: string) =>
      path.startsWith('/v2/phone_numbers/')
        ? ok({ status: 'active', connection_id: 'app_1' })
        : ok({ active: true, webhook_event_url: 'https://api-staging.sokar.tech/voice/telnyx' }),
    );
    const result = await checkPhoneLine('num_1', 'https://api.sokar.tech', get);
    expect(result.ok).toBe(false);
  });

  it('signale un numéro suspendu ou sans application', async () => {
    const suspended = vi.fn(async () => ok({ status: 'suspended', connection_id: 'app_1' }));
    expect((await checkPhoneLine('num_1', 'https://api.sokar.tech', suspended)).ok).toBe(false);
    const orphan = vi.fn(async () => ok({ status: 'active', connection_id: null }));
    expect((await checkPhoneLine('num_1', 'https://api.sokar.tech', orphan)).ok).toBe(false);
  });
});
