import { voiceConfig } from '../../env';
import { logger } from '../../shared/logger/pino';
import { voiceNoiseSuppressionTotal } from '../../shared/observability/metrics';
import { telnyxFetch } from '../../shared/telnyx/http-agent';
import type { CallSession } from './stream/types';

/**
 * Suppression de bruit Telnyx (bêta) sur l'audio reçu de l'appelant, avant qu'il n'atteigne la
 * transcription. Désactivée par défaut, réservée aux restaurants listés : elle change le signal
 * que Deepgram entend, donc elle s'essaie appel par appel avant toute généralisation.
 *
 * `direction` est définie du point de vue de Telnyx : `outbound` est l'audio reçu de l'appelant
 * (celui qu'on transcrit), `inbound` celui que l'appelant entend. Pour la parole, la
 * documentation Telnyx prescrit `outbound` ; `both` doublerait la facturation sans bénéfice ici.
 */
export function noiseSuppressionEngineFor(restaurantId: string): string | null {
  const engine = voiceConfig.VOICE_NOISE_SUPPRESSION_ENGINE;
  if (engine === 'off') return null;
  const allowed = (voiceConfig.VOICE_NOISE_SUPPRESSION_RESTAURANT_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return allowed.includes(restaurantId) ? engine : null;
}

/** Ne bloque jamais l'appel : un échec est compté et journalisé, l'appel continue sans suppression. */
export async function startNoiseSuppression(session: CallSession): Promise<void> {
  const engine = noiseSuppressionEngineFor(session.restaurantId);
  if (!engine) return;
  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) return;

  const startedAt = Date.now();
  try {
    const response = await telnyxFetch(
      `/v2/calls/${encodeURIComponent(session.callControlId)}/actions/suppression_start`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction: 'outbound', noise_suppression_engine: engine }),
      },
    );
    if (response.ok) {
      voiceNoiseSuppressionTotal.inc({ engine, outcome: 'started' });
      logger.info(
        { callId: session.callControlId, engine, ms: Date.now() - startedAt },
        '[noise-suppression] started',
      );
      return;
    }
    const detail = (await response.text()).slice(0, 200);
    voiceNoiseSuppressionTotal.inc({ engine, outcome: 'rejected' });
    logger.warn(
      { callId: session.callControlId, engine, status: response.status, detail },
      '[noise-suppression] Telnyx refused suppression_start',
    );
  } catch (err) {
    voiceNoiseSuppressionTotal.inc({ engine, outcome: 'error' });
    logger.warn(
      { callId: session.callControlId, engine, err: err instanceof Error ? err.message : err },
      '[noise-suppression] suppression_start failed',
    );
  }
}
