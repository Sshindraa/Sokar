/**
 * Abstraction multi-canal pour l'envoi de messages.
 *
 * Rappel J-1 : WhatsApp uniquement pour une reservation WEB avec accord.
 * Aucun rappel SMS, meme si WhatsApp est absent ou refuse l'envoi.
 * Les claims historiques des deux canaux restent proteges contre les doublons.
 * La reactivation marketing SMS est un parcours distinct, inchange.
 */

import { sendSms } from '../telnyx/client';
import {
  getWhatsAppProvider,
  isWhatsAppConfigured,
  sendWhatsAppTemplate,
} from '../whatsapp/client';
import { trackMessagingEvent } from '../../modules/analytics/events.service';
import { logger } from '../logger/pino';
import { recordNotificationProviderResult } from '../observability/metrics';
import type { MessagingUsageContext } from '../../modules/usage/messaging-usage.service';
import {
  acquireNotificationClaim,
  buildNotificationClaimKey,
  classifyNotificationError,
  enqueueNotificationReconciliation,
  getNotificationClaim,
  getNotificationErrorProviderMessageId,
  normalizeNotificationSendResult,
  recordNotificationResult,
  type NotificationClaimRecord,
  type NotificationClaimStore,
  type NotificationProvider,
  type NotificationProviderResult,
  type NotificationReconciliationQueue,
  type NotificationSendResult,
} from '../queue/notification-idempotency';

export type MessageChannel = 'whatsapp' | 'sms';

export interface SendReminderParams {
  to: string;
  restaurantName: string;
  restaurantId?: string;
  reservationId?: string;
  customerId?: string;
  date: string; // déjà formaté en français
  time: string;
  partySize: number;
  /** Explicit agreement for WhatsApp reminders on this reservation only. */
  whatsappOptIn?: boolean;
  reservationChannel?: string;
}

export interface SendReminderOptions {
  /** Enables channel-specific claims when called from a protected worker. */
  claimStore?: NotificationClaimStore;
  reconciliationQueue?: NotificationReconciliationQueue;
}

export interface SendResult {
  skipped?:
    | 'non_web_booking'
    | 'no_whatsapp_consent'
    | 'whatsapp_unavailable'
    | 'outside_reminder_window'
    | 'missing_recipient';
  channel: MessageChannel;
  success: boolean;
  outcome?: NotificationProviderResult;
  provider?: NotificationProvider;
  providerMessageId?: string;
  error?: string;
}

interface ReminderClaimHandle {
  key: string;
  token: string;
}

function asSendResult(
  result: NotificationSendResult | void,
  provider: NotificationProvider,
  channel: MessageChannel,
): SendResult {
  const normalized = normalizeNotificationSendResult(result, provider, channel);
  recordNotificationProviderResult(provider, channel, normalized.outcome);
  return {
    channel,
    success: normalized.outcome === 'success',
    outcome: normalized.outcome,
    provider: normalized.provider,
    ...(normalized.providerMessageId ? { providerMessageId: normalized.providerMessageId } : {}),
  };
}

function asErrorResult(
  error: unknown,
  provider: NotificationProvider,
  channel: MessageChannel,
): SendResult {
  const outcome = classifyNotificationError(error);
  const providerMessageId = getNotificationErrorProviderMessageId(error);
  recordNotificationProviderResult(provider, channel, outcome);
  return {
    channel,
    success: false,
    outcome,
    provider,
    ...(providerMessageId ? { providerMessageId } : {}),
    error: error instanceof Error ? error.message : String(error),
  };
}

async function trackReminderEvent(input: Parameters<typeof trackMessagingEvent>[0]): Promise<void> {
  try {
    await trackMessagingEvent(input);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      '[messaging] analytics failed',
    );
  }
}

async function retainClaimResult(
  claimStore: NotificationClaimStore | undefined,
  reconciliationQueue: NotificationReconciliationQueue | undefined,
  claim: ReminderClaimHandle | undefined,
  result: SendResult,
): Promise<void> {
  if (!claimStore || !claim || !result.outcome || !result.provider) return;

  try {
    const transitioned = await recordNotificationResult(
      claimStore,
      claim.key,
      claim.token,
      result.outcome,
      {
        provider: result.provider,
        channel: result.channel,
        ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
      },
    );
    if (result.outcome === 'unknown' && transitioned && reconciliationQueue) {
      await enqueueNotificationReconciliation(reconciliationQueue, {
        claimKey: claim.key,
        provider: result.provider,
        channel: result.channel,
        ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
      });
    }
  } catch (err) {
    // Never release an unknown claim because Redis or the reconciliation
    // queue is unavailable. The next job run can requeue it from its state.
    logger.error(
      {
        provider: result.provider,
        channel: result.channel,
        outcome: result.outcome,
        err: err instanceof Error ? err.message : String(err),
      },
      '[messaging] failed to persist notification result',
    );
  }
}

async function resultForExistingClaim(
  record: NotificationClaimRecord,
  claimKey: string,
  reconciliationQueue: NotificationReconciliationQueue | undefined,
  fallbackProvider: NotificationProvider,
  fallbackChannel: MessageChannel,
): Promise<SendResult> {
  const provider = record.provider ?? fallbackProvider;
  const channel =
    record.channel === 'sms' || record.channel === 'whatsapp' ? record.channel : fallbackChannel;
  if (record.status === 'unknown' && reconciliationQueue && record.provider && record.channel) {
    try {
      await enqueueNotificationReconciliation(reconciliationQueue, {
        claimKey,
        provider: record.provider,
        channel: record.channel,
        ...(record.providerMessageId ? { providerMessageId: record.providerMessageId } : {}),
      });
    } catch (err) {
      logger.error(
        {
          provider: record.provider,
          channel: record.channel,
          outcome: 'unknown',
          err: err instanceof Error ? err.message : String(err),
        },
        '[messaging] failed to requeue unknown notification',
      );
    }
  }

  if (record.status === 'success') {
    return {
      channel,
      success: true,
      outcome: 'success',
      provider,
      ...(record.providerMessageId ? { providerMessageId: record.providerMessageId } : {}),
    };
  }
  return { channel, success: false, outcome: 'unknown', provider };
}

