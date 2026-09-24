import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildAnswerChoicePlan,
  buildDeterministicTurnPlan,
  buildReservationProgressPlan,
  classifyVoiceSpeechActInContext,
  createConversationState,
  getReadyAvailabilityRequest,
  isWithinOpeningHours,
  recordAssistantReplyFromLlmTextFallback,
  recordAssistantReplyWithPolicy,
  recordUserTurn,
  voiceMaxPartySize,
} from '../stream/conversation-controller';
import type { CallSession } from '../stream/types';

const NOW = new Date('2026-09-23T10:00:00Z'); // mercredi
const EVERY_DAY = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const NOON_TO_ELEVEN = Object.fromEntries(
  EVERY_DAY.map((day) => [day, { open: '12:00', close: '23:00' }]),
) as CallSession['openingHours'];

const ENV_KEYS = [
  'VOICE_EXPECTED_ANSWER_ENABLED',
  'VOICE_CONFIDENCE_CONFIRM_ENABLED',
  'VOICE_CONFIDENCE_CONFIRM_RESTAURANT_IDS',
  'VOICE_CONFIDENCE_CONFIRM_SLOTS',
] as const;
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
  process.env.VOICE_EXPECTED_ANSWER_ENABLED = 'true';
  delete process.env.VOICE_CONFIDENCE_CONFIRM_ENABLED;
  delete process.env.VOICE_CONFIDENCE_CONFIRM_RESTAURANT_IDS;
  delete process.env.VOICE_CONFIDENCE_CONFIRM_SLOTS;
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function makeSession(overrides: Partial<CallSession> = {}): CallSession {
  const session = {
    conversation: createConversationState(),
    restaurantId: 'restaurant-pilote',
    timezone: 'Europe/Paris',
    history: [],
    openingHours: NOON_TO_ELEVEN,
    ...overrides,
  } as unknown as CallSession;
  session.conversation.intent = 'reservation';
  return session;
}

/** Tour complet : réponse de l'appelant puis réponse déterministe de l'agent, enregistrée. */
function turn(session: CallSession, transcript: string): string {
  const speechAct = classifyVoiceSpeechActInContext(session, transcript);
  recordUserTurn(session, transcript, speechAct, NOW);
  const plan = buildDeterministicTurnPlan(session, speechAct, transcript);
  if (plan) {
    recordAssistantReplyWithPolicy(session, plan.reply, plan.proposal);
    return plan.reply;
  }
  const progress = buildReservationProgressPlan(session, transcript);
  if (progress) recordAssistantReplyWithPolicy(session, progress.reply, progress.proposal);
  return progress?.reply ?? '';
}

