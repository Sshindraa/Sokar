/**
 * Banc du tour structuré contre le vrai modèle (Cerebras, JSON Schema strict).
 *
 * Rejoue des conversations tirées des appels réels e3e67025 et 02fd0726, plus
 * des paraphrases, à travers `runStructuredTurn`. Le modèle est réel ; la
 * disponibilité, la réservation, le message et le transfert sont simulés.
 * Mesure : sorties valides, attentes respectées, latence du premier token et du
 * début de la phrase parlée.
 *
 * Usage (depuis apps/api) : CEREBRAS_API_KEY=… node --env-file=.env --import tsx scripts/voice-structured-bench.ts [répétitions]
 * Clé de dev uniquement ; aucune donnée ni appel de production.
 */
import { WebSocket } from 'ws';
import { runStructuredTurn } from '../src/modules/voice/stream/structured-turn/engine';
import { createConversationState } from '../src/modules/voice/stream/conversation-controller';
import { buildSystemPrompt } from '../src/modules/voice/prompts';
import type { CallSession, ChatMessage } from '../src/modules/voice/stream/types';
import type { CallSessionManager } from '../src/modules/voice/stream/manager';
import type { StructuredTurnOutput } from '../src/modules/voice/stream/structured-turn/schema';

const API_KEY = process.env.CEREBRAS_API_KEY;
const MODEL = process.env.VOICE_LLM_MODEL ?? 'qwen-3.8-27b';
const BASE_URL = process.env.CEREBRAS_BASE_URL ?? 'https://api.cerebras.ai/v1';
const REPEATS = Number(process.argv[2] ?? '3');

type Expect = Partial<{
  interpretation: StructuredTurnOutput['interpretation'][];
  action: StructuredTurnOutput['action'][];
  awaiting: StructuredTurnOutput['awaiting'][];
  sayExcludes: string[];
  endsCall: boolean;
  reservationCreated: boolean;
}>;

interface Scenario {
  name: string;
  turns: Array<{ caller: string; expect: Expect }>;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'e3e67025 — demain oublié puis abandon',
    turns: [
      {
        caller: "bonjour je vous appelle pour faire une réservation s'il vous plaît",
        expect: { interpretation: ['new_request', 'answer'], action: ['none'] },
      },
      {
        caller: 'vous êtes ouvert demain',
        expect: { interpretation: ['question'], action: ['none'] },
      },
      {
        caller: 'vers 18 heures 30',
        expect: { action: ['none'], awaiting: ['partySize', 'date'] },
      },
      {
        caller: '6 personnes',
        expect: { action: ['check_availability', 'none'] },
      },
      {
        caller: "c'est Akif alors c'est A K I F",
        expect: { awaiting: ['customerNameConfirmation', 'customerName', 'confirmation', 'date'] },
      },
      { caller: 'non', expect: { awaiting: ['customerName'] } },
      {
        caller: "alors c'est a 2 k i f",
        expect: { awaiting: ['customerNameConfirmation', 'confirmation'] },
      },
      {
        caller: 'non non non je préfère rien faire',
        expect: { interpretation: ['end_call'], endsCall: true, sayExcludes: ['corriger'] },
      },
    ],
  },
  {
    name: '02fd0726 — question en pleine réservation',
    turns: [
      {
        caller: 'ok je veux réserver pour demain est-ce que c’est possible',
        expect: { action: ['none'], awaiting: ['partySize', 'time'] },
      },
      { caller: 'on fait 4 personnes', expect: { awaiting: ['time'] } },
      {
        caller: 'en fait vous êtes ouvert quelle heure plutôt',
        expect: { interpretation: ['question'], action: ['none'], sayExcludes: ['corriger'] },
      },
      {
        caller: 'non vous êtes ouvert quelle heure',
        expect: { interpretation: ['question'], action: ['none'], sayExcludes: ['corriger'] },
      },
    ],
  },
  {
    name: 'paraphrases de renoncement',
    turns: [
      { caller: 'je voudrais une table samedi soir', expect: { action: ['none'] } },
      {
        caller: 'bon finalement laissez, je rappellerai',
        expect: { interpretation: ['end_call'], endsCall: true },
      },
    ],
  },
  {
    name: 'réservation complète',
    turns: [
      {
        caller: 'une table pour deux demain à 20 heures',
        expect: { awaiting: ['customerName'], reservationCreated: false },
      },
      {
        caller: 'Dupont, D U P O N T',
        expect: {
          awaiting: ['customerNameConfirmation', 'confirmation'],
          reservationCreated: false,
        },
      },
      {
        caller: 'oui c’est ça',
        // Un oui à l'orthographe seule ne réserve pas : le récapitulatif complet doit suivre.
        expect: { reservationCreated: false },
      },
      { caller: 'oui parfait', expect: { reservationCreated: true } },
    ],
  },
];

