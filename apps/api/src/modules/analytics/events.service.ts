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