describe('vraisemblance des heures', () => {
  it('hv242 : « vers 10 heures », restaurant fermé à 10 h → choix, jamais retenu en silence', () => {
    const session = makeSession();
    session.conversation.slots.date = '2026-09-26';
    recordAssistantReplyFromLlmTextFallback(session, 'Vous voulez venir vers quelle heure ?');
    recordUserTurn(session, 'Je rappelle vers 10 heures.', 'content', NOW);

    expect(session.conversation.slots.time).toBeUndefined();
    expect(session.conversation.answerChoice).toEqual({
      kind: 'time',
      values: ['10:00', '22:00'],
    });
    expect(buildAnswerChoicePlan(session)?.reply).toBe('Pardon, 10 h ou 22 h ?');
  });

  it('cite les horaires quand l’appelant maintient l’heure fermée', () => {
    const session = makeSession();
    session.conversation.slots.date = '2026-09-26';
    recordAssistantReplyFromLlmTextFallback(session, 'Vous voulez venir vers quelle heure ?');
    expect(turn(session, 'Vers 10 heures.')).toBe('Pardon, 10 h ou 22 h ?');

    expect(turn(session, '10 heures.')).toBe(
      'Ce jour-là, nous sommes ouverts de 12 h à 23 h. Vers quelle heure souhaitez-vous venir ?',
    );
    expect(session.conversation.slots.time).toBeUndefined();
  });

  it('garde une heure ouverte, même hors de la grille au quart d’heure', () => {
    const session = makeSession();
    session.conversation.slots.date = '2026-09-26';
    recordAssistantReplyFromLlmTextFallback(session, 'Vous voulez venir vers quelle heure ?');
    recordUserTurn(session, 'Vers 20 h 10.', 'content', NOW);

    expect(session.conversation.slots.time).toBe('20:10');
    expect(session.conversation.answerChoice).toBeNull();
  });

  it('utilise les horaires de la semaine quand le jour est inconnu', () => {
    const openingHours = {
      ...NOON_TO_ELEVEN,
      sun: { open: '09:00', close: '15:00' },
    } as CallSession['openingHours'];
    expect(isWithinOpeningHours(openingHours, undefined, '10:00')).toBe(true);
    expect(isWithinOpeningHours(openingHours, '2026-09-26', '10:00')).toBe(false);
    expect(isWithinOpeningHours(openingHours, undefined, '08:00')).toBe(false);
  });

  it('gère un service qui finit après minuit', () => {
    const openingHours = { sat: { open: '19:00', close: '01:00' } } as CallSession['openingHours'];
    expect(isWithinOpeningHours(openingHours, '2026-09-26', '00:30')).toBe(true);
    expect(isWithinOpeningHours(openingHours, '2026-09-26', '18:00')).toBe(false);
  });

  it('ne change rien quand les horaires sont inconnus', () => {
    const session = makeSession({ openingHours: null });
    recordAssistantReplyFromLlmTextFallback(session, 'Vous voulez venir vers quelle heure ?');
    recordUserTurn(session, 'Vers 10 heures.', 'content', NOW);

    expect(session.conversation.slots.time).toBe('10:00');
  });

  it('ne change rien quand la phase 1 est coupée', () => {
    process.env.VOICE_EXPECTED_ANSWER_ENABLED = 'false';
    const session = makeSession();
    recordAssistantReplyFromLlmTextFallback(session, 'Vous voulez venir vers quelle heure ?');
    recordUserTurn(session, 'Vers 10 heures.', 'content', NOW);

    expect(session.conversation.slots.time).toBe('10:00');
  });
});

describe('portée du flag de confiance', () => {
  beforeEach(() => {
    process.env.VOICE_CONFIDENCE_CONFIRM_ENABLED = 'true';
  });

  function lowConfidenceTurn(): CallSession {
    const session = makeSession();
    session.conversation.slots.date = '2026-09-26';
    recordAssistantReplyFromLlmTextFallback(session, 'Vous serez combien ?');
    const transcript = 'Six personnes à 22 heures';
    session.sttEvidence = {
      transcript,
      words: [
        { word: 'Six', confidence: 0.05 },
        { word: 'personnes', confidence: 0.9 },
        { word: '22', confidence: 0.05 },
      ],
      partials: [],
    };
    recordUserTurn(session, transcript, 'content', NOW);
    return session;
  }

  it('par défaut, n’agit que sur le nombre de personnes ; l’heure est observée', () => {
    const session = lowConfidenceTurn();

    expect(session.conversation.answerChoice).toEqual({ kind: 'partySize', values: ['6', '10'] });
    expect(session.conversation.slots.time).toBe('22:00');
    expect(session.conversation.lastSlotConfidence).toEqual([
      { kind: 'partySize', confidence: 0.05, unstable: false, decision: 'choice' },
      { kind: 'time', confidence: 0.05, unstable: false, decision: 'wouldBeReadBack' },
    ]);
  });

  it('agit sur l’heure quand elle est dans la portée', () => {
    process.env.VOICE_CONFIDENCE_CONFIRM_SLOTS = 'time';
    const session = lowConfidenceTurn();

    expect(session.conversation.slots.partySize).toBe(6);
    expect(session.conversation.answerChoice?.kind).toBe('time');
    expect(session.conversation.lastSlotConfidence?.[0].decision).toBe('wouldBeChoice');
  });
});

