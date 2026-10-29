import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useEffect } from 'react';

type SiteStatus = 'idle' | 'loading' | 'ready' | 'error';

const mocks = vi.hoisted(() => ({
  site: { activeSiteId: undefined as string | undefined, status: 'idle' as SiteStatus },
}));

vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ isSignedIn: true }),
  useOrganization: () => ({ organization: { id: 'org_clerk' } }),
}));

vi.mock('@/features/sites/site-context', () => ({
  useSiteSelection: () => mocks.site,
}));

// useApi lit les variables d'environnement à l'import : chaque cas recharge le module.
async function loadUseApi(env: { clerk: boolean; demo?: string }) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', env.clerk ? 'pk_test_dummy' : '');
  vi.stubEnv('NEXT_PUBLIC_DEMO_RESTAURANT_ID', env.demo ?? '');
  const { useApi } = await import('@/lib/api');
  return useApi;
}

function setSite(activeSiteId: string | undefined, status: SiteStatus) {
  mocks.site = { activeSiteId, status };
}

describe('useApi pendant le chargement des sites', () => {
  beforeEach(() => setSite(undefined, 'idle'));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('ne publie aucun identifiant d’établissement tant que les sites chargent', async () => {
    const useApi = await loadUseApi({ clerk: true });
    for (const status of ['idle', 'loading'] as const) {
      setSite(undefined, status);
      const { result, unmount } = renderHook(() => useApi());
      expect(result.current.orgId).toBeUndefined();
      expect(result.current.siteId).toBeUndefined();
      expect(result.current.organizationId).toBe('org_clerk');
      unmount();
    }
  });

  it('n’appelle pas l’API avec l’identifiant Clerk pendant le chargement, puis avec le site', async () => {
    const fetchSpy = vi.fn(
      async (_input: RequestInfo | URL) => new Response('{}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const useApi = await loadUseApi({ clerk: true });
    setSite(undefined, 'loading');
    const { rerender } = renderHook(() => {
      const { orgId, get } = useApi();
      useEffect(() => {
        if (orgId) void get(`restaurants/${orgId}`);
      }, [orgId, get]);
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    setSite('site_1', 'ready');
    rerender();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain('restaurants/site_1');
    expect(url).not.toContain('org_clerk');
  });

  it('revient à l’identifiant du compte si le chargement des sites échoue', async () => {
    const useApi = await loadUseApi({ clerk: true });
    setSite(undefined, 'error');
    const { result } = renderHook(() => useApi());
    expect(result.current.orgId).toBe('org_clerk');
    expect(result.current.siteId).toBe('org_clerk');
  });

  it('garde le repli immédiat en démo', async () => {
    const useApi = await loadUseApi({ clerk: true, demo: 'demo_restaurant' });
    setSite(undefined, 'idle');
    const { result } = renderHook(() => useApi());
    expect(result.current.orgId).toBe('demo_restaurant');
  });
});
