import { afterEach, describe, expect, it, vi } from 'vitest';

const dispatchAlertMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('../../../shared/redis/client', () => ({
  redisCache: {
    set: vi.fn(),
    zadd: vi.fn(),
    zremrangebyscore: vi.fn(),
    zcount: vi.fn(),
    expire: vi.fn(),
  },
}));
vi.mock('../../../shared/observability/alert-dispatcher', () => ({
  dispatchAlert: dispatchAlertMock,
}));

import {
  alertTerminalSttUnavailable,
  recordSttConnectionUnavailable,
  STT_CONNECTION_ALERT_CALL_THRESHOLD,
} from '../stream/stt-alerts';

function makeStore() {
  const keys = new Set<string>();
  const eventTimes: number[] = [];
  let now = 1_000_000;
  return {
    set: vi.fn(async (key: string, _value: string, _ex: 'EX', _ttl: number, _nx: 'NX') => {
      if (keys.has(key)) return null;
      keys.add(key);
      return 'OK';
    }),
    zadd: vi.fn(async (_key: string, score: number, _member: string) => {
      eventTimes.push(score);
      return 1;
    }),
    zremrangebyscore: vi.fn(async (_key: string, _min: string, max: string) => {
      const cutoff = Number(max.slice(1));
      const retained = eventTimes.filter((score) => score >= cutoff);
      const removed = eventTimes.length - retained.length;
      eventTimes.splice(0, eventTimes.length, ...retained);
      return removed;
    }),
    zcount: vi.fn(
      async (_key: string, min: number, _max: string) =>
        eventTimes.filter((score) => score >= min).length,
    ),
    expire: vi.fn().mockResolvedValue(1),
    now: () => now,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

describe('alertes d’indisponibilité STT', () => {
  afterEach(() => vi.clearAllMocks());

  it('envoie une seule alerte critique globale par heure pour quota/auth/terms', async () => {
    const store = makeStore();
    const dispatch = vi.fn().mockResolvedValue([]);
    const dependencies = { store, dispatch, now: store.now };

    await alertTerminalSttUnavailable('auth', dependencies);
    await alertTerminalSttUnavailable('quota', dependencies);
    await alertTerminalSttUnavailable('terms', dependencies);

    expect(store.set).toHaveBeenCalledWith(
      'sokar:voice:stt:terminal-alert-cooldown',
      '1',
      'EX',
      3_600,
      'NX',
    );
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith({
      kind: 'elevenlabs_stt_auth',
      severity: 'critical',
      summary: 'ElevenLabs STT indisponible : auth',
      detail: 'provider=elevenlabs_stt\nreason=auth',
    });
    const message = JSON.stringify(dispatch.mock.calls[0]?.[0]);
    expect(message).not.toMatch(/cc-stt|cs-stt|\+33|callId|phone/i);
  });

  it('alerte en avertissement au sixième appel touché dans la fenêtre de dix minutes', async () => {
    const store = makeStore();
    const dispatch = vi.fn().mockResolvedValue([]);
    const dependencies = { store, dispatch, now: store.now };

    for (let call = 0; call < 3; call++) {
      await recordSttConnectionUnavailable(dependencies);
    }
    expect(dispatch).not.toHaveBeenCalled();

    store.advance(9 * 60 * 1_000);
    for (let call = 0; call < 3; call++) {
      await recordSttConnectionUnavailable(dependencies);
    }

    await recordSttConnectionUnavailable(dependencies);

    expect(store.expire).toHaveBeenCalledWith('sokar:voice:stt:connection-unavailable:10m', 600);
    expect(store.zremrangebyscore).toHaveBeenLastCalledWith(
      'sokar:voice:stt:connection-unavailable:10m',
      '-inf',
      `(940000`,
    );
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith({
      kind: 'elevenlabs_stt_connection_burst',
      severity: 'warning',
      summary: 'Plus de cinq appels ont subi une indisponibilité STT en 10 minutes',
      detail: 'provider=elevenlabs_stt\naffectedCalls=6\nwindowSeconds=600',
    });
    const message = JSON.stringify(dispatch.mock.calls[0]?.[0]);
    expect(message).not.toMatch(/cc-stt|cs-stt|\+33|callId|phone/i);
  });
});