function fakeManager(outputs: StructuredTurnOutput[], timings: number[][]): CallSessionManager {
  return {
    transition: (session: CallSession, state: CallSession['state']) => {
      session.state = state;
      return true;
    },
    cleanup: (session: CallSession) => {
      session.ended = true;
    },
    getAvailability: async (_s: CallSession, date: string, partySize: number) => ({
      restaurantId: 'bench',
      date,
      partySize,
      slots: ['18:30', '19:00', '19:30', '20:00', '20:30'],
      allSlots: [],
    }),
    createReservationFromConversation: async (session: CallSession) => {
      session.reservationCreatedAt = Date.now();
      return 'Réservation confirmée. Un SMS de confirmation va être envoyé.';
    },
    handoffToManager: async () => 'Je vous passe le gérant.',
    recordCallerMessage: async () => 'Message enregistré pour le gérant.',
    streamStructuredCompletion: async (
      _session: CallSession,
      messages: ChatMessage[],
      responseFormat: unknown,
      options: { signal?: AbortSignal; onDelta: (delta: string) => void },
    ) => {
      const startedAt = Date.now();
      const response = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({
          model: MODEL,
          messages,
          max_tokens: 400,
          temperature: 0.3,
          top_p: 0.8,
          reasoning_effort: 'none',
          response_format: responseFormat,
          stream: true,
        }),
        signal: options.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      let text = '';
      let firstTokenMs: number | null = null;
      let sayStartMs: number | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) {
          const payload = line.trim().replace(/^data:\s*/, '');
          if (!payload || payload === '[DONE]' || !line.trim().startsWith('data:')) continue;
          const delta = (
            JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> }
          ).choices?.[0]?.delta?.content;
          if (!delta) continue;
          firstTokenMs ??= Date.now() - startedAt;
          text += delta;
          if (sayStartMs === null && /"say"\s*:\s*"/.test(text))
            sayStartMs = Date.now() - startedAt;
          options.onDelta(delta);
        }
      }
      timings.push([firstTokenMs ?? -1, sayStartMs ?? -1, Date.now() - startedAt]);
      try {
        outputs.push(JSON.parse(text) as StructuredTurnOutput);
      } catch {
        // Sortie invalide : comptée par le moteur (phrase de secours).
      }
      return text;
    },
  } as unknown as CallSessionManager;
}

function benchSession(): CallSession {
  return {
    callControlId: 'bench',
    restaurantId: 'bench',
    timezone: 'Europe/Paris',
    from: '+33600000000',
    maxPartySize: 7,
    systemPrompt: buildSystemPrompt({
      name: 'Le Comptoir de Saint-Eustache',
      timezone: 'Europe/Paris',
      openingHours: {
        mon: { open: '18:00', close: '23:00' },
        tue: { open: '18:00', close: '23:00' },
        wed: { open: '18:00', close: '23:00' },
        thu: { open: '18:00', close: '23:00' },
        fri: { open: '18:00', close: '23:30' },
        sat: { open: '18:00', close: '23:30' },
        sun: null,
      },
    }),
    state: 'LISTENING',
    ended: false,
    responseGeneration: 0,
    ttsGeneration: 0,
    history: [],
    turnCount: 0,
    conversation: createConversationState(),
    telnyxWs: { readyState: WebSocket.CLOSED, send: () => undefined },
  } as unknown as CallSession;
}

