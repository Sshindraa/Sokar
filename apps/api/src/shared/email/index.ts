import { Resend } from 'resend';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  extractProviderMessageId,
  type NotificationProviderResult,
  type NotificationSendResult,
} from '../queue/notification-idempotency';
import {
  recordAcceptedMessagingUsage,
  type MessagingUsageContext,
} from '../../modules/usage/messaging-usage.service';

// Resend HTTP API (port 443) — l'envoi ne dépend plus des ports SMTP sortants du VPS.
// L'API HTTP de Resend utilise le port 443 (HTTPS).
//
// Init lazy : on ne crée le client Resend qu'au premier envoi. Si
// RESEND_API_KEY est vide (ex: staging sans config email), le module
// se charge sans crasher — l'erreur ne surgit qu'à l'appel sendEmail(),
// comme avec l'ancien nodemailer. Sans ça, `new Resend(undefined)` throw
// au module load et crash l'API entière en boucle (PM2 restart loop).
let resendClient: Resend | null = null;
function getResend(): Resend {
  if (!resendClient) {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      throw new Error('RESEND_API_KEY is not set — cannot send email');
    }
    resendClient = new Resend(key);
  }
  return resendClient;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  usage?: MessagingUsageContext;
}

/**
 * Verifies the Svix signature sent by Resend without calling the provider.
 * `payload` must be the exact raw request body (`id.timestamp.payload` is the
 * signed value); accepting parsed JSON here would make key-order changes
 * invalidate or, worse, bypass verification.
 */
export function verifyResendWebhookSignature(input: {
  payload: string;
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
  secret: string | undefined;
  now?: number;
  toleranceSeconds?: number;
}): boolean {
  if (!input.secret || !input.id || !input.timestamp || !input.signature) return false;
  const timestampSeconds = Number(input.timestamp);
  if (!Number.isInteger(timestampSeconds)) return false;
  const tolerance = input.toleranceSeconds ?? 300;
  if (Math.abs((input.now ?? Date.now()) - timestampSeconds * 1000) > tolerance * 1000) {
    return false;
  }

  const encodedSecret = input.secret.startsWith('whsec_')
    ? input.secret.slice('whsec_'.length)
    : input.secret;
  let secret: Buffer;
  try {
    secret = Buffer.from(encodedSecret, 'base64');
  } catch {
    return false;
  }
  if (secret.length === 0) return false;

  const signedPayload = `${input.id}.${input.timestamp}.${input.payload}`;
  const expected = createHmac('sha256', secret).update(signedPayload).digest('base64');
  return input.signature.split(' ').some((candidate) => {
    const [, encoded] = candidate.split(',', 2);
    if (!encoded) return false;
    const expectedBuffer = Buffer.from(expected);
    const candidateBuffer = Buffer.from(encoded);
    return (
      expectedBuffer.length === candidateBuffer.length &&
      timingSafeEqual(expectedBuffer, candidateBuffer)
    );
  });
}

export function normalizeResendSendResponse(response: unknown): NotificationSendResult {
  if (!response || typeof response !== 'object') {
    throw new Error('Resend API error: malformed response');
  }
  const record = response as Record<string, unknown>;
  const error = record.error;
  if (error) {
    const message =
      error &&
      typeof error === 'object' &&
      typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : 'unknown provider error';
    throw new Error(`Resend API error: ${message}`, { cause: error });
  }
  const providerMessageId = extractProviderMessageId(response);
  return {
    outcome: 'success',
    provider: 'resend',
    channel: 'email',
    ...(providerMessageId ? { providerMessageId } : {}),
  };
}

export async function sendEmail(opts: SendEmailOptions): Promise<void | NotificationSendResult> {
  const response = await getResend().emails.send({
    from: process.env.EMAIL_FROM ?? 'noreply@sokar.fr',
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
  const result = normalizeResendSendResponse(response);
  if (opts.usage) {
    await recordAcceptedMessagingUsage({
      channel: 'email',
      provider: 'resend',
      providerMessageId: result.providerMessageId,
      context: opts.usage,
    });
  }
  return result;
}

type ResendEmailEvent =
  | 'bounced'
  | 'canceled'
  | 'clicked'
  | 'complained'
  | 'delivered'
  | 'delivery_delayed'
  | 'failed'
  | 'opened'
  | 'queued'
  | 'scheduled'
  | 'sent'
  | 'suppressed';

function extractResendEmailEvent(response: unknown): ResendEmailEvent | undefined {
  const root =
    response && typeof response === 'object' ? (response as Record<string, unknown>) : null;
  const payload =
    root?.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : root;
  const event = payload?.last_event;
  return typeof event === 'string' ? (event as ResendEmailEvent) : undefined;
}

export function classifyResendEmailResponse(response: unknown): NotificationProviderResult {
  const event = extractResendEmailEvent(response);
  if (!event) return 'unknown';
  if (event === 'failed' || event === 'canceled' || event === 'suppressed') {
    return 'failure_certain';
  }
  return 'success';
}

/**
 * Resend exposes a read endpoint for recent email IDs. A found message proves
 * acceptance of the email request; delivery failures must not cause a blind
 * duplicate. Lookup failures remain unknown.
 */
export async function lookupResendEmail(
  providerMessageId: string,
): Promise<NotificationProviderResult> {
  try {
    const response = await getResend().emails.get(providerMessageId);
    return classifyResendEmailResponse(response);
  } catch {
    return 'unknown';
  }
}
