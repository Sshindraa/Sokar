/**
 * Suggestions CRM tirées d'un appel : après le raccroché, une requête lit ce que l'appelant a dit et
 * propose des préférences durables (zone, table, régime, accessibilité, langue, occasion). Elles sont
 * écrites comme `VOICE_SUGGESTION` non confirmées, qui expirent seules : l'agent ne s'en sert pas tant
 * que l'équipe ne les a pas confirmées dans la fiche (voir selectVoicePreferences).
 *
 * Jamais pendant l'appel, jamais bloquant : toute erreur est journalisée sans texte d'appel et absorbée.
 */
import { z } from 'zod';
import { db } from '../../shared/db/client';
import { logger } from '../../shared/logger/pino';
import {
  appendCustomerTimelineEvent,
  buildCustomerTimelineDedupeKey,
  normalizeCustomerPhone,
  upsertCustomerPreference,
  type CustomerPreferenceKey,
} from './customer-crm.service';

export const CRM_VOICE_SUGGESTIONS_JOB_NAME = 'crm-voice-suggestions';

/** Ce qu'un appelant peut dire de lui-même ; la taille de groupe habituelle se calcule ailleurs. */
export const VOICE_SUGGESTION_KEYS = [
  'preferred_section',
  'preferred_table',
  'dietary_restrictions',
  'accessibility_needs',
  'preferred_language',
  'occasion_type',
] as const satisfies readonly CustomerPreferenceKey[];

const SUGGESTION_TTL_DAYS = 90;
const SUGGESTION_CONFIDENCE = 0.6;
const MIN_TRANSCRIPT_LENGTH = 30;
const MAX_TRANSCRIPT_LENGTH = 6_000;
const MAX_VALUE_LENGTH = 120;
const REQUEST_TIMEOUT_MS = 30_000;

/** Pour tous les restaurants dès que la clé OpenRouter est présente (la requête passe par elle). */
export function isCrmVoiceSuggestionsEnabled(
  restaurantId: string | undefined | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(restaurantId && (env.OPENROUTER_API_KEY ?? '').trim());
}

export const VOICE_SUGGESTION_INSTRUCTIONS = [
  "Tu lis ce qu'un appelant a dit au téléphone à un restaurant (transcription automatique de sa seule voix, sans les réponses de l'agent).",
  "Relève seulement ce qu'il affirme clairement sur lui-même ou sur son groupe et qui vaudra encore pour une prochaine visite : zone ou table qu'il préfère, régime ou allergie, besoin d'accessibilité, langue dans laquelle il veut être servi, occasion qu'il fête.",
  "Une demande valable seulement pour cette réservation, une question, une hypothèse ou une information sur une autre personne qu'un convive ne compte pas. Dans le doute, ne relève rien : une liste vide est la réponse attendue la plupart du temps.",
  'value est une formulation courte en français (« terrasse », « sans gluten », « fauteuil roulant »). evidence recopie mot pour mot le passage de la transcription qui le prouve.',
].join('\n');

export const VOICE_SUGGESTION_FORMAT = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'crm_voice_suggestions',
    strict: true as const,
    schema: {
      type: 'object',
      properties: {
        suggestions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', enum: [...VOICE_SUGGESTION_KEYS] },
              value: { type: 'string' },
              evidence: { type: 'string' },
            },
            required: ['key', 'value', 'evidence'],
            additionalProperties: false,
          },
        },
      },
      required: ['suggestions'],
      additionalProperties: false,
    },
  },
};

const rawSuggestionsSchema = z.object({
  suggestions: z.array(
    z.object({ key: z.string(), value: z.string(), evidence: z.string() }).passthrough(),
  ),
});

export interface VoiceSuggestion {
  key: (typeof VOICE_SUGGESTION_KEYS)[number];
  value: string;
}

function normalizeForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Garde-fou contre l'invention : une suggestion n'est gardée que si sa preuve apparaît vraiment dans
 * ce que l'appelant a dit. Une clé hors liste, une valeur vide ou trop longue est écartée ; une clé
 * n'est gardée qu'une fois.
 */
