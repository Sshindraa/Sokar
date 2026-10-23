import { afterEach, describe, expect, it, vi } from 'vitest';

const dispatchAlertMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('../../../shared/redis/client', () => ({ redisCache: {} }));
vi.mock('../../../shared/observability/alert-dispatcher', () => ({
  dispatchAlert: dispatchAlertMock,
}));
vi.mock('../../../shared/logger/pino', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  alertLlmCircuitOpened,
  alertLlmFallbackUnavailable,
  alertLlmPrimaryUnavailable,
  LLM_BOTH_DOWN_THRESHOLD,
  LLM_HEDGE_BURST_THRESHOLD,
  recordLlmBothProvidersFailed,
  recordLlmHedgeFired,
  type LlmAlertDependencies,
} from '../stream/llm-alerts';

function makeDependencies(): LlmAlertDependencies & { advance: (ms: number) => void } {
  const claimed = new Map<string, number>();
  const windows = new Map<string, number[]>();
  let now = 1_000_000;
  return {
    store: {
      set: vi.fn(async (key: string, _v: string, _ex: 'EX', ttl: number, _nx: 'NX') => {
        const expiresAt = claimed.get(key);
        if (expiresAt !== undefined && expiresAt > now) return null;
        claimed.set(key, now + ttl * 1_000);
        return 'OK';
      }),
      zadd: vi.fn(async (key: string, score: number) => {
        windows.set(key, [...(windows.get(key) ?? []), score]);
        return 1;
      }),
      zremrangebyscore: vi.fn(async (key: string, _min: string, max: string) => {
        const cutoff = Number(max.slice(1));
        windows.set(
          key,
          (windows.get(key) ?? []).filter((score) => score >= cutoff),
        );
        return 0;
      }),
      zcount: vi.fn(
        async (key: string, min: number) =>
          (windows.get(key) ?? []).filter((score) => score >= min).length,
      ),
      expire: vi.fn().mockResolvedValue(1),
    },
    dispatch: dispatchAlertMock,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('alertes du modèle vocal', () => {
  afterEach(() => vi.clearAllMocks());

  it('quota épuisé ou clé refusée : une alerte critique par heure et par cause, sans donnée d’appel', async () => {
    const deps = makeDependencies();
    expect(await alertLlmPrimaryUnavailable('quota', deps)).toBe(true);
    expect(await alertLlmPrimaryUnavailable('quota', deps)).toBe(false);
    expect(await alertLlmPrimaryUnavailable('auth', deps)).toBe(true);
    expect(dispatchAlertMock).toHaveBeenCalledTimes(2);
    expect(dispatchAlertMock.mock.calls[0][0]).toMatchObject({
      kind: 'voice_llm_quota',
      severity: 'critical',
    });
    deps.advance(61 * 60 * 1_000);
    expect(await alertLlmPrimaryUnavailable('quota', deps)).toBe(true);
  });

  it('les deux fournisseurs en échec : alerte critique au seuil, puis silence de 30 minutes', async () => {
    const deps = makeDependencies();
    for (let i = 1; i < LLM_BOTH_DOWN_THRESHOLD; i++) {
      expect(await recordLlmBothProvidersFailed('primary_failed', deps)).toBe(false);
    }
    expect(await recordLlmBothProvidersFailed('primary_failed', deps)).toBe(true);
    expect(dispatchAlertMock.mock.calls[0][0]).toMatchObject({
      kind: 'voice_llm_all_providers_down',
      severity: 'critical',
    });
    expect(await recordLlmBothProvidersFailed('primary_failed', deps)).toBe(false);
    deps.advance(31 * 60 * 1_000);
    for (let i = 0; i < LLM_BOTH_DOWN_THRESHOLD - 1; i++)
      await recordLlmBothProvidersFailed('primary_failed', deps);
    expect(await recordLlmBothProvidersFailed('primary_failed', deps)).toBe(true);
  });

  it('un modèle principal seulement lent n’est pas annoncé comme une panne des deux fournisseurs (appel du 19/10)', async () => {
    const deps = makeDependencies();
    for (let i = 0; i < LLM_BOTH_DOWN_THRESHOLD; i++) {
      await recordLlmBothProvidersFailed('primary_slow', deps);
    }
    const alert = dispatchAlertMock.mock.calls[0][0];
    expect(alert.kind).toBe('voice_llm_all_providers_down');
    expect(alert.summary).not.toMatch(/ni cerebras ni/i);
    expect(alert.summary).toMatch(/phrase de repli/);
    expect(alert.detail).toMatch(/aucun texte à temps/);
  });

  it('le secours qui refuse (402) prévient une fois par jour, en avertissement, même pour un doublon', async () => {
    const deps = makeDependencies();
    expect(await alertLlmFallbackUnavailable(402, deps)).toBe(true);
    expect(await alertLlmFallbackUnavailable(402, deps)).toBe(false);
    expect(dispatchAlertMock.mock.calls[0][0]).toMatchObject({
      kind: 'voice_llm_fallback_unavailable',
      severity: 'warning',
    });
    expect(dispatchAlertMock.mock.calls[0][0].summary).toMatch(/crédit/);
    deps.advance(23 * 60 * 60 * 1_000);
    expect(await alertLlmFallbackUnavailable(402, deps)).toBe(false);
    deps.advance(2 * 60 * 60 * 1_000);
    expect(await alertLlmFallbackUnavailable(402, deps)).toBe(true);
  });

  it('une clé de secours refusée (401) a sa propre alerte', async () => {
    const deps = makeDependencies();
    expect(await alertLlmFallbackUnavailable(402, deps)).toBe(true);
    expect(await alertLlmFallbackUnavailable(401, deps)).toBe(true);
    expect(dispatchAlertMock.mock.calls[1][0].summary).toMatch(/clé/);
  });

  it('des échecs espacés de plus de 10 minutes ne déclenchent rien', async () => {
    const deps = makeDependencies();
    for (let i = 0; i < LLM_BOTH_DOWN_THRESHOLD + 2; i++) {
      expect(await recordLlmBothProvidersFailed('primary_failed', deps)).toBe(false);
      deps.advance(11 * 60 * 1_000);
    }
    expect(dispatchAlertMock).not.toHaveBeenCalled();
  });

  it('le doublon de hedging ne prévient que lorsqu’il part en rafale', async () => {
    const deps = makeDependencies();
    for (let i = 1; i < LLM_HEDGE_BURST_THRESHOLD; i++) {
      expect(await recordLlmHedgeFired(deps)).toBe(false);
    }
    expect(await recordLlmHedgeFired(deps)).toBe(true);
    expect(dispatchAlertMock.mock.calls[0][0]).toMatchObject({
      kind: 'voice_llm_primary_slow',
      severity: 'warning',
    });
    expect(await recordLlmHedgeFired(deps)).toBe(false);
  });

  it('l’ouverture du disjoncteur prévient une fois par 30 minutes', async () => {
    const deps = makeDependencies();
    expect(await alertLlmCircuitOpened(deps)).toBe(true);
    expect(await alertLlmCircuitOpened(deps)).toBe(false);
    deps.advance(31 * 60 * 1_000);
    expect(await alertLlmCircuitOpened(deps)).toBe(true);
  });

  it('sans Redis, aucune alerte n’est envoyée et rien n’est levé', async () => {
    const broken: LlmAlertDependencies = {
      store: {
        set: vi.fn().mockRejectedValue(new Error('redis down')),
        zadd: vi.fn().mockRejectedValue(new Error('redis down')),
        zremrangebyscore: vi.fn(),
        zcount: vi.fn(),
        expire: vi.fn(),
      },
      dispatch: dispatchAlertMock,
    };
    expect(await alertLlmPrimaryUnavailable('quota', broken)).toBe(false);
    expect(await recordLlmBothProvidersFailed('primary_failed', broken)).toBe(false);
    expect(dispatchAlertMock).not.toHaveBeenCalled();
  });
});
