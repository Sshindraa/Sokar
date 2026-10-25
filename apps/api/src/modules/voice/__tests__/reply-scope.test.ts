import { describe, expect, it } from 'vitest';
import { replyScopeOf } from '../stream/structured-turn/reply-scope';
import {
  authorizeStructuredAction,
  createStructuredTurnState,
} from '../stream/structured-turn/fact-guards';
import type { StructuredTurnOutput } from '../stream/structured-turn/schema';

describe('portée des réponses à une proposition', () => {
  it.each(['Non.', 'Non, pas besoin.', 'Non merci.', 'Ça ira.', 'No thanks.'])(
    'un refus bref concerne le repli proposé : %s',
    (text) => expect(replyScopeOf('humanFallback', text)).toBe('decline_human_fallback'),
  );

  it('les mêmes mots dépendent de la question ; après réservation ils ne relancent rien', () => {
    expect(replyScopeOf('confirmation', 'Non.')).toBe('decline_booking');
    expect(replyScopeOf('confirmationResume', 'Non.')).toBe('decline_booking');
    expect(replyScopeOf('customerNameConfirmation', 'Non.')).toBe('correct_name');
    expect(replyScopeOf('none', 'Non.')).toBeUndefined();
    expect(replyScopeOf('open', 'Non merci.')).toBeUndefined();
    expect(replyScopeOf('humanFallback', 'Non merci.', '', true)).toBeUndefined();
  });

  it.each([
    'Non, laissez tomber la réservation.',
    'Je raccroche.',
    'Non merci, au revoir.',
    'Pas besoin de réserver.',
    'Non, plutôt vingt heures.',
  ])('laisse au modèle une intention explicite ou une correction : %s', (text) =>
    expect(replyScopeOf('humanFallback', text)).toBeUndefined(),
  );

  it('un oui ne choisit pas entre transfert et message ; une seule offre reste acceptable', () => {
    expect(
      replyScopeOf(
        'humanFallback',
        'Oui.',
        'Je peux vous passer le gérant ou prendre un message ?',
      ),
    ).toBe('choose_human_fallback');
    expect(replyScopeOf('humanFallback', 'Oui.', 'Le gérant ou un message ?')).toBe(
      'choose_human_fallback',
    );
    expect(replyScopeOf('humanFallback', 'Oui.', 'Je vous passe le gérant ?')).toBeUndefined();
    expect(
      replyScopeOf('humanFallback', 'Oui.', 'Je prends un message pour le gérant ?'),
    ).toBeUndefined();
    expect(replyScopeOf('confirmation', 'Oui.')).toBeUndefined();
  });

  it('bloque toute action et toute clôture sans question malgré un modèle confiant', () => {
    const state = createStructuredTurnState();
    const output = {
      turnComplete: true,
      interpretation: 'end_call',
      draft: state.draft,
      awaiting: 'none',
      action: 'end_call',
      message: '',
      confidence: 'high',
      understanding: 'clear',
      say: 'Au revoir.',
    } as StructuredTurnOutput;
    const context = { maxPartySize: 7, replyScope: 'decline_human_fallback' as const };
    expect(authorizeStructuredAction(state, output, state.draft, context)).toEqual({
      allowed: false,
      reason: 'reply_scope_required',
    });
    expect(
      authorizeStructuredAction(state, { ...output, action: 'transfer' }, state.draft, context)
        .allowed,
    ).toBe(false);
    expect(
      authorizeStructuredAction(state, { ...output, action: 'none' }, state.draft, context).allowed,
    ).toBe(false);
    expect(
      authorizeStructuredAction(
        state,
        { ...output, action: 'none', awaiting: 'open' },
        state.draft,
        context,
      ),
    ).toEqual({ allowed: true });
    expect(
      authorizeStructuredAction(
        state,
        { ...output, action: 'none', awaiting: 'open', draft: { ...state.draft, partySize: 8 } },
        state.draft,
        context,
      ).allowed,
    ).toBe(false);
  });
});
