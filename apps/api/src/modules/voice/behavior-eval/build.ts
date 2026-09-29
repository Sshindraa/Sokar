import {
  buildStructuredTurnJsonSchema,
  STRUCTURED_TURN_SCHEMA_NAME,
} from '../stream/structured-turn/schema';
import { buildStructuredTurnMessages } from '../stream/structured-turn/prompt';
import { createStructuredTurnState } from '../stream/structured-turn/fact-guards';
import type { BehaviorCase, BehaviorCasesFile } from './types';

/** Consigne restaurant minimale : le jeu mesure le comportement du tour structuré, pas la fiche. */
const SYSTEM_PROMPT =
  "Tu es l'agent vocal du restaurant Chez Sokar, à Paris. Tu prends les réservations par téléphone, en français, en vouvoyant l'appelant. Réponses courtes et naturelles.";

const OPENING_HOURS = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [
    day,
    { open: '12:00', close: '22:00' },
  ]),
);

/** Après une action exécutée, le modèle ne peut plus que parler ou terminer l'appel. */
const AFTER_ACTION_ACTIONS = ['none', 'end_call'] as const;

export interface BehaviorRequest {
  id: string;
  samples: number;
  messages: ReturnType<typeof buildStructuredTurnMessages>;
  format: {
    type: 'json_schema';
    json_schema: { name: string; strict: true; schema: unknown };
  };
}

function historyOf(testCase: BehaviorCase, file: BehaviorCasesFile) {
  if (typeof testCase.history !== 'string') return testCase.history;
  const named = file.histories?.[testCase.history];
  if (!named) throw new Error(`Historique inconnu « ${testCase.history} » (cas ${testCase.id})`);
  return named;
}

export function buildRequest(testCase: BehaviorCase, file: BehaviorCasesFile): BehaviorRequest {
  const state = createStructuredTurnState();
  state.draft = { date: '', time: '', partySize: 0, customerName: '', ...testCase.draft };
  state.lastAwaiting = (testCase.awaiting ?? 'open') as typeof state.lastAwaiting;
  state.reservationCreated = testCase.reservationCreated === true;
  const messages = buildStructuredTurnMessages({
    systemPrompt: SYSTEM_PROMPT,
    history: historyOf(testCase, file) as never,
    transcript: testCase.transcript,
    state,
    openingHours: OPENING_HOURS,
    today: file.today,
    ...(testCase.dayPart ? { dayPart: testCase.dayPart } : {}),
    ...(testCase.actionResult ? { actionResult: testCase.actionResult } : {}),
  });
  return {
    id: testCase.id,
    samples: testCase.samples ?? 12,
    messages,
    format: {
      type: 'json_schema',
      json_schema: {
        name: STRUCTURED_TURN_SCHEMA_NAME,
        strict: true,
        schema: buildStructuredTurnJsonSchema(
          testCase.actionResult ? (AFTER_ACTION_ACTIONS as never) : undefined,
        ),
      },
    },
  };
}

export function buildRequests(file: BehaviorCasesFile): BehaviorRequest[] {
  return file.cases.map((testCase) => buildRequest(testCase, file));
}
