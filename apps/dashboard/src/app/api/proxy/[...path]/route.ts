import type { NextRequest } from 'next/server';

const API_ORIGIN = process.env.API_URL || 'http://127.0.0.1:4000';

/**
 * Proxy universel : /api/proxy/customers?phone=xxx → http://localhost:4000/customers?phone=xxx
 * Forward le cookie Clerk pour l'authentification.
 */
export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  const path = params.path.join('/');
  const search = req.nextUrl.search;
  const url = `${API_ORIGIN}/${path}${search}`;

  const res = await fetch(url, {
    headers: { Cookie: req.headers.get('cookie') || '' },
  });

  const data = await res.json();
  return Response.json(data, { status: res.status });
}

export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  const path = params.path.join('/');
  const search = req.nextUrl.search;
  const url = `${API_ORIGIN}/${path}${search}`;

  const body = req.headers.get('content-type')?.includes('application/json')
    ? await req.json()
    : undefined;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: req.headers.get('cookie') || '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  return Response.json(data, { status: res.status });
}

export async function PATCH(req: NextRequest, { params }: { params: { path: string[] } }) {
  const path = params.path.join('/');
  const search = req.nextUrl.search;
  const url = `${API_ORIGIN}/${path}${search}`;

  const body = await req.json();

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: req.headers.get('cookie') || '',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return Response.json(data, { status: res.status });
}
