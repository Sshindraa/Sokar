import { expect, it, vi } from 'vitest';

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

import { upstreamResponseHeaders } from '../forwarded-headers';

it('renvoie Retry-After au navigateur quand l’API limite', () => {
  const limited = new Response('{}', { status: 429, headers: { 'Retry-After': '42' } });
  expect(upstreamResponseHeaders(limited)).toEqual({ 'Retry-After': '42' });
  expect(upstreamResponseHeaders(new Response('{}'))).toEqual({});
});
