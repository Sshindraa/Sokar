import { queues } from '../../shared/queue/queues';
import { logger } from '../../shared/logger/pino';

export type OnboardingAnalyticsEvent =
  | 'onboarding_step_started'
  | 'onboarding_step_completed'
  | 'onboarding_step_skipped'
  | 'onboarding_step_blocked'
  | 'onboarding_activated'
  | 'onboarding_first_call';

type TrackOnboardingEventInput = {
  event: OnboardingAnalyticsEvent;
  restaurantId: string;
  userId?: string | null;
  task?: string;
  metadata?: Record<string, unknown>;
};

export async function trackOnboardingEvent(input: TrackOnboardingEventInput) {
  try {
    await queues.analytics.add('track', {
      ...input,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.warn(
      { err, event: input.event, restaurantId: input.restaurantId },
      '[analytics] track failed',
    );
  }
}

/**
 * Events RGPD émis sur la queue analytics. Objectif : piloter/observer
 * les actions RGPD sans dépendre uniquement du ReservationAuditLog (qui
 * est append-only orienté preuve légale, pas observabilité temps réel).
 *
 *   - rgpd_erasure : déclenché à chaque anonymisation effective
 *     (données trouvées + comptages > 0 ou consentements conservés).
 *   - rgpd_export : déclenché à chaque export subject (succès).
 *   - rgpd_verification_requested : ouverture du flow (OTP/email).
 *
 * Aucun PII brute : on ne stocke que le subjectHashPrefix (8 premiers
 * caractères hex) et des compteurs agrégés.
 */
export type RgpdAnalyticsEvent = 'rgpd_erasure' | 'rgpd_export' | 'rgpd_verification_requested';

type TrackRgpdEventInput = {
  event: RgpdAnalyticsEvent;
  intent?: 'erase' | 'export' | 'withdraw_marketing';
  channel?: 'sms' | 'email' | 'unknown';
  subjectHashPrefix?: string;
  actor?: string;
  metadata?: Record<string, unknown>;
};

export async function trackRgpdEvent(input: TrackRgpdEventInput): Promise<void> {
  try {
    await queues.analytics.add('track', {
      ...input,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    // On ne fait pas échouer un erase/export si la queue est down :
    // l'audit log ReservationAuditLog reste la preuve légale.
    logger.warn({ err, event: input.event }, '[analytics] rgpd track failed');
  }
}
