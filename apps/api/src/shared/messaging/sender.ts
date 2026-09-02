/**
 * Abstraction multi-canal pour l'envoi de messages.
 *
 * Stratégie :
 * - Rappel J-1 (utility) → WhatsApp si configuré, sinon SMS
 * - Réactivation VIP (marketing) → toujours SMS (WhatsApp marketing coûte 5x plus cher + opt-in requis)
 * - Messages transactionnels (annulation, etc.) → WhatsApp si configuré, sinon SMS
 *
 * Le fallback SMS intervient si WhatsApp n'est pas configuré ou après un refus certain de WhatsApp ;
 * un résultat inconnu bloque le second canal jusqu'à réconciliation.
 * Chaque envoi émet un event analytics `reminder_sent` avec le canal pour comparer
 * open rate SMS vs WhatsApp et justifier l'économie.
 */

import { sendSms } from '../telnyx/client';
import { isWhatsAppConfigured, sendWhatsAppTemplate } from '../whatsapp/client';
import { trackMessagingEvent } from '../../modules/analytics/events.service';
import { logger } from '../logger/pino';
import { recordNotificationProviderResult } from '../observability/metrics';
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
}

export interface SendReminderOptions {
  /** Enables channel-specific claims when called from a protected worker. */
  claimStore?: NotificationClaimStore;
  reconciliationQueue?: NotificationReconciliationQueue;
}

export interface SendResult {
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
    { channel: 'whatsapp', provider: 'telnyx' },
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
  const attempt = await acquireNotificationClaim(options.claimStore, key, {
    provider: 'telnyx',
    channel,
  });
  if (attempt.acquired && attempt.token) return { key, token: attempt.token };
  if (attempt.record) {
    return resultForExistingClaim(
      attempt.record,
      key,
      options.reconciliationQueue,
      'telnyx',
      channel,
    );
  }
  return { channel, success: false, outcome: 'unknown', provider: 'telnyx' };
}

/**
 * Envoie un rappel de réservation J-1.
 * WhatsApp (utility template) si configuré, sinon SMS.
 */
export async function sendReminder(
  params: SendReminderParams,
  options: SendReminderOptions = {},
): Promise<SendResult> {
  const { to, restaurantName, restaurantId, reservationId, customerId, date, time, partySize } =
    params;

  let fellBackFromWhatsApp = false;

  // A retry must inspect both channel claims before selecting a provider. This
  // prevents a previous unknown SMS result from causing a fresh WhatsApp call.
  const existingClaim = await findExistingReminderClaim(params, options);
  if (existingClaim) return existingClaim;

  if (isWhatsAppConfigured()) {
    const whatsappClaim = await acquireReminderChannelClaim(params, options, 'whatsapp');
    if (whatsappClaim && 'outcome' in whatsappClaim) return whatsappClaim;

    try {
      const providerResult = asSendResult(
        await sendWhatsAppTemplate(to, 'reservation_reminder', 'fr', [
          restaurantName,
          date,
          time,
          String(partySize),
        ]),
        'telnyx',
        'whatsapp',
      );
      await retainClaimResult(
        options.claimStore,
        options.reconciliationQueue,
        whatsappClaim && 'token' in whatsappClaim ? whatsappClaim : undefined,
        providerResult,
      );
      if (providerResult.outcome === 'success') {
        await trackReminderEvent({
          event: 'reminder_sent',
          channel: 'whatsapp',
          restaurantId,
          reservationId,
          customerId,
          success: true,
        });
        return providerResult;
      }
      if (providerResult.outcome === 'unknown') return providerResult;
      fellBackFromWhatsApp = true;
      await trackReminderEvent({
        event: 'whatsapp_fallback_to_sms',
        channel: 'whatsapp',
        restaurantId,
        reservationId,
        customerId,
        success: false,
      });
    } catch (err: unknown) {
      const providerResult = asErrorResult(err, 'telnyx', 'whatsapp');
      await retainClaimResult(
        options.claimStore,
        options.reconciliationQueue,
        whatsappClaim && 'token' in whatsappClaim ? whatsappClaim : undefined,
        providerResult,
      );
      if (providerResult.outcome === 'unknown') return providerResult;
      fellBackFromWhatsApp = true;
      await trackReminderEvent({
        event: 'whatsapp_fallback_to_sms',
        channel: 'whatsapp',
        restaurantId,
        reservationId,
        customerId,
        success: false,
        error: providerResult.error,
      });
    }
  }

  const smsClaim = await acquireReminderChannelClaim(params, options, 'sms');
  if (smsClaim && 'outcome' in smsClaim) return smsClaim;

  // SMS fallback (ou canal par défaut si WhatsApp non configuré).
  try {
    const smsText = `Rappel ${restaurantName}: votre réservation ${date} à ${time} pour ${partySize} pers. Nous avons hâte de vous accueillir.`;
    const providerResult = asSendResult(await sendSms(to, smsText), 'telnyx', 'sms');
    await retainClaimResult(
      options.claimStore,
      options.reconciliationQueue,
      smsClaim && 'token' in smsClaim ? smsClaim : undefined,
      providerResult,
    );
    await trackReminderEvent({
      event: 'reminder_sent',
      channel: 'sms',
      restaurantId,
      reservationId,
      customerId,
      success: providerResult.outcome === 'success',
      ...(providerResult.error ? { error: providerResult.error } : {}),
      metadata: fellBackFromWhatsApp ? { fellBackFromWhatsApp: true } : undefined,
    });
    return providerResult;
  } catch (err: unknown) {
    const providerResult = asErrorResult(err, 'telnyx', 'sms');
    await retainClaimResult(
      options.claimStore,
      options.reconciliationQueue,
      smsClaim && 'token' in smsClaim ? smsClaim : undefined,
      providerResult,
    );
    await trackReminderEvent({
      event: 'reminder_sent',
      channel: 'sms',
      restaurantId,
      reservationId,
      customerId,
      success: false,
      error: providerResult.error,
      metadata: fellBackFromWhatsApp ? { fellBackFromWhatsApp: true } : undefined,
    });
    return providerResult;
  }
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
): Promise<SendResult> {
  const firstName = customerName.split(' ')[0] || customerName;
  const text = `Bonjour ${firstName}, cela fait un moment qu'on ne vous a pas vu chez ${restaurantName}. On serait ravis de vous revoir ! Réservez au ${restaurantPhone}.`;

  try {
    await sendSms(to, text);
    return { channel: 'sms', success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { channel: 'sms', success: false, error: message };
  }
}
