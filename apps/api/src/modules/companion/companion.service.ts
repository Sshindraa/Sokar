/**
 * Companion : une réponse de l'assistant du dashboard, par OpenRouter. Le modèle lit les chiffres par
 * les outils (companion.tools.ts) et ne voit jamais de donnée client. Une requête par tour, 20 s
 * chacune, 4 tours d'outils au plus : le tour suivant part sans outils pour obtenir la réponse finale.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import { env } from '../../env';
import { COMPANION_TOOLS, runCompanionTool } from './companion.tools';
import { queryScope } from './query-data';

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_TOOL_ROUNDS = 8;
// Au-delà de ce volume d'entrée, la réponse part sans outil : elle se fait avec ce qui est déjà lu.
const INPUT_TOKEN_BUDGET = 60_000;
const MAX_OUTPUT_TOKENS = 1024;

export interface CompanionMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Appel d'outil tel que le banc le relit : nom, arguments bruts, contenu renvoyé au modèle. */
export interface CompanionToolCall {
  name: string;
  arguments: string;
  result: unknown;
}

export interface CompanionAnswer {
  reply: string;
  sources: Array<{ tool: string; href: string }>;
  /** Identifiant de cette réponse, pour rattacher un avis (POST /companion/feedback). */
  responseId: string;
}

/** OpenRouter en échec, lent ou illisible : la route répond 502. */
export class CompanionUpstreamError extends Error {}

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** Bloc de contenu : seul le début fixe (consignes) porte un point de cache. */
interface ContentBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null | ContentBlock[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullish(),
          tool_calls: z
            .array(
              z.object({
                id: z.string(),
                type: z.literal('function').default('function'),
                function: z.object({ name: z.string(), arguments: z.string() }),
              }),
            )
            .optional(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
      // Présent quand le fournisseur signale les lectures du cache.
      prompt_tokens_details: z
        .object({ cached_tokens: z.number().int().nonnegative().optional() })
        .nullish(),
    })
    .optional(),
});

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const longDateFormatter = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** Jour AAAA-MM-JJ à Paris : clé du plafond quotidien et date injectée au modèle. */
export function companionDayKey(now: Date): string {
  return dayFormatter.format(now);
}

/** Consignes fixes, mises en cache : sans date, pour que le cache tienne d'un jour à l'autre. */
export function companionSystemPrompt(): string {
  return [
    `Vous êtes l'assistant IA de Sokar, au service de l'équipe de direction de ce restaurant. Vous répondez à partir des chiffres du tableau de bord, que vous obtenez par vos outils.`,
    '',
    'Règles :',
    '- Vouvoyez toujours votre interlocuteur. Répondez en français, en quelques phrases courtes.',
    "- Tout chiffre que vous donnez vient d'un outil de cette conversation. Si les outils ne le fournissent pas, dites que vous ne l'avez pas.",
    "- Ne faites aucun calcul vous-même : ni somme, ni différence, ni moyenne, ni taux, ni pourcentage. Si vous avez besoin d'un total, demandez-le à un outil (query_data sans group_by donne le total). Citez les nombres tels que les outils les renvoient.",
    "- Pour un indicateur du tableau de bord (taux de conversion, jours sous-réservés, no-shows, ROI), utilisez l'outil dédié. Pour toute autre question chiffrée, composez une requête query_data.",
    '- Choisissez date de service pour servis / prévus / ce jour-là, date de prise pour prises / reçues ; dites lequel vous avez utilisé si la question est ambiguë.',
    "- Convertissez les dates relatives (mardi dernier, le mois dernier) en dates exactes à partir d'aujourd'hui, et citez-les.",
    "- Répondez d'abord à la question posée ; proposez les autres chiffres en une phrase, sans les dérouler. Ne rattachez jamais un chiffre à un groupe auquel il ne correspond pas.",
    '- Les montants (chiffre d’affaires, économies, coûts évités) sont des estimations : dites-le.',
    "- Le mois en cours n'est pas terminé : si vous citez ses chiffres, dites qu'ils sont partiels (arrêtés à aujourd'hui).",
    `- Périmètre : ${queryScope()}, les jours à venir (réservations et couverts prévus), les no-shows des 90 derniers jours, le retour sur investissement d’un mois.`,
    "- Une rédaction (message à un client, relance) est un brouillon : rien n'est envoyé, et vous ne dites jamais l'avoir envoyé.",
    "- Un brouillon ne contient aucun fait absent des données : ni table libérée, ni promotion, ni prix, ni horaire, ni disponibilité. Mettez [à compléter] à la place et dites ce qu'il faut vérifier. Toute formule de disponibilité ou d'urgence va entre crochets : « table disponible », « places limitées », « dernières places », « vient de se libérer ».",
    '- Pas de conseil juridique, fiscal ni comptable : orientez vers un professionnel.',
    "- Vous n'avez accès à aucune coordonnée ni à aucun nom de client : ne les demandez pas.",
    '- Texte simple, sans Markdown : ni gras (**), ni titre (#), ni tableau. Les listes utilisent un tiret « - ».',
    '- Reliez seulement ce que les données montrent ensemble (« en même temps, les appels non terminés ont doublé »). Jamais une cause extérieure aux données (météo, concurrence, saison, personnel), jamais un lien de cause à effet présenté comme certain. Dites ce que vous ne savez pas.',
    "- Quand la question porte sur un écart, une évolution ou une comparaison, appelez d'abord explain_change, puis query_data seulement si un point reste à préciser.",
    "- Réponse : l'écart principal, les deux ou trois premiers facteurs, puis les variations simultanées, introduites par « en même temps ». Jamais « à cause de ». Si low_volume est vrai, dites-le et ne concluez rien.",
    "- Vos réponses précédentes figurent dans la conversation : pour rappeler un chiffre que vous avez déjà donné, reprenez-le sans vous désavouer. Pour toute question chiffrée nouvelle ou contestée, interrogez de nouveau l'outil : les chiffres changent pendant la journée.",
  ].join('\n');
}

