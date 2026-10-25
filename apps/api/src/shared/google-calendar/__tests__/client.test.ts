import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchWithTimeout = vi.fn();
vi.mock('../../resilience', () => ({
  fetchWithTimeout: (...args: unknown[]) => fetchWithTimeout(...args),
  retry: (fn: () => unknown) => fn(),
}));

import { GoogleCalendarClient } from '../client';

const details = {
  start: new Date('2026-11-01T19:00:00Z'),
  end: new Date('2026-11-01T21:00:00Z'),
  summary: 'Réservation Sokar',
  description: 'Couverts: 2',
};

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body, text: async () => '' };
}

describe('GoogleCalendarClient', () => {
  beforeEach(() => {
    fetchWithTimeout.mockReset();
    fetchWithTimeout.mockImplementation(async (url: string) =>
      url.includes('oauth2') ? jsonResponse({ access_token: 'at' }) : jsonResponse({ id: 'evt-1' }),
    );
  });

  // Un événement opaque rendrait le créneau « occupé » dans freeBusy pour les réservations suivantes.
  it.each([
    ['createEvent', () => GoogleCalendarClient.createEvent('rt', 'primary', details)],
    ['updateEvent', () => GoogleCalendarClient.updateEvent('rt', 'primary', 'evt-1', details)],
  ])('%s marque l’événement Sokar comme disponible', async (_name, call) => {
    await call();

    const eventCall = fetchWithTimeout.mock.calls.find(([url]) => String(url).includes('/events'));
    expect(JSON.parse(eventCall![1].body).transparency).toBe('transparent');
  });
});
