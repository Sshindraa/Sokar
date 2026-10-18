import { z } from 'zod';

/**
 * Faits pratiques du restaurant, saisis une fois à l'onboarding et lus par tous les canaux.
 * Règle de fond : une clé absente veut dire « non précisé », jamais « non ». L'assistant ne répond
 * qu'à partir de ce qui est renseigné et passe la main au gérant pour le reste.
 */
export const PRACTICAL_PARKING = ['onsite', 'nearby', 'none'] as const;
export const PRACTICAL_PETS = ['yes', 'terrace', 'no'] as const;

/** Valeurs de `ambiance` que cette étape pilote ; les autres (brunch, groupe…) ne sont jamais touchées. */
export const PRACTICAL_MANAGED_FEATURES = {
  terrace: 'terrasse',
  privatization: 'privatisation',
} as const;

export const PRACTICAL_NOTES_MAX = 500;

const FieldSchemas = {
  terrace: z.boolean(),
  privatization: z.boolean(),
  parking: z.enum(PRACTICAL_PARKING),
  accessible: z.boolean(),
  pets: z.enum(PRACTICAL_PETS),
  kidsMenu: z.boolean(),
  menuUrl: z.string().trim().url().max(300),
  notes: z.string().trim().min(1).max(PRACTICAL_NOTES_MAX),
} as const;

export type PracticalInfo = {
  [K in keyof typeof FieldSchemas]?: z.infer<(typeof FieldSchemas)[K]>;
};

/** Corps de sauvegarde : les valeurs `null` effacent une réponse, une clé absente ne la touche pas. */
export const PracticalInfoUpdateSchema = z.object({
  practicalInfo: z
    .object({
      terrace: FieldSchemas.terrace.nullable(),
      privatization: FieldSchemas.privatization.nullable(),
      parking: FieldSchemas.parking.nullable(),
      accessible: FieldSchemas.accessible.nullable(),
      pets: FieldSchemas.pets.nullable(),
      kidsMenu: FieldSchemas.kidsMenu.nullable(),
      menuUrl: FieldSchemas.menuUrl.nullable(),
      notes: FieldSchemas.notes.nullable(),
    })
    .partial(),
  dietary: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
});

export type PracticalInfoUpdate = z.infer<typeof PracticalInfoUpdateSchema>;

/** Lecture tolérante : une valeur invalide est ignorée sans invalider les autres. */
export function normalizePracticalInfo(raw: unknown): PracticalInfo {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(FieldSchemas)) {
    const parsed = schema.safeParse(source[key]);
    if (parsed.success) result[key] = parsed.data;
  }
  return result as PracticalInfo;
}

/** Fusionne une mise à jour dans l'existant : `null` retire, une valeur remplace, le reste est conservé. */
export function mergePracticalInfo(
  current: PracticalInfo,
  update: PracticalInfoUpdate['practicalInfo'],
): PracticalInfo {
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(update)) {
    if (value === null) delete next[key];
    else if (value !== undefined) next[key] = value;
  }
  return next as PracticalInfo;
}

/**
 * Garde `ambiance` (lue par Connect) cohérente avec les réponses terrasse et privatisation :
 * vrai l'ajoute, faux la retire, non précisé n'y touche pas.
 */
export function syncManagedFeatures(
  ambiance: string[],
  update: PracticalInfoUpdate['practicalInfo'],
): string[] {
  const next = new Set(ambiance);
  for (const [field, feature] of Object.entries(PRACTICAL_MANAGED_FEATURES)) {
    const value = update[field as keyof typeof PRACTICAL_MANAGED_FEATURES];
    if (value === true) next.add(feature);
    if (value === false || value === null) next.delete(feature);
  }
  return [...next];
}

/** Questions auxquelles le restaurateur doit répondre : ce que les clients demandent le plus. */
export const PRACTICAL_REQUIRED_FIELDS = [
  'terrace',
  'parking',
  'accessible',
  'pets',
  'kidsMenu',
  'privatization',
] as const;

/**
 * Vrai quand chaque question obligatoire a une réponse. Terrasse et privatisation comptent comme
 * répondues si la fiche Connect les affiche déjà (`ambiance`). Les options alimentaires, l'adresse du
 * menu et les précisions restent libres : « aucune » est une réponse valable.
 */
export function hasAnsweredPracticalInfo(
  practicalInfo: unknown,
  ambiance?: string[] | null,
): boolean {
  const info = normalizePracticalInfo(practicalInfo);
  const features = ambiance ?? [];
  return PRACTICAL_REQUIRED_FIELDS.every((field) => {
    if (info[field] !== undefined) return true;
    if (field === 'terrace') return features.includes(PRACTICAL_MANAGED_FEATURES.terrace);
    if (field === 'privatization')
      return features.includes(PRACTICAL_MANAGED_FEATURES.privatization);
    return false;
  });
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * Phrases à donner à l'assistant vocal, une par fait connu. Rien n'est écrit pour un fait non
 * précisé : l'assistant ne doit pas le déduire. L'adresse du menu n'est pas lue au téléphone.
 */
export function buildPracticalFacts(input: {
  practicalInfo?: unknown;
  dietary?: string[] | null;
  ambiance?: string[] | null;
}): string[] {
  const info = normalizePracticalInfo(input.practicalInfo);
  const ambiance = input.ambiance ?? [];
  const facts: string[] = [];

  const terrace =
    info.terrace ?? (ambiance.includes(PRACTICAL_MANAGED_FEATURES.terrace) ? true : undefined);
  if (terrace === true) facts.push('Le restaurant a une terrasse.');
  if (terrace === false) facts.push('Le restaurant n’a pas de terrasse.');

  if (info.parking === 'onsite') facts.push('Le restaurant dispose d’un parking.');
  if (info.parking === 'nearby') {
    facts.push('Le restaurant n’a pas de parking à lui, mais on peut se garer à proximité.');
  }
  if (info.parking === 'none') facts.push('Il n’y a pas de parking.');

  if (info.accessible === true) {
    facts.push('Le restaurant est accessible aux personnes à mobilité réduite.');
  }
  if (info.accessible === false) {
    facts.push('Le restaurant n’est pas accessible aux personnes à mobilité réduite.');
  }

  if (info.pets === 'yes') facts.push('Les animaux sont acceptés.');
  if (info.pets === 'terrace') facts.push('Les animaux sont acceptés uniquement en terrasse.');
  if (info.pets === 'no') facts.push('Les animaux ne sont pas acceptés.');

  const dietary = (input.dietary ?? []).map(oneLine).filter(Boolean);
  if (dietary.length > 0) facts.push(`Options alimentaires proposées : ${dietary.join(', ')}.`);

  if (info.kidsMenu === true) facts.push('Il y a un menu enfant.');
  if (info.kidsMenu === false) facts.push('Il n’y a pas de menu enfant.');

  const privatization =
    info.privatization ??
    (ambiance.includes(PRACTICAL_MANAGED_FEATURES.privatization) ? true : undefined);
  if (privatization === true) facts.push('Le restaurant propose la privatisation.');
  if (privatization === false) facts.push('Le restaurant ne propose pas la privatisation.');

  if (info.menuUrl) facts.push('Le menu est consultable en ligne sur le site du restaurant.');
  if (info.notes) facts.push(`Autres précisions du restaurateur : ${oneLine(info.notes)}`);

  return facts;
}
