import { describe, expect, it } from 'vitest';
import {
  buildDeterministicTurnResponse,
  buildAvailabilityFollowupResponse,
  buildAvailabilityReply,
  classifyVoiceSpeechAct,
  createConversationState,
  extractConversationSlots,
  getReadyAvailabilityRequest,
  handleCustomerNameTurn,
  parseSpelledNameTranscript,
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

  it('reconnaît aussi la formulation courte « à quel nom je réserve ? »', () => {
    const session = makeSession();
    recordAssistantReply(session, 'Parfait. À quel nom je réserve ?');

    expect(session.conversation.pendingQuestion).toBe('customerName');
  });

  it('conserve les lettres d’une épellation claire avec le STT courant', () => {
    expect(parseSpelledNameTranscript('Au nom de K I F')).toEqual({
      value: 'KIF',
      confident: true,
    });
  });

  it('refuse de deviner quand Flux ajoute du bruit dans une épellation', () => {
    expect(parseSpelledNameTranscript('Un nom de actif a de k i f')).toEqual({
      value: 'ADKIF',
      confident: false,
    });
  });

  it('fait répéter une épellation incertaine au lieu de la transmettre au LLM', () => {
    const session = makeSession();
    recordAssistantReply(session, 'Quel est votre nom pour la réservation ?');

    const result = handleCustomerNameTurn(session, 'Un nom de actif a de k i f');

    expect(result).toEqual({
      response:
        "J'ai entendu une suite de lettres, mais je ne suis pas sûr de l'orthographe. Pouvez-vous me redonner votre nom, lettre par lettre, lentement ?",
      confirmedName: null,
    });
    expect(session.conversation.spellingCandidate).toBeNull();
    expect(session.conversation.slots.customerName).toBeUndefined();
  });

  it('répète puis confirme une épellation claire avant de renseigner le slot nom', () => {
    const session = makeSession();
    recordAssistantReply(session, 'Quel est votre nom pour la réservation ?');

    expect(handleCustomerNameTurn(session, 'Au nom de K I F')).toEqual({
      response: "J'ai noté : K, I, F. C'est bien votre nom ?",
      confirmedName: null,
    });
    expect(session.conversation.slots.customerName).toBeUndefined();

    expect(handleCustomerNameTurn(session, 'Oui, c’est ça')).toEqual({
      response: null,
      confirmedName: 'KIF',
    });
    expect(session.conversation.slots.customerName).toBe('KIF');
    expect(session.conversation.spellingCandidate).toBeNull();
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
    ).toBe("Alors 20 h c'est complet, par contre j'ai 19 h 30 ou 20 h 30. Ça vous irait ?");
  });

  it('propose de regarder un autre jour quand aucun créneau vérifié n’existe', () => {
    expect(buildAvailabilityReply({ date: '2026-07-23', time: '20:00', partySize: 4 }, [])).toBe(
      'Ah, malheureusement on est complets ce jour-là pour 4 personnes. Vous voulez que je regarde un autre jour ?',
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

  it('reconnaît une heure transcrite sans séparateur (« 19 30 »)', () => {
    expect(
      extractConversationSlots('Demain à 19 30 pour deux personnes', 'Europe/Paris'),
    ).toMatchObject({
      time: '19:30',
      partySize: 2,
    });
  });

  it('ne confond pas le nombre de personnes avec une heure', () => {
    expect(extractConversationSlots('Demain pour 2 personnes', 'Europe/Paris')).not.toHaveProperty(
      'time',
    );
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
