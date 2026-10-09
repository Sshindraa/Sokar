import { voiceConfig } from '../../env';
import { logger } from '../../shared/logger/pino';

/**
 * Nom que l'assistant annonce et que les réservations affichent, déduit du nom Google Maps.
 * Google y ajoute souvent la ville, l'arrondissement ou le type de cuisine (« Little Italy lyon 2 »).
 *
 * 1. Règle sûre : ville (et arrondissement) en fin de nom, séparés par une ponctuation ou suivis d'un
 *    arrondissement. Aucun appel externe.
 * 2. Sinon, un LLM propose le nom commercial. Sa réponse n'est acceptée que si elle ne fait que
 *    retirer des mots du nom Google, dans le même ordre : il ne peut rien inventer.
 * 3. En cas de doute, d'échec ou de délai dépassé : le nom Google, inchangé. Le restaurateur peut
 *    toujours le corriger à l'étape 1.
 */

export type PlaceNameInput = { name: string; city: string; postalCode: string };
export type PlaceNameLlm = (input: PlaceNameInput) => Promise<string | null>;

const LLM_TIMEOUT_MS = 2_500;
const LINKING_WORDS = new Set([
  'de',
  'du',
  'des',
  'd',
  'la',
  'le',
  'les',
  'l',
  'en',
  'sur',
  'a',
  'au',
]);
const SEPARATOR_ONLY = /^[\s,\-–—|·@/:]+$/;

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const tokens = (value: string) =>
  fold(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

function trimTrailingSeparators(words: string[]): string[] {
  const out = [...words];
  while (out.length > 0) {
    const last = out[out.length - 1];
    if (SEPARATOR_ONLY.test(last) || fold(last) === 'a') {
      out.pop();
      continue;
    }
    out[out.length - 1] = last.replace(/[\s,\-–—|·@/:]+$/, '');
    break;
  }
  return out;
}

/** Retire la ville (et l'arrondissement) en fin de nom, ou rend le nom inchangé. */
export function stripLocationSuffix(input: PlaceNameInput): string {
  const original = input.name.trim().replace(/\s+/g, ' ');
  const words = original.split(' ');
  const cityKey = tokens(input.city).join('');
  if (!cityKey || words.length < 2) return original;

  let end = words.length;
  let hadArrondissement = false;
  if (input.postalCode && tokens(input.postalCode).join('') === tokens(words[end - 1]).join('')) {
    end -= 1;
    hadArrondissement = true;
  }
  if (end > 1 && /^\d{1,2}(e|er|eme)?$/.test(tokens(words[end - 1]).join(''))) {
    end -= 1;
    hadArrondissement = true;
  }
  for (let size = 1; size <= 4 && end - size >= 1; size++) {
    const slice = words.slice(end - size, end);
    if (tokens(slice.join(' ')).join('') !== cityKey) continue;
    const before = words.slice(0, end - size);
    const separated =
      SEPARATOR_ONLY.test(before[before.length - 1] ?? '') ||
      /[,\-–—|·]$/.test(before[before.length - 1] ?? '');
    if (!hadArrondissement && !separated) return original;
    const kept = trimTrailingSeparators(before);
    const lastKept = kept[kept.length - 1];
    // « Café de Lyon » : la ville fait partie de l'enseigne.
    if (!lastKept || LINKING_WORDS.has(tokens(lastKept).join(''))) return original;
    return kept.join(' ');
  }
  return original;
}

/** Vrai si `candidate` ne fait que retirer des mots de `original`, sans en ajouter ni réordonner. */
export function isFaithfulName(candidate: string, original: string): boolean {
  const wanted = tokens(candidate);
  const source = tokens(original);
  if (wanted.length === 0 || wanted.length > source.length) return false;
  let index = 0;
  for (const token of source) {
    if (token === wanted[index]) index += 1;
    if (index === wanted.length) return true;
  }
  return false;
}

const SYSTEM_PROMPT = [
  "Tu donnes le nom commercial d'un restaurant tel que ses clients le disent au téléphone.",
  "Tu reçois le nom de sa fiche Google Maps. Retire uniquement ce que Google y a ajouté : la ville, le quartier, l'arrondissement, le code postal ou une description (« restaurant italien », « pizzeria »).",
  "Garde tout ce qui fait partie de l'enseigne, même si c'est un mot de lieu (« Le Comptoir Lyonnais », « Café de Paris », « Brasserie Georges »).",
  "N'ajoute, ne traduis et ne reformule jamais : ta réponse est le nom Google privé de mots, rien d'autre.",
  'Exemples : « Little Italy lyon 2 » → Little Italy ; « Pizzeria Napoli - Restaurant italien Lyon 6 » → Pizzeria Napoli ; « Le Comptoir Lyonnais » → Le Comptoir Lyonnais.',
  'Réponds uniquement par le nom, sans guillemets.',
].join('\n');

const cerebrasLlm: PlaceNameLlm = async (input) => {
  const apiKey = voiceConfig.CEREBRAS_API_KEY?.trim();
  if (!apiKey) return null;
  const response = await fetch(
    `${voiceConfig.CEREBRAS_BASE_URL.replace(/\/+$/, '')}/chat/completions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      body: JSON.stringify({
        model: voiceConfig.VOICE_LLM_MODEL,
        temperature: 0,
        max_tokens: 40,
        reasoning_effort: 'none',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Nom Google : ${input.name}\nVille : ${input.city}\nCode postal : ${input.postalCode}`,
          },
        ],
      }),
    },
  );
  if (!response.ok) return null;
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = body.choices?.[0]?.message?.content ?? '';
  const line =
    text
      .split('\n')[0]
      ?.trim()
      .replace(/^["«»'\s]+|["«»'\s]+$/g, '') ?? '';
  return line.length > 0 && line.length <= 80 ? line : null;
};

export async function deriveDisplayName(
  input: PlaceNameInput,
  llm: PlaceNameLlm = cerebrasLlm,
): Promise<string> {
  const original = input.name.trim();
  if (!original) return original;
  const stripped = stripLocationSuffix(input);
  if (stripped !== original.replace(/\s+/g, ' ')) return stripped;
  if (tokens(original).length < 2) return original;
  try {
    const candidate = await llm(input);
    if (candidate && isFaithfulName(candidate, original)) return candidate;
  } catch (err) {
    // Jamais le nom ni la ville dans les journaux : seulement la cause.
    logger.warn(
      { reason: err instanceof Error ? err.name : 'unknown' },
      '[onboarding] display name suggestion failed',
    );
  }
  return original;
}
