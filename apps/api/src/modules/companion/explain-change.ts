/**
 * Outil explain_change : explique un écart. Il renvoie le total et sa référence, les groupes qui
 * portent l'écart (drivers), et les autres sources qui varient dans le même temps (alongside).
 * Tout passe par le moteur de query_data : rien ici n'est propre à une fiche. Une variation
 * simultanée n'est jamais une cause, et le modèle ne calcule aucun écart.
 */
import { z } from 'zod';
import { SOURCES, type Dimension } from './catalog';
import {
  COMPARE_MODES,
  DateSchema,
  computeQueryData,
  type Compared,
  type QueryError,
  type QueryResult,
  type QueryUnavailable,
} from './query-data';

const DAY_MS = 86_400_000;
const DRIVER_LIMIT = 5;
const ALONGSIDE_MIN_PCT = 25;
const ALONGSIDE_MIN_REFERENCE = 5;
const LOW_VOLUME_REFERENCE = 5;
const TIME_DIMENSIONS = [
  { name: 'weekday', label: 'jour de la semaine' },
  { name: 'hour', label: 'heure de début' },
] as const;

const ExplainArgs = z
  .object({
    source: z.enum(Object.keys(SOURCES) as [string, ...string[]]),
    measure: z.string(),
    date_field: z.string().optional(),
    compare: z.enum(COMPARE_MODES),
    from: DateSchema,
    to: DateSchema,
  })
  .strict();

export interface Driver {
  dimension: string;
  label: string;
  key: string | number;
  value: number | null;
  reference: number | null;
  delta: number;
  /** Part de l'écart total porté par ce groupe ; null si l'écart total vaut 0. */
  share: number | null;
}

export interface Alongside {
  source: string;
  label: string;
  value: number | null;
  reference: number | null;
  delta_pct: number;
}

export interface Explanation {
  source: string;
  measure: string;
  compare: string;
  from: string;
  to: string;
  total: Compared;
  drivers: Driver[];
  alongside: Alongside[];
  low_volume: boolean;
}

const isResult = (value: QueryResult | QueryUnavailable | QueryError): value is QueryResult =>
  'total' in value;

const roundTo = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

export async function explainChange(
  restaurantId: string,
  input: unknown,
): Promise<Explanation | QueryUnavailable | QueryError> {
  const parsed = ExplainArgs.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'invalid_query',
      detail: parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'requête'} : ${issue.message}`)
        .join(' ; '),
    };
  }
  const args = parsed.data;
  const source = SOURCES[args.source as keyof typeof SOURCES];
  const base = {
    entity: args.source,
    metric: args.measure,
    date_field: args.date_field,
    compare: args.compare,
    from: args.from,
    to: args.to,
  };

  const total = await computeQueryData(restaurantId, base);
  if (!isResult(total)) return total;
  const totalCompared = total.total as Compared;

  // Drivers : chaque dimension fermée de la fiche, et le jour de la semaine et l'heure si la période
  // dépasse un jour.
  const span = (Date.parse(args.to) - Date.parse(args.from)) / DAY_MS + 1;
  const dimensions: Array<{ name: string; label: string }> = [
    ...(Object.entries(source.dimensions) as Array<[string, Dimension]>)
      .filter(([, dimension]) => dimension.values !== undefined)
      .map(([name, dimension]) => ({ name, label: dimension.label })),
    ...(span > 1 ? TIME_DIMENSIONS : []),
  ];
  const drivers: Driver[] = [];
  for (const dimension of dimensions) {
    const grouped = await computeQueryData(restaurantId, { ...base, group_by: dimension.name });
    if (!isResult(grouped) || !grouped.groups) continue;
    for (const group of grouped.groups as Array<Compared & { key: string | number }>) {
      if (group.delta === null) continue;
      drivers.push({
        dimension: dimension.name,
        label: dimension.label,
        key: group.key,
        value: group.value,
        reference: group.reference,
        delta: group.delta,
        share:
          totalCompared.delta === null || totalCompared.delta === 0
            ? null
            : roundTo(group.delta / totalCompared.delta, 2),
      });
    }
  }
  drivers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  // Alongside : le nombre d'éléments de chaque autre source sur les mêmes dates, avec le même compare.
  const alongside: Alongside[] = [];
  for (const [name, other] of Object.entries(SOURCES)) {
    if (name === args.source) continue;
    const dates = Object.keys(other.dates);
    const dateField =
      args.date_field !== undefined && dates.includes(args.date_field) ? args.date_field : dates[0];
    const result = await computeQueryData(restaurantId, {
      entity: name,
      metric: 'count',
      date_field: dateField,
      compare: args.compare,
      from: args.from,
      to: args.to,
    });
    if (!isResult(result)) continue;
    const compared = result.total as Compared;
    if (
      compared.delta_pct === null ||
      compared.reference === null ||
      compared.reference < ALONGSIDE_MIN_REFERENCE ||
      Math.abs(compared.delta_pct) < ALONGSIDE_MIN_PCT
    ) {
      continue;
    }
    alongside.push({
      source: name,
      label: other.label,
      value: compared.value,
      reference: compared.reference,
      delta_pct: compared.delta_pct,
    });
  }
  alongside.sort((a, b) => Math.abs(b.delta_pct) - Math.abs(a.delta_pct));

  return {
    source: args.source,
    measure: args.measure,
    compare: args.compare,
    from: args.from,
    to: args.to,
    total: totalCompared,
    drivers: drivers.slice(0, DRIVER_LIMIT),
    alongside,
    low_volume: totalCompared.reference === null || totalCompared.reference < LOW_VOLUME_REFERENCE,
  };
}

const unique = (values: readonly string[]) => [...new Set(values)];

/** Description d'explain_change, générée depuis le catalogue. */
export function explainChangeDescription(): string {
  const sources = Object.entries(SOURCES)
    .map(([name, source]) => `${name} = ${source.description}`)
    .join(' ; ');
  return [
    `Explique un écart entre une période et sa référence (compare, même sens que query_data). Sources (source) : ${sources}.`,
    'Le résultat donne le total avec sa référence, un écart et un pourcentage calculés par le serveur ; les groupes qui portent l’écart (drivers, avec leur part de l’écart total, cinq au plus) ; et les autres sources qui varient dans le même temps (alongside, seulement si l’écart est d’au moins 25 % et la référence d’au moins 5).',
    'low_volume vrai signifie une référence inférieure à 5 : ne concluez rien alors.',
    'Les variations simultanées ne sont pas des causes. date_field est obligatoire si la source a plusieurs dates.',
  ].join(' ');
}

/** Paramètres JSON d'explain_change, générés depuis le catalogue. */
export function explainChangeParameters() {
  const all = Object.values(SOURCES);
  return {
    type: 'object',
    properties: {
      source: { type: 'string', enum: Object.keys(SOURCES) },
      measure: {
        type: 'string',
        enum: unique(all.flatMap((source) => Object.keys(source.measures))),
      },
      date_field: {
        type: 'string',
        enum: unique(all.flatMap((source) => Object.keys(source.dates))),
      },
      compare: { type: 'string', enum: [...COMPARE_MODES] },
      from: { type: 'string', description: 'Premier jour inclus, AAAA-MM-JJ (heure de Paris).' },
      to: { type: 'string', description: 'Dernier jour inclus, AAAA-MM-JJ (heure de Paris).' },
    },
    required: ['source', 'measure', 'compare', 'from', 'to'],
    additionalProperties: false,
  };
}