async function findExistingReminderClaim(
  params: SendReminderParams,
  options: SendReminderOptions,
): Promise<SendResult | null> {
  if (!options.claimStore || !params.reservationId) return null;

  const candidates: Array<{ channel: MessageChannel; provider: NotificationProvider }> = [
    { channel: 'whatsapp', provider: getWhatsAppProvider() },
    { channel: 'sms', provider: 'telnyx' },
  ];
  let successfulClaim: SendResult | null = null;
  for (const candidate of candidates) {
    const key = buildNotificationClaimKey(
      `reservation-reminder-${candidate.channel}`,
      params.reservationId,
    );
    const record = await getNotificationClaim(options.claimStore, key);
    if (!record) continue;
    if (record.status !== 'success') {
      return resultForExistingClaim(
        record,
        key,
        options.reconciliationQueue,
        candidate.provider,
        candidate.channel,
      );
    }
    successfulClaim = await resultForExistingClaim(
      record,
      key,
      options.reconciliationQueue,
      candidate.provider,
      candidate.channel,
    );
  }
  return successfulClaim;
}

async function acquireReminderChannelClaim(
  params: SendReminderParams,
  options: SendReminderOptions,
  channel: MessageChannel,
): Promise<ReminderClaimHandle | SendResult | null> {
  if (!options.claimStore || !params.reservationId) return null;
  const key = buildNotificationClaimKey(`reservation-reminder-${channel}`, params.reservationId);
  const provider = channel === 'whatsapp' ? getWhatsAppProvider() : 'telnyx';
  const attempt = await acquireNotificationClaim(options.claimStore, key, {
    provider,
    channel,
  });
  if (attempt.acquired && attempt.token) return { key, token: attempt.token };
  if (attempt.record) {
    return resultForExistingClaim(
      attempt.record,
      key,
      options.reconciliationQueue,
      provider,
      channel,
    );
  }
  return { channel, success: false, outcome: 'unknown', provider };
}

/**
 * Envoie un rappel de réservation J-1.
 * WhatsApp uniquement, sans secours SMS.
 */
export async function sendReminder(
  params: SendReminderParams,
  options: SendReminderOptions = {},
): Promise<SendResult> {
  // Preserve historical SMS/WhatsApp claims so a policy change never duplicates
  // an already accepted or ambiguous reminder.
  const existingClaim = await findExistingReminderClaim(params, options);
  if (existingClaim) return existingClaim;

  const skipped =
    params.reservationChannel !== 'WEB'
      ? 'non_web_booking'
      : params.whatsappOptIn !== true
        ? 'no_whatsapp_consent'
        : !isWhatsAppConfigured()
          ? 'whatsapp_unavailable'
          : undefined;
  if (skipped) return { channel: 'whatsapp', success: false, skipped };

  const claim = await acquireReminderChannelClaim(params, options, 'whatsapp');
  if (claim && 'outcome' in claim) return claim;
  const usageContext: MessagingUsageContext | undefined =
    params.restaurantId && params.reservationId
      ? {
          restaurantId: params.restaurantId,
          sourceType: 'reservation_reminder',
          sourceId: params.reservationId,
          metadata: { messageType: 'reservation_reminder' },
        }
      : undefined;
  let result: SendResult;
  try {
    result = asSendResult(
      await sendWhatsAppTemplate(
        params.to,
        'reservation_reminder',
        'fr',
        [params.restaurantName, params.date, params.time, String(params.partySize)],
        usageContext,
      ),
      getWhatsAppProvider(),
      'whatsapp',
    );
  } catch (error: unknown) {
    result = asErrorResult(error, getWhatsAppProvider(), 'whatsapp');
  }
  await retainClaimResult(
    options.claimStore,
    options.reconciliationQueue,
    claim && 'token' in claim ? claim : undefined,
    result,
  );
  await trackReminderEvent({
    event: 'reminder_sent',
    channel: 'whatsapp',
    restaurantId: params.restaurantId,
    reservationId: params.reservationId,
    customerId: params.customerId,
    success: result.outcome === 'success',
    ...(result.error ? { error: result.error } : {}),
  });
  // A refused WhatsApp reminder can be retried on WhatsApp only, never by SMS.
  return result;
}

/**
 * Envoie un SMS de réactivation VIP.
 * Toujours SMS — WhatsApp marketing coûte 5x plus cher et nécessite un opt-in.
 */
export async function sendReactivation(
  to: string,
  restaurantName: string,
  customerName: string,
  restaurantPhone: string,
  usageContext?: MessagingUsageContext,
): Promise<SendResult> {
  const firstName = customerName.split(' ')[0] || customerName;
  const text = `Bonjour ${firstName}, cela fait un moment qu'on ne vous a pas vu chez ${restaurantName}. On serait ravis de vous revoir ! Réservez au ${restaurantPhone}.`;

  try {
    const result = normalizeNotificationSendResult(
      await sendSms(to, text, usageContext),
      'telnyx',
      'sms',
    );
    return {
      channel: 'sms',
      success: result.outcome === 'success',
      outcome: result.outcome,
      provider: result.provider,
      ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { channel: 'sms', success: false, error: message };
  }
}
