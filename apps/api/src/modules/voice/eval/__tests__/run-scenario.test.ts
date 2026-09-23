/**
 * Câblage du banc : un scénario complet passe par le vrai pipeline de l'agent,
 * avec un faux Groq qui joue l'agent, l'appelant et le juge.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { voiceConfig } from '../../../../env';
import type { EvalLlmConfig } from '../eval-llm';
import { installEvalFakes, type EvalFakesState } from '../fakes';
import { createScenarioRuntime, runScenario } from '../run-scenario';
import { RESTAURANT_PRESETS, ScenarioSchema } from '../scenario';

const config: EvalLlmConfig = {
  apiKey: ['fake', 'eval', 'key'].join('-'),
  baseUrl: 'https://groq.fake/openai/v1',
  callerModel: 'fake-caller',
  judgeModel: 'fake-judge',
};

let callerLines: string[] = [];
let agentReplies: string[] = [];
const agentRequests: string[] = [];

function sse(text: string): Response {
  const body = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
    'data: [DONE]\n\n',
  ].join('');
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const fakeGroq = vi.fn(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? '{}')) as {
    model?: string;
    messages?: Array<{ content: string }>;
  };
  if (body.model === 'fake-caller') {
    const content = callerLines.shift() ?? 'Au revoir. [FIN]';
    return Response.json({ choices: [{ message: { content } }] });
  }
  if (body.model === 'fake-judge') {
    return Response.json({
      choices: [{ message: { content: '{"score": 4, "comment": "Naturel."}' } }],
    });
  }
  agentRequests.push(body.messages?.at(-1)?.content ?? '');
  return sse(agentReplies.shift() ?? "D'accord.");
});

const fakes: EvalFakesState = { runtime: null, restaurantId: '' };

beforeAll(() => {
  voiceConfig.GROQ_API_KEY = ['fake', 'groq', 'key'].join('-');
  voiceConfig.GROQ_BASE_URL = config.baseUrl;
  globalThis.fetch = fakeGroq as unknown as typeof globalThis.fetch;
  installEvalFakes(fakes);
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('runScenario', () => {
  it('joue une question pratique de bout en bout et note la conversation', async () => {
    const scenario = ScenarioSchema.parse({
      id: 'wiring-info',
      category: 'practical_question',
      restaurant: 'standard',
      persona: 'p',
      goal: 'g',
      opening: 'Bonjour, vous êtes ouverts le dimanche ?',
      expected: { mustSay: ['ferm'], forbiddenTools: ['createReservation'], maxTurns: 4 },
    });
    callerLines = ['Merci, au revoir. [FIN]'];
    agentReplies = ['Le dimanche, nous sommes fermés. Vous vouliez venir un autre jour ?'];
    const runtime = createScenarioRuntime(scenario);
    fakes.runtime = runtime;
    fakes.restaurantId = RESTAURANT_PRESETS.standard.id;

    const report = await runScenario(scenario, config, runtime);

    expect(report.transcript[0]).toEqual({
      speaker: 'agent',
      text: 'Bonjour, ici Le Bistrot du Marché. Je vous écoute.',
    });
    expect(report.transcript).toContainEqual({
      speaker: 'agent',
      text: 'Le dimanche, nous sommes fermés. Vous vouliez venir un autre jour ?',
    });
    expect(report.callerTurns).toBe(2);
    expect(report.endedByCaller).toBe(true);
    expect(report.naturalness).toEqual({ score: 4, comment: 'Naturel.' });
    expect(report.checks.filter((check) => !check.passed)).toEqual([]);
    expect(report.passed).toBe(true);
    expect(agentRequests).toContain('Bonjour, vous êtes ouverts le dimanche ?');
  });

  it('repère un horaire inventé après une vraie vérification de disponibilité', async () => {
    const scenario = ScenarioSchema.parse({
      id: 'wiring-invented',
      category: 'unavailable',
      restaurant: 'standard',
      persona: 'p',
      goal: 'g',
      opening: 'Je voudrais réserver pour 2 personnes demain à 20 h.',
      availableSlots: ['19:00', '21:30'],
      expected: { forbiddenTools: ['createReservation'], maxTurns: 4 },
    });
    callerLines = ['Non merci, au revoir. [FIN]'];
    // Le faux agent annonce 20 h 45, qui n'est pas dans la disponibilité.
    agentReplies = ["20 h est complet, mais j'ai 20 h 45. Ça vous irait ?"];
    const runtime = createScenarioRuntime(scenario);
    fakes.runtime = runtime;
    fakes.restaurantId = RESTAURANT_PRESETS.standard.id;

    const report = await runScenario(scenario, config, runtime);

    expect(runtime.returnedSlots).toEqual(expect.arrayContaining(['19:00', '21:30']));
    const invented = report.checks.find((check) => check.name === 'no_invented_time');
    expect(invented?.passed).toBe(false);
    expect(invented?.detail).toContain('20:45');
    expect(report.passed).toBe(false);
  });
});
