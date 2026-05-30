'use client';

import { useAuth, useOrganization } from '@clerk/nextjs';
import { useCallback } from 'react';

const PROXY = '/api/proxy';

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
  const { isSignedIn } = useAuth();
  const { organization } = useOrganization();
  const orgId = organization?.id;

  const apiFetch = useCallback(
    async <T = any>(
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
      path: string,
      body?: any,
    ): Promise<T> => {
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
  const post = useCallback(<T = any>(path: string, body?: any) => apiFetch<T>('POST', path, body), [apiFetch]);
  const patch = useCallback(<T = any>(path: string, body?: any) => apiFetch<T>('PATCH', path, body), [apiFetch]);

  return {
    orgId,
    isSignedIn,
    get,
    post,
    patch,
  };
}
