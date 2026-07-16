'use client';

import { useAuth, useOrganization } from '@clerk/nextjs';
import { useCallback } from 'react';

const PROXY = '/api/proxy';
const hasClerkKey = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
const demoOrgId = process.env.NEXT_PUBLIC_DEMO_RESTAURANT_ID;

interface ApiResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/**
 * Hook API client pour le dashboard.
 * - Proxy via Next.js (même origine → cookie Clerk forwardé)
 * - orgId automatique depuis Clerk
 * - Gestion d'erreur centralisée
 */
export function useApi() {
  // The environment flag is stable for the whole client bundle. Without Clerk
  // keys we expose a no-op API client so local UI previews can render.
  const clerk = hasClerkKey
    ? // eslint-disable-next-line react-hooks/rules-of-hooks
      useClerkContext()
    : {
        isSignedIn: Boolean(demoOrgId),
        organization: null as ReturnType<typeof useOrganization>['organization'],
      };
  const { isSignedIn, organization } = clerk;
  const orgId = organization?.id ?? demoOrgId ?? undefined;

  const apiFetch = useCallback(
    async <T = unknown>(
      method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
      path: string,
      body?: unknown,
    ): Promise<T> => {
      const url = `${PROXY}/${path.replace(/^\//, '')}`;

      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });

      let data: Record<string, unknown> = {};
      const text = await res.text();
      if (text) {
        try {
          data = JSON.parse(text) as Record<string, unknown>;
        } catch {
          data = { message: text };
        }
      }

      if (!res.ok) {
        const errorMsg = data.error || data.message || `Erreur ${res.status}`;
        throw new Error(typeof errorMsg === 'string' ? errorMsg : `Erreur ${res.status}`);
      }

      return data as T;
    },
    [],
  );

  const get = useCallback(<T = unknown>(path: string) => apiFetch<T>('GET', path), [apiFetch]);
  const post = useCallback(
    <T = unknown>(path: string, body?: unknown) => apiFetch<T>('POST', path, body),
    [apiFetch],
  );
  const put = useCallback(
    <T = unknown>(path: string, body?: unknown) => apiFetch<T>('PUT', path, body),
    [apiFetch],
  );
  const patch = useCallback(
    <T = unknown>(path: string, body?: unknown) => apiFetch<T>('PATCH', path, body),
    [apiFetch],
  );
  const del = useCallback(<T = unknown>(path: string) => apiFetch<T>('DELETE', path), [apiFetch]);

  return {
    orgId,
    isSignedIn,
    get,
    post,
    put,
    patch,
    del,
  };
}

function useClerkContext() {
  const { isSignedIn } = useAuth();
  const { organization } = useOrganization();

  return { isSignedIn, organization };
}
