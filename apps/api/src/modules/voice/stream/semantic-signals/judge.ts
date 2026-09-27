import { z } from 'zod';
import { BEHAVIORS } from './behaviors';
import type { BehaviorId } from './behaviors';
import type { EvalExample } from './eval-request';

export type JudgeLabel = boolean | 'not_observable';
export type JudgeLabels = Record<BehaviorId, JudgeLabel>;

export interface JudgeOutput {
  reasoning: string;
  labels: JudgeLabels;
}

export type JudgeErrorReason = 'missing_key' | 'timeout' | 'http_error' | 'invalid_response';
export type JudgeResult =
  | { status: 'ok'; output: JudgeOutput }
  | { status: 'error'; reason: JudgeErrorReason };

export interface JudgeOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

const rawJudgeOutputSchema = z
  .object({
    reasoning: z.string().optional(),
    labels: z.record(z.unknown()).optional(),
  })
  .passthrough();

const LABEL_SCHEMA = {
  anyOf: [{ type: 'boolean' }, { type: 'string', enum: ['not_observable'] }],
} as const;

export function buildJudgeSystemPrompt(): string {
  const behaviorList = BEHAVIORS.map(
    ({ id, instructions, present, absent }) =>
      `- ${id}: ${instructions} Présent si : ${present}. Absent si : ${absent}.`,
  ).join('\n');

  return [
    'Vous annotez des conversations téléphoniques de réservation en français.',
    'Évaluez uniquement le dernier message du client. Les échanges précédents servent seulement à comprendre les références et la question active ; ils ne sont pas des preuves de l’intention du client. La réponse de l’agent qui suit le dernier message n’est pas fournie et ne doit pas être évaluée.',
    'Pour chaque comportement, répondez true, false ou not_observable. Choisissez not_observable uniquement si le dernier message ne permet pas de trancher. N’inférez jamais une intention à partir de la réponse de l’agent.',
    'Les identifiants et critères à annoter sont :',
    behaviorList,
    'reasoning doit être concis, en français, et ne doit contenir aucune transcription recopiée. Il sert uniquement au contrôle interne et ne sera ni journalisé ni publié.',
  ].join('\n\n');
}

export function buildJudgeResponseSchema(): Record<string, unknown> {
  const behaviorIds = BEHAVIORS.map(({ id }) => id);
  return {
    type: 'object',
    properties: {
      reasoning: { type: 'string' },
      labels: {
        type: 'object',
        properties: Object.fromEntries(behaviorIds.map((id) => [id, LABEL_SCHEMA])),
        required: behaviorIds,
        additionalProperties: false,
      },
    },
    required: ['reasoning', 'labels'],
    additionalProperties: false,
  };
}

/** Les identifiants absents ou mal formés sont explicitement non observables. */
export function parseJudgeOutput(value: unknown): JudgeOutput | null {
  const parsed = rawJudgeOutputSchema.safeParse(value);
  if (!parsed.success) return null;

  const labels = {} as JudgeLabels;
  for (const { id } of BEHAVIORS) {
    const label = parsed.data.labels?.[id];
    labels[id] =
      typeof label === 'boolean' || label === 'not_observable' ? label : 'not_observable';
  }

  return {
    reasoning: parsed.data.reasoning ?? '',
    labels,
  };
}

const chatCompletionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

export async function judgeAnnotation(
  example: EvalExample,
  options: JudgeOptions,
): Promise<JudgeResult> {
  if (!options.apiKey.trim()) return { status: 'error', reason: 'missing_key' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000);
  try {
    const response = await (options.fetcher ?? fetch)(
      `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: options.model,
          temperature: 0,
          messages: [
            { role: 'system', content: buildJudgeSystemPrompt() },
            {
              role: 'user',
              content: example.input
                .map(({ role, content }) => `${role === 'user' ? 'Client' : 'Agent'} : ${content}`)
                .join('\n'),
            },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'jev_behavior_judgment',
              strict: true,
              schema: buildJudgeResponseSchema(),
            },
          },
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) return { status: 'error', reason: 'http_error' };

    const completion = chatCompletionSchema.safeParse(await response.json());
    if (!completion.success) return { status: 'error', reason: 'invalid_response' };
    let content: unknown;
    try {
      content = JSON.parse(completion.data.choices[0].message.content);
    } catch {
      return { status: 'error', reason: 'invalid_response' };
    }
    const output = parseJudgeOutput(content);
    return output ? { status: 'ok', output } : { status: 'error', reason: 'invalid_response' };
  } catch (error) {
    return {
      status: 'error',
      reason:
        controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')
          ? 'timeout'
          : 'invalid_response',
    };
  } finally {
    clearTimeout(timeout);
  }
}