function percentile(values: number[], p: number): number {
  const sorted = values.filter((value) => value >= 0).sort((a, b) => a - b);
  if (!sorted.length) return -1;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function main() {
  if (!API_KEY) {
    console.error('CEREBRAS_API_KEY manquante (clé de dev).');
    process.exit(1);
  }
  const timings: number[][] = [];
  let checks = 0;
  let passed = 0;
  let invalid = 0;
  const failures: string[] = [];
  for (let repeat = 0; repeat < REPEATS; repeat++) {
    for (const scenario of SCENARIOS) {
      const session = benchSession();
      for (const [index, step] of scenario.turns.entries()) {
        if (session.ended || session.ending) break;
        const outputs: StructuredTurnOutput[] = [];
        const mgr = fakeManager(outputs, timings);
        const generation = ++session.responseGeneration;
        await runStructuredTurn(
          session,
          step.caller,
          mgr,
          () => session.responseGeneration === generation && !session.ended,
        );
        const first = outputs[0];
        if (process.env.BENCH_TRACE) {
          process.stdout.write(
            `[${scenario.name} #${index + 1}] « ${step.caller} » → ${JSON.stringify(outputs)}\n`,
          );
        }
        if (!first) invalid++;
        const said = String(session.history.at(-1)?.content ?? '');
        const verdicts: Array<[string, boolean]> = [];
        if (step.expect.interpretation) {
          verdicts.push([
            'interpretation',
            step.expect.interpretation.includes(first?.interpretation),
          ]);
        }
        if (step.expect.action)
          verdicts.push(['action', step.expect.action.includes(first?.action)]);
        if (step.expect.awaiting) {
          const last = outputs.at(-1);
          verdicts.push([
            'awaiting',
            Boolean(last && step.expect.awaiting.includes(last.awaiting)),
          ]);
        }
        for (const word of step.expect.sayExcludes ?? []) {
          verdicts.push([`say≠${word}`, !said.toLowerCase().includes(word)]);
        }
        if (step.expect.reservationCreated !== undefined) {
          verdicts.push([
            'reservationCreated',
            Boolean(session.reservationCreatedAt) === step.expect.reservationCreated,
          ]);
        }
        if (step.expect.endsCall !== undefined) {
          verdicts.push([
            'endsCall',
            Boolean(session.ending || session.ended) === step.expect.endsCall,
          ]);
        }
        for (const [label, ok] of verdicts) {
          checks++;
          if (ok) passed++;
          else {
            failures.push(
              `${scenario.name} #${index + 1} ${label} — « ${step.caller} » → ${JSON.stringify({
                interpretation: first?.interpretation,
                action: first?.action,
                awaiting: outputs.at(-1)?.awaiting,
                say: said,
              })}`,
            );
          }
        }
      }
    }
  }
  const firstTokens = timings.map(([value]) => value);
  const sayStarts = timings.map(([, value]) => value);
  process.stdout.write(`Appels modèle : ${timings.length}, sorties invalides : ${invalid}\n`);
  process.stdout.write(`Attentes respectées : ${passed}/${checks}\n`);
  process.stdout.write(
    `Premier token p50/p90 : ${percentile(firstTokens, 50)} / ${percentile(firstTokens, 90)} ms\n`,
  );
  process.stdout.write(
    `Début de « say » p50/p90 : ${percentile(sayStarts, 50)} / ${percentile(sayStarts, 90)} ms\n`,
  );
  if (failures.length) process.stdout.write(`\nÉcarts :\n${failures.join('\n')}\n`);
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