describe('groupes au-delà du seuil du restaurant', () => {
  it.each([
    [undefined, 7],
    [7, 7],
    [10, 10],
  ])('seuil %s → %s', (maxPartySize, expected) => {
    expect(voiceMaxPartySize({ maxPartySize })).toBe(expected);
  });

  it('« nous serons douze » : confirmation explicite, puis groupe confié au gérant', () => {
    const session = makeSession({ managerPhone: '+33100000000' });
    session.conversation.slots.date = '2026-09-26';
    recordAssistantReplyFromLlmTextFallback(session, 'Vous serez combien ?');

    expect(turn(session, 'Nous serons douze.')).toBe("Douze personnes, c'est bien ça ?");
    expect(session.conversation.slots.partySize).toBeUndefined();

    recordUserTurn(session, 'Oui.', 'content', NOW);
    expect(session.conversation.groupRequest).toEqual({ partySize: 12, confirmed: true });
    expect(session.conversation.slots.partySize).toBeUndefined();
  });

  it('confirme aussi « douze personnes » et accepte une correction', () => {
    const session = makeSession();
    recordAssistantReplyFromLlmTextFallback(session, 'Vous serez combien ?');
    turn(session, 'Une table pour douze personnes.');

    recordUserTurn(session, 'Non, six personnes.', 'content', NOW);
    expect(session.conversation.groupRequest).toBeNull();
    expect(session.conversation.slots.partySize).toBe(6);
  });

  it('ne relance jamais en boucle un groupe confirmé', () => {
    const session = makeSession();
    recordAssistantReplyFromLlmTextFallback(session, 'Vous serez combien ?');
    turn(session, 'On sera quinze.');
    recordUserTurn(session, 'Oui, quinze.', 'content', NOW);

    expect(session.conversation.groupRequest).toEqual({ partySize: 15, confirmed: true });
    expect(getReadyAvailabilityRequest(session)).toBeNull();
  });

  it.each([
    [8, { groupRequest: { partySize: 10, confirmed: true }, partySize: undefined }],
    [10, { groupRequest: null, partySize: 10 }],
  ])('« six ou dix ? » → « dix » avec le seuil %s', (maxPartySize, expected) => {
    const session = makeSession({ maxPartySize });
    session.conversation.slots.date = '2026-09-26';
    recordAssistantReplyFromLlmTextFallback(session, 'Vous serez combien ?');
    session.conversation.answerChoice = { kind: 'partySize', values: ['6', '10'] };

    recordUserTurn(session, 'Dix.', 'content', NOW);

    expect(session.conversation.groupRequest).toEqual(expected.groupRequest);
    expect(session.conversation.slots.partySize).toBe(expected.partySize);
  });

  it('réserve normalement jusqu’au seuil inclus', () => {
    const session = makeSession({ maxPartySize: 10 });
    recordAssistantReplyFromLlmTextFallback(session, 'Vous serez combien ?');
    recordUserTurn(session, 'Nous serons dix.', 'content', NOW);

    expect(session.conversation.slots.partySize).toBe(10);
    expect(session.conversation.groupRequest).toBeNull();
  });
});

describe('« Pour demain midi, quatre personnes. »', () => {
  it('ne fixe pas 12:00, retient le service du midi et ne boucle pas', () => {
    const session = makeSession();
    session.conversation.slots = {};
    recordAssistantReplyFromLlmTextFallback(session, 'Pour quel jour ?');

    expect(turn(session, 'Pour demain midi, quatre personnes.')).toBe(
      'Quatre personnes jeudi 24, très bien. Vous voulez venir vers quelle heure ?',
    );
    expect(session.conversation.slots).toEqual({ date: '2026-09-24', partySize: 4 });
    expect(session.conversation.dayPeriod).toBe('lunch');

    turn(session, 'Midi.');
    expect(getReadyAvailabilityRequest(session)).toMatchObject({
      date: '2026-09-24',
      time: '12:00',
      partySize: 4,
    });
  });
});