export function validateVoiceSuggestions(raw: unknown, transcript: string): VoiceSuggestion[] {
  const parsed = rawSuggestionsSchema.safeParse(raw);
  if (!parsed.success) return [];
  const haystack = normalizeForMatch(transcript);
  const seen = new Set<string>();
  const kept: VoiceSuggestion[] = [];
  for (const item of parsed.data.suggestions) {
    if (!(VOICE_SUGGESTION_KEYS as readonly string[]).includes(item.key)) continue;
    if (seen.has(item.key)) continue;
    const value = item.value.replace(/\s+/g, ' ').trim();
    if (!value || value.length > MAX_VALUE_LENGTH) continue;
    const evidence = normalizeForMatch(item.evidence);
    if (evidence.length < 3 || !haystack.includes(evidence)) continue;
    seen.add(item.key);
    kept.push({ key: item.key as VoiceSuggestion['key'], value });
  }
  return kept;
}

export interface ExtractOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export type ExtractResult =
  | { status: 'ok'; suggestions: VoiceSuggestion[] }
  | { status: 'error'; reason: 'missing_key' | 'timeout' | 'http_error' | 'invalid_response' };

export async function extractVoiceSuggestions(
  transcript: string,
  options: ExtractOptions,
): Promise<ExtractResult> {
  if (!options.apiKey.trim()) return { status: 'error', reason: 'missing_key' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS);
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
            { role: 'system', content: VOICE_SUGGESTION_INSTRUCTIONS },
            { role: 'user', content: transcript.slice(0, MAX_TRANSCRIPT_LENGTH) },
          ],
          response_format: VOICE_SUGGESTION_FORMAT,
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) return { status: 'error', reason: 'http_error' };
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) return { status: 'error', reason: 'invalid_response' };
    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      return { status: 'error', reason: 'invalid_response' };
    }
    if (!rawSuggestionsSchema.safeParse(raw).success) {
      return { status: 'error', reason: 'invalid_response' };
    }
    return { status: 'ok', suggestions: validateVoiceSuggestions(raw, transcript) };
  } catch (err) {
    if (controller.signal.aborted) return { status: 'error', reason: 'timeout' };
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      '[crm] voice suggestions request failed',
    );
    return { status: 'error', reason: 'http_error' };
  } finally {
    clearTimeout(timeout);
  }
}

export type SaveOutcome = 'created' | 'replaced' | 'kept_team_value' | 'unchanged';

/**
 * Écrit une suggestion sans jamais écraser ce que l'équipe a saisi ou confirmé : seule une suggestion
 * vocale encore non confirmée peut être remplacée par une plus récente.
 */
export async function saveVoiceSuggestion(input: {
  restaurantId: string;
  customerId: string;
  callId: string;
  suggestion: VoiceSuggestion;
  now?: Date;
}): Promise<SaveOutcome> {
  const now = input.now ?? new Date();
  const { restaurantId, customerId, suggestion } = input;
  const outcome = await db.$transaction(async (tx) => {
    const existing = await tx.customerPreference.findUnique({
      where: { customerId_key: { customerId, key: suggestion.key }, restaurantId },
      select: { source: true, confirmedAt: true, value: true, expiresAt: true },
    });
    const existingIsLive = !existing?.expiresAt || existing.expiresAt.getTime() > now.getTime();
    if (existing && existingIsLive) {
      if (existing.source !== 'VOICE_SUGGESTION' || existing.confirmedAt) return 'kept_team_value';
      if (existing.value === suggestion.value) return 'unchanged';
    }
    await upsertCustomerPreference(
      {
        restaurantId,
        customerId,
        key: suggestion.key,
        value: suggestion.value,
        source: 'VOICE_SUGGESTION',
        confidence: SUGGESTION_CONFIDENCE,
        confirmedAt: null,
        expiresAt: new Date(now.getTime() + SUGGESTION_TTL_DAYS * 86_400_000),
      },
      tx,
    );
    return existing ? 'replaced' : 'created';
  });

  if (outcome === 'created' || outcome === 'replaced') {
    const sourceId = `${input.callId}:${suggestion.key}`;
    await appendCustomerTimelineEvent({
      restaurantId,
      customerId,
      eventType: 'CUSTOMER_PREFERENCE_SUGGESTED',
      sourceType: 'call',
      sourceId,
      dedupeKey: buildCustomerTimelineDedupeKey({
        restaurantId,
        customerId,
        eventType: 'CUSTOMER_PREFERENCE_SUGGESTED',
        sourceType: 'call',
        sourceId,
      }),
      occurredAt: now,
      summaryCode: 'customer.preference_suggested',
      metadata: { preferenceKey: suggestion.key, source: 'VOICE_SUGGESTION' },
    });
  }
  return outcome;
}

