'use client';

import { useAuth, useOrganization } from '@clerk/nextjs';
import { useCallback } from 'react';
import { useSiteSelection } from '@/features/sites/site-context';
import { toApiError } from '@/lib/api-error';

const PROXY = '/api/proxy';
const hasClerkKey = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
const demoOrgId = process.env.NEXT_PUBLIC_DEMO_RESTAURANT_ID;

interface ApiResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

type ApiRequestOptions = {
  signal?: AbortSignal;
  headers?: Record<string, string>;
};

/**
 * Hook API client pour le dashboard.
 * - Proxy via Next.js (même origine → cookie Clerk forwardé)
 * - orgId/siteId automatiques depuis Clerk et le sélecteur multi-site
 * - Gestion d'erreur centralisée
 */
export function useApi(options: { requireSession?: boolean } = {}) {
  const { activeSiteId } = useSiteSelection();
  // Les options de session sont fixes pour chaque composant appelant. Sans Clerk
  // on expose un client de preview local.
  // En staging demo mode (NEXT_PUBLIC_DEMO_RESTAURANT_ID défini), on force le
  // mode démo, sauf pour le contrôle opérateur qui exige la vraie session.
  const clerk =
    hasClerkKey && (!demoOrgId || options.requireSession)
      ? // eslint-disable-next-line react-hooks/rules-of-hooks
        useClerkContext()
      : {
          isSignedIn: Boolean(demoOrgId),
          organization: null as ReturnType<typeof useOrganization>['organization'],
        };
  const { isSignedIn, organization } = clerk;
  const organizationId = organization?.id ?? demoOrgId ?? undefined;
  // Les routes historiques attendent un ID d'établissement dans leurs
  // paramètres. Une fois le compte multi-site chargé, orgId pointe donc vers
  // le site actif, tout en conservant organizationId pour les opérations au
  // niveau du compte (facturation, sélecteur, etc.).
  const orgId = activeSiteId ?? organizationId;

  const apiFetch = useCallback(
    async <T = unknown>(
      method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
      path: string,
      body?: unknown,
      options?: ApiRequestOptions,
    ): Promise<T> => {
      const url = `${PROXY}/${path.replace(/^\//, '')}`;

      const headers: Record<string, string> = {};
      if (body) headers['Content-Type'] = 'application/json';
      if (activeSiteId) headers['X-Sokar-Site-ID'] = activeSiteId;
      if (options?.headers) Object.assign(headers, options.headers);

      const res = await fetch(url, {
        method,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: options?.signal,
        // Dashboard responses are tenant- and session-scoped. Prevent a
        // successful operator capability probe from being reused after a
        // restaurant user signs in on the same browser.
        cache: 'no-store',
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
        // Message français, code et statut : voir lib/api-error.ts.
        throw toApiError(res.status, data);
      }

      return data as T;
    },
    [activeSiteId],
  );

  const get = useCallback(
    <T = unknown>(path: string, options?: { signal?: AbortSignal }) =>
      apiFetch<T>('GET', path, undefined, options),
    [apiFetch],
  );
  const post = useCallback(
    <T = unknown>(path: string, body?: unknown, options?: ApiRequestOptions) =>
      apiFetch<T>('POST', path, body, options),
    [apiFetch],
  );
  const put = useCallback(
    <T = unknown>(path: string, body?: unknown, options?: ApiRequestOptions) =>
      apiFetch<T>('PUT', path, body, options),
    [apiFetch],
  );
  const patch = useCallback(
    <T = unknown>(path: string, body?: unknown, options?: ApiRequestOptions) =>
      apiFetch<T>('PATCH', path, body, options),
    [apiFetch],
  );
  const del = useCallback(<T = unknown>(path: string) => apiFetch<T>('DELETE', path), [apiFetch]);

  return {
    orgId,
    organizationId,
    siteId: activeSiteId ?? organizationId,
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
