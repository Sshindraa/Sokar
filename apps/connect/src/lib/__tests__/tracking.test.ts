import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('uses the browser API URL and keeps failed best-effort analytics out of the error overlay', async () => {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
  const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
  vi.stubGlobal('fetch', fetchMock);
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const consoleDebug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);

  const { trackEvent } = await import('../tracking');
  trackEvent({
    event: 'restaurant_page_view',
    restaurantId: 'restaurant-test',
    restaurantSlug: 'restaurant-test',
    city: 'Lyon',
  });

  expect(fetchMock).toHaveBeenCalledWith(
    'http://localhost:4000/public/analytics/events',
    expect.objectContaining({ method: 'POST' }),
  );
  await vi.waitFor(() => expect(consoleDebug).toHaveBeenCalled());
  expect(consoleError).not.toHaveBeenCalled();
});
