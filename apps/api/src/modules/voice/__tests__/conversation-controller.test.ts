import { describe, expect, it } from 'vitest';
import {
  buildDeterministicTurnResponse,
  buildAvailabilityFollowupResponse,
  buildAvailabilityLlmContext,
  buildAvailabilityReply,
  classifyVoiceSpeechAct,
  classifyVoiceSpeechActInContext,
  createConversationState,
  extractConversationSlots,
  getReadyAvailabilityRequest,
  buildReservationProgressResponse,
  buildPendingQuestionResponse,
  confirmReservationDraft,
  extractPlainCustomerName,
  getReservationConfirmationKey,
  handleCustomerNameTurn,
  isNameCollectionBlocking,
  parseSpelledNameTranscript,
  parseSpelledNameTranscriptDetailed,
  recordAssistantReply,
  recordUserTurn,
  resetNameCollectionAfterFallback,
  pendingQuestionFrom,
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
    ['À 19 h 30, non plutôt 20 h 30.', 'correction'],
    ['Je voudrais réserver demain.', 'content'],
  ] as const)('classifie « %s » comme %s', (transcript, expected) => {
    expect(classifyVoiceSpeechAct(transcript)).toBe(expected);
  });

  it('garde le sens de « c’est bon » quand une confirmation est attendue', () => {
    const session = makeSession();
    recordAssistantReply(session, 'J’ai une table pour quatre personnes. Vous me confirmez ?');

    expect(session.conversation.pendingQuestion).toBe('confirmation');
    expect(classifyVoiceSpeechAct('C’est bon')).toBe('closing');
    expect(classifyVoiceSpeechActInContext(session, 'C’est bon')).toBe('content');
  });

  it('reconnaît les attentes de confirmation, de créneau et de téléphone', () => {
    expect(pendingQuestionFrom('Vous me confirmez ?')).toBe('confirmation');
    expect(pendingQuestionFrom('Ça vous va pour samedi ?')).toBe('confirmation');
    expect(pendingQuestionFrom('Je peux la réserver ?')).toBe('confirmation');
    expect(pendingQuestionFrom('Quel horaire vous conviendrait ?')).toBe('timeChoice');
    expect(pendingQuestionFrom('Quel créneau préférez-vous ?')).toBe('timeChoice');
    expect(pendingQuestionFrom('Quel numéro puis-je utiliser ?')).toBe('customerPhone');
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

  it('retient un nom simple déjà donné pour le transmettre au prochain tour', () => {
    const session = makeSession();
    recordAssistantReply(session, 'À quel nom je réserve ?');
    recordUserTurn(session, 'Akif', 'content');

    expect(session.conversation.slots.customerName).toBe('Akif');
    expect(extractPlainCustomerName('Au nom de Akif')).toBe('Akif');
    expect(extractPlainCustomerName('A K I F', true)).toBeNull();
  });

  it('ne répète pas mécaniquement la question de nom après un acquiescement', () => {
    const session = makeSession();
    recordAssistantReply(session, 'Parfait. À quel nom je réserve ?');

    expect(buildPendingQuestionResponse(session, 'Oui')).toBe(
      'Quel nom dois-je inscrire pour la réservation ?',
    );
  });

  it('ne transforme pas un oui de confirmation en répétition de la question', () => {
    const session = makeSession();
    recordAssistantReply(session, 'J’ai une table pour quatre personnes. Vous me confirmez ?');

    expect(buildDeterministicTurnResponse(session, 'content', 'Oui')).toBeNull();
  });

  it('lie l’accord au dernier récapitulatif et l’annule dès qu’un créneau change', () => {
    const session = makeSession();
    session.conversation.slots = {
      date: '2026-09-12',
      time: '19:30',
      partySize: 4,
      customerName: 'Akif',
    };

    recordAssistantReply(
      session,
      'J’ai une table pour quatre personnes samedi 12 septembre à 19 h 30, au nom d’Akif. Vous me confirmez ?',
    );
    const key = getReservationConfirmationKey(session);
    expect(key).toBe('2026-09-12:19:30:4:akif');
    expect(session.conversation.pendingReservationConfirmationKey).toBe(key);
    expect(confirmReservationDraft(session)).toBe(true);
    expect(session.conversation.confirmedReservationKey).toBe(key);

    recordUserTurn(session, 'Non, plutôt 20 h 30', 'correction');

    expect(session.conversation.slots.time).toBe('20:30');
    expect(session.conversation.pendingReservationConfirmationKey).toBeNull();
    expect(session.conversation.confirmedReservationKey).toBeNull();
    expect(session.conversation.pendingQuestion).toBeNull();
  });

  it('conserve les lettres d’une épellation claire avec le STT courant', () => {
    expect(parseSpelledNameTranscript('Au nom de K I F')).toEqual({
      value: 'KIF',
      confident: true,
    });
  });

  it('refuse de deviner quand Scribe ajoute du bruit dans une épellation', () => {
    expect(parseSpelledNameTranscript('Un nom de actif a de k i f')).toEqual({
      value: 'ADKIF',
      confident: false,
    });
  });

  it('reconnaît la variante Scribe « en nombre de actifs » dans une question de nom', () => {
    expect(parseSpelledNameTranscript('En nombre de actifs, a de k i f')).toEqual({
      value: 'ADKIF',
      confident: true,
    });
  });

  it('ignore le préfixe de correction avant une nouvelle épellation', () => {
    expect(parseSpelledNameTranscript('Non, a d k i f')).toEqual({
      value: 'ADKIF',
      confident: true,
    });
  });

  it.each([
    ['A K I F', 'AKIF'],
    ['a ka i effe', 'AKIF'],
    ['K-I-F', 'KIF'],
    ['Je vous épelle : L I', 'LI'],
    ['A comme Anatole, K comme Karim, I comme Isabelle, F comme François', 'AKIF'],
    ['A comme Anatole K I F', 'AKIF'],
    ['A deux L A N', 'ALLAN'],
    ['double L', 'LL'],
    ['double vé i grec', 'WY'],
    ['K tiret I F', 'K-IF'],
    ['K trait d’union I F', 'K-IF'],
  ])('parse %s sans corriger le transcript en %s', (transcript, expected) => {
    expect(parseSpelledNameTranscript(transcript)).toMatchObject({
      value: expected,
      confident: true,
    });
  });

  it('conserve les positions ambiguës dans le candidat détaillé', () => {
    const parsed = parseSpelledNameTranscriptDetailed('Un nom de actif a de k i f');

    expect(parsed).toMatchObject({
      value: 'ADKIF',
      partialCandidate: '?ADKIF',
      confident: false,
      ambiguousPositions: [0],
    });
    expect(parsed?.tokens[0]).toMatchObject({ kind: 'ambiguous', value: null, position: 0 });
  });

  it('ne traite pas les particules et noms composés ordinaires comme une épellation', () => {
    expect(parseSpelledNameTranscript('Jean de La Fontaine')).toBeNull();
    expect(parseSpelledNameTranscript('Anne-Marie')).toBeNull();
    expect(parseSpelledNameTranscript('de')).toBeNull();
  });

  it('fait répéter une épellation incertaine au lieu de la transmettre au LLM', () => {
    const session = makeSession();
    recordAssistantReply(session, 'Quel est votre nom pour la réservation ?');

    const result = handleCustomerNameTurn(session, 'Un nom de actif a de k i f');

    expect(result).toMatchObject({
      response:
        "Je n'ai pas bien saisi l'orthographe. Pouvez-vous me redonner le nom lettre par lettre, s'il vous plaît ?",
      confirmedName: null,
    });
    expect(session.conversation.nameCollection.state).toBe('clarifying');
    expect(session.conversation.nameCollection.ambiguousPositions).toEqual([0]);
    expect(session.conversation.spellingCandidate).toBeNull();
    expect(session.conversation.slots.customerName).toBeUndefined();
  });

  it("récupère une épellation fiable après un mot parasite de l'ASR", () => {
    const session = makeSession();
    recordAssistantReply(session, 'Quel est votre nom pour la réservation ?');

    expect(handleCustomerNameTurn(session, 'Un nom de bruit a deux k i f')).toMatchObject({
      response:
        "Je n'ai pas bien saisi l'orthographe. Pouvez-vous me redonner le nom lettre par lettre, s'il vous plaît ?",
      confirmedName: null,
    });

    expect(handleCustomerNameTurn(session, 'Attif, a b k i f')).toEqual({
      response: "A-B-K-I-F, c'est bien cela ?",
      confirmedName: null,
    });
    expect(session.conversation.nameCollection.state).toBe('confirming');
  });

  it('garde la correction « non, A D K I F » dans le stt déterministe', () => {
    const session = makeSession();
    recordAssistantReply(session, 'Quel est votre nom pour la réservation ?');

    expect(handleCustomerNameTurn(session, 'En nombre de actifs, a de k i f')).toMatchObject({
      response: "A-D-K-I-F, c'est bien cela ?",
      confirmedName: null,
    });
    expect(handleCustomerNameTurn(session, 'Non, a d k i f')).toMatchObject({
      response: "A-D-K-I-F, c'est bien cela ?",
      confirmedName: null,
    });
    expect(session.conversation.nameCollection.state).toBe('confirming');
    expect(session.conversation.slots.customerName).toBeUndefined();
  });

  it('remplit uniquement la zone demandée quand la clarification utilise « comme »', () => {
    const session = makeSession();
    recordAssistantReply(session, 'Quel est votre nom pour la réservation ?');

    expect(handleCustomerNameTurn(session, 'Au nom de K actif I F')).toMatchObject({
      response:
        "Je n'ai pas bien saisi l'orthographe. Pouvez-vous me redonner le nom lettre par lettre, s'il vous plaît ?",
    });
    expect(handleCustomerNameTurn(session, 'K comme Karim')).toEqual({
      response: "K-K-I-F, c'est bien cela ?",
      confirmedName: null,
    });
  });

  it('accepte la lettre C seule comme réponse de clarification', () => {
    const session = makeSession();
    recordAssistantReply(session, 'Quel est votre nom pour la réservation ?');

    expect(handleCustomerNameTurn(session, 'Un nom de actif a de k i f')).toMatchObject({
      response:
        "Je n'ai pas bien saisi l'orthographe. Pouvez-vous me redonner le nom lettre par lettre, s'il vous plaît ?",
    });
    expect(handleCustomerNameTurn(session, 'C')).toEqual({
      response: "C-A-D-K-I-F, c'est bien cela ?",
      confirmedName: null,
    });
  });

  it('répète puis confirme une épellation claire avant de renseigner le slot nom', () => {
    const session = makeSession();
    recordAssistantReply(session, 'Quel est votre nom pour la réservation ?');

    expect(handleCustomerNameTurn(session, 'Au nom de K I F')).toEqual({
      response: "K-I-F, c'est bien cela ?",
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

  it('conserve le contexte nom pour la confirmation de l’épellation', () => {
    const session = makeSession();
    recordAssistantReply(session, 'Quel est votre nom pour la réservation ?');
    const spelling = handleCustomerNameTurn(session, 'A K I F');
    recordAssistantReply(session, spelling.response!);

    expect(session.conversation.pendingQuestion).toBe('customerName');
    expect(buildPendingQuestionResponse(session, 'Oui')).toBeNull();
  });

  it('conserve le doublon explicite « A deux K I F »', () => {
    const session = makeSession();
    recordAssistantReply(session, 'Quel est votre nom pour la réservation ?');

    expect(handleCustomerNameTurn(session, 'Au nom de A deux K I F')).toEqual({
      response: "A-K-K-I-F, c'est bien cela ?",
      confirmedName: null,
    });
  });

  it('conserve deux fragments et ne les transmet qu’après confirmation', () => {
    const session = makeSession();
    recordAssistantReply(session, 'Quel est votre nom pour la réservation ?');

    expect(handleCustomerNameTurn(session, 'A K')).toEqual({
      response:
        "J'ai noté A-K pour l'instant. Vous pouvez continuer, ou me dire si c'est tout le nom.",
      confirmedName: null,
    });
    expect(session.conversation.nameCollection.state).toBe('collecting');

    expect(handleCustomerNameTurn(session, 'I F')).toEqual({
      response: "A-K-I-F, c'est bien cela ?",
      confirmedName: null,
    });
    expect(session.conversation.nameCollection.state).toBe('confirming');
    expect(session.conversation.slots.customerName).toBeUndefined();

    expect(handleCustomerNameTurn(session, 'Oui')).toEqual({
      response: null,
      confirmedName: 'AKIF',
    });
    expect(session.conversation.nameCollection.state).toBe('confirmed');
  });

  it('reprend proprement une épellation bruitée puis comprend la correction « A deux K I F »', () => {
    const session = makeSession();
    recordAssistantReply(session, 'Quel est votre nom pour la réservation ?');

    expect(handleCustomerNameTurn(session, 'Au nom de Aikif, a de k i f')).toMatchObject({
      response:
        "Je n'ai pas bien saisi l'orthographe. Pouvez-vous me redonner le nom lettre par lettre, s'il vous plaît ?",
      confirmedName: null,
    });
    expect(session.conversation.nameCollection.state).toBe('clarifying');

    expect(handleCustomerNameTurn(session, 'Non.')).toEqual({
      response: "D'accord. Pouvez-vous me redonner votre nom, lettre par lettre, lentement ?",
      confirmedName: null,
    });
    expect(session.conversation.nameCollection.state).toBe('collecting');

    expect(
      handleCustomerNameTurn(
        session,
        'Non, non, non, non. Attends, attends, attends. A deux k i f.',
      ),
    ).toEqual({
      response: "A-K-K-I-F, c'est bien cela ?",
      confirmedName: null,
    });
    expect(session.conversation.nameCollection.state).toBe('confirming');

    expect(handleCustomerNameTurn(session, 'Oui.')).toEqual({
      response: null,
      confirmedName: 'AKKIF',
    });
    expect(session.conversation.slots.customerName).toBe('AKKIF');
  });

  it('concatène aussi une continuation de trois lettres au fragment précédent', () => {
    const session = makeSession();
    recordAssistantReply(session, 'Quel est votre nom ?');

    handleCustomerNameTurn(session, 'A B');
    expect(handleCustomerNameTurn(session, 'C D E')).toEqual({
      response: "A-B-C-D-E, c'est bien cela ?",
      confirmedName: null,
    });
  });

  it('ne libère pas le verrou quand la dernière lettre arrive seule', () => {
    const session = makeSession();
    recordAssistantReply(session, 'Quel est votre nom ?');

    handleCustomerNameTurn(session, 'A B');
    expect(handleCustomerNameTurn(session, 'C')).toEqual({
      response: "A-B-C, c'est bien cela ?",
      confirmedName: null,
    });
    expect(session.conversation.nameCollection.state).toBe('confirming');
    expect(isNameCollectionBlocking(session)).toBe(true);
  });

  it('distingue une continuation d’une reprise complète sans concaténer aveuglément', () => {
    const session = makeSession();
    recordAssistantReply(session, 'Quel est votre nom ?');

    expect(handleCustomerNameTurn(session, 'A B')).toMatchObject({
      response:
        "J'ai noté A-B pour l'instant. Vous pouvez continuer, ou me dire si c'est tout le nom.",
    });
    expect(handleCustomerNameTurn(session, 'La suite I F')).toMatchObject({
      response: "A-B-I-F, c'est bien cela ?",
    });
    expect(handleCustomerNameTurn(session, 'Je recommence K I F')).toMatchObject({
      response: "K-I-F, c'est bien cela ?",
    });
  });

  it('corrige une position ciblée en conservant les autres lettres', () => {
    const session = makeSession();
    recordAssistantReply(session, 'Quel est votre nom ?');
    handleCustomerNameTurn(session, 'A B I F');

    expect(handleCustomerNameTurn(session, 'Non, la deuxième lettre est un K')).toEqual({
      response: "A-K-I-F, c'est bien cela ?",
      confirmedName: null,
    });
    expect(handleCustomerNameTurn(session, 'Oui')).toEqual({
      response: null,
      confirmedName: 'AKIF',
    });
  });

  it('invalide une confirmation précédente lorsqu’une correction arrive ensuite', () => {
    const session = makeSession();
    recordAssistantReply(session, 'Quel est votre nom ?');
    handleCustomerNameTurn(session, 'A B I F');
    handleCustomerNameTurn(session, 'Oui');

    expect(handleCustomerNameTurn(session, 'La première lettre est un K')).toMatchObject({
      response: "K-B-I-F, c'est bien cela ?",
      confirmedName: null,
    });
    expect(session.conversation.slots.customerName).toBeUndefined();
    expect(handleCustomerNameTurn(session, 'Oui')).toMatchObject({ confirmedName: 'KBIF' });
  });

  it('ignore une phrase ordinaire après confirmation sans modifier le nom', () => {
    const session = makeSession();
    recordAssistantReply(session, 'Quel est votre nom ?');
    handleCustomerNameTurn(session, 'A B I F');
    handleCustomerNameTurn(session, 'Oui');

    expect(handleCustomerNameTurn(session, 'Je voudrais une table à midi')).toEqual({
      response: null,
      confirmedName: null,
    });
    expect(session.conversation.nameCollection.state).toBe('confirmed');
    expect(session.conversation.nameCollection.confirmedName).toBe('ABIF');
    expect(session.conversation.slots.customerName).toBe('ABIF');
  });

  it('garde la réservation bloquée si une correction reste inexpliquée après confirmation', () => {
    const session = makeSession();
    recordAssistantReply(session, 'Quel est votre nom ?');
    handleCustomerNameTurn(session, 'A B I F');
    handleCustomerNameTurn(session, 'Oui');

    expect(handleCustomerNameTurn(session, 'Non, je ne sais plus quelle lettre corriger')).toEqual({
      response:
        "Je n'ai pas compris la correction. Quelle lettre souhaitez-vous modifier, s'il vous plaît ?",
      confirmedName: null,
    });
    expect(session.conversation.nameCollection.state).toBe('collecting');
    expect(session.conversation.nameCollection.awaitingCorrection).toBe(true);
    expect(session.conversation.nameCollection.confirmedName).toBeNull();
    expect(session.conversation.slots.customerName).toBeUndefined();
    expect(isNameCollectionBlocking(session)).toBe(true);
  });

  it('borne les corrections incomprises au même compteur de clarification', () => {
    const session = makeSession();
    recordAssistantReply(session, 'Quel est votre nom ?');
    handleCustomerNameTurn(session, 'A B I F');

    expect(
      handleCustomerNameTurn(session, 'Non, je ne sais plus quelle lettre corriger'),
    ).not.toHaveProperty('escalate');
    expect(handleCustomerNameTurn(session, 'Je ne sais pas')).toMatchObject({
      escalate: true,
      confirmedName: null,
    });
    expect(session.conversation.nameCollection.clarificationCount).toBe(2);
  });

  it('ne traite pas une suite isolée comme correction après confirmation', () => {
    const session = makeSession();
    recordAssistantReply(session, 'Quel est votre nom ?');
    handleCustomerNameTurn(session, 'K I F');
    handleCustomerNameTurn(session, 'Oui');

    expect(handleCustomerNameTurn(session, 'A K')).toEqual({
      response: null,
      confirmedName: null,
    });
    expect(session.conversation.slots.customerName).toBe('KIF');
  });

  it('n’autorise pas un oui sans candidat effectivement présenté', () => {
    const session = makeSession();
    recordAssistantReply(session, 'Quel est votre nom ?');
    handleCustomerNameTurn(session, 'A K');

    const result = handleCustomerNameTurn(session, 'Oui');
    expect(result.confirmedName).toBeNull();
    expect(session.conversation.slots.customerName).toBeUndefined();
  });

  it('escalade après deux clarifications infructueuses', () => {
    const session = makeSession();
    recordAssistantReply(session, 'Quel est votre nom ?');
    handleCustomerNameTurn(session, 'Un nom de actif a de k i f');

    expect(handleCustomerNameTurn(session, 'Je ne sais pas')).not.toHaveProperty('escalate');
    expect(handleCustomerNameTurn(session, 'Je ne sais toujours pas')).toMatchObject({
      escalate: true,
      confirmedName: null,
    });
    expect(session.conversation.nameCollection.clarificationCount).toBe(2);
  });

  it('réinitialise la clarification après l’enregistrement d’une prise de message', () => {
    const session = makeSession();
    recordAssistantReply(session, 'Quel est votre nom ?');
    handleCustomerNameTurn(session, 'Un nom de actif a de k i f');
    handleCustomerNameTurn(session, 'Je ne sais pas');
    expect(handleCustomerNameTurn(session, 'Je ne sais toujours pas')).toMatchObject({
      escalate: true,
    });

    resetNameCollectionAfterFallback(session);

    expect(session.conversation.nameCollection.state).toBe('idle');
    expect(session.conversation.nameCollection.fallbackRecorded).toBe(true);
    expect(session.conversation.pendingQuestion).toBeNull();
    expect(isNameCollectionBlocking(session)).toBe(false);
  });

  it('termine la collecte sur une clôture sans déclencher la prise de message', () => {
    const session = makeSession();
    recordAssistantReply(session, 'Quel est votre nom ?');
    handleCustomerNameTurn(session, 'A B');
    handleCustomerNameTurn(session, 'Non, je me suis trompé');
    expect(session.conversation.nameCollection.awaitingCorrection).toBe(true);

    expect(handleCustomerNameTurn(session, 'Non merci, au revoir')).toEqual({
      response: null,
      confirmedName: null,
    });
    expect(session.conversation.nameCollection.state).toBe('idle');
    expect(session.conversation.nameCollection.awaitingCorrection).toBe(false);
    expect(session.conversation.nameCollection.fallbackRecorded).toBe(false);
    expect(session.conversation.pendingQuestion).toBeNull();
    expect(session.conversation.spellingCandidate).toBeNull();
    expect(isNameCollectionBlocking(session)).toBe(false);
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

  it('transmet au LLM le créneau vérifié et n’invite pas à redemander un nom connu', () => {
    const context = buildAvailabilityLlmContext({
      request: { date: '2026-09-12', time: '19:30', partySize: 4 },
      availableSlots: ['19:30', '20:00'],
      knownCustomerName: 'Akif',
    });

    expect(context).toContain('date exacte 2026-09-12');
    expect(context).toContain('samedi 12 septembre 2026');
    expect(context).toContain('créneau demandé disponible');
    expect(context).toContain('Le nom « Akif » est déjà connu : ne le redemande pas');
    expect(context).toContain('confirmation explicite');
  });

  it('borne les alternatives du LLM aux créneaux renvoyés par la disponibilité', () => {
    const context = buildAvailabilityLlmContext({
      request: { date: '2026-09-12', time: '19:30', partySize: 4 },
      availableSlots: ['18:30', '20:00'],
    });

    expect(context).toContain('créneau demandé indisponible');
    expect(context).toContain('20 h ou 18 h 30');
    expect(context).toContain('Ne confirme pas et ne crée pas de réservation');
  });

  it('garde la collecte de réservation sur une seule question à la fois', () => {
    const session = makeSession();
    session.timezone = 'Europe/Paris';
    recordUserTurn(
      session,
      'Je voudrais réserver demain soir',
      'content',
      new Date('2026-09-04T10:00:00Z'),
    );
    expect(buildReservationProgressResponse(session)).toBe('Vous serez combien ?');

    recordUserTurn(session, 'Pour quatre personnes', 'content');
    expect(buildReservationProgressResponse(session, 'Pour quatre personnes')).toBe(
      'Vous voulez venir vers quelle heure ?',
    );
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

  it('calcule après-demain comme deux jours après la date locale', () => {
    expect(
      extractConversationSlots(
        'Après-demain à 20 heures',
        'Europe/Paris',
        new Date('2026-07-22T10:00:00Z'),
      ),
    ).toMatchObject({ date: '2026-07-24', time: '20:00' });
  });

  it('conserve uniquement la nouvelle valeur après une correction', () => {
    expect(extractConversationSlots('À 19 h 30, non plutôt 20 h 30', 'Europe/Paris')).toMatchObject(
      {
        time: '20:30',
      },
    );
  });

  it('invalide la disponibilité précédente quand le brouillon est corrigé', () => {
    const session = makeSession();
    session.conversation.intent = 'reservation';
    session.conversation.slots = {
      date: '2026-07-23',
      time: '19:30',
      partySize: 4,
    };
    session.conversation.lastAvailabilityCheck = '2026-07-23:19:30:4';
    session.conversation.lastAvailabilityResult = {
      key: '2026-07-23:19:30:4',
      date: '2026-07-23',
      time: '19:30',
      partySize: 4,
      slots: ['19:30'],
    };

    recordUserTurn(session, 'À 19 h 30, non plutôt 20 h 30', 'correction');

    expect(session.conversation.slots.time).toBe('20:30');
    expect(session.conversation.lastAvailabilityCheck).toBeNull();
    expect(session.conversation.lastAvailabilityResult).toBeNull();
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

  it('reconnaît une heure transcrite en toutes lettres (« vingt heures »)', () => {
    expect(
      extractConversationSlots(
        'Demain soir, vers vingt heures, pour quatre personnes',
        'Europe/Paris',
      ),
    ).toMatchObject({ time: '20:00', partySize: 4 });
  });

  it('reconnaît les minutes et les heures composées en toutes lettres', () => {
    expect(
      extractConversationSlots('Vendredi à vingt et une heures trente', 'Europe/Paris'),
    ).toMatchObject({
      time: '21:30',
    });
    expect(
      extractConversationSlots('Samedi à dix-neuf heures et quart', 'Europe/Paris'),
    ).toMatchObject({
      time: '19:15',
    });
  });

  it('reconnaît « à midi » comme une heure vérifiable', () => {
    expect(
      extractConversationSlots(
        'Demain soir, pour quatre personnes. Est-ce possible à midi ?',
        'Europe/Paris',
      ),
    ).toMatchObject({
      date: expect.any(String),
      time: '12:00',
      partySize: 4,
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

  it('routes an English caller through English intent, slot prompts and availability copy', () => {
    const session = makeSession();
    session.voiceLanguageCode = 'en';
    recordUserTurn(session, 'I would like to book a table', 'content');

    expect(session.conversation.intent).toBe('reservation');
    expect(session.conversation.slots).toEqual({});
    expect(buildReservationProgressResponse(session)).toBe('What day would you like to come?');

    session.conversation.slots.date = '2026-09-11';
    session.conversation.slots.partySize = 2;
    session.conversation.slots.time = '20:00';
    expect(buildReservationProgressResponse(session)).toBeNull();
    expect(
      buildAvailabilityReply({ date: '2026-09-11', time: '20:00', partySize: 2 }, ['20:00'], 'en'),
    ).toContain('What name should I book it under?');
  });

  it('recognizes English speech acts and English spelled names', () => {
    expect(classifyVoiceSpeechAct('Are you still there?')).toBe('liveness');
    expect(classifyVoiceSpeechAct('Thank you, goodbye')).toBe('closing');
    const session = makeSession();
    session.voiceLanguageCode = 'en';
    recordUserTurn(session, 'I want a reservation for two tomorrow at 7 pm', 'content');
    recordAssistantReply(session, 'What name should I book it under?');
    const name = handleCustomerNameTurn(session, 'My name is A bee K I F');
    expect(name.response).toContain('is that correct?');
  });
});
