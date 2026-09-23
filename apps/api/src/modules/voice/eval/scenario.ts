/**
 * Scénarios du banc d'évaluation vocal : persona, objectif et résultat
 * attendu. Un fichier JSON par catégorie dans `scenarios/`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const TimeSchema = z.string().regex(/^\d{2}:\d{2}$/u);

export const RESTAURANT_PRESETS = {
  /** Fermé le dimanche, service midi et soir, ligne gérant configurée. */
  standard: {
    id: 'eval-standard',
    name: 'Le Bistrot du Marché',
    managerPhone: '+33100000001',
    openingHours: {
      mon: { open: '12:00', close: '22:30' },
      tue: { open: '12:00', close: '22:30' },
      wed: { open: '12:00', close: '22:30' },
      thu: { open: '12:00', close: '22:30' },
      fri: { open: '12:00', close: '23:00' },
      sat: { open: '12:00', close: '23:00' },
      sun: null,
    },
  },
  /** Ouvert tous les jours, y compris le dimanche. */
  open_sunday: {
    id: 'eval-open-sunday',
    name: 'Chez Lucie',
    managerPhone: '+33100000002',
    openingHours: {
      mon: { open: '12:00', close: '22:30' },
      tue: { open: '12:00', close: '22:30' },
      wed: { open: '12:00', close: '22:30' },
      thu: { open: '12:00', close: '22:30' },
      fri: { open: '12:00', close: '23:00' },
      sat: { open: '12:00', close: '23:00' },
      sun: { open: '12:00', close: '22:00' },
    },
  },
  /** Sans ligne gérant : le repli humain passe par la prise de message. */
  no_manager: {
    id: 'eval-no-manager',
    name: 'La Table de Paul',
    managerPhone: null,
    openingHours: {
      mon: { open: '12:00', close: '22:30' },
      tue: { open: '12:00', close: '22:30' },
      wed: { open: '12:00', close: '22:30' },
      thu: { open: '12:00', close: '22:30' },
      fri: { open: '12:00', close: '23:00' },
      sat: { open: '12:00', close: '23:00' },
      sun: null,
    },
  },
} as const;

export type RestaurantPresetId = keyof typeof RESTAURANT_PRESETS;

/** Créneaux ouverts par défaut (midi et soir, par demi-heure). */
export const DEFAULT_AVAILABLE_SLOTS = [
  '12:00',
  '12:30',
  '13:00',
  '13:30',
  '19:00',
  '19:30',
  '20:00',
  '20:30',
  '21:00',
  '21:30',
];

export const ScenarioSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  language: z.enum(['fr', 'en']).default('fr'),
  restaurant: z.enum(['standard', 'open_sunday', 'no_manager']).default('standard'),
  /** Qui est l'appelant et comment il parle. */
  persona: z.string().min(1),
  /** Ce qu'il veut obtenir, avec les faits qu'il connaît. */
  goal: z.string().min(1),
  /** Première phrase imposée (sinon générée par le LLM appelant). */
  opening: z.string().optional(),
  /** Créneaux renvoyés par la disponibilité (défaut : DEFAULT_AVAILABLE_SLOTS). */
  availableSlots: z.array(TimeSchema).optional(),
  expected: z.object({
    /** Réservation qui doit être créée, et seulement celle-là. */
    reservation: z
      .object({
        dateOffsetDays: z.number().int().min(0).max(14),
        time: TimeSchema,
        partySize: z.number().int().min(1).max(20),
      })
      .optional(),
    /** Outils qui doivent avoir été appelés au moins une fois. */
    tools: z.array(z.string()).default([]),
    /** Outils qui ne doivent jamais être appelés. */
    forbiddenTools: z.array(z.string()).default([]),
    /** Au moins une réplique de l'agent doit correspondre à chaque motif. */
    mustSay: z.array(z.string()).default([]),
    /** Aucune réplique de l'agent ne doit correspondre à ces motifs. */
    mustNotSay: z.array(z.string()).default([]),
    /** Nombre maximal de tours de l'appelant. */
    maxTurns: z.number().int().min(1).max(30).default(12),
  }),
});

export type Scenario = z.infer<typeof ScenarioSchema>;

export const SCENARIOS_DIR = path.join(__dirname, 'scenarios');

/** Charge et valide tous les scénarios ; les identifiants doivent être uniques. */
export function loadScenarios(dir = SCENARIOS_DIR): Scenario[] {
  const scenarios: Scenario[] = [];
  for (const file of readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()) {
    const raw = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as unknown[];
    for (const entry of raw) {
      const parsed = ScenarioSchema.safeParse(entry);
      if (!parsed.success) {
        throw new Error(`Scénario invalide dans ${file} : ${parsed.error.message}`);
      }
      scenarios.push(parsed.data);
    }
  }
  const ids = new Set<string>();
  for (const scenario of scenarios) {
    if (ids.has(scenario.id)) throw new Error(`Identifiant de scénario en double : ${scenario.id}`);
    ids.add(scenario.id);
  }
  return scenarios;
}
