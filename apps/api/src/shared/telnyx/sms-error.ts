import { classifyNotificationError } from '../queue/notification-idempotency';

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Keep technical diagnostics, never the SDK's raw body, headers, detail, or cause. */
export function sanitizeSmsProviderError(error: unknown): Error {
  const source = record(error);
  const raw = record(source?.raw);
  const response = record(source?.responseBody) ?? record(raw?.responseBody);
  const candidates = [source?.code, raw?.code];
  if (Array.isArray(response?.errors)) {
    for (const item of response.errors.slice(0, 10)) candidates.push(record(item)?.code);
  }
  const providerErrorCodes = [
    ...new Set(
      candidates
        .filter(
          (value): value is string | number =>
            typeof value === 'string' || typeof value === 'number',
        )
        .map(String)
        .filter((value) => /^\d{5}$/.test(value)),
    ),
  ];
  const candidateStatus = source?.statusCode ?? raw?.statusCode;
  const statusCode =
    typeof candidateStatus === 'number' &&
    Number.isInteger(candidateStatus) &&
    candidateStatus >= 400 &&
    candidateStatus <= 599
      ? candidateStatus
      : undefined;
  const details = [statusCode ? `HTTP ${statusCode}` : '', ...providerErrorCodes].filter(Boolean);
  return Object.assign(
    new Error(`Telnyx SMS send failed${details.length ? ` (${details.join(', ')})` : ''}`),
    {
      name: 'TelnyxSmsSendError',
      ...(statusCode ? { statusCode } : {}),
      providerErrorCodes,
      notificationResult: classifyNotificationError(error),
    },
  );
}
