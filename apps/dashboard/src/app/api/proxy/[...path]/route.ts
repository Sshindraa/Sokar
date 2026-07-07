import type { NextRequest } from 'next/server';

const API_ORIGIN = process.env.API_URL || 'http://127.0.0.1:4000';

function forwardedHeaders(req: NextRequest) {
  const cookie = req.headers.get('cookie') || '';
  const forwardedFor = req.headers.get('x-forwarded-for') || '';
  const requestId = req.headers.get('x-request-id') || '';

  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  if (forwardedFor) headers['X-Forwarded-For'] = forwardedFor;
  if (requestId) headers['X-Request-ID'] = requestId;
  return headers;
}

async function parseResponse(res: Response) {
  const text = await res.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function proxyResponse(data: unknown, status: number) {
  if (status === 204 || status === 304) {
    return new Response(null, { status });
  }

  return Response.json(data, { status });
}

/**
 * Proxy universel : /api/proxy/customers?phone=xxx → http://localhost:4000/customers?phone=xxx
 * Forward le cookie Clerk pour l'authentification.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const search = req.nextUrl.search;
  const url = `${API_ORIGIN}/${path.join('/')}${search}`;

  const res = await fetch(url, {
    headers: forwardedHeaders(req),
  });

  const data = await parseResponse(res);
  return proxyResponse(data, res.status);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const search = req.nextUrl.search;
  const url = `${API_ORIGIN}/${path.join('/')}${search}`;

  const body = req.headers.get('content-type')?.includes('application/json')
    ? await req.json()
    : undefined;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...forwardedHeaders(req),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await parseResponse(res);
  return proxyResponse(data, res.status);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const search = req.nextUrl.search;
  const url = `${API_ORIGIN}/${path.join('/')}${search}`;

  const body = await req.json();

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...forwardedHeaders(req),
    },
    body: JSON.stringify(body),
  });

  const data = await parseResponse(res);
  return proxyResponse(data, res.status);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const search = req.nextUrl.search;
  const url = `${API_ORIGIN}/${path.join('/')}${search}`;

  const body = await req.json();

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...forwardedHeaders(req),
    },
    body: JSON.stringify(body),
  });

  const data = await parseResponse(res);
  return proxyResponse(data, res.status);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const search = req.nextUrl.search;
  const url = `${API_ORIGIN}/${path.join('/')}${search}`;

  const res = await fetch(url, {
    method: 'DELETE',
    headers: forwardedHeaders(req),
  });

  const data = await parseResponse(res);
  return proxyResponse(data, res.status);
}
