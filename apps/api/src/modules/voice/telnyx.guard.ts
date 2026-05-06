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
  if (!signature || !timestamp) {
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
  } catch {
    reply.status(403).send({ error: 'Forbidden' });
    return;
  }
}
