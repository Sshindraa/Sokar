import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CircuitBreaker,
  CircuitOpenError,
  ProviderTimeoutError,
  fetchWithTimeout,
  isRetryableProviderError,
  retry,
  withTimeout,
} from '../index';

describe('withTimeout', () => {
  it('rend le résultat quand l’appel répond à temps', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50, 'test')).resolves.toBe('ok');
  });

  it('rejette avec ProviderTimeoutError quand l’appel ne répond pas', async () => {
    const never = new Promise<string>(() => {});
    await expect(withTimeout(never, 10, 'cartesia-tts')).rejects.toBeInstanceOf(
      ProviderTimeoutError,
    );
  });

  it('ne laisse pas de timer actif après un succès', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(Promise.resolve(1), 10_000, 'test');
    await expect(pending).resolves.toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});

describe('fetchWithTimeout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('convertit une annulation par timeout en ProviderTimeoutError', async () => {
    vi.stubGlobal(
      'fetch',
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    await expect(fetchWithTimeout('https://api.example.test', {}, 10)).rejects.toBeInstanceOf(
      ProviderTimeoutError,
    );
  });

  it('propage les erreurs non liées au timeout', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('boom')));
    await expect(fetchWithTimeout('https://api.example.test')).rejects.toThrow('boom');
  });
});

describe('isRetryableProviderError', () => {
  it('rejoue les erreurs transitoires', () => {
    expect(isRetryableProviderError(new ProviderTimeoutError('x', 10))).toBe(true);
    expect(isRetryableProviderError(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe(
      true,
    );
    expect(isRetryableProviderError(Object.assign(new Error('x'), { status: 503 }))).toBe(true);
    expect(isRetryableProviderError(Object.assign(new Error('x'), { status: 429 }))).toBe(true);
    expect(isRetryableProviderError(new Error('fetch failed'))).toBe(true);
  });

  it('ne rejoue pas les erreurs définitives', () => {
    expect(isRetryableProviderError(Object.assign(new Error('x'), { status: 400 }))).toBe(false);
    expect(isRetryableProviderError(new Error('invalid token'))).toBe(false);
    expect(isRetryableProviderError(undefined)).toBe(false);
  });
});

describe('retry', () => {
  const fastSleep = async () => {};

  it('réessaie jusqu’au succès', async () => {
    let calls = 0;
    const result = await retry(
      async () => {
        calls += 1;
        if (calls < 3) throw new ProviderTimeoutError('x', 10);
        return 'ok';
      },
      { attempts: 3, sleep: fastSleep, random: () => 0.5 },
    );

    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('abandonne après le nombre de tentatives', async () => {
    let calls = 0;
    await expect(
      retry(
        async () => {
          calls += 1;
          throw new ProviderTimeoutError('x', 10);
        },
        { attempts: 2, sleep: fastSleep, random: () => 0.5 },
      ),
    ).rejects.toBeInstanceOf(ProviderTimeoutError);
    expect(calls).toBe(2);
  });

  it('ne réessaie pas une erreur définitive', async () => {
    let calls = 0;
    await expect(
      retry(
        async () => {
          calls += 1;
          throw Object.assign(new Error('bad request'), { status: 400 });
        },
        { attempts: 3, sleep: fastSleep },
      ),
    ).rejects.toThrow('bad request');
    expect(calls).toBe(1);
  });

  it('applique un backoff exponentiel borné et notifie chaque tentative', async () => {
    const delays: number[] = [];
    await expect(
      retry(
        async () => {
          throw new ProviderTimeoutError('x', 10);
        },
        {
          attempts: 4,
          baseDelayMs: 100,
          maxDelayMs: 250,
          random: () => 0.5,
          sleep: async (ms) => {
            delays.push(ms);
          },
        },
      ),
    ).rejects.toBeInstanceOf(ProviderTimeoutError);

    // 100, 200 puis plafonné à 250 (jitter neutre avec random = 0.5).
    expect(delays).toEqual([100, 200, 250]);
  });
});

describe('CircuitBreaker', () => {
  function makeBreaker(now: { value: number }) {
    return new CircuitBreaker({
      name: 'cartesia',
      failureThreshold: 3,
      cooldownMs: 1_000,
      now: () => now.value,
    });
  }

  it('reste fermé tant que le seuil n’est pas atteint', async () => {
    const now = { value: 0 };
    const breaker = makeBreaker(now);
    const failing = () => Promise.reject(new Error('down'));

    await expect(breaker.execute(failing)).rejects.toThrow('down');
    await expect(breaker.execute(failing)).rejects.toThrow('down');
    expect(breaker.state).toBe('closed');
    expect(breaker.consecutiveFailures).toBe(2);
  });

  it('ouvre après trois échecs et refuse sans appeler le fournisseur', async () => {
    const now = { value: 0 };
    const breaker = makeBreaker(now);
    const failing = () => Promise.reject(new Error('down'));

    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(failing)).rejects.toThrow('down');
    }
    expect(breaker.state).toBe('open');

    const operation = vi.fn().mockResolvedValue('never');
    await expect(breaker.execute(operation)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(operation).not.toHaveBeenCalled();
  });

  it('passe en half-open après le cooldown et se referme au premier succès', async () => {
    const now = { value: 0 };
    const breaker = makeBreaker(now);
    const failing = () => Promise.reject(new Error('down'));

    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(failing)).rejects.toThrow('down');
    }

    now.value = 1_000;
    expect(breaker.state).toBe('half-open');

    await expect(breaker.execute(async () => 'recovered')).resolves.toBe('recovered');
    expect(breaker.state).toBe('closed');
    expect(breaker.consecutiveFailures).toBe(0);
  });

  it('repart pour un cooldown complet si la sonde half-open échoue', async () => {
    const now = { value: 0 };
    const breaker = makeBreaker(now);
    const failing = () => Promise.reject(new Error('down'));

    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(failing)).rejects.toThrow('down');
    }

    now.value = 1_000;
    await expect(breaker.execute(failing)).rejects.toThrow('down');
    expect(breaker.state).toBe('open');

    now.value = 1_500;
    expect(breaker.state).toBe('open');
    now.value = 2_000;
    expect(breaker.state).toBe('half-open');
  });

  it('n’autorise qu’une seule sonde simultanée en half-open', async () => {
    const now = { value: 0 };
    const breaker = makeBreaker(now);
    const failing = () => Promise.reject(new Error('down'));

    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(failing)).rejects.toThrow('down');
    }
    now.value = 1_000;

    let release: (value: string) => void = () => {};
    const inFlight = breaker.execute(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );

    await expect(breaker.execute(async () => 'second')).rejects.toBeInstanceOf(CircuitOpenError);
    release('first');
    await expect(inFlight).resolves.toBe('first');
  });
});
