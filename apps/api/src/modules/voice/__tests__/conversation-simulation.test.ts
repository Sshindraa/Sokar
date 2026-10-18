/**
 * Simulation d'appels : le vrai prompt, le vrai tour structuré et le vrai modèle (Cerebras), avec un appelant scripté
 * et des outils simulés (disponibilités, réservation, transfert). Seule la voix (TTS) est remplacée par une capture.
 *
 * Coûte des tokens : un appel au modèle par tour. Désactivée sans VOICE_SIMU=1.
 *   VOICE_SIMU=1 VOICE_SIMU_OUT=/chemin/simulation.json pnpm exec vitest run src/modules/voice/__tests__/conversation-simulation.test.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { parse } from 'dotenv';
import { buildSystemPrompt, type OpeningHours, type SystemPromptContext } from '../prompts';
import { processTranscriptStreaming } from '../stream/llm-handler';
import { createConversationState } from '../stream/conversation-controller';
import { createStructuredTurnState, todayInTimezone } from '../stream/structured-turn/fact-guards';
import { speakTtsStreamed } from '../stream/tts-handler';
import type { CallSession } from '../stream/types';
import type { CallSessionManager } from '../stream/manager';

vi.mock('../stream/tts-handler', () => ({
  speakTtsStreamed: vi.fn().mockResolvedValue(undefined),
  isSessionActiveForTts: vi.fn().mockReturnValue(true),
  cleanTextForTts: (text: string) => text,
}));
vi.mock('../stream/cartesia-context', () => ({
  isCartesiaContextV2Enabled: () => false,
  createCartesiaContextTurn: vi.fn(() => ({
    push: vi.fn(),
    finish: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn(),
    hasAudioOutput: false,
  })),
}));
vi.mock('../../../shared/telnyx/http-agent', () => ({
  telnyxFetch: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('../../../shared/logger/pino', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const RESTAURANT_ID = 'resto-simulation';
const NAME = 'Little Italy';
const TIMEZONE = 'Europe/Paris';
const MAX_PARTY_SIZE = 4;
const SLOTS = ['19:00', '19:30', '20:00', '20:30', '21:00'];
const OUT = process.env.VOICE_SIMU_OUT ?? path.join(os.tmpdir(), 'voice-simulation.json');

/** Horaires de la fixture du banc (même restaurant de référence que le banc comportemental). */
const OPENING_HOURS = (
  JSON.parse(
    readFileSync(path.join(process.cwd(), 'scripts/fixtures/voice-behavior/cases.json'), 'utf8'),
  ) as { profiles: Record<string, { openingHours: OpeningHours }> }
).profiles['chez-sokar']!.openingHours;

/** Deux réglages : le défaut (aucun registre ajouté) et la maison gastronomique formelle. */
const CONFIGS: Record<
  string,
  { personality: SystemPromptContext['personality']; styled: boolean }
> = {
  defaut: { personality: null, styled: false },
  'gastro-formal': {
    personality: { profileType: 'GASTRONOMIQUE', fillerStyle: 'FORMAL' },
    styled: true,
  },
};

/** Appelant scripté, en transcription STT (minuscules, sans ponctuation). */
const SCENARIOS: Record<string, { utterances: string[]; group: boolean }> = {
  ouverture: {
    utterances: ['vous êtes ouvert demain', 'vers vingt heures', 'nous serons deux'],
    group: false,
  },
  reservation: {
    utterances: [
      'bonjour je voudrais réserver une table pour demain',
      'vers vingt heures s il vous plaît',
      'nous serons deux',
      'au nom de dupont',
      'oui c est bien ça',
    ],
    group: false,
  },
  groupe: {
    utterances: [
      'bonjour on voudrait venir demain soir pour dîner',
      'nous serions cinq',
      'pourquoi pour cinq personnes',
      'd accord merci beaucoup au revoir',
    ],
    group: true,
  },
};

function tomorrow(): string {
  const date = new Date(`${todayInTimezone(TIMEZONE)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** Un appel au modèle, avec le même format que le tour réel (messages système fusionnés en tête). */
/** Configuration réelle du modèle, lue dans le .env de l'API : les tests injectent des valeurs de test. */
// Absent en CI (pas de .env) : la lecture ne sert qu'à la simulation, désactivée par défaut.
const REAL_ENV = existsSync(path.join(process.cwd(), '.env'))
  ? parse(readFileSync(path.join(process.cwd(), '.env'), 'utf8'))
  : {};
const CEREBRAS_BASE = (REAL_ENV.CEREBRAS_BASE_URL || 'https://api.cerebras.ai/v1').replace(
  /\/+$/,
  '',
);
const LLM_MODEL = REAL_ENV.VOICE_LLM_MODEL || 'qwen-3.8-27b';

/** Erreurs du modèle pendant la simulation : sans elles, le repli silencieux ferait passer une panne pour un dialogue. */
let llmErrors: string[] = [];

async function chatOnce(messages: Array<{ role: string; content: string }>, format: unknown) {
  const apiKey = REAL_ENV.CEREBRAS_API_KEY?.trim();
  if (!apiKey)
    throw new Error('CEREBRAS_API_KEY absent du .env : la simulation a besoin du vrai modèle.');
  const system = messages.filter((message) => message.role === 'system').map((m) => m.content);
  const rest = messages.filter((message) => message.role !== 'system');
  const response = await fetch(`${CEREBRAS_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: system.length ? [{ role: 'system', content: system.join('\n\n') }, ...rest] : rest,
      response_format: format,
      temperature: 0.3,
      max_tokens: 400,
      reasoning_effort: 'none',
    }),
  });
  if (!response.ok) throw new Error(`Cerebras HTTP ${response.status}`);
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return body.choices?.[0]?.message?.content ?? '';
}

