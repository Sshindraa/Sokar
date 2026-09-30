import {
  buildStructuredTurnJsonSchema,
  STRUCTURED_TURN_SCHEMA_NAME,
} from '../stream/structured-turn/schema';
import { buildStructuredTurnMessages } from '../stream/structured-turn/prompt';
import { buildSystemPrompt } from '../prompts';
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

export interface BuildOptions {
  /** Vérification de compréhension (reading + understanding), comme le drapeau de production. */
  understanding?: boolean;
}

export function buildRequest(
  testCase: BehaviorCase,
  file: BehaviorCasesFile,
  options: BuildOptions = {},
): BehaviorRequest {
  const state = createStructuredTurnState();
  state.draft = { date: '', time: '', partySize: 0, customerName: '', ...testCase.draft };
  state.lastAwaiting = (testCase.awaiting ?? 'open') as typeof state.lastAwaiting;
  state.reservationCreated = testCase.reservationCreated === true;
  const profile = testCase.profile ? file.profiles?.[testCase.profile] : undefined;
  if (testCase.profile && !profile) {
    throw new Error(`Profil inconnu « ${testCase.profile} » (cas ${testCase.id})`);
  }
  const messages = buildStructuredTurnMessages({
    // Avec un profil, la vraie consigne du restaurant (même constructeur qu'en appel).
    systemPrompt: profile
      ? buildSystemPrompt(
          {
            name: profile.name,
            openingHours: profile.openingHours as never,
            timezone: 'Europe/Paris',
            // Le banc mesure le tour structuré : même consigne de base qu'en appel.
            structuredTurn: true,
          },
          new Date(`${file.today}T12:00:00Z`),
        )
      : SYSTEM_PROMPT,
    history: historyOf(testCase, file) as never,
    transcript: testCase.transcript,
    state,
    openingHours: profile ? profile.openingHours : OPENING_HOURS,
    today: file.today,
    ...(testCase.dayPart ? { dayPart: testCase.dayPart } : {}),
    ...(testCase.callerFinished ? { callerFinished: true } : {}),
    ...(testCase.actionResult ? { actionResult: testCase.actionResult } : {}),
    ...(options.understanding ? { understanding: true } : {}),
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
          // Comme en appel : la relance après un silence impose turnComplete=true.
          {
            turnCompleteOnly: testCase.callerFinished === true,
            ...(options.understanding ? { understanding: true } : {}),
          },
        ),
      },
    },
  };
}

export function buildRequests(
  file: BehaviorCasesFile,
  options: BuildOptions = {},
): BehaviorRequest[] {
  return file.cases.map((testCase) => buildRequest(testCase, file, options));
}
