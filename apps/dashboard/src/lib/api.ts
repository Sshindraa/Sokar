'use client';

import { useAuth, useOrganization } from '@clerk/nextjs';
import { useCallback } from 'react';

const PROXY = '/api/proxy';
const hasClerkKey = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

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
        isSignedIn: false,
        organization: null as ReturnType<typeof useOrganization>['organization'],
      };
  const { isSignedIn, organization } = clerk;
  const orgId = organization?.id;

  const apiFetch = useCallback(
    async <T = any>(
      method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
      path: string,
      body?: any,
    ): Promise<T> => {
      if (!hasClerkKey) {
        return {} as T;
      }

      const url = `${PROXY}/${path.replace(/^\//, '')}`;

      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });

      let data: any = {};
      const text = await res.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { message: text };
        }
      }

      if (!res.ok) {
        throw new Error(data.error || data.message || `Erreur ${res.status}`);
      }

      return data as T;
    },
    [],
  );

  const get = useCallback(<T = any>(path: string) => apiFetch<T>('GET', path), [apiFetch]);
  const post = useCallback(
    <T = any>(path: string, body?: any) => apiFetch<T>('POST', path, body),
    [apiFetch],
  );
  const put = useCallback(
    <T = any>(path: string, body?: any) => apiFetch<T>('PUT', path, body),
    [apiFetch],
  );
  const patch = useCallback(
    <T = any>(path: string, body?: any) => apiFetch<T>('PATCH', path, body),
    [apiFetch],
  );
  const del = useCallback(<T = any>(path: string) => apiFetch<T>('DELETE', path), [apiFetch]);

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