function simulatedSession(systemPrompt: string): CallSession {
  return {
    callControlId: `sim-${Math.random().toString(36).slice(2, 10)}`,
    restaurantId: RESTAURANT_ID,
    timezone: TIMEZONE,
    from: '+33600000000',
    systemPrompt,
    state: 'LISTENING',
    ended: false,
    demo: true,
    responseGeneration: 0,
    ttsGeneration: 0,
    history: [],
    turnCount: 1,
    conversation: createConversationState(),
    structuredTurn: createStructuredTurnState(),
    telnyxWs: { readyState: WebSocket.OPEN, send: vi.fn() },
  } as unknown as CallSession;
}

/** Outils simulés. La transmission au gérant reprend le comportement de la démonstration (aucun transfert réel). */
function simulatedManager(booked: string[]): CallSessionManager {
  return {
    handleBargeIn: vi.fn(),
    transition: vi.fn((s: CallSession, state: CallSession['state']) => {
      s.state = state;
      return true;
    }),
    cleanup: vi.fn((s: CallSession) => {
      s.ended = true;
      s.state = 'IDLE';
    }),
    streamStructuredCompletion: vi.fn(
      async (
        _session: CallSession,
        messages: Array<{ role: string; content: string }>,
        format: unknown,
        options: { onDelta?: (delta: string) => void },
      ) => {
        try {
          const text = await chatOnce(messages, format);
          options.onDelta?.(text);
          return text;
        } catch (err) {
          llmErrors.push(err instanceof Error ? err.message : String(err));
          throw err;
        }
      },
    ),
    getTableRanges: vi.fn(async () => [{ capacity: 12, minCapacity: 1 }]),
    getAvailability: vi.fn(async (_s: CallSession, date: string, partySize: number) => ({
      restaurantId: RESTAURANT_ID,
      date,
      partySize,
      slots: SLOTS,
      allSlots: [],
    })),
    createReservationFromConversation: vi.fn(async (s: CallSession) => {
      s.reservationCreatedAt = Date.now();
      booked.push(JSON.stringify(s.structuredTurn?.draft ?? {}));
      return 'Réservation confirmée.';
    }),
    handoffToManager: vi.fn(async (s: CallSession) => {
      s.handoffConclusion = 'demo_no_transfer';
      return "Transfert non effectué : cette conversation est une démonstration. Propose de prendre un message pour le gérant, sans affirmer qu'il est absent ou indisponible.";
    }),
    recordCallerMessage: vi.fn(async () => 'Message enregistré.'),
  } as unknown as CallSessionManager;
}

async function runScenario(configId: string, scenarioId: string) {
  const config = CONFIGS[configId]!;
  const scenario = SCENARIOS[scenarioId]!;
  const systemPrompt = buildSystemPrompt(
    {
      name: NAME,
      openingHours: OPENING_HOURS as never,
      timezone: TIMEZONE,
      maxPartySize: MAX_PARTY_SIZE,
      personality: config.personality,
      personalityStyleEnabled: config.styled,
    },
    new Date(),
  );
  const session = simulatedSession(systemPrompt);
  const booked: string[] = [];
  llmErrors = [];
  const mgr = simulatedManager(booked);
  const turns: Array<{ caller: string; agent: string[] }> = [];
  for (const utterance of scenario.utterances) {
    vi.mocked(speakTtsStreamed).mockClear();
    await processTranscriptStreaming(session, utterance, mgr);
    turns.push({
      caller: utterance,
      agent: vi.mocked(speakTtsStreamed).mock.calls.map(([, text]) => String(text)),
    });
  }
  return {
    config: configId,
    scenario: scenarioId,
    turns,
    booked: booked.length,
    draft: session.structuredTurn?.draft,
    llmErrors: [...llmErrors],
  };
}

const enabled = process.env.VOICE_SIMU === '1';

describe.skipIf(!enabled)('simulation d’appels (vrai modèle, appelant scripté)', () => {
  it('joue chaque scénario sous chaque réglage et enregistre les échanges', async () => {
    const results = [];
    for (const configId of Object.keys(CONFIGS)) {
      for (const scenarioId of Object.keys(SCENARIOS).filter(
        (id) => !process.env.VOICE_SIMU_ONLY || process.env.VOICE_SIMU_ONLY === id,
      )) {
        results.push(await runScenario(configId, scenarioId));
      }
    }
    writeFileSync(OUT, JSON.stringify({ date: tomorrow(), results }, null, 2));
    for (const result of results) {
      expect(result.llmErrors).toEqual([]);
      expect(result.turns.length).toBe(SCENARIOS[result.scenario]!.utterances.length);
      for (const turn of result.turns) {
        expect(turn.agent.join(' ').trim().length).toBeGreaterThan(0);
      }
    }
  }, 900_000);

  it.skipIf(!!process.env.VOICE_SIMU_ONLY && process.env.VOICE_SIMU_ONLY !== 'groupe')(
    'au-delà du seuil de groupe, rien n’est réservé sans le gérant',
    async () => {
      const results = [];
      for (const configId of Object.keys(CONFIGS)) {
        results.push(await runScenario(configId, 'groupe'));
      }
      for (const result of results) {
        expect(result.booked).toBe(0);
      }
    },
    900_000,
  );
});
