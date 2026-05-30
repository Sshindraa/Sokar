import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  const API_URL = 'http://127.0.0.1:4000';

  const res = await fetch(`${API_URL}/api/auth/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Forward the Clerk session cookie
      Cookie: req.headers.get('cookie') || '',
    },
  });

  const data = await res.json();
  return Response.json(data, { status: res.status });
}
