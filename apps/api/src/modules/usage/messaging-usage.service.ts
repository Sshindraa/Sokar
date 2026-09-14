import type { UsageCategory } from '@prisma/client';
import { logger } from '../../shared/logger/pino';
import { enqueueOnDatabase } from '../../shared/outbox/outbox.service';

/**
 * Business context attached to an accepted provider request.
 *
 * The context deliberately contains identifiers only. Recipient addresses and
 * message bodies must never be copied to the transactional outbox.
 */
export interface MessagingUsageContext {
  readonly restaurantId: string;
  readonly accountId?: string | null;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly occurredAt?: Date;
  readonly metadata?: Record<string, string | number | boolean | null>;
}

export type MessagingUsageChannel = 'sms' | 'whatsapp' | 'email';

const GSM_7_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'.split(
    '',
  ),
);

// These characters consume an escape septet in GSM-03.38 and therefore count
// as two units when calculating the number of billable SMS segments.
const GSM_7_EXTENDED = new Set('^{}\\[~]|€'.split(''));

/** Count GSM-7 septets or UTF-16 code units for one message. */
export function countSmsUnits(text: string): { units: number; encoding: 'gsm7' | 'ucs2' } {
  let gsm7 = true;
  let units = 0;
  for (const character of text) {
    if (GSM_7_BASIC.has(character)) {
      units += 1;
    } else if (GSM_7_EXTENDED.has(character)) {
      units += 2;
    } else {
      gsm7 = false;
      break;
    }
  }

  if (gsm7) return { units, encoding: 'gsm7' };
  // JavaScript's string length matches the UTF-16 code units used by the
  // UCS-2/Unicode SMS size calculation, including astral symbols.
  return { units: text.length, encoding: 'ucs2' };
}

/** Return the number of provider-billed SMS segments for a message body. */
export function countSmsSegments(text: string): number {
  const { units, encoding } = countSmsUnits(text);
  if (units === 0) return 0;
  const singleLimit = encoding === 'gsm7' ? 160 : 70;
  const concatenatedLimit = encoding === 'gsm7' ? 153 : 67;
  return units <= singleLimit ? 1 : Math.ceil(units / concatenatedLimit);
}

export function usageCategoryForChannel(channel: MessagingUsageChannel): UsageCategory {
  switch (channel) {
    case 'sms':
      return 'SMS_SEGMENTS';
    case 'whatsapp':
      return 'WHATSAPP_MESSAGES';
    case 'email':
      return 'EMAIL_MESSAGES';
  }
}

/**
 * Build the stable idempotency key shared by the outbox and usage ledger.
 * Source ids are business ids (reservation, call, campaign), never addresses.
 */
export function buildMessagingUsageKey(
  context: Pick<MessagingUsageContext, 'sourceType' | 'sourceId'>,
  channel: MessagingUsageChannel,
): string {
  return `messaging:${channel}:${context.sourceType.trim()}:${context.sourceId.trim()}:accepted`;
}

function normalizeDate(value: Date | undefined): Date {
  const date = value ?? new Date();
  if (Number.isNaN(date.getTime())) throw new Error('messaging usage occurredAt must be valid');
  return date;
}

/**
 * Append an accepted messaging request to the durable usage outbox.
 *
 * Provider acceptance has already happened when this function runs. A ledger
 * failure must therefore never make the caller retry the provider request and
 * risk a duplicate message; the failure is logged for operational repair.
 */
export async function recordAcceptedMessagingUsage(input: {
  readonly channel: MessagingUsageChannel;
  readonly provider: string;
  readonly text?: string;
  readonly providerMessageId?: string;
  readonly context: MessagingUsageContext;
}): Promise<void> {
  const { context } = input;
  const restaurantId = context.restaurantId.trim();
  const sourceType = context.sourceType.trim();
  const sourceId = context.sourceId.trim();
  if (!restaurantId || !sourceType || !sourceId) {
    logger.error(
      { channel: input.channel, sourceType, sourceId },
      '[usage] accepted message missing ledger identifiers',
    );
    return;
  }

  const category = usageCategoryForChannel(input.channel);
  const quantity = input.channel === 'sms' ? countSmsSegments(input.text ?? '') : 1;
  if (quantity <= 0) {
    logger.warn(
      { channel: input.channel, sourceType, sourceId },
      '[usage] accepted message has no billable units',
    );
    return;
  }

  try {
    const sourceEventKey = buildMessagingUsageKey({ sourceType, sourceId }, input.channel);
    const occurredAt = normalizeDate(context.occurredAt);
    const provider = input.provider.trim().toLowerCase();
    const unit = input.channel === 'sms' ? 'segments' : 'messages';
    const metadata = {
      ...(context.metadata ?? {}),
      channel: input.channel,
      countMethod: input.channel === 'sms' ? 'sms_segment_encoding' : 'provider_accepted',
      ...(input.providerMessageId ? { providerMessageId: input.providerMessageId } : {}),
    };

    await enqueueOnDatabase({
      restaurantId,
      topic: 'usage',
      aggregateType: 'message',
      aggregateId: sourceId,
      eventType: 'usage.messaging.accepted',
      idempotencyKey: sourceEventKey,
      payload: {
        restaurantId,
        accountId: context.accountId ?? null,
        category,
        provider,
        quantity,
        unit,
        sourceType,
        sourceId,
        sourceEventKey,
        occurredAt: occurredAt.toISOString(),
        metadata,
      },
    });
  } catch (error) {
    logger.error(
      {
        err: error instanceof Error ? error.message : String(error),
        channel: input.channel,
        sourceType,
        sourceId,
      },
      '[usage] failed to enqueue accepted messaging usage',
    );
  }
}