/** Date du jour, hors du cache : elle change chaque jour, les consignes non. */
export function companionDatePrompt(now: Date): string {
  return `Aujourd'hui, nous sommes le ${longDateFormatter.format(now)} (${companionDayKey(now)}, fuseau Europe/Paris).`;
}

type AssistantMessage = z.infer<typeof completionSchema>['choices'][number]['message'];

async function requestTurn(
  conversation: ChatMessage[],
  withTools: boolean,
  trace: CompanionTrace,
  fetcher: typeof fetch,
): Promise<AssistantMessage> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  trace.turns++;
  try {
    const response = await fetcher(
      `${env.OPENROUTER_BASE_URL.replace(/\/+$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: env.COMPANION_LLM_MODEL,
          // Pas de conservation des données par le fournisseur : les messages du gérant y transitent.
          provider: { data_collection: 'deny' },
          messages: conversation,
          ...(withTools ? { tools: COMPANION_TOOLS, tool_choice: 'auto' } : {}),
          max_tokens: MAX_OUTPUT_TOKENS,
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) throw new CompanionUpstreamError(`http_${response.status}`);
    const parsed = completionSchema.safeParse(await response.json());
    if (!parsed.success) throw new CompanionUpstreamError('invalid_response');
    trace.inputTokens += parsed.data.usage?.prompt_tokens ?? 0;
    trace.outputTokens += parsed.data.usage?.completion_tokens ?? 0;
    trace.cachedInputTokens += parsed.data.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    return parsed.data.choices[0].message;
  } catch (error) {
    if (error instanceof CompanionUpstreamError) throw error;
    throw new CompanionUpstreamError(
      error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network_error',
    );
  } finally {
    clearTimeout(timeout);
  }
}

interface CompanionTrace {
  turns: number;
  tools: string[];
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

export async function answerCompanion(input: {
  restaurantId: string;
  messages: CompanionMessage[];
  log: FastifyBaseLogger;
  fetcher?: typeof fetch;
  onToolCall?: (call: CompanionToolCall) => void;
}): Promise<CompanionAnswer> {
  const started = performance.now();
  const responseId = randomUUID();
  const fetcher = input.fetcher ?? fetch;
  const trace: CompanionTrace = {
    turns: 0,
    tools: [],
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
  };
  const sources: CompanionAnswer['sources'] = [];
  const conversation: ChatMessage[] = [
    {
      role: 'system',
      content: [
        { type: 'text', text: companionSystemPrompt(), cache_control: { type: 'ephemeral' } },
      ],
    },
    { role: 'system', content: companionDatePrompt(new Date()) },
    ...input.messages,
  ];
  let outcome = 'ok';
  let reason: string | undefined;

  try {
    for (let round = 0; ; round++) {
      const withTools = round < MAX_TOOL_ROUNDS && trace.inputTokens < INPUT_TOKEN_BUDGET;
      const message = await requestTurn(conversation, withTools, trace, fetcher);
      if (!withTools || !message.tool_calls?.length) {
        const reply = message.content?.replaceAll('**', '').trim() ?? '';
        if (!reply) throw new CompanionUpstreamError('empty_reply');
        return { reply, sources, responseId };
      }

      conversation.push({
        role: 'assistant',
        content: message.content ?? null,
        tool_calls: message.tool_calls,
      });
      for (const call of message.tool_calls) {
        const result = await runCompanionTool(
          call.function.name,
          call.function.arguments,
          input.restaurantId,
        );
        trace.tools.push(call.function.name);
        input.onToolCall?.({
          name: call.function.name,
          arguments: call.function.arguments,
          result: result.content,
        });
        if (result.source && !sources.some((source) => source.tool === result.source?.tool)) {
          sources.push(result.source);
        }
        conversation.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result.content),
        });
      }
    }
  } catch (error) {
    if (error instanceof CompanionUpstreamError) {
      outcome = 'upstream_error';
      reason = error.message;
    } else {
      outcome = 'error';
    }
    throw error;
  } finally {
    // Ni le contenu des messages ni les résultats d'outils : seulement la forme de l'appel.
    input.log.info(
      {
        responseId,
        model: env.COMPANION_LLM_MODEL,
        outcome,
        reason,
        turns: trace.turns,
        tools: trace.tools,
        input_tokens: trace.inputTokens,
        cached_input_tokens: trace.cachedInputTokens,
        output_tokens: trace.outputTokens,
        latency_ms: Math.round(performance.now() - started),
      },
      'companion chat',
    );
  }
}
