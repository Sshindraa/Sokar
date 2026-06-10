import { FastifyRequest, FastifyReply } from 'fastify';

function toBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function fromBase64(str: string): Uint8Array {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

export async function telnyxWebhookGuard(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const signature = req.headers['telnyx-signature-ed25519'] as string | undefined;
  const timestamp = req.headers['telnyx-timestamp']          as string | undefined;
  // Debug logging — TEMP to diagnose 403 on real Telnyx calls
  req.log.info(
    {
      hasSignature: !!signature,
      sigLength: signature?.length,
      hasTimestamp: !!timestamp,
      timestamp,
      publicKeyLen: process.env.TELNYX_PUBLIC_KEY?.length,
    },
    'telnyx-guard: incoming',
  );
  if (!signature || !timestamp) {
    req.log.warn({ headers: Object.keys(req.headers) }, 'telnyx-guard: missing headers');
    reply.status(403).send({ error: 'Forbidden' });
    return;
  }
  try {
    const { default: telnyx } = await import('telnyx');
    telnyx.webhooks.constructEvent(
      JSON.stringify(req.body),
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
