/**
 * HMAC partagé pour le feed OpenAI Reserve (RES-007).
 *
 * Le feed /v1/businesses est public par spec OpenAI Apps SDK. L'HMAC est
 * optionnel : si OPENAI_RESERVE_HMAC_KEY est défini, le paramètre ?signature
 * doit être présent et valide. Si la clé n'est pas configurée, le feed reste
 * accessible sans signature (compatibilité par défaut).
 *
 * Signature : HMAC-SHA256(base64url) du payload :
 *   GET|<path>|<query-string-normalisé>
 * Le query string est trié par clés et exclut le paramètre `signature`.
 * Exemple pour GET /v1/businesses?page=1&page_size=20 :
 *   GET|/v1/businesses|page=1&page_size=20
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

export function buildSignaturePayload(
  method: string,
  path: string,
  query: Record<string, unknown>,
): string {
  const sortedParams = new URLSearchParams();
  for (const key of Object.keys(query).sort()) {
    if (key === 'signature') continue;
    const value = query[key];
    if (value === undefined || value === null) continue;
    sortedParams.append(key, String(value));
  }
  return `${method.toUpperCase()}|${path}|${sortedParams.toString()}`;
}

export function signOpenaiReserveRequest(
  method: string,
  path: string,
  query: Record<string, unknown>,
  secret: string,
): string {
  const payload = buildSignaturePayload(method, path, query);
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function getQuerySignature(req: FastifyRequest): string | undefined {
  const query = req.query as Record<string, unknown>;
  if (typeof query.signature === 'string') {
    return query.signature;
  }
  return undefined;
}

export function verifyOpenaiReserveRequest(req: FastifyRequest, secret: string): boolean {
  const signature = getQuerySignature(req);
  if (!signature) return false;

  const path = req.url.split('?')[0];
  const query = req.query as Record<string, unknown>;

  // 1) Signature complète (method + path + query triée) — la plus sécurisée.
  const payloadWithQuery = buildSignaturePayload(req.method, path, query);
  const expectedWithQuery = createHmac('sha256', secret)
    .update(payloadWithQuery)
    .digest('base64url');

  // 2) Signature statique (method + path) — compatible OpenAI qui paginate
  // en ajoutant `page`/`page_size` sans recalculer de signature.
  const payloadWithoutQuery = buildSignaturePayload(req.method, path, {});
  const expectedWithoutQuery = createHmac('sha256', secret)
    .update(payloadWithoutQuery)
    .digest('base64url');

  const signatureBuffer = Buffer.from(signature);
  for (const expected of [expectedWithQuery, expectedWithoutQuery]) {
    const expectedBuffer = Buffer.from(expected);
    if (
      signatureBuffer.length === expectedBuffer.length &&
      timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      return true;
    }
  }
  return false;
}
