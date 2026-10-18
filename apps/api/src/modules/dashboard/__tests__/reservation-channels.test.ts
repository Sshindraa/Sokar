import { describe, expect, it } from 'vitest';
import { reservationChannelGroup, summarizeReservationChannels } from '../reservation-channels';

describe('reservationChannelGroup', () => {
  it.each([
    [{ channel: 'PHONE', source: null }, 'phone'],
    [{ channel: 'MCP', source: 'mcp' }, 'ai'],
    [{ channel: 'OPENAI_RESERVE', source: null }, 'ai'],
    [{ channel: 'API', source: null }, 'ai'],
    [{ channel: 'ADMIN', source: null }, 'team'],
    [{ channel: 'WEB', source: 'google' }, 'google'],
    [{ channel: 'WEB', source: 'ChatGPT' }, 'ai'],
    [{ channel: 'WEB', source: 'perplexity' }, 'ai'],
    [{ channel: 'WEB', source: 'instagram' }, 'website'],
    [{ channel: 'WEB', source: null }, 'website'],
  ] as const)('%o → %s', (reservation, expected) => {
    expect(reservationChannelGroup(reservation)).toBe(expected);
  });
});

describe('summarizeReservationChannels', () => {
  it('renvoie les cinq canaux dans un ordre stable, même vides', () => {
    expect(
      summarizeReservationChannels([
        { channel: 'PHONE', source: null, partySize: 2 },
        { channel: 'PHONE', source: null, partySize: 3 },
        { channel: 'WEB', source: 'google', partySize: 4 },
      ]),
    ).toEqual([
      { channel: 'phone', reservations: 2, covers: 5 },
      { channel: 'website', reservations: 0, covers: 0 },
      { channel: 'google', reservations: 1, covers: 4 },
      { channel: 'ai', reservations: 0, covers: 0 },
      { channel: 'team', reservations: 0, covers: 0 },
    ]);
  });
});
