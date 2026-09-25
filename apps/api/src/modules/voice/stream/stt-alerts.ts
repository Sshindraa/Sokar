import { randomUUID } from 'node:crypto';
import { redisCache } from '../../../shared/redis/client';
import { dispatchAlert } from '../../../shared/observability/alert-dispatcher';
import { logger } from '../../../shared/logger/pino';

const TERMINAL_ALERT_COOLDOWN_SECONDS = 60 * 60;
const CONNECTION_ALERT_WINDOW_SECONDS = 10 * 60;
export const STT_CONNECTION_ALERT_CALL_THRESHOLD = 5;

const TERMINAL_ALERT_KEY = 'sokar:voice:stt:terminal-alert-cooldown';
const CONNECTION_WINDOW_KEY = 'sokar:voice:stt:connection-unavailable:10m';
const CONNECTION_ALERT_KEY = 'sokar:voice:stt:connection-alert-cooldown:10m';
type SttProviderMetricLabel = 'elevenlabs_stt' | 'deepgram_stt';

type SttAlertStore = {
  set(
    key: string,
    value: string,
    expiryMode: 'EX',
    ttlSeconds: number,
    condition: 'NX',
  ): Promise<string | null>;
  zadd(key: string, score: number, member: string): Promise<number>;
  zremrangebyscore(key: string, min: string, max: string): Promise<number>;
  zcount(key: string, min: number, max: string): Promise<number>;
  expire(key: string, ttlSeconds: number): Promise<number>;
};

interface SttAlertDependencies {
  readonly store: SttAlertStore;
  readonly dispatch: typeof dispatchAlert;
  readonly now?: () => number;
}

const defaultDependencies: SttAlertDependencies = {
  store: redisCache,
  dispatch: dispatchAlert,
};

async function dispatchClaimedAlert(
  key: string,
  ttlSeconds: number,
  payload: Parameters<typeof dispatchAlert>[0],
  dependencies: SttAlertDependencies,
): Promise<boolean> {
  try {
    const claimed = (await dependencies.store.set(key, '1', 'EX', ttlSeconds, 'NX')) === 'OK';
    if (!claimed) return false;
    await dependencies.dispatch(payload);
    return true;
  } catch (error) {
    // Redis failures are fail-closed: avoid unbounded pages during an outage.
    logger.warn({ err: error }, '[stt-alerts] Alert dispatch skipped because cooldown failed');
    return false;
  }
}

/** One global terminal-provider alert per hour; payload intentionally has no call data. */
export async function alertTerminalSttUnavailable(
  reason: 'quota' | 'auth' | 'terms',
  dependencies: SttAlertDependencies = defaultDependencies,
  provider: SttProviderMetricLabel = 'elevenlabs_stt',
): Promise<boolean> {
  const providerName = provider === 'deepgram_stt' ? 'Deepgram' : 'ElevenLabs';
  return dispatchClaimedAlert(
    provider === 'elevenlabs_stt' ? TERMINAL_ALERT_KEY : `${TERMINAL_ALERT_KEY}:${provider}`,
    TERMINAL_ALERT_COOLDOWN_SECONDS,
    {
      kind: `${provider}_${reason}`,
      severity: 'critical',
      summary: `${providerName} STT indisponible : ${reason}`,
      detail: `provider=${provider}\nreason=${reason}`,
    },
    dependencies,
  );
}

/** Count distinct affected calls (the caller invokes this once per session). */
export async function recordSttConnectionUnavailable(
  dependencies: SttAlertDependencies = defaultDependencies,
  provider: SttProviderMetricLabel = 'elevenlabs_stt',
): Promise<boolean> {
  try {
    const now = dependencies.now?.() ?? Date.now();
    const cutoff = now - CONNECTION_ALERT_WINDOW_SECONDS * 1_000;
    const windowKey =
      provider === 'elevenlabs_stt'
        ? CONNECTION_WINDOW_KEY
        : `${CONNECTION_WINDOW_KEY}:${provider}`;
    const alertKey =
      provider === 'elevenlabs_stt' ? CONNECTION_ALERT_KEY : `${CONNECTION_ALERT_KEY}:${provider}`;
    await dependencies.store.zadd(windowKey, now, randomUUID());
    await dependencies.store.zremrangebyscore(windowKey, '-inf', `(${cutoff}`);
    const calls = await dependencies.store.zcount(windowKey, cutoff, '+inf');
    const ttlSet = await dependencies.store.expire(windowKey, CONNECTION_ALERT_WINDOW_SECONDS);
    if (ttlSet !== 1) {
      logger.warn('[stt-alerts] Could not set the connection alert window expiry');
      return false;
    }
    if (calls <= STT_CONNECTION_ALERT_CALL_THRESHOLD) return false;

    return dispatchClaimedAlert(
      alertKey,
      CONNECTION_ALERT_WINDOW_SECONDS,
      {
        kind: `${provider}_connection_burst`,
        severity: 'warning',
        summary:
          provider === 'elevenlabs_stt'
            ? 'Plus de cinq appels ont subi une indisponibilité STT en 10 minutes'
            : `Plus de cinq appels ont subi une indisponibilité ${providerName(provider)} STT en 10 minutes`,
        detail: [
          `provider=${provider}`,
          `affectedCalls=${calls}`,
          `windowSeconds=${CONNECTION_ALERT_WINDOW_SECONDS}`,
        ].join('\n'),
      },
      dependencies,
    );
  } catch (error) {
    logger.warn({ err: error }, '[stt-alerts] Could not count unavailable STT calls');
    return false;
  }
}

function providerName(provider: SttProviderMetricLabel): string {
  return provider === 'deepgram_stt' ? 'Deepgram' : 'ElevenLabs';
}
