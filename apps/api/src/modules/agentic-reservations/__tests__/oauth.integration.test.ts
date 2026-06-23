/**
 * Test d'intégration du flow OAuth 2.0 MCP complet.
 *
 * Simule le flow Claude.ai :
 *   1. Dynamic Client Registration (POST /oauth/register)
 *   2. Authorize (GET → consent page, POST → redirect with code)
 *   3. Token exchange (POST /oauth/token avec form-urlencoded)
 *   4. MCP call avec le token OAuth (POST /mcp)
 *
 * Le test critique : vérifie que les scopes envoyés en form-urlencoded
 * (où les espaces sont encodés avec +) sont correctement parsés en
 * scopes séparés, pas une seule string collée.
 *
 * Bug historique : le parser custom form-urlencoded ne décodait pas
 * + en espace, ce qui donnait scopes=["mcp:read+mcp:reserve+mcp:cancel"]
 * au lieu de scopes=["mcp:read","mcp:reserve","mcp:cancel"].
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getApp, closeApp } from '../../../test/helpers';
import { redisCache } from '../../../shared/redis/client';
import { db } from '../../../shared/db/client';

const REDIRECT_URI = 'https://claude.ai/api/mcp/auth_callback';
const SCOPES = 'mcp:read mcp:reserve mcp:cancel';

describe('OAuth MCP integration flow', () => {
  let clientId: string;
  let clientSecret: string;
  let authCode: string;
  let accessToken: string;
  let csrfToken: string;

  beforeAll(() => {
    process.env.NODE_ENV = 'development';
    process.env.OAUTH_ISSUER_URL = 'http://localhost:4000';
  });

  afterAll(async () => {
    await closeApp();
  });

  // ── 1. Metadata discovery ────────────────────────────
  it('GET /.well-known/oauth-authorization-server returns metadata', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/.well-known/oauth-authorization-server',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.issuer).toBe('http://localhost:4000');
    expect(body.authorization_endpoint).toContain('/oauth/authorize');
    expect(body.token_endpoint).toContain('/oauth/token');
    expect(body.registration_endpoint).toContain('/oauth/register');
    expect(body.code_challenge_methods_supported).toContain('S256');
  });

  // ── 2. Dynamic Client Registration ───────────────────
  it('POST /oauth/register creates a client', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/oauth/register',
      headers: { 'content-type': 'application/json' },
      payload: {
        client_name: 'test-claude',
        redirect_uris: [REDIRECT_URI],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.client_id).toBeDefined();
    expect(body.client_secret).toBeDefined();
    expect(body.redirect_uris).toContain(REDIRECT_URI);
    clientId = body.client_id;
    clientSecret = body.client_secret;
  });

  // ── 3. Authorize (consent page) ──────────────────────
  it('GET /oauth/authorize returns consent HTML', async () => {
    // Mock: at least one restaurant with MCP enabled
    vi.mocked(db.restaurantExposureSettings.findFirst).mockResolvedValue({
      restaurantId: 'test-resto-1',
      mcpEnabled: true,
    } as any);

    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES)}&code_challenge=test-challenge&code_challenge_method=S256&state=test-state`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Autoriser');
    expect(res.body).not.toContain('Restaurant connect'); // no restaurant block

    // Extract CSRF token from the hidden input
    const csrfMatch = res.body.match(/name="csrf_token" value="([^"]+)"/);
    expect(csrfMatch).not.toBeNull();
    csrfToken = csrfMatch![1];
  });

  // ── 4. Authorize (process consent → redirect with code) ──
  it('POST /oauth/authorize (form-urlencoded) redirects with code', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/oauth/authorize',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `action=approve&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=test-state&scope=${encodeURIComponent(SCOPES)}&csrf_token=${csrfToken}`,
    });

    expect(res.statusCode).toBe(302);
    const location = res.headers.location as string;
    expect(location).toContain(REDIRECT_URI);
    expect(location).toContain('code=');
    expect(location).toContain('state=test-state');

    // Extract the code
    const url = new URL(location);
    authCode = url.searchParams.get('code')!;
    expect(authCode).toBeDefined();
  });

  // ── 5. Token exchange (THE CRITICAL TEST) ─────────────
  it('POST /oauth/token (form-urlencoded) exchanges code for token with correct scopes', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `grant_type=authorization_code&code=${authCode}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_id=${clientId}&client_secret=${clientSecret}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.access_token).toBeDefined();
    expect(body.token_type).toBe('Bearer');
    expect(body.refresh_token).toBeDefined();
    accessToken = body.access_token;

    // CRITICAL: scopes must be space-separated, not + separated
    const returnedScopes = body.scope.split(' ');
    expect(returnedScopes).toContain('mcp:read');
    expect(returnedScopes).toContain('mcp:reserve');
    expect(returnedScopes).toContain('mcp:cancel');
    expect(returnedScopes).toHaveLength(3);
    // The bug would have produced ["mcp:read+mcp:reserve+mcp:cancel"] (1 element)
    expect(returnedScopes).not.toContain('mcp:read+mcp:reserve+mcp:cancel');
  });

  // ── 6. MCP call with OAuth token ──────────────────────
  it('POST /mcp with OAuth token calls tools/list successfully', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.result).toBeDefined();
    expect(body.result.tools).toHaveLength(6);

    // Verify tool annotations are present
    for (const tool of body.result.tools) {
      expect(tool.title).toBeDefined();
      expect(tool.annotations).toBeDefined();
    }
  });

  // ── 7. MCP call with OAuth token can call a read tool ──
  it('POST /mcp with OAuth token can call search_restaurants (mcp:read scope)', async () => {
    vi.mocked(db.restaurant.findMany).mockResolvedValue([]);
    vi.mocked(db.restaurant.count).mockResolvedValue(0);

    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      payload: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'search_restaurants',
          arguments: {
            city: 'Paris',
            partySize: 2,
            slotStart: '2026-06-24T19:00:00Z',
            slotEnd: '2026-06-24T21:00:00Z',
          },
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Should NOT get a scope error
    expect(body.result?.isError).toBeFalsy();
    expect(body.error).toBeUndefined();
  });

  // ── 8. 401 avec WWW-Authenticate header ──────────────
  it('GET /mcp without auth returns 401 with WWW-Authenticate', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/mcp',
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toContain('resource_metadata');
    expect(res.headers['www-authenticate']).toContain('.well-known/oauth-protected-resource');
  });

  // ── 9. Known redirect URI works without DCR ──────────
  it('GET /oauth/authorize accepts Claude.ai callback without DCR client in dev/test', async () => {
    vi.mocked(db.restaurantExposureSettings.findFirst).mockResolvedValue({
      restaurantId: 'test-resto-1',
      mcpEnabled: true,
    } as any);

    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/oauth/authorize?response_type=code&client_id=nonexistent&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES)}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Autoriser');
  });

  // ── 10. Public consent in production (no Clerk required) ──
  it('GET /oauth/authorize shows consent page in production without Clerk login', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    vi.mocked(db.restaurantExposureSettings.findFirst).mockResolvedValue({
      restaurantId: 'test-resto-1',
      mcpEnabled: true,
    } as any);

    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES)}`,
    });

    // No redirect to login — consent page shows directly
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Autoriser');

    process.env.NODE_ENV = previousNodeEnv;
  });
});
