/* eslint-disable no-console -- CLI benchmark intentionally reports live progress and results. */
import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: resolve(process.cwd(), '.env') });
loadEnv({ path: resolve(process.cwd(), 'apps/api/.env'), override: false });
loadEnv({ path: resolve(process.cwd(), '.env.local'), override: false });
if (
  !process.env.OPENROUTER_API_KEY?.startsWith('sk-or-') ||
  process.env.OPENROUTER_API_KEY.length < 40
) {
  loadEnv({ path: resolve(homedir(), '.hermes/.env'), override: true });
}

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error('OPENROUTER_API_KEY is required');

const RUNS = Number.parseInt(process.env.BENCHMARK_RUNS ?? '3', 10);
const OUTPUT_PATH =
  process.env.BENCHMARK_OUTPUT ?? '/tmp/sokar-voice-llm-benchmark-2026-07-22.json';
const REQUEST_TIMEOUT_MS = 30_000;

type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

type Message = {
  role: 'system' | 'assistant' | 'user' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

type Usage = { prompt_tokens?: number; completion_tokens?: number };

type StreamResult = {
  message: Message;
  firstSignalMs: number;
  firstContentMs: number | null;
  firstPhraseMs: number | null;
  totalMs: number;
  usage: Usage;
  error?: string;
};

type Scenario = {
  id: string;
  user: string;
  expectedTool: string;
  expectedArgs: Record<string, unknown>;
  toolResult: string;
};

const premiumModels = [
  {
    id: 'mistralai/mistral-small-3.2-24b-instruct',
    label: 'Mistral Small 3.2 (contrôle)',
    inputPerMillion: 0.075,
    outputPerMillion: 0.2,
    provider: { order: ['mistral'], allow_fallbacks: false },
  },
  {
    id: 'google/gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash-Lite',
    inputPerMillion: 0.3,
    outputPerMillion: 2.5,
  },
  {
    id: 'google/gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash Lite',
    inputPerMillion: 0.25,
    outputPerMillion: 1.5,
  },
  {
    id: 'openai/gpt-5.6-luna',
    label: 'GPT-5.6 Luna',
    inputPerMillion: 1,
    outputPerMillion: 6,
  },
  {
    id: 'deepseek/deepseek-v4-flash',
    label: 'DeepSeek V4 Flash',
    inputPerMillion: 0.084,
    outputPerMillion: 0.168,
  },
  {
    id: 'qwen/qwen3.6-flash',
    label: 'Qwen3.6 Flash',
    inputPerMillion: 0.1875,
    outputPerMillion: 1.125,
  },
] as const;

const costEffectiveModels = [
  {
    id: 'mistralai/mistral-small-3.2-24b-instruct',
    label: 'Mistral Small 3.2 (contrôle)',
    inputPerMillion: 0.075,
    outputPerMillion: 0.2,
    provider: { order: ['mistral'], allow_fallbacks: false },
  },
  {
    id: 'ibm-granite/granite-4.1-8b',
    label: 'Granite 4.1 8B',
    inputPerMillion: 0.05,
    outputPerMillion: 0.1,
  },
  {
    id: 'bytedance-seed/seed-2.0-mini',
    label: 'Seed 2.0 Mini',
    inputPerMillion: 0.1,
    outputPerMillion: 0.4,
  },
  {
    id: 'nex-agi/nex-n2-mini',
    label: 'Nex-N2-Mini',
    inputPerMillion: 0.025,
    outputPerMillion: 0.1,
  },
  {
    id: 'mistralai/mistral-small-2603',
    label: 'Mistral Small 4',
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
    provider: { order: ['mistral'], allow_fallbacks: false },
  },
  {
    id: 'google/gemma-4-31b-it',
    label: 'Gemma 4 31B',
    inputPerMillion: 0.12,
    outputPerMillion: 0.35,
  },
] as const;

const balancedModels = [
  {
    id: 'mistralai/mistral-small-3.2-24b-instruct',
    label: 'Mistral Small 3.2 (contrôle)',
    inputPerMillion: 0.075,
    outputPerMillion: 0.2,
    provider: { order: ['mistral'], allow_fallbacks: false },
  },
  {
    id: 'openai/gpt-5.4-nano',
    label: 'GPT-5.4 Nano',
    inputPerMillion: 0.2,
    outputPerMillion: 1.25,
  },
  {
    id: 'google/gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash Lite',
    inputPerMillion: 0.25,
    outputPerMillion: 1.5,
  },
  {
    id: 'google/gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash-Lite',
    inputPerMillion: 0.3,
    outputPerMillion: 2.5,
  },
  {
    id: 'openai/gpt-5.4-mini',
    label: 'GPT-5.4 Mini',
    inputPerMillion: 0.75,
    outputPerMillion: 4.5,
  },
] as const;

const models =
  process.env.BENCHMARK_PANEL === 'premium'
    ? premiumModels
    : process.env.BENCHMARK_PANEL === 'balanced'
      ? balancedModels
      : costEffectiveModels;

const scenarios: Scenario[] = [
  {
    id: 'create-reservation',
    user: 'Je confirme une réservation le 2026-07-25 à 20h00 pour 4 personnes, au nom de Thomas Martin. Mon numéro est le +33612345678.',
    expectedTool: 'createReservation',
    expectedArgs: {
      date: '2026-07-25',
      time: '20:00',
      partySize: 4,
      customerName: 'Thomas Martin',
      customerPhone: '+33612345678',
    },
    toolResult: 'Réservation confirmée pour 4 personnes le 25 juillet 2026 à 20 h.',
  },
  {
    id: 'availability',
    user: 'Avez-vous une table disponible le 2026-07-26 pour 2 personnes ?',
    expectedTool: 'checkAvailability',
    expectedArgs: { date: '2026-07-26', partySize: 2 },
    toolResult: 'Créneaux disponibles : 12:30, 19:30 et 21:00.',
  },
  {
    id: 'cancel-reservation',
    user: 'Je souhaite annuler ma réservation au nom de Claire Bernard pour le 2026-07-27.',
    expectedTool: 'cancelReservation',
    expectedArgs: { customerName: 'Claire Bernard', date: '2026-07-27' },
    toolResult: 'La réservation de Claire Bernard a été annulée.',
  },
  {
    id: 'report-delay',
    user: 'Je suis Karim Benali. Ma réservation est le 2026-07-22 à 20h30 et nous aurons 25 minutes de retard.',
    expectedTool: 'reportDelay',
    expectedArgs: {
      customerName: 'Karim Benali',
      date: '2026-07-22',
      time: '20:30',
      delayMinutes: 25,
    },
    toolResult: "Le retard a été signalé à l'équipe. Aucun changement de table n'est promis.",
  },
  {
    id: 'large-group-handoff',
    user: 'Je voudrais réserver pour 9 personnes le 2026-07-30 à 19h30.',
    expectedTool: 'handoffToManager',
    expectedArgs: {},
    toolResult: "Transfert de l'appel vers le gérant en cours.",
  },
  {
    id: 'gift-card',
    user: "Je confirme une carte cadeau de 80 euros. Je m'appelle Sophie Leroy, mon téléphone est le +33687654321, et le destinataire est Julien Moreau.",
    expectedTool: 'purchaseGiftCard',
    expectedArgs: {
      amount: 80,
      senderName: 'Sophie Leroy',
      senderPhone: '+33687654321',
      recipientName: 'Julien Moreau',
    },
    toolResult: "Carte cadeau créée. Le code a été envoyé par SMS à l'expéditeur.",
  },
];

// Intentionally synthetic: representative of a reservation assistant without exporting
// Sokar's production prompt, restaurant configuration, or complete internal tool schema.
const systemPrompt = `Tu es l'assistant vocal d'un restaurant fictif français.
Réponds uniquement en français, poliment et en 1 ou 2 phrases.
Utilise l'outil correspondant dès que toutes ses informations obligatoires sont présentes.
Pour un groupe de 8 personnes ou plus, appelle immédiatement handoffToManager.
Après un résultat d'outil, confirme brièvement le résultat sans inventer d'information.
Nous sommes le mercredi 22 juillet 2026, fuseau Europe/Paris.
Les dates ISO données par l'appelant sont explicites et ne doivent jamais être changées.`;

const date = { type: 'string', format: 'date' } as const;
const time = { type: 'string', pattern: '^([0-1]\\d|2[0-3]):[0-5]\\d$' } as const;
const tools = [
  {
    type: 'function',
    function: {
      name: 'createReservation',
      description: 'Crée une réservation lorsque toutes les informations sont confirmées.',
      parameters: {
        type: 'object',
        properties: {
          date,
          time,
          partySize: { type: 'integer', minimum: 1, maximum: 7 },
          customerName: { type: 'string' },
          customerPhone: { type: 'string' },
        },
        required: ['date', 'time', 'partySize', 'customerName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'checkAvailability',
      description: 'Vérifie les disponibilités pour une date et un nombre de personnes.',
      parameters: {
        type: 'object',
        properties: { date, partySize: { type: 'integer', minimum: 1, maximum: 7 } },
        required: ['date', 'partySize'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancelReservation',
      description: 'Annule une réservation identifiée par le nom et la date.',
      parameters: {
        type: 'object',
        properties: { customerName: { type: 'string' }, date },
        required: ['customerName', 'date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reportDelay',
      description: 'Signale un retard sans modifier la réservation.',
      parameters: {
        type: 'object',
        properties: {
          customerName: { type: 'string' },
          date,
          time,
          delayMinutes: { type: 'integer', minimum: 5, maximum: 180 },
        },
        required: ['customerName', 'date', 'time', 'delayMinutes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'handoffToManager',
      description: 'Transfère au responsable les groupes de 8 personnes ou plus.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'purchaseGiftCard',
      description: 'Crée une carte cadeau après confirmation de toutes les informations.',
      parameters: {
        type: 'object',
        properties: {
          amount: { type: 'number', minimum: 10 },
          senderName: { type: 'string' },
          senderPhone: { type: 'string' },
          recipientName: { type: 'string' },
        },
        required: ['amount', 'senderName', 'senderPhone', 'recipientName'],
      },
    },
  },
];

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return Math.round(sorted[Math.ceil(quantile * sorted.length) - 1]);
}

function normalizePhone(value: unknown): string {
  return String(value ?? '').replace(/[^+\d]/g, '');
}

function argsMatch(actual: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([key, expectedValue]) => {
    const actualValue = actual[key];
    if (key.toLowerCase().includes('phone')) {
      return normalizePhone(actualValue) === normalizePhone(expectedValue);
    }
    return actualValue === expectedValue;
  });
}

function validateToolCall(
  calls: ToolCall[],
  scenario: Scenario,
): { passed: boolean; reason: string; args?: Record<string, unknown> } {
  if (calls.length !== 1) {
    return { passed: false, reason: `expected 1 tool call, received ${calls.length}` };
  }
  const call = calls[0];
  if (call.function.name !== scenario.expectedTool) {
    return {
      passed: false,
      reason: `expected ${scenario.expectedTool}, received ${call.function.name || '(empty)'}`,
    };
  }
  try {
    const args = JSON.parse(call.function.arguments) as Record<string, unknown>;
    if (!argsMatch(args, scenario.expectedArgs)) {
      return { passed: false, reason: 'arguments do not match expected business values', args };
    }
    return { passed: true, reason: 'ok', args };
  } catch {
    return { passed: false, reason: 'arguments are not valid JSON' };
  }
}

async function streamCompletion(
  model: (typeof models)[number],
  messages: Message[],
): Promise<StreamResult> {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let firstSignalMs: number | null = null;
  let firstContentMs: number | null = null;
  let firstPhraseMs: number | null = null;
  let content = '';
  let buffer = '';
  let usage: Usage = {};
  const toolCalls: ToolCall[] = [];

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://sokar.tech',
        'X-Title': 'Sokar Voice LLM Benchmark',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: model.id,
        messages,
        tools,
        tool_choice: 'auto',
        max_tokens: 150,
        temperature: 0.2,
        reasoning: { effort: 'minimal', exclude: true },
        stream: true,
        stream_options: { include_usage: true },
        ...(model.provider ? { provider: model.provider } : {}),
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    if (!response.body) throw new Error('Empty response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;
        const chunk = JSON.parse(data) as {
          choices?: Array<{
            delta?: {
              content?: string;
              tool_calls?: Array<{
                index?: number;
                id?: string;
                type?: 'function';
                function?: { name?: string; arguments?: string };
              }>;
            };
          }>;
          usage?: Usage;
        };
        if (chunk.usage) usage = chunk.usage;
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if ((delta.content || delta.tool_calls) && firstSignalMs === null) {
          firstSignalMs = performance.now() - startedAt;
        }
        if (delta.content) {
          if (firstContentMs === null) firstContentMs = performance.now() - startedAt;
          content += delta.content;
          if (firstPhraseMs === null && /[.!?](?:\s|$)/.test(content)) {
            firstPhraseMs = performance.now() - startedAt;
          }
        }
        for (const streamedCall of delta.tool_calls ?? []) {
          const index = streamedCall.index ?? 0;
          toolCalls[index] ??= {
            id: streamedCall.id ?? `tool-${index}`,
            type: 'function',
            function: { name: '', arguments: '' },
          };
          if (streamedCall.id) toolCalls[index].id = streamedCall.id;
          if (streamedCall.function?.name) {
            toolCalls[index].function.name += streamedCall.function.name;
          }
          if (streamedCall.function?.arguments) {
            toolCalls[index].function.arguments += streamedCall.function.arguments;
          }
        }
      }
    }

    const totalMs = performance.now() - startedAt;
    return {
      message: {
        role: 'assistant',
        content: content || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
      firstSignalMs: Math.round(firstSignalMs ?? totalMs),
      firstContentMs: firstContentMs === null ? null : Math.round(firstContentMs),
      firstPhraseMs: firstPhraseMs === null ? null : Math.round(firstPhraseMs),
      totalMs: Math.round(totalMs),
      usage,
    };
  } catch (error) {
    const totalMs = Math.round(performance.now() - startedAt);
    return {
      message: { role: 'assistant', content: null },
      firstSignalMs: totalMs,
      firstContentMs: null,
      firstPhraseMs: null,
      totalMs,
      usage,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runScenario(model: (typeof models)[number], scenario: Scenario, run: number) {
  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'assistant', content: 'Bonjour, Chez Sokar, comment puis-je vous aider ?' },
    { role: 'user', content: scenario.user },
  ];
  const scenarioStartedAt = performance.now();
  const decision = await streamCompletion(model, messages);
  const calls = decision.message.tool_calls ?? [];
  const validation = validateToolCall(calls, scenario);
  let final: StreamResult | null = null;

  if (validation.passed) {
    messages.push(decision.message);
    messages.push({
      role: 'tool',
      tool_call_id: calls[0].id,
      content: scenario.toolResult,
    });
    final = await streamCompletion(model, messages);
  }

  const promptTokens = (decision.usage.prompt_tokens ?? 0) + (final?.usage.prompt_tokens ?? 0);
  const completionTokens =
    (decision.usage.completion_tokens ?? 0) + (final?.usage.completion_tokens ?? 0);
  const estimatedCostUsd =
    (promptTokens * model.inputPerMillion + completionTokens * model.outputPerMillion) / 1_000_000;

  return {
    model: model.id,
    scenario: scenario.id,
    run,
    passed: validation.passed,
    reason: validation.reason,
    actualTool: calls[0]?.function.name ?? null,
    actualArgs: validation.args ?? calls[0]?.function.arguments ?? null,
    decisionFirstSignalMs: decision.firstSignalMs,
    decisionTotalMs: decision.totalMs,
    finalFirstContentMs: final?.firstContentMs ?? null,
    finalFirstPhraseMs: final?.firstPhraseMs ?? null,
    endToEndFirstPhraseMs:
      final?.firstPhraseMs == null ? null : Math.round(decision.totalMs + final.firstPhraseMs),
    endToEndTotalMs: Math.round(performance.now() - scenarioStartedAt),
    finalText: final?.message.content ?? decision.message.content,
    promptTokens,
    completionTokens,
    estimatedCostUsd,
    error: decision.error ?? final?.error ?? null,
  };
}

async function main() {
  // eslint-disable-next-line no-console
  console.log(
    `Sokar voice benchmark: ${models.length} models × ${scenarios.length} scenarios × ${RUNS} runs`,
  );
  const records: Awaited<ReturnType<typeof runScenario>>[] = [];

  for (let run = 1; run <= RUNS; run++) {
    // eslint-disable-next-line no-console
    console.log(`Run ${run}/${RUNS}`);
    for (const scenario of scenarios) {
      const results = await Promise.all(
        models.map(async (model) => {
          const result = await runScenario(model, scenario, run);
          // eslint-disable-next-line no-console
          console.log(
            `${result.passed ? 'PASS' : 'FAIL'} ${model.label} / ${scenario.id} / ${result.decisionTotalMs}ms`,
          );
          return result;
        }),
      );
      records.push(...results);
    }
  }

  const summaries = models.map((model) => {
    const modelRecords = records.filter((record) => record.model === model.id);
    const passed = modelRecords.filter((record) => record.passed);
    const decisionLatencies = modelRecords.map((record) => record.decisionFirstSignalMs);
    const phraseLatencies = passed
      .map((record) => record.endToEndFirstPhraseMs)
      .filter((value): value is number => value !== null);
    const totalCostUsd = modelRecords.reduce((sum, record) => sum + record.estimatedCostUsd, 0);
    return {
      model: model.label,
      id: model.id,
      accuracy: `${passed.length}/${modelRecords.length}`,
      accuracyPercent: Math.round((passed.length / modelRecords.length) * 1000) / 10,
      decisionP50Ms: percentile(decisionLatencies, 0.5),
      decisionP95Ms: percentile(decisionLatencies, 0.95),
      voiceReadyP50Ms: percentile(phraseLatencies, 0.5),
      voiceReadyP95Ms: percentile(phraseLatencies, 0.95),
      estimatedCostPerScenarioUsd:
        Math.round((totalCostUsd / modelRecords.length) * 1_000_000) / 1_000_000,
      observedCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
      errors: modelRecords.filter((record) => record.error).length,
    };
  });

  summaries.sort((left, right) => {
    if (right.accuracyPercent !== left.accuracyPercent) {
      return right.accuracyPercent - left.accuracyPercent;
    }
    return (
      (left.voiceReadyP50Ms ?? Number.MAX_SAFE_INTEGER) -
      (right.voiceReadyP50Ms ?? Number.MAX_SAFE_INTEGER)
    );
  });

  console.table(summaries);
  await writeFile(
    OUTPUT_PATH,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        runCount: RUNS,
        scenarios: scenarios.map(({ id, expectedTool, expectedArgs }) => ({
          id,
          expectedTool,
          expectedArgs,
        })),
        summaries,
        records,
      },
      null,
      2,
    )}\n`,
  );
  // eslint-disable-next-line no-console
  console.log(`Raw results: ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