async function findActiveCustomerByPhone(
  restaurantId: string,
  phone: string,
): Promise<{ id: string } | null> {
  const normalized = normalizeCustomerPhone(phone);
  if (normalized) {
    const identity = await db.customerIdentity.findUnique({
      where: {
        restaurantId_type_normalizedValue: {
          restaurantId,
          type: 'PHONE',
          normalizedValue: normalized,
        },
      },
      select: { customer: { select: { id: true, archivedAt: true, mergedIntoId: true } } },
    });
    if (identity && !identity.customer.archivedAt && !identity.customer.mergedIntoId) {
      return { id: identity.customer.id };
    }
  }
  const customer = await db.customer.findUnique({
    where: { restaurantId_phone: { restaurantId, phone } },
    select: { id: true, archivedAt: true, mergedIntoId: true },
  });
  return customer && !customer.archivedAt && !customer.mergedIntoId ? { id: customer.id } : null;
}

export type SuggestionsJobResult =
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string }
  | { status: 'done'; outcomes: SaveOutcome[] };

/** Tâche du worker : ne lève jamais, une suggestion manquante n'a d'effet sur rien. */
export async function runCrmVoiceSuggestionsJob(
  callLegId: string,
  env: NodeJS.ProcessEnv = process.env,
  fetcher?: typeof fetch,
): Promise<SuggestionsJobResult> {
  try {
    const call = await db.call.findUnique({
      where: { callSid: callLegId },
      select: { id: true, restaurantId: true, callerPhone: true, transcript: true },
    });
    if (!call) return { status: 'skipped', reason: 'call_not_found' };
    if (!isCrmVoiceSuggestionsEnabled(call.restaurantId, env)) {
      return { status: 'skipped', reason: 'disabled' };
    }
    const transcript = call.transcript?.trim() ?? '';
    if (transcript.length < MIN_TRANSCRIPT_LENGTH) {
      return { status: 'skipped', reason: 'short_transcript' };
    }
    if (!call.callerPhone) return { status: 'skipped', reason: 'no_caller' };
    const customer = await findActiveCustomerByPhone(call.restaurantId, call.callerPhone);
    if (!customer) return { status: 'skipped', reason: 'no_customer' };

    const extracted = await extractVoiceSuggestions(transcript, {
      apiKey: (env.OPENROUTER_API_KEY ?? '').trim(),
      baseUrl: env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
      model: env.VOICE_CRM_SUGGESTIONS_MODEL || env.VOICE_STRUCTURED_FALLBACK_MODEL || '',
      fetcher,
    });
    if (extracted.status === 'error') {
      logger.warn(
        { callId: call.id, restaurantId: call.restaurantId, reason: extracted.reason },
        '[crm] voice suggestions skipped',
      );
      return { status: 'failed', reason: extracted.reason };
    }

    const outcomes: SaveOutcome[] = [];
    for (const suggestion of extracted.suggestions) {
      outcomes.push(
        await saveVoiceSuggestion({
          restaurantId: call.restaurantId,
          customerId: customer.id,
          callId: call.id,
          suggestion,
        }),
      );
    }
    logger.info(
      {
        callId: call.id,
        restaurantId: call.restaurantId,
        keys: extracted.suggestions.map((suggestion) => suggestion.key),
        outcomes,
      },
      '[crm] voice suggestions processed',
    );
    return { status: 'done', outcomes };
  } catch (err) {
    logger.warn(
      { callLegId, err: err instanceof Error ? err.message : String(err) },
      '[crm] voice suggestions job failed',
    );
    return { status: 'failed', reason: 'exception' };
  }
}

/** Met la tâche en file au raccroché, une seule tentative : rien ne dépend d'elle. */
export async function enqueueCrmVoiceSuggestions(
  callLegId: string,
  restaurantId: string | undefined | null,
  queue: { add: (name: string, data: unknown, opts: Record<string, unknown>) => Promise<unknown> },
  jobId: string,
): Promise<void> {
  if (!isCrmVoiceSuggestionsEnabled(restaurantId)) return;
  try {
    await queue.add(
      CRM_VOICE_SUGGESTIONS_JOB_NAME,
      { callLegId },
      { jobId, attempts: 1, removeOnComplete: 200, removeOnFail: 200 },
    );
  } catch (err) {
    logger.warn(
      { callLegId, err: err instanceof Error ? err.message : String(err) },
      '[crm] could not enqueue voice suggestions (no effect on the call)',
    );
  }
}
