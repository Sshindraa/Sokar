import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeApp, getApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';
import { GoogleCalendarClient } from '../../../shared/google-calendar/client';
import { dashboardBase } from '../google.routes';

vi.mock('../../../shared/google-calendar/client', () => ({
  GoogleCalendarClient: {
    getAuthUrl: vi.fn(),
    resolveSignedState: vi.fn(),
    exchangeCodeForTokens: vi.fn(),
  },
}));

describe('dashboardBase', () => {
  it('utilise DASHBOARD_URL, sans barre finale', () => {
    expect(dashboardBase({ DASHBOARD_URL: 'https://sokar.tech/' })).toBe('https://sokar.tech');
    expect(dashboardBase({})).toBe('http://localhost:3000');
  });
});

describe('GET /integrations/google-calendar/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('DASHBOARD_URL', 'https://sokar.tech');
    vi.stubEnv('PUBLIC_URL', 'https://api.sokar.tech');
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeApp();
  });

  it('ramène le restaurateur dans ses réglages, sur le dashboard public, après une connexion réussie', async () => {
    const app = await getApp();
    vi.mocked(GoogleCalendarClient.resolveSignedState).mockReturnValue('rest-1');
    vi.mocked(GoogleCalendarClient.exchangeCodeForTokens).mockResolvedValue({
      refreshToken: 'token',
      googleCalendarId: 'primary',
    } as never);
    vi.mocked(db.restaurant.update).mockResolvedValue({} as never);

    const res = await app.inject({
      method: 'GET',
      url: '/integrations/google-calendar/callback?code=abc&state=signed',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://sokar.tech/dashboard/settings?google_sync=success');
  });

  it('renvoie aussi vers le dashboard en cas d’échec, sans mettre le détail technique dans l’URL', async () => {
    const app = await getApp();
    vi.mocked(GoogleCalendarClient.resolveSignedState).mockImplementation(() => {
      throw new Error('invalid_grant: détail interne');
    });

    const res = await app.inject({
      method: 'GET',
      url: '/integrations/google-calendar/callback?code=abc&state=signed',
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://sokar.tech/dashboard/settings?google_sync=error');
    expect(String(res.headers.location)).not.toContain('invalid_grant');
  });
});
