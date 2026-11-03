/**
 * Banc du résumé « Ce soir » (phase C) : trois scénarios, joués par brief-run.ts avec `--trials 3`.
 *
 * Critères, figés avant le premier essai (commit dédié, aucun essai avant) :
 * - ancrage : chaque chiffre du résumé figure dans les données transmises au modèle (100 %) ;
 * - au plus 3 phrases ;
 * - au moins un point attendu présent : sa valeur exacte, calculée ici par Prisma, indépendamment
 *   de catalog.ts, de tonight.ts et de brief.ts ;
 * - aucun nom de client du jour dans le texte ;
 * - au plus 30 mots par phrase. Ce seuil remplace les 20 mots du premier passage, choisi au
 *   renotage des points (voir le Journal) ; le critère 20 mots était ajouté après le premier passage.
 *
 * Restaurant : le démo. Aucun restaurant sans la formule Avis n'a de réservations dans la base
 * locale : le scénario 3 retire donc la lecture des avis, comme le ferait une formule absente.
 * Heures de Paris : UTC+2 jusqu'au 25 octobre 2026, UTC+1 ensuite.
 */
// L’environnement d’abord : il choisit la base (apps/api/.env), avant le client Prisma.
import '../../src/env';
import { db } from '../../src/shared/db/client';
import { anchoredIn, numbersIn } from '../../src/modules/companion/grounding';

export const BRIEF_CRITERIA = {
  maxSentences: 3,
  maxWordsPerSentence: 30,
  /** Part des chiffres du résumé ancrés dans les données (1 = 100 %). */
  anchoring: 1,
  minExpectedPoints: 1,
  maxNames: 0,
} as const;

// Le service du soir commence à 16 h (heure de Paris) : mêmes états que tonight.ts.
const SERVICE_STATES = ['PENDING', 'CONFIRMED', 'SEATED'] as const;

export interface BriefScenario {
  n: number;
  label: string;
  /** Instant de la carte, avec son décalage de Paris. */
  now: string;
  /** false : la formule Avis est absente, la lecture des avis est retirée du résumé. */
  recovery: boolean;
  /** Valeurs exactes qui doivent figurer dans le résumé (au moins une). */
  expected: (restaurantId: string) => Promise<number[]>;
  /** Noms des clients du jour : aucun ne doit figurer dans le résumé. */
  names: (restaurantId: string) => Promise<string[]>;
}

// Décalage de Paris pour un jour AAAA-MM-JJ d'octobre 2026 : heure d'été jusqu'au 25 octobre.
const parisOffset = (day: string) => (day < '2026-10-25' ? '+02:00' : '+01:00');
const dayStart = (day: string) => new Date(`${day}T00:00:00${parisOffset(day)}`);
const dayEnd = (day: string) => new Date(`${day}T23:59:59.999${parisOffset(day)}`);
const eveningStart = (day: string) => new Date(`${day}T16:00:00${parisOffset(day)}`);

// Couverts du service du soir : réservations valables de ce jour, à partir de 16 h.
async function coversTonight(restaurantId: string, day: string): Promise<number[]> {
  const rows = await db.reservation.findMany({
    where: {
      restaurantId,
      isTest: false,
      state: { in: [...SERVICE_STATES] },
      reservedAt: { gte: eveningStart(day), lte: dayEnd(day) },
    },
    select: { partySize: true },
  });
  return [rows.reduce((sum, row) => sum + row.partySize, 0)];
}

async function customerNamesOn(restaurantId: string, day: string): Promise<string[]> {
  const rows = await db.reservation.findMany({
    where: { restaurantId, isTest: false, reservedAt: { gte: dayStart(day), lte: dayEnd(day) } },
    select: { customerName: true },
  });
  return [...new Set(rows.map((row) => row.customerName).filter((name) => name.length >= 3))];
}

// Appels reçus un jour donné : nombre exact, sans passer par catalog.ts.
async function callsOn(restaurantId: string, day: string): Promise<number[]> {
  const count = await db.call.count({
    where: { restaurantId, createdAt: { gte: dayStart(day), lte: dayEnd(day) } },
  });
  return [count];
}

export const BRIEF_SCENARIOS: BriefScenario[] = [
  {
    n: 1,
    label: 'jour de l’anomalie : appels du 20 octobre, soir du 21',
    now: '2026-10-21T19:00:00+02:00',
    recovery: true,
    expected: (restaurantId) => callsOn(restaurantId, '2026-10-20'),
    names: (restaurantId) => customerNamesOn(restaurantId, '2026-10-21'),
  },
  {
    n: 2,
    label: 'jour normal : soir du 31 octobre',
    now: '2026-10-31T19:00:00+01:00',
    recovery: true,
    expected: (restaurantId) => coversTonight(restaurantId, '2026-10-31'),
    names: (restaurantId) => customerNamesOn(restaurantId, '2026-10-31'),
  },
  {
    n: 3,
    label: 'sans la formule Avis : soir du 31 octobre',
    now: '2026-10-31T19:00:00+01:00',
    recovery: false,
    expected: (restaurantId) => coversTonight(restaurantId, '2026-10-31'),
    names: (restaurantId) => customerNamesOn(restaurantId, '2026-10-31'),
  },
];

/** Phrases : fin par . ! ? suivi d'un espace ou de la fin du texte. */
export function sentenceCount(text: string): number {
  return text
    .split(/[.!?]+(?=\s|$)/)
    .map((sentence) => sentence.trim())
    .filter(Boolean).length;
}

/** Score d'un essai, selon les critères ci-dessus. facts : les données transmises au modèle. */
/** Mots de chaque phrase du texte. */
export function sentenceWords(text: string): number[] {
  return text
    .split(/[.!?]+(?=\s|$)/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .map((sentence) => sentence.split(/\s+/).length);
}

export function scoreBrief(input: {
  reply: string;
  facts: unknown;
  expected: number[];
  names: string[];
}) {
  const figures = numbersIn(input.reply);
  const lowered = input.reply.toLowerCase();
  const sentences = sentenceCount(input.reply);
  return {
    anchored: anchoredIn(input.reply, [{ result: input.facts }]).ok,
    sentences,
    withinSentences: sentences <= BRIEF_CRITERIA.maxSentences,
    withinWords: sentenceWords(input.reply).every(
      (words) => words <= BRIEF_CRITERIA.maxWordsPerSentence,
    ),
    point: input.expected.some((value) => figures.includes(value)),
    names: input.names.filter((name) => lowered.includes(name.toLowerCase())),
  };
}
