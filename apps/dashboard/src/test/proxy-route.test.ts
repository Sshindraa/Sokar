import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST, PATCH, PUT, DELETE } from '../app/api/proxy/[...path]/route';
import type { NextRequest } from 'next/server';

const API_UNAVAILABLE_MESSAGE =
  'Impossible de joindre le serveur API. Veuillez réessayer dans quelques instants.';

function createMockRequest(
  urlStr: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const url = new URL(urlStr);
  return {
    nextUrl: url,
    method: options.method ?? 'GET',
    headers: {
      get: (name: string) => {
        const lower = name.toLowerCase();
        if (lower === 'content-type' && options.body) return 'application/json';
        return options.headers?.[lower] ?? null;
      },
    },
    json: async () => options.body,
  } as unknown as NextRequest;
}

describe('Proxy route handlers error resilience', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('GET retourne 502 avec message explicite lorsque le fetch backend échoue', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:4000')),
    );

    const req = createMockRequest('http://localhost:3000/api/proxy/restaurants/123/connect');
    const res = await GET(req, {
      params: Promise.resolve({ path: ['restaurants', '123', 'connect'] }),
    });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe(API_UNAVAILABLE_MESSAGE);
    expect(body.error).not.toContain('ECONNREFUSED');
    expect(body.error).not.toContain('127.0.0.1:4000');
  });

  it('POST retourne 502 avec message explicite lorsque le fetch backend échoue', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')));

    const req = createMockRequest('http://localhost:3000/api/proxy/restaurants/123/connect', {
      method: 'POST',
      body: { name: 'Test' },
    });
    const res = await POST(req, {
      params: Promise.resolve({ path: ['restaurants', '123', 'connect'] }),
    });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe(API_UNAVAILABLE_MESSAGE);
  });

  it('PATCH retourne 502 lorsque le backend échoue', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const req = createMockRequest('http://localhost:3000/api/proxy/restaurants/123/connect', {
      method: 'PATCH',
      body: { connectPublished: true },
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ path: ['restaurants', '123', 'connect'] }),
    });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe(API_UNAVAILABLE_MESSAGE);
  });

  it('PUT retourne 502 lorsque le backend échoue', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const req = createMockRequest('http://localhost:3000/api/proxy/restaurants/123/connect', {
      method: 'PUT',
      body: { name: 'New' },
    });
    const res = await PUT(req, {
      params: Promise.resolve({ path: ['restaurants', '123', 'connect'] }),
    });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe(API_UNAVAILABLE_MESSAGE);
  });

  it('DELETE retourne 502 lorsque le backend échoue', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const req = createMockRequest('http://localhost:3000/api/proxy/restaurants/123/connect', {
      method: 'DELETE',
    });
    const res = await DELETE(req, {
      params: Promise.resolve({ path: ['restaurants', '123', 'connect'] }),
    });

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe(API_UNAVAILABLE_MESSAGE);
  });
});
