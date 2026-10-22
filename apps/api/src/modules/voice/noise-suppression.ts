import { logger } from '../../shared/logger/pino';
import { voiceNoiseSuppressionTotal } from '../../shared/observability/metrics';
import { telnyxFetch } from '../../shared/telnyx/http-agent';
import type { CallSession } from './stream/types';

/**
 * Suppression de bruit Telnyx Krisp (bêta) sur l'audio reçu de l'appelant, avant qu'il n'atteigne la
 * transcription, pour tous les restaurants.
 *
 * `direction` est définie du point de vue de Telnyx : `outbound` est l'audio reçu de l'appelant
 * (celui qu'on transcrit), `inbound` celui que l'appelant entend. Pour la parole, la
 * documentation Telnyx prescrit `outbound` ; `both` doublerait la facturation sans bénéfice ici.
 */
export const NOISE_SUPPRESSION_ENGINE = 'Krisp';

/** Ne bloque jamais l'appel : un échec est compté et journalisé, l'appel continue sans suppression. */
export async function startNoiseSuppression(session: CallSession): Promise<void> {
  const engine = NOISE_SUPPRESSION_ENGINE;
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
