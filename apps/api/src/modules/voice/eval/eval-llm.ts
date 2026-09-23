/**
 * LLM « appelant » et LLM « juge » du banc d'évaluation. Ils passent par
 * l'API Groq (compatible OpenAI), déjà utilisée par l'agent vocal.
 */
import type { Scenario } from './scenario';
import type { TranscriptLine } from './checks';

export const CALLER_END_MARKER = '[FIN]';

export interface EvalLlmConfig {
  apiKey: string;
  baseUrl: string;
  callerModel: string;
  judgeModel: string;
}

export function readEvalLlmConfig(env = process.env): EvalLlmConfig | null {
  const apiKey = env.VOICE_EVAL_GROQ_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1',
    callerModel: env.VOICE_EVAL_CALLER_MODEL ?? 'openai/gpt-oss-120b',
    judgeModel: env.VOICE_EVAL_JUDGE_MODEL ?? 'openai/gpt-oss-120b',
  };
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

async function chat(
  config: EvalLlmConfig,
  model: string,
  messages: ChatMessage[],
  options: { temperature: number; maxTokens: number; json?: boolean },
): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        ...(options.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 429 && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)));
      continue;
    }
    if (!response.ok) {
      throw new Error(`LLM d'évaluation ${response.status}: ${await response.text()}`);
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content?.trim() ?? '';
  }
  throw new Error("LLM d'évaluation : trop de tentatives");
}

export function buildCallerSystemPrompt(scenario: Scenario, restaurantName: string): string {
  const language =
    scenario.language === 'en'
      ? 'Tu parles uniquement anglais.'
      : 'Tu parles français, comme au téléphone.';
  return [
    `Tu joues un client qui appelle le restaurant « ${restaurantName} ». Tu parles à son assistant vocal.`,
    `Qui tu es : ${scenario.persona}`,
    `Ce que tu veux : ${scenario.goal}`,
    language,
    "Réponds uniquement par ce que tu dis à voix haute : une ou deux phrases courtes, sans didascalie, sans guillemets. Tu ne donnes que les informations demandées ou naturelles à ce moment de l'appel.",
    "Si l'assistant te demande d'épeler ton nom, épelle-le lettre par lettre séparées par des espaces.",
    `Quand ton objectif est atteint, ou qu'il devient impossible et que l'échange est terminé, dis au revoir puis ajoute ${CALLER_END_MARKER}.`,
  ].join('\n');
}

/** Prochaine réplique de l'appelant, et s'il raccroche après. */
export async function nextCallerUtterance(
  config: EvalLlmConfig,
  scenario: Scenario,
  restaurantName: string,
  transcript: TranscriptLine[],
): Promise<{ text: string; ended: boolean }> {
  // Du point de vue de l'appelant, l'agent est l'interlocuteur (« user »).
  const messages: ChatMessage[] = [
    { role: 'system', content: buildCallerSystemPrompt(scenario, restaurantName) },
    ...transcript.map<ChatMessage>((line) => ({
      role: line.speaker === 'agent' ? 'user' : 'assistant',
      content: line.text,
    })),
  ];
  const raw = await chat(config, config.callerModel, messages, {
    temperature: 0.7,
    maxTokens: 400,
  });
  const ended = raw.includes(CALLER_END_MARKER);
  const text = raw
    .replace(CALLER_END_MARKER, '')
    .replace(/^["«\s]+|["»\s]+$/gu, '')
    .trim();
  return { text, ended };
}

export interface NaturalnessScore {
  score: number;
  comment: string;
}

/** Note de naturel de 1 à 5 attribuée aux répliques de l'agent. */
export async function judgeNaturalness(
  config: EvalLlmConfig,
  transcript: TranscriptLine[],
): Promise<NaturalnessScore> {
  const dialogue = transcript
    .map((line) => `${line.speaker === 'agent' ? 'AGENT' : 'APPELANT'} : ${line.text}`)
    .join('\n');
  const raw = await chat(
    config,
    config.judgeModel,
    [
      {
        role: 'system',
        content:
          'Tu évalues le naturel d\'un assistant vocal de restaurant au téléphone. Note uniquement l\'AGENT, de 1 (robotique, répétitif, maladroit) à 5 (indiscernable d\'un bon hôte humain). Critères : phrases courtes, pas de répétition mot pour mot, réponses aux questions posées, ton chaleureux, pas de jargon administratif. Réponds en JSON : {"score": entier, "comment": "une phrase"}.',
      },
      { role: 'user', content: dialogue },
    ],
    { temperature: 0, maxTokens: 300, json: true },
  );
  try {
    const parsed = JSON.parse(raw) as { score?: unknown; comment?: unknown };
    const score = Math.min(5, Math.max(1, Math.round(Number(parsed.score))));
    return {
      score: Number.isFinite(score) ? score : 0,
      comment: typeof parsed.comment === 'string' ? parsed.comment : '',
    };
  } catch {
    return { score: 0, comment: `réponse du juge illisible : ${raw.slice(0, 120)}` };
  }
}
