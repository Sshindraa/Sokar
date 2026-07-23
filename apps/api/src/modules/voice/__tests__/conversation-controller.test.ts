import { describe, expect, it } from 'vitest';
import {
  buildDeterministicTurnResponse,
  buildAvailabilityFollowupResponse,
  buildAvailabilityReply,
  classifyVoiceSpeechAct,
  createConversationState,
  extractConversationSlots,
  getReadyAvailabilityRequest,
  recordAssistantReply,
  recordUserTurn,
} from '../stream/conversation-controller';
import type { CallSession } from '../stream/types';

function makeSession(): CallSession {
  return { conversation: createConversationState() } as CallSession;
}

describe('classifyVoiceSpeechAct', () => {
  it.each([
    ['Allô ?', 'liveness'],
    ['D’accord.', 'backchannel'],
    ['Merci, c’est tout.', 'closing'],
    ['Non non merci au revoir.', 'closing'],
    ['Non, plutôt 20 h 30.', 'correction'],
    ['Je voudrais réserver demain.', 'content'],
  ] as const)('classifie « %s » comme %s', (transcript, expected) => {
    expect(classifyVoiceSpeechAct(transcript)).toBe(expected);
  });
});

describe('conversation state', () => {
  it('mémorise une intention et la question métier en attente', () => {
    const session = makeSession();
    recordUserTurn(session, 'Je voudrais réserver une table', 'content');
    recordAssistantReply(session, 'Très bien. Quel est votre nom pour la réservation ?');

    expect(session.conversation.intent).toBe('reservation');
    expect(session.conversation.pendingQuestion).toBe('customerName');
    expect(session.conversation.lastAssistantQuestion).toBe(
      'Quel est votre nom pour la réservation ?',
    );
  });

  it('reprend une question après un acquiescement sans appeler le LLM', () => {
    const session = makeSession();
    recordAssistantReply(session, 'Pour combien de personnes souhaitez-vous réserver ?');

    expect(buildDeterministicTurnResponse(session, 'backchannel')).toBe(
      "D'accord. Pour combien de personnes souhaitez-vous réserver ?",
    );
  });

  it('confie la formulation de clôture au LLM sans rouvrir le dialogue', () => {
    const session = makeSession();

    recordUserTurn(session, 'Non non merci au revoir', 'closing');
    expect(buildDeterministicTurnResponse(session, 'closing')).toBeNull();
    expect(session.conversation.closing).toBe(true);
  });

  it('transfère après deux incompréhensions consécutives', () => {
    const session = makeSession();
    recordAssistantReply(session, "Désolé, je n'ai pas bien compris. Pouvez-vous répéter ?");
    recordAssistantReply(session, "Désolé, je n'ai pas bien compris. Pouvez-vous répéter ?");

    expect(buildDeterministicTurnResponse(session, 'content')).toBe(
      'Je vais vous passer le gérant pour vous aider.',
    );
  });

  it('réinitialise le compteur dès qu’une réponse métier a été comprise', () => {
    const session = makeSession();
    recordAssistantReply(session, "Désolé, je n'ai pas bien compris. Pouvez-vous répéter ?");
    recordAssistantReply(session, 'Très bien. Vous serez combien ?');

    expect(session.conversation.misunderstandingCount).toBe(0);
    expect(buildDeterministicTurnResponse(session, 'content')).toBeNull();
  });

  it('extrait les slots français et rend la disponibilité prête au même tour', () => {
    const session = makeSession();
    session.timezone = 'Europe/Paris';
    recordUserTurn(
      session,
      'Je voudrais réserver demain à 20 h pour deux personnes',
      'content',
      new Date('2026-07-22T10:00:00Z'),
    );

    expect(session.conversation.slots).toEqual({
      date: '2026-07-23',
      time: '20:00',
      partySize: 2,
    });
    expect(getReadyAvailabilityRequest(session)).toEqual({
      date: '2026-07-23',
      time: '20:00',
      partySize: 2,
      key: '2026-07-23:20:00:2',
    });
  });

  it('convertit les heures et ne propose que deux alternatives', () => {
    expect(
      buildAvailabilityReply({ date: '2026-07-23', time: '20:00', partySize: 2 }, [
        '19:30',
        '20:30',
        '21:00',
      ]),
    ).toBe("Désolé, 20 h n'est pas disponible. Je peux vous proposer 19 h 30 ou 20 h 30.");
  });

  it('propose le gérant ou un message quand aucun créneau vérifié n’existe', () => {
    expect(buildAvailabilityReply({ date: '2026-07-23', time: '20:00', partySize: 4 }, [])).toBe(
      "Désolé, je n'ai pas de créneau disponible ce jour-là pour 4 personnes. Je peux vous passer le gérant ou prendre un message.",
    );
  });

  it('ne fabrique jamais une alternative après une recherche vide', () => {
    const session = makeSession();
    session.conversation.lastAvailabilityResult = {
      key: '2026-07-23:20:00:2',
      date: '2026-07-23',
      time: '20:00',
      partySize: 2,
      slots: [],
    };

    expect(buildAvailabilityFollowupResponse(session, 'Du coup, vous proposez quoi ?')).toBe(
      "Je n'ai aucun autre créneau vérifié ce jour-là. Je peux vous passer le gérant ou prendre un message.",
    );
  });

  it('demande de préciser le nombre après une transcription ambiguë', () => {
    const session = makeSession();
    session.conversation.intent = 'reservation';
    recordAssistantReply(session, 'Vous serez combien ?');

    expect(buildDeterministicTurnResponse(session, 'content', "Je s'en sera pas de personne")).toBe(
      "Je n'ai pas bien compris le nombre de personnes. Vous serez combien ?",
    );
  });

  it('calcule les dates relatives dans le fuseau du restaurant', () => {
    expect(
      extractConversationSlots(
        'Demain à 20 heures',
        'Europe/Paris',
        new Date('2026-07-22T22:30:00Z'),
      ),
    ).toMatchObject({ date: '2026-07-24', time: '20:00' });
  });

  it('conserve une date ISO explicite', () => {
    expect(extractConversationSlots('Le 2026-08-01 à 19:30', 'Europe/Paris')).toMatchObject({
      date: '2026-08-01',
      time: '19:30',
    });
  });

  it('résout le prochain jour de semaine dans le fuseau du restaurant', () => {
    expect(
      extractConversationSlots(
        'Vendredi à 19 heures',
        'Europe/Paris',
        new Date('2026-07-22T10:00:00Z'),
      ),
    ).toMatchObject({ date: '2026-07-24', time: '19:00' });
  });
});
