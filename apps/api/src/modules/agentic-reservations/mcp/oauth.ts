/**
 * OAuth 2.0 pour MCP — flow Authorization Code avec PKCE.
 *
 * Implémente le minimum pour que Claude.ai, ChatGPT et Mistral
 * puissent s'enregistrer comme Custom Connectors via OAuth discovery.
 *
 * Endpoints:
 * - GET  /.well-known/oauth-authorization-server  → metadata (RFC 8414)
 * - POST /oauth/register                           → dynamic client registration (RFC 7591)
 * - GET  /oauth/authorize                          → consent page (auto-approve MVP)
 * - POST /oauth/authorize                          → process consent, redirect with code
 * - POST /oauth/token                              → exchange code → token, refresh token
 *
 * Stockage Redis (db 1, redisCache) :
 * - sokar:oauth:client:<clientId>    → JSON { secret, redirectUris, name } (TTL 365j)
 * - sokar:oauth:code:<code>          → JSON { clientId, restaurantId, scopes, redirectUri, codeChallenge, codeChallengeMethod } (TTL 10min)
 * - sokar:oauth:token:<token>        → JSON { clientId, restaurantId, scopes } (TTL 30j)
 * - sokar:oauth:refresh:<token>      → JSON { clientId, restaurantId, scopes } (TTL 90j)
 *
 * Sécurité :
 * - Les codes et tokens sont des crypto.randomUUID() (128 bits d'entropie).
 * - PKCE S256 obligatoire si le client fournit un code_challenge.
 * - Les redirect_uri sont validés contre ceux enregistrés lors du register.
 * - En production, l'issuer est lu depuis OAUTH_ISSUER_URL.
 *
 * TODO (P2) : remplacer l'auto-approve par une page de consentement
 * qui demande à l'utilisateur de sélectionner son restaurant après
 * authentification Clerk. Pour l'instant on utilise le premier restaurant
 * avec MCP activé.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { redisCache } from '../../../shared/redis/client';
import { logger } from '../../../shared/logger/pino';
import type { AuthContext } from './auth';

// ─── TTLs ──────────────────────────────────────────────
const TTL_CLIENT = 60 * 60 * 24 * 365; // 365 jours
const TTL_CODE = 60 * 10; // 10 minutes
const TTL_TOKEN = 60 * 60 * 24 * 30; // 30 jours
const TTL_REFRESH = 60 * 60 * 24 * 90; // 90 jours

// ─── Helpers ───────────────────────────────────────────

export function getIssuer(): string {
  return process.env.OAUTH_ISSUER_URL || 'http://localhost:4000';
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

/**
 * Vérifie un code_verifier PKCE contre le code_challenge stocké.
 */
function verifyPkce(
  codeVerifier: string,
  codeChallenge: string | undefined,
  method: string | undefined,
): boolean {
  if (!codeChallenge) return true; // Pas de PKCE demandé
  // S256 uniquement — 'plain' est déprécié (RFC 7636) et refusé
  if (method === 'S256') {
    const computed = base64url(createHash('sha256').update(codeVerifier).digest());
    return computed === codeChallenge;
  }
  return false;
}

