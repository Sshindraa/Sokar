export type PublicExperienceSession = {
  id: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  remaining: number;
};

export type PublicExperience = {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceCents: number;
  currency: string;
  capacity: number;
  sessions: PublicExperienceSession[];
};

export type PublicExperienceCheckoutStatus = {
  status: 'OPEN' | 'PAID' | 'FREE' | 'EXPIRED' | 'REFUND_PENDING' | 'REFUNDED' | 'REFUND_FAILED';
  quantity: number;
  reservation: {
    id: string;
    experience: { name: string };
    session: { startsAt: string };
  } | null;
};

const SERVER_API_URL =
  process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = typeof window === 'undefined' ? SERVER_API_URL : PUBLIC_API_URL;
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    cache: 'no-store',
    headers: { ...(init?.headers ?? {}) },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: string;
    message?: string;
  };
  if (!response.ok) throw new Error(payload.error ?? payload.message ?? `HTTP_${response.status}`);
  return payload.data as T;
}

export function fetchPublicExperiences(slug: string) {
  return apiRequest<{ restaurant: { name: string }; experiences: PublicExperience[] }>(
    `/public/r/${encodeURIComponent(slug)}/experiences`,
  );
}

export function createPublicExperienceCheckout(input: {
  slug: string;
  experienceId: string;
  sessionId: string;
  quantity: number;
  idempotencyKey: string;
}) {
  return apiRequest<{ checkoutId: string; url: string; expiresAt: string }>(
    `/public/r/${encodeURIComponent(input.slug)}/experiences/checkout`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify({
        experienceId: input.experienceId,
        sessionId: input.sessionId,
        quantity: input.quantity,
      }),
    },
  );
}

export function fetchPublicExperienceCheckoutStatus(input: {
  slug: string;
  checkoutId: string;
  sessionId: string;
}) {
  return apiRequest<PublicExperienceCheckoutStatus>(
    `/public/r/${encodeURIComponent(input.slug)}/experiences/checkout/${encodeURIComponent(input.checkoutId)}/status?session_id=${encodeURIComponent(input.sessionId)}`,
  );
}

export function cancelPublicExperienceCheckout(input: {
  slug: string;
  checkoutId: string;
  sessionId: string;
}) {
  return apiRequest<{ status: string }>(
    `/public/r/${encodeURIComponent(input.slug)}/experiences/checkout/${encodeURIComponent(input.checkoutId)}/cancel?session_id=${encodeURIComponent(input.sessionId)}`,
    { method: 'POST' },
  );
}
