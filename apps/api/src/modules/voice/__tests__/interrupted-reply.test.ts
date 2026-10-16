import { describe, expect, it } from 'vitest';
import { replyContentNotFullyHeard, splitHeardReply } from '../stream/interrupted-reply';
import {
  authorizeStructuredAction,
  bookingKey,
  createStructuredTurnState,
} from '../stream/structured-turn/fact-guards';
import type { StructuredTurnOutput } from '../stream/structured-turn/schema';

const RECAP = "Donc, jeudi 1er octobre à 18 h 30, pour 5 personnes, au nom de HOUET. C'est bon ?";

describe('splitHeardReply', () => {
  it('uses the per-character alignment when the voice provides it', () => {
    const said = 'Bonjour, une table pour deux ?';
    // « Bonjour, » de 0 à 450 ms, puis un caractère toutes les 60 ms.
    const startMs = [...said].map((_, index) => (index < 9 ? index * 50 : 450 + (index - 9) * 60));
    const alignment = { text: said, startMs };
    // 200 ms de tampon : à 900 ms joués, l'appelant a entendu jusqu'à 700 ms.
    const reply = splitHeardReply(said, 900, null, alignment);
    expect(reply.heard).toBe('Bonjour, une');
    expect(reply.unheard).toBe('table pour deux ?');
  });

  it('falls back to the pace estimate when the alignment does not match the text', () => {
    const alignment = {
      text: 'Autre texte',
      startMs: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
    };
    expect(splitHeardReply(RECAP, 3_200, 6_000, alignment)).toEqual(
      splitHeardReply(RECAP, 3_200, 6_000),
    );
  });

  it('keeps everything once the audio has fully played', () => {
    const reply = splitHeardReply(RECAP, 6_000, 6_000);
    expect(reply.unheard).toBe('');
    expect(reply.heard).toBe(RECAP);
  });

  it('cuts on a word boundary in proportion to the audio played', () => {
    const reply = splitHeardReply(RECAP, 3_200, 6_000);
    expect(reply.heard.length).toBeGreaterThan(20);
    expect(reply.heard.length).toBeLessThan(RECAP.length - 15);
    expect(`${reply.heard} ${reply.unheard}`).toBe(RECAP);
    expect(RECAP.charAt(reply.heard.length)).toBe(' ');
  });

  it('hears nothing before the buffer is played, and estimates a pace when the total is unknown', () => {
    expect(splitHeardReply(RECAP, 100, 6_000).heard).toBe('');
    expect(splitHeardReply(RECAP, 100, 6_000).unheard).toBe(RECAP);
    const unknownTotal = splitHeardReply(RECAP, 2_200, null);
    expect(unknownTotal.heard.length).toBeGreaterThan(0);
    expect(unknownTotal.unheard.length).toBeGreaterThan(0);
  });
});

describe('replyContentNotFullyHeard', () => {
  it('is true when the cut falls before the closing question', () => {
    expect(replyContentNotFullyHeard(splitHeardReply(RECAP, 3_200, 6_000))).toBe(true);
  });

  it('is false when only the closing question was missed, or nothing was cut', () => {
    const cutAtQuestion = {
      said: RECAP,
      heard: 'Donc, jeudi 1er octobre à 18 h 30, pour 5 personnes, au nom de HOUET.',
      unheard: "C'est bon ?",
    };
    expect(replyContentNotFullyHeard(cutAtQuestion)).toBe(false);
    expect(replyContentNotFullyHeard(splitHeardReply(RECAP, 6_000, 6_000))).toBe(false);
  });

  it('is false for a reply that is only a question', () => {
    const question = { said: 'Vous confirmez ?', heard: 'Vous', unheard: 'confirmez ?' };
    expect(replyContentNotFullyHeard(question)).toBe(false);
  });
});

describe('recap_not_heard', () => {
  const output = {
    turnComplete: true,
    interpretation: 'affirmation',
    draft: { date: '2026-10-01', time: '18:30', partySize: 5, customerName: 'HOUET' },
    awaiting: 'none',
    action: 'create_reservation',
    message: '',
    confidence: 'high',
    say: '',
  } as StructuredTurnOutput;

  it('refuses a yes given over a recap whose content was not heard', () => {
    const state = createStructuredTurnState();
    state.draft = { ...output.draft };
    state.lastAwaiting = 'confirmation';
    state.recapKey = bookingKey(state.draft);
    state.availability = { date: '2026-10-01', partySize: 5, slots: ['18:30'] };
    const context = { maxPartySize: 8 };
    expect(authorizeStructuredAction(state, output, state.draft, context)).toEqual({
      allowed: true,
    });
    expect(
      authorizeStructuredAction(state, output, state.draft, { ...context, recapHeard: false }),
    ).toEqual({ allowed: false, reason: 'recap_not_heard' });
  });
});
