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
  dispatchOpenRouterCreditAlerts,
  fetchOpenRouterRemainingUsd,
  type OpenRouterCreditDependencies,
} from '../openrouter-credit.worker';

const TEST_KEY = ['test', 'openrouter', 'key'].join('-');

function makeDependencies() {
  const claimed = new Set<string>();
  const dispatch = vi.fn().mockResolvedValue([]);
  const dependencies: OpenRouterCreditDependencies = {
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

describe('crédit OpenRouter', () => {
  afterEach(() => vi.clearAllMocks());

  it('alerte une fois sous 2 $, puis une fois sous 0,5 $, sans répéter à chaque heure', async () => {
    const { dependencies, dispatch } = makeDependencies();
    expect(await dispatchOpenRouterCreditAlerts(5, dependencies)).toEqual({
      dispatched: 0,
      suppressed: 0,
    });
    expect(await dispatchOpenRouterCreditAlerts(1.4, dependencies)).toEqual({
      dispatched: 1,
      suppressed: 0,
    });
    expect(dispatch.mock.calls[0][0]).toMatchObject({
      kind: 'openrouter_credit_low',
      severity: 'warning',
    });
    expect(await dispatchOpenRouterCreditAlerts(1.3, dependencies)).toEqual({
      dispatched: 0,
      suppressed: 1,
    });
    expect(await dispatchOpenRouterCreditAlerts(0.1, dependencies)).toEqual({
      dispatched: 1,
      suppressed: 1,
    });
    expect(dispatch.mock.calls[1][0]).toMatchObject({
      kind: 'openrouter_credit_critical',
      severity: 'critical',
    });
  });

  it('une recharge relâche les verrous : la baisse suivante alerte à nouveau', async () => {
    const { dependencies, dispatch } = makeDependencies();
    await dispatchOpenRouterCreditAlerts(0.1, dependencies);
    expect(dispatch).toHaveBeenCalledTimes(2);
    await dispatchOpenRouterCreditAlerts(20, dependencies);
    await dispatchOpenRouterCreditAlerts(1.9, dependencies);
    expect(dispatch).toHaveBeenCalledTimes(3);
  });

  it('lit le crédit restant (total moins usage), null sans clé, erreur si réponse invalide', async () => {
    const ok = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { total_credits: 10, total_usage: 4.9 } }),
    });
    expect(await fetchOpenRouterRemainingUsd({ apiKey: TEST_KEY, fetcher: ok })).toBeCloseTo(5.1);
    expect(ok.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/credits');
    expect(await fetchOpenRouterRemainingUsd({ apiKey: '  ', fetcher: ok })).toBeNull();
    const invalid = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await expect(
      fetchOpenRouterRemainingUsd({ apiKey: TEST_KEY, fetcher: invalid }),
    ).rejects.toThrow('invalid');
    const denied = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    await expect(
      fetchOpenRouterRemainingUsd({ apiKey: TEST_KEY, fetcher: denied }),
    ).rejects.toThrow('401');
  });
});
