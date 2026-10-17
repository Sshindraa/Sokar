import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
  let body: { token?: unknown; action?: unknown } | null;
  try {
    const text = await req.text();
    if (text.length > 2048)
      return Response.json({ error: 'Demande invalide.' }, { status: 413, headers });
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: 'Demande invalide.' }, { status: 400, headers });
  }
  try {
    if (
      !body ||
      typeof body.token !== 'string' ||
      body.token.length > 100 ||
      !['view', 'withdraw_whatsapp'].includes(String(body.action))
    )
      return Response.json({ error: 'Demande invalide.' }, { status: 400, headers });
    const forwardedFor = req.headers.get('x-forwarded-for');
    const response = await fetch(
      `${process.env.API_URL || 'http://127.0.0.1:4000'}/public/reservation-management`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {}),
        },
        body: JSON.stringify({ token: body.token, action: body.action }),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      },
    );
    return Response.json(await response.json(), { status: response.status, headers });
  } catch {
    return Response.json(
      { error: 'Service indisponible. Veuillez réessayer.' },
      { status: 502, headers },
    );
  }
}
