import { pathToFileURL } from 'node:url';

// Read-only operator probe. Never return phone numbers, text, bearer links or raw errors.
export function summarizeReceipt(message, expectedId) {
  if (!message || message.id !== expectedId) throw new Error('Receipt ID mismatch');
  const status = message.to?.[0]?.status ?? 'unknown';
  const known = new Set([
    'queued',
    'sending',
    'sent',
    'delivered',
    'delivery_failed',
    'delivery_unconfirmed',
    'sending_failed',
    'expired',
  ]);
  return {
    providerMessageId: expectedId,
    providerAccepted: true,
    deliveryStatus: known.has(status) ? status : 'unknown',
    deliveryConfirmed: status === 'delivered',
    parts: Number.isInteger(message.parts) ? message.parts : null,
    sentAt: message.sent_at ?? null,
    completedAt: message.completed_at ?? null,
    errorCodes: (message.errors ?? [])
      .map((error) => String(error.code ?? ''))
      .filter((code) => /^\d{3,8}$/.test(code)),
  };
}

async function main() {
  const id = process.env.SOKAR_RECEIPT_MESSAGE_ID;
  if (!id || !/^[a-f0-9-]{36}$/i.test(id))
    throw new Error('Set SOKAR_RECEIPT_MESSAGE_ID to the provider UUID');
  if (!process.env.TELNYX_API_KEY)
    throw new Error('TELNYX_API_KEY must be supplied through the environment');
  const response = await fetch(`https://api.telnyx.com/v2/messages/${id}`, {
    headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Receipt lookup failed (HTTP ${response.status})`);
  // eslint-disable-next-line no-console -- structured output of this operator CLI
  console.log(JSON.stringify(summarizeReceipt((await response.json()).data, id)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // Only our controlled messages are safe; network failures may expose URLs.
    console.error(
      error.message.startsWith('Receipt') ||
        error.message.startsWith('Set ') ||
        error.message.startsWith('TELNYX_API_KEY')
        ? error.message
        : 'Receipt lookup unavailable',
    );
    process.exitCode = 1;
  });
}