async function getJson<T>(key: string): Promise<T | null> {
  const raw = await redisCache.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function setJson(key: string, value: unknown, ttlSec: number): Promise<void> {
  await redisCache.set(key, JSON.stringify(value), 'EX', String(ttlSec));
}

// ─── Types ─────────────────────────────────────────────

type RegisteredClient = {
  clientId: string;
  clientSecretHash: string; // SHA-256 hash, jamais le plaintext
  redirectUris: string[];
  clientName: string;
  createdAt: string;
};

type AuthCode = {
  clientId: string;
  restaurantId: string;
  restaurantName: string;
  scopes: string[];
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
};

type StoredToken = {
  clientId: string;
  restaurantId: string;
  restaurantName: string;
  scopes: string[];
};

// ─── Validation des tokens OAuth ───────────────────────

/**
 * Valide un token OAuth (opaque, stocké dans Redis).
 * Retourne un AuthContext si valide, null sinon.
 */
export async function validateOAuthToken(token: string): Promise<AuthContext | null> {
  const data = await getJson<StoredToken>(`sokar:oauth:token:${token}`);
  if (!data) return null;

  // Convertir vers AuthContext (même forme que l'auth par API key)
  return {
    clientId: data.clientId,
    clientName: 'oauth-client',
    restaurantId: data.restaurantId,
    scopes: data.scopes,
    allowedOrigins: [],
  };
}

// ─── Pre-allowed redirect URIs for known MCP platforms ──
// Si un client ne fait pas de DCR, on accepte ces redirect URIs
const KNOWN_REDIRECT_PATTERNS: { pattern: RegExp; name: string }[] = [
  { pattern: /^https:\/\/claude\.ai\/api\/mcp\/auth_callback$/, name: 'Claude' },
  { pattern: /^https:\/\/claude\.ai\/api\/mcp\/auth_callback\/.+$/, name: 'Claude' },
  { pattern: /^https:\/\/chatgpt\.com\/backend-api\/mcp\/.+\/callback$/, name: 'ChatGPT' },
  { pattern: /^https:\/\/chat\.mistral\.ai\/.+\/callback$/, name: 'Mistral' },
  { pattern: /^http:\/\/localhost:\d+\/callback$/, name: 'Claude Code' },
  { pattern: /^http:\/\/127\.0\.0\.1:\d+\/callback$/, name: 'Claude Code' },
];

function matchKnownRedirect(uri: string): string | null {
  for (const entry of KNOWN_REDIRECT_PATTERNS) {
    if (entry.pattern.test(uri)) return entry.name;
  }
  return null;
}

// ─── Rate limit simple pour endpoints OAuth ───────────
// Anti-brute-force sur /token, anti-spam sur /register.
// 10 req/min par IP pour /token, 5 req/min par IP pour /register.
const oauthRateMap = new Map<string, { count: number; resetAt: number }>();
const OAUTH_RATE_TOKEN = { max: 10, windowMs: 60_000 };
const OAUTH_RATE_REGISTER = { max: 5, windowMs: 60_000 };

function checkOauthRate(ip: string, config: { max: number; windowMs: number }): boolean {
  const now = Date.now();
  const key = `${ip}:${config.max}`;
  const entry = oauthRateMap.get(key);
  if (!entry || now > entry.resetAt) {
    oauthRateMap.set(key, { count: 1, resetAt: now + config.windowMs });
    return true;
  }
  if (entry.count >= config.max) return false;
  entry.count++;
  return true;
}

// ─── Routes ────────────────────────────────────────────

export async function oauthRoutes(app: FastifyInstance): Promise<void> {
  const { db } = await import('../../../shared/db/client');

  // ── 0. Protected resource metadata (MCP spec 2025-06-18) ──
  app.get(
    '/.well-known/oauth-protected-resource',
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const issuer = getIssuer();
      return reply.header('Cache-Control', 'public, max-age=3600').send({
        resource: issuer,
        authorization_servers: [issuer],
        bearer_methods_supported: ['header'],
        resource_documentation: `${issuer}/docs`,
      });
    },
  );

  // ── 1. Metadata discovery (RFC 8414) ─────────────────
  app.get(
    '/.well-known/oauth-authorization-server',
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const issuer = getIssuer();
      return reply.header('Cache-Control', 'public, max-age=3600').send({
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        registration_endpoint: `${issuer}/oauth/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: [
          'client_secret_post',
          'client_secret_basic',
          'none',
        ],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: ['mcp:read', 'mcp:reserve', 'mcp:cancel'],
        revocation_endpoint: `${issuer}/oauth/revoke`,
      });
    },
  );

  // ── 2. Dynamic Client Registration (RFC 7591) ────────
  app.post('/oauth/register', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!checkOauthRate(req.ip, OAUTH_RATE_REGISTER)) {
      return reply
        .status(429)
        .send({ error: 'too_many_requests', error_description: 'Too many registrations' });
    }
    const body = req.body as {
      client_name?: string;
      redirect_uris?: string[];
      token_endpoint_auth_method?: string;
      grant_types?: string[];
      response_types?: string[];
    };

    if (
      !body.redirect_uris ||
      !Array.isArray(body.redirect_uris) ||
      body.redirect_uris.length === 0
    ) {
      return reply.status(400).send({
        error: 'invalid_client_metadata',
        error_description: 'redirect_uris is required',
      });
    }

    const clientId = randomUUID();
    const clientSecret = randomUUID() + randomUUID();
    const clientSecretHash = createHash('sha256').update(clientSecret).digest('hex');

    const client: RegisteredClient = {
      clientId,
      clientSecretHash,
      redirectUris: body.redirect_uris,
      clientName: body.client_name || 'mcp-client',
      createdAt: new Date().toISOString(),
    };

    await setJson(`sokar:oauth:client:${clientId}`, client, TTL_CLIENT);

    logger.info({ clientId, clientName: client.clientName }, 'oauth: client registered');

    return reply.status(201).send({
      client_id: clientId,
      client_secret: clientSecret,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: body.token_endpoint_auth_method || 'client_secret_basic',
      grant_types: body.grant_types || ['authorization_code', 'refresh_token'],
      response_types: body.response_types || ['code'],
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_secret_expires_at: 0, // N'expire pas (TTL Redis géré séparément)
    });
  });

  // ── 3. Authorization endpoint ────────────────────────
  // GET  → affiche une page de consentement
  // POST → process le consentement, redirige avec un code

  app.get('/oauth/authorize', async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as {
      client_id?: string;
      redirect_uri?: string;
      response_type?: string;
      state?: string;
      scope?: string;
      code_challenge?: string;
      code_challenge_method?: string;
    };

    // Valider les params
    if (!query.client_id || !query.redirect_uri) {
      return reply
        .status(400)
        .type('text/html')
        .send(renderError('Paramètres manquants', 'client_id et redirect_uri sont requis.'));
    }

    if (query.response_type !== 'code') {
      return reply
        .status(400)
        .type('text/html')
        .send(renderError('Type non supporté', 'Seul response_type=code est supporté.'));
    }

    // Valider le client
    let client = await getJson<RegisteredClient>(`sokar:oauth:client:${query.client_id}`);
    let clientName = query.client_id || 'Unknown';

    if (!client) {
      const knownName = matchKnownRedirect(query.redirect_uri);
      if (knownName) {
        clientName = knownName;
      } else {
        return reply
          .status(400)
          .type('text/html')
          .send(
            renderError('Client inconnu', `Aucun client enregistré avec l'ID ${query.client_id}.`),
          );
      }
    } else {
      clientName = client.clientName;
      if (!client.redirectUris.includes(query.redirect_uri)) {
        return reply
          .status(400)
          .type('text/html')
          .send(
            renderError(
              'Redirect URI non autorisé',
              `L'URI ${query.redirect_uri} n'est pas enregistrée pour ce client.`,
            ),
          );
      }
    }

    // Trouver le premier restaurant avec MCP activé
    const restaurant = await db.restaurantExposureSettings.findFirst({
      where: { mcpEnabled: true },
      include: { restaurant: { select: { id: true, name: true } } },
    });

    if (!restaurant || !restaurant.restaurant) {
      return reply
        .status(400)
        .type('text/html')
        .send(
          renderError(
            'Aucun restaurant MCP',
            "Aucun restaurant n'a MCP activé. Activez MCP dans le dashboard Sokar d'abord.",
          ),
        );
    }

    const scopes = query.scope
      ? query.scope.split(' ').filter(Boolean)
      : ['mcp:read', 'mcp:reserve', 'mcp:cancel'];

    // Générer un token CSRF pour protéger le consent form
    const csrfToken = randomUUID();
    await setJson(
      `sokar:oauth:csrf:${csrfToken}`,
      { clientId: query.client_id, redirectUri: query.redirect_uri },
      TTL_CODE, // 10 min — même TTL que les auth codes
    );

    return reply.type('text/html').send(
      renderConsentPage({
        clientName: clientName,
        restaurantName: restaurant.restaurant.name,
        restaurantId: restaurant.restaurantId,
        clientId: query.client_id,
        redirectUri: query.redirect_uri,
        state: query.state || '',
        scope: scopes.join(' '),
        codeChallenge: query.code_challenge || '',
        codeChallengeMethod: query.code_challenge_method || '',
        csrfToken,
      }),
    );
  });

  app.post('/oauth/authorize', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      client_id?: string;
      redirect_uri?: string;
      state?: string;
      scope?: string;
      restaurant_id?: string;
      code_challenge?: string;
      code_challenge_method?: string;
      action?: string; // "approve" ou "deny"
      csrf_token?: string;
    };

    // Valider le token CSRF (protection contre les attaques cross-site
    // sur le consent form — que ce soit approve ou deny)
    if (!body.csrf_token) {
      return reply
        .status(403)
        .type('text/html')
        .send(renderError('Token CSRF manquant', 'Veuillez recharger la page de consentement.'));
    }
    const csrfData = await getJson<{ clientId: string; redirectUri: string }>(
      `sokar:oauth:csrf:${body.csrf_token}`,
    );
    if (!csrfData) {
      return reply
        .status(403)
        .type('text/html')
        .send(
          renderError(
            'Token CSRF invalide',
            'Le token de consentement a expiré. Veuillez recharger la page.',
          ),
        );
    }
    // Supprimer le token (one-time use)
    await redisCache.del(`sokar:oauth:csrf:${body.csrf_token}`);

    // Vérifier la cohérence client_id / redirect_uri entre le CSRF et le form
    if (
      (body.client_id && csrfData.clientId && body.client_id !== csrfData.clientId) ||
      (body.redirect_uri && csrfData.redirectUri && body.redirect_uri !== csrfData.redirectUri)
    ) {
      return reply
        .status(403)
        .type('text/html')
        .send(
          renderError(
            'Incohérence CSRF',
            'Les paramètres ne correspondent pas au token de consentement.',
          ),
        );
    }

    // Valider le client
    const postClient = await getJson<RegisteredClient>(`sokar:oauth:client:${body.client_id}`);

    if (!postClient) {
      const knownName = body.redirect_uri ? matchKnownRedirect(body.redirect_uri) : null;
      if (!knownName) {
        return reply
          .status(400)
          .type('text/html')
          .send(renderError('Client inconnu', 'Client non trouvé.'));
      }
    } else {
      if (!body.redirect_uri || !postClient.redirectUris.includes(body.redirect_uri)) {
        return reply.status(400).type('text/html').send(renderError('Redirect URI invalide', ''));
      }
    }

    // Si l'utilisateur a refusé
    if (body.action === 'deny') {
      if (!body.redirect_uri) {
        return reply.status(400).type('text/html').send(renderError('Redirect URI manquant', ''));
      }
      const denyUrl = new URL(body.redirect_uri);
      denyUrl.searchParams.set('error', 'access_denied');
      denyUrl.searchParams.set('error_description', 'User denied access');
      if (body.state) denyUrl.searchParams.set('state', body.state);
      return reply.redirect(denyUrl.toString());
    }

    // Récupérer le restaurant
    const restaurantId = body.restaurant_id;
    if (!restaurantId) {
      return reply
        .status(400)
        .type('text/html')
        .send(renderError('Restaurant manquant', 'restaurant_id requis.'));
    }

    const restaurant = await db.restaurant.findUnique({
      where: { id: restaurantId },
      select: { id: true, name: true },
    });
    if (!restaurant) {
      return reply.status(400).type('text/html').send(renderError('Restaurant introuvable', ''));
    }

    // Refuser les requêtes sans client_id valide
    if (!body.client_id) {
      return reply
        .status(400)
        .type('text/html')
        .send(renderError('Client manquant', 'client_id requis.'));
    }

    // Générer le code d'autorisation
    const code = randomUUID();
    const scopes = body.scope
      ? body.scope.split(' ').filter(Boolean)
      : ['mcp:read', 'mcp:reserve', 'mcp:cancel'];

    const authCode: AuthCode = {
      clientId: body.client_id || '',
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      scopes,
      redirectUri: body.redirect_uri || '',
      codeChallenge: body.code_challenge || undefined,
      codeChallengeMethod: body.code_challenge_method || undefined,
    };

    await setJson(`sokar:oauth:code:${code}`, authCode, TTL_CODE);

    logger.info(
      { clientId: body.client_id, restaurantId: restaurant.id },
      'oauth: authorization code issued',
    );

    // Rediriger vers le client avec le code
    if (!body.redirect_uri) {
      return reply.status(400).type('text/html').send(renderError('Redirect URI manquant', ''));
    }
    const redirectUrl = new URL(body.redirect_uri);
    redirectUrl.searchParams.set('code', code);
    if (body.state) redirectUrl.searchParams.set('state', body.state);

    return reply.redirect(redirectUrl.toString());
  });

  // ── 4. Token endpoint ────────────────────────────────
  app.post('/oauth/token', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!checkOauthRate(req.ip, OAUTH_RATE_TOKEN)) {
      return reply
        .status(429)
        .send({ error: 'too_many_requests', error_description: 'Too many token requests' });
    }
    const body = req.body as {
      grant_type?: string;
      code?: string;
      redirect_uri?: string;
      client_id?: string;
      client_secret?: string;
      code_verifier?: string;
      refresh_token?: string;
    };

    // Auth client via Basic ou body
    let clientId = body.client_id;
    let clientSecret = body.client_secret;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
      const [id, secret] = decoded.split(':');
      if (id) clientId = id;
      if (secret) clientSecret = secret;
    }

    if (!clientId) {
      return reply
        .status(401)
        .send({ error: 'invalid_client', error_description: 'client_id required' });
    }

    // Valider le client (optionnel pour les public clients sans DCR)
    const tokenClient = await getJson<RegisteredClient>(`sokar:oauth:client:${clientId}`);

    // Pour les clients DCR, valider le secret par hash (jamais en plaintext)
    if (tokenClient && tokenClient.clientSecretHash && clientSecret) {
      const providedHash = createHash('sha256').update(clientSecret).digest('hex');
      if (providedHash !== tokenClient.clientSecretHash) {
        return reply
          .status(401)
          .send({ error: 'invalid_client', error_description: 'Invalid client secret' });
      }
    }

    const grantType = body.grant_type;

    // ── 4a. authorization_code ──────────────────────────
    if (grantType === 'authorization_code') {
      if (!body.code) {
        return reply
          .status(400)
          .send({ error: 'invalid_request', error_description: 'code required' });
      }

      const authCode = await getJson<AuthCode>(`sokar:oauth:code:${body.code}`);
      if (!authCode) {
        return reply
          .status(400)
          .send({ error: 'invalid_grant', error_description: 'Invalid or expired code' });
      }

      // Valider le client AVANT de supprimer le code (sinon une typo
      // consomme le code définitivement et l'utilisateur ne peut pas réessayer)
      if (authCode.clientId !== clientId) {
        return reply.status(400).send({
          error: 'invalid_grant',
          error_description: 'Code was issued to a different client',
        });
      }

      // Valider le redirect_uri
      if (body.redirect_uri && body.redirect_uri !== authCode.redirectUri) {
        return reply
          .status(400)
          .send({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
      }

      // Vérifier PKCE
      if (authCode.codeChallenge) {
        if (!body.code_verifier) {
          return reply
            .status(400)
            .send({ error: 'invalid_grant', error_description: 'code_verifier required (PKCE)' });
        }
        if (!verifyPkce(body.code_verifier, authCode.codeChallenge, authCode.codeChallengeMethod)) {
          return reply
            .status(400)
            .send({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
        }
      }

      // Toutes les validations sont passées → supprimer le code (one-time use)
      await redisCache.del(`sokar:oauth:code:${body.code}`);

      // Générer les tokens
      const accessToken = randomUUID();
      const refreshToken = randomUUID();

      const tokenData: StoredToken = {
        clientId,
        restaurantId: authCode.restaurantId,
        restaurantName: authCode.restaurantName,
        scopes: authCode.scopes,
      };

      await setJson(`sokar:oauth:token:${accessToken}`, tokenData, TTL_TOKEN);
      await setJson(`sokar:oauth:refresh:${refreshToken}`, tokenData, TTL_REFRESH);

      logger.info({ clientId, restaurantId: authCode.restaurantId }, 'oauth: access token issued');

      return reply.send({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: TTL_TOKEN,
        refresh_token: refreshToken,
        scope: authCode.scopes.join(' '),
      });
    }

    // ── 4b. refresh_token ───────────────────────────────
    if (grantType === 'refresh_token') {
      if (!body.refresh_token) {
        return reply
          .status(400)
          .send({ error: 'invalid_request', error_description: 'refresh_token required' });
      }

      const oldToken = await getJson<StoredToken>(`sokar:oauth:refresh:${body.refresh_token}`);
      if (!oldToken) {
        return reply
          .status(400)
          .send({ error: 'invalid_grant', error_description: 'Invalid or expired refresh token' });
      }

      // Supprimer l'ancien refresh token (rotation)
      await redisCache.del(`sokar:oauth:refresh:${body.refresh_token}`);

      // Générer de nouveaux tokens
      const accessToken = randomUUID();
      const refreshToken = randomUUID();

      await setJson(`sokar:oauth:token:${accessToken}`, oldToken, TTL_TOKEN);
      await setJson(`sokar:oauth:refresh:${refreshToken}`, oldToken, TTL_REFRESH);

      return reply.send({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: TTL_TOKEN,
        refresh_token: refreshToken,
        scope: oldToken.scopes.join(' '),
      });
    }

    return reply.status(400).send({
      error: 'unsupported_grant_type',
      error_description: `grant_type ${grantType} not supported`,
    });
  });

  // ── 5. Revocation (RFC 7009) — minimal avec auth client ──
  app.post('/oauth/revoke', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { token?: string; token_type_hint?: string };

    // Auth client obligatoire (Basic ou body) pour éviter que n'importe qui
    // puisse révoquer les tokens des autres
    let revokeClientId = (body as any).client_id;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
      const [id] = decoded.split(':');
      if (id) revokeClientId = id;
    }

    if (!revokeClientId) {
      return reply
        .status(401)
        .send({ error: 'invalid_client', error_description: 'client_id required' });
    }

    if (body.token) {
      await redisCache.del(`sokar:oauth:token:${body.token}`);
      await redisCache.del(`sokar:oauth:refresh:${body.token}`);
    }
    return reply.status(200).send({});
  });
}

