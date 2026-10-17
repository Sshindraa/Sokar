import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('bullmq', () => ({
  Worker: class {
    on = vi.fn();
  },
}));
vi.mock('../../../redis/client', () => ({ redisCache: {}, redisQueue: {} }));
vi.mock('../helper', () => ({ setupWorkerListeners: vi.fn() }));
vi.mock('../../../logger/pino', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  ELEVENLABS_QUOTA_LEVELS,
  TELNYX_BALANCE_LEVELS,
  dispatchLevelAlerts,
  fetchElevenLabsQuota,
  fetchTelnyxAvailableCredit,
  type ProviderBalanceDependencies,
} from '../provider-balance.worker';

const TEST_KEY = ['test', 'provider', 'key'].join('-');

function makeDependencies() {
  const claimed = new Set<string>();
  const dispatch = vi.fn().mockResolvedValue([]);
  const dependencies: ProviderBalanceDependencies = {
    claimStore: {
      set: vi.fn(async (key: string) => {
        if (claimed.has(key)) return null;
        claimed.add(key);
        return 'OK';
      }),
      del: vi.fn(async (key: string) => (claimed.delete(key) ? 1 : 0)),
    },
    dispatch,
  };
  return { dependencies, dispatch };
}

const telnyxAlert = (value: number) => ({
  provider: 'telnyx' as const,
  value,
  levels: TELNYX_BALANCE_LEVELS,
  summary: () => `solde ${value}`,
  detail: [],
});

describe('alertes de solde fournisseur', () => {
  afterEach(() => vi.clearAllMocks());

  it('alerte une seule fois par niveau franchi, puis se relâche après une recharge', async () => {
    const { dependencies, dispatch } = makeDependencies();

    expect(await dispatchLevelAlerts(telnyxAlert(2.43), dependencies)).toEqual({
      dispatched: 2,
      suppressed: 0,
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'telnyx_balance_critical', severity: 'critical' }),
    );
    expect(await dispatchLevelAlerts(telnyxAlert(2.4), dependencies)).toEqual({
      dispatched: 0,
      suppressed: 2,
    });

    await dispatchLevelAlerts(telnyxAlert(50), dependencies);
    expect(await dispatchLevelAlerts(telnyxAlert(10), dependencies)).toEqual({
      dispatched: 1,
      suppressed: 0,
    });
  });

  it('suit la part restante du quota ElevenLabs', async () => {
    const { dependencies, dispatch } = makeDependencies();
    await dispatchLevelAlerts(
      {
        provider: 'elevenlabs',
        value: 0.1,
        levels: ELEVENLABS_QUOTA_LEVELS,
        summary: () => 'quota',
        detail: [],
      },
      dependencies,
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'elevenlabs_balance_low', severity: 'warning' }),
    );
  });
});

describe('lecture des soldes', () => {
  it('lit le crédit Telnyx disponible', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { available_credit: '2.43', currency: 'USD' } }),
    });
    await expect(fetchTelnyxAvailableCredit({ apiKey: TEST_KEY, fetcher })).resolves.toEqual({
      available: 2.43,
      currency: 'USD',
    });
    await expect(fetchTelnyxAvailableCredit({ apiKey: '' })).resolves.toBeNull();
  });

  it('calcule la part restante du quota ElevenLabs', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ character_count: 25_000, character_limit: 100_000, tier: 'creator' }),
    });
    await expect(fetchElevenLabsQuota({ apiKey: TEST_KEY, fetcher })).resolves.toEqual({
      used: 25_000,
      limit: 100_000,
      remainingRatio: 0.75,
      tier: 'creator',
    });
  });

  it('refuse une réponse invalide', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await expect(fetchElevenLabsQuota({ apiKey: TEST_KEY, fetcher })).rejects.toThrow(/invalid/);
  });
});
