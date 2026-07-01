import { FastifyRequest, FastifyReply } from 'fastify';

function _toBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function fromBase64(str: string): Uint8Array {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

export async function telnyxWebhookGuard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const signature = req.headers['telnyx-signature-ed25519'] as string | undefined;
  const timestamp = req.headers['telnyx-timestamp'] as string | undefined;
  if (!signature || !timestamp) {
    req.log.warn({ headers: Object.keys(req.headers) }, 'telnyx-guard: missing headers');
    reply.status(403).send({ error: 'Forbidden' });
    return;
  }
  try {
    const { default: telnyx } = await import('telnyx');
    // Use the raw body string (preserved by addContentTypeParser) to verify
    // the signature. Re-serializing JSON.stringify(req.body) can change key
    // order and break the Ed25519 signature check.
    const rawBody = (req as any).rawBody as string | undefined;
    if (!rawBody) {
      throw new Error('rawBody not available — content-type parser not configured?');
    }
    telnyx.webhooks.constructEvent(
      rawBody,
      fromBase64(signature),
      timestamp,
      fromBase64(process.env.TELNYX_PUBLIC_KEY!),
    );
  } catch (err: any) {
    req.log.error(
      {
        err: err?.message,
        errType: err?.constructor?.name,
        errStack: err?.stack?.split('\n').slice(0, 3).join(' | '),
        signatureLen: signature.length,
        timestamp,
        publicKeyLen: process.env.TELNYX_PUBLIC_KEY?.length,
      },
      'telnyx-guard: signature verification failed',
    );
    reply.status(403).send({ error: 'Forbidden' });
    return;
  }
}