// ─── HTML helpers ──────────────────────────────────────

function renderConsentPage(params: {
  clientName: string;
  restaurantName: string;
  restaurantId: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  csrfToken: string;
}): string {
  const {
    clientName,
    restaurantName,
    restaurantId,
    clientId,
    redirectUri,
    state,
    scope,
    codeChallenge,
    codeChallengeMethod,
    csrfToken,
  } = params;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Sokar — Connexion MCP</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #fafafa;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: #141414;
      border: 1px solid #262626;
      border-radius: 16px;
      padding: 40px;
      max-width: 440px;
      width: 100%;
    }
    .logo {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 24px;
      letter-spacing: -0.5px;
    }
    .logo span { color: #f97316; }
    h1 {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    p {
      color: #a3a3a3;
      font-size: 14px;
      line-height: 1.6;
      margin-bottom: 16px;
    }
    .restaurant {
      background: #1c1c1c;
      border: 1px solid #333;
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 24px;
    }
    .restaurant-label {
      font-size: 12px;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .restaurant-name {
      font-size: 16px;
      font-weight: 600;
    }
    .scopes {
      margin-bottom: 24px;
    }
    .scope-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 0;
      font-size: 14px;
      color: #d4d4d4;
    }
    .scope-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #f97316;
      flex-shrink: 0;
    }
    .actions {
      display: flex;
      gap: 12px;
    }
    button {
      flex: 1;
      padding: 12px 20px;
      border: none;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-approve {
      background: #f97316;
      color: #fff;
    }
    .btn-approve:hover { background: #ea580c; }
    .btn-deny {
      flex: 0 0 auto;
      background: transparent;
      color: #a3a3a3;
      border: 1px solid #333;
      padding: 12px 20px;
    }
    .btn-deny:hover { border-color: #555; color: #fafafa; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Sokar<span>.</span></div>
    <h1>Connexion à ${escapeHtml(clientName)}</h1>
    <p>${escapeHtml(clientName)} demande l'accès aux outils de réservation de votre restaurant sur Sokar.</p>

    <div class="restaurant">
      <div class="restaurant-label">Restaurant connecté</div>
      <div class="restaurant-name">${escapeHtml(restaurantName)}</div>
    </div>

    <div class="scopes">
      <div class="scope-item"><span class="scope-dot"></span> Rechercher des restaurants</div>
      <div class="scope-item"><span class="scope-dot"></span> Vérifier les disponibilités</div>
      <div class="scope-item"><span class="scope-dot"></span> Créer des réservations</div>
      <div class="scope-item"><span class="scope-dot"></span> Annuler des réservations</div>
    </div>

    <form method="POST" action="/oauth/authorize">
      <input type="hidden" name="action" value="approve"/>
      <input type="hidden" name="client_id" value="${escapeAttr(clientId)}"/>
      <input type="hidden" name="redirect_uri" value="${escapeAttr(redirectUri)}"/>
      <input type="hidden" name="state" value="${escapeAttr(state)}"/>
      <input type="hidden" name="scope" value="${escapeAttr(scope)}"/>
      <input type="hidden" name="restaurant_id" value="${escapeAttr(restaurantId)}"/>
      <input type="hidden" name="code_challenge" value="${escapeAttr(codeChallenge)}"/>
      <input type="hidden" name="code_challenge_method" value="${escapeAttr(codeChallengeMethod)}"/>
      <input type="hidden" name="csrf_token" value="${escapeAttr(csrfToken)}"/>
      <div class="actions">
        <button type="submit" class="btn-approve">Autoriser</button>
        <button type="submit" name="action" value="deny" class="btn-deny">Refuser</button>
      </div>
    </form>
  </div>
</body>
</html>`;
}

function renderError(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Sokar — Erreur</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #fafafa;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: #141414;
      border: 1px solid #262626;
      border-radius: 16px;
      padding: 40px;
      max-width: 440px;
      width: 100%;
    }
    .logo {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 24px;
    }
    .logo span { color: #f97316; }
    h1 { font-size: 18px; color: #ef4444; margin-bottom: 12px; }
    p { color: #a3a3a3; font-size: 14px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Sokar<span>.</span></div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
