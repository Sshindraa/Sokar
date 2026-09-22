import { PassThrough } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { REDACT_CENSOR, REDACT_PATHS } from '../pino';

describe('logger redaction', () => {
  it('redacts provider phone fields at the root and in nested payloads', async () => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));

    const testLogger = pino(
      {
        base: null,
        timestamp: false,
        redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR },
      },
      output,
    );

    testLogger.info(
      {
        from: '+33612345678',
        to: '+33123456789',
        providerPayload: { phoneNumber: '+33698765432' },
        fromState: 'IDLE',
      },
      'redaction-check',
    );
    testLogger.flush();
    await new Promise<void>((resolve) => setImmediate(resolve));

    const record = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
    expect(record.from).toBe(REDACT_CENSOR);
    expect(record.to).toBe(REDACT_CENSOR);
    expect((record.providerPayload as Record<string, unknown>).phoneNumber).toBe(REDACT_CENSOR);
    expect(record.fromState).toBe('IDLE');
  });
});
