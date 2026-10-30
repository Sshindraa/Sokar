/**
 * Requête du Companion (outil query_data) : le modèle compose une requête, le serveur la valide,
 * la borne au restaurant, calcule et ne renvoie que des totaux. Les sources, leurs champs et leurs
 * mesures viennent du catalogue (catalog.ts) : ce fichier ne contient que le moteur.
 */
import { normalizeOpeningHours } from '@sokar/shared';
import { z } from 'zod';
import { db } from '../../shared/db/client';
import { WaitingListDisabledError } from '../agentic-reservations/core/waiting-list.errors';
import { evaluateCapability } from '../entitlements/entitlement.service';
import {
  RESERVATION_STATES,
  SOURCES,
  filtersOf,
  type Item,
  type Measure,
  type Scalar,
  type Source,
} from './catalog';

const DAY_MS = 86_400_000;
const MAX_SPAN_DAYS = 400;
const MAX_DAY_GROUP_SPAN_DAYS = 62;
const TIME_GROUPS = ['day', 'weekday', 'hour'] as const;

// 0 = dimanche … 6 = samedi, comme normalizeOpeningHours.
const WEEKDAY_NAMES = [
  'dimanche',
  'lundi',
  'mardi',
  'mercredi',
  'jeudi',
  'vendredi',
  'samedi',
] as const;
const WEEKDAY_RANK: Record<string, number> = Object.fromEntries(
  ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'].map((name, rank) => [
    name,
    rank,
  ]),
);
const WEEKDAY_BY_SHORT: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const PARIS_CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Paris',
  hourCycle: 'h23',
  weekday: 'short',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

// Jour (AAAA-MM-JJ), jour de semaine et heure à Paris pour un instant donné.
export function parisParts(date: Date) {
  const parts = Object.fromEntries(
    PARIS_CLOCK.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return {
    dayKey: `${parts.year}-${parts.month.padStart(2, '0')}-${parts.day.padStart(2, '0')}`,
    weekday: WEEKDAY_BY_SHORT[parts.weekday],
    hour: Number(parts.hour),
    wall: Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    ),
  };
}

// Décalage de Paris par rapport à UTC à cet instant : +1 h en hiver, +2 h en été.
function parisOffsetMs(instant: number): number {
  return parisParts(new Date(instant)).wall - instant;
}

// Minuit à Paris le jour donné, en instant UTC (le décalage change au passage à l'heure d'été).
export function parisMidnight(dayKey: string): Date {
  const wall = Date.parse(`${dayKey}T00:00:00Z`);
  return new Date(wall - parisOffsetMs(wall - parisOffsetMs(wall)));
}

export function addDays(dayKey: string, days: number): string {
  return new Date(Date.parse(`${dayKey}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

const invalid = (detail: string): QueryError => ({ error: 'invalid_query', detail });

function rangeProblem(query: { from: string; to: string; group_by?: string }): string | null {
  const span = (Date.parse(query.to) - Date.parse(query.from)) / DAY_MS;
  if (span < 0) return 'to est antérieur à from';
  if (span > MAX_SPAN_DAYS) return `plage de ${MAX_SPAN_DAYS} jours au plus`;
  if (query.group_by === 'day' && span > MAX_DAY_GROUP_SPAN_DAYS) {
    return `regroupement par jour sur ${MAX_DAY_GROUP_SPAN_DAYS} jours au plus`;
  }
  return null;
}

const isRealDay = (value: string) => {
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
};
const DateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealDay, 'date inexistante');
const WeekdaySchema = z.number().int().min(0).max(6);
const enumOf = (values: readonly string[]) => z.enum(values as [string, ...string[]]);
// Valeurs fermées d'une dimension : texte, nombre ou booléen, chacun exact.
const literalUnion = (values: readonly Scalar[]) =>
  z.union(
    values.map((value) => z.literal(value as string | number | boolean)) as unknown as [
      z.ZodLiteral,
      z.ZodLiteral,
      ...z.ZodLiteral[],
    ],
  );

// Un schéma par source, à partir de sa fiche : seuls les champs de la fiche sont acceptés.
function sourceSchema(name: string, source: Source) {
  const dates = Object.keys(source.dates);
  const filters: Record<string, z.ZodType> = { weekdays: z.array(WeekdaySchema).optional() };
  if (source.states) filters.states = z.array(enumOf(source.states.values)).optional();
  for (const [filterName, filter] of Object.entries(filtersOf(source))) {
    const values = source.dimensions[filter.dimension].values ?? [];
    filters[filterName] =
      filter.kind === 'flag' ? z.boolean().optional() : z.array(literalUnion(values)).optional();
  }
  return z
    .object({
      entity: z.literal(name),
      metric: enumOf(Object.keys(source.measures)),
      date_field: dates.length > 1 ? enumOf(dates) : z.literal(dates[0]).optional(),
      group_by: enumOf([...TIME_GROUPS, ...Object.keys(source.dimensions)]).optional(),
      filters: z.object(filters).strict().optional(),
      from: DateSchema,
      to: DateSchema,
    })
    .strict();
}

const QuerySchema = z.discriminatedUnion(
  'entity',
  Object.entries(SOURCES).map(([name, source]) => sourceSchema(name, source)) as unknown as [
    z.ZodObject,
    z.ZodObject,
    ...z.ZodObject[],
  ],
);

/** Requête validée : la forme commune à toutes les sources, précisée par la fiche. */
interface ParsedQuery {
  entity: string;
  metric: string;
  date_field?: string;
  group_by?: string;
  filters?: Record<string, unknown>;
  from: string;
  to: string;
}

export interface QueryGroup {
  key: string | number;
  value: number | null;
}
export interface QueryResult {
  query: unknown;
  total: number | null;
  groups?: QueryGroup[];
}
/** Source indisponible pour ce restaurant : le modèle le dit, sans annoncer zéro. */
export interface QueryUnavailable {
  unavailable: 'plan' | 'disabled';
}
export interface QueryError {
  error: 'invalid_query';
  detail: string;
}

const roundTo = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

function measureValue(measure: Measure, group: Item[]): number | null {
  if (measure.kind === 'count') return group.length;
  const values = group.map((item) => item.fields[measure.field as string]);
  const decimals = measure.decimals ?? 0;
  if (measure.kind === 'sum') {
    return roundTo(
      values.reduce<number>((sum, value) => sum + Number(value ?? 0), 0),
      decimals,
    );
  }
  const present = values.filter((value) => value !== null && value !== undefined).map(Number);
  if (present.length === 0) return null;
  return roundTo(present.reduce((sum, value) => sum + value, 0) / present.length, decimals);
}

function timeKey(groupBy: 'day' | 'weekday' | 'hour', at: Date): string | number {
  const parts = parisParts(at);
  if (groupBy === 'day') return parts.dayKey;
  if (groupBy === 'hour') return parts.hour;
  return WEEKDAY_NAMES[parts.weekday];
}

const ascending = (a: Scalar, b: Scalar) =>
  (a as string | number) < (b as string | number)
    ? -1
    : (a as string | number) > (b as string | number)
      ? 1
      : 0;

interface Group {
  key: Scalar;
  value: number | null;
}

function compareGroups(groupBy: string, order: 'key' | 'value' | undefined, a: Group, b: Group) {
  if (groupBy === 'weekday') return WEEKDAY_RANK[String(a.key)] - WEEKDAY_RANK[String(b.key)];
  if (groupBy === 'day' || groupBy === 'hour' || order === 'key') return ascending(a.key, b.key);
  return (b.value ?? 0) - (a.value ?? 0);
}

// Totaux d'un ensemble, puis un groupe par clé (ordre de la fiche, sinon décroissant).
function summarize(
  items: Item[],
  groupBy: string | undefined,
  dimension: { labels?: Record<string, string>; order?: 'key' | 'value' } | undefined,
  value: (group: Item[]) => number | null,
  keyOf: (item: Item) => Scalar,
): Pick<QueryResult, 'total' | 'groups'> {
  const total = value(items);
  if (!groupBy) return { total };
  const buckets = new Map<Scalar, Item[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  const groups: Group[] = [...buckets].map(([key, bucket]) => ({ key, value: value(bucket) }));
  groups.sort((a, b) => compareGroups(groupBy, dimension?.order, a, b));
  return {
    total,
    groups: groups.map(({ key, value: groupValue }) => ({
      key: (dimension?.labels?.[String(key)] ?? key) as string | number,
      value: groupValue,
    })),
  };
}

/**
 * Valide la requête du modèle, puis la calcule. Une requête invalide renvoie { error } au modèle :
 * elle ne lève jamais d'exception.
 */
export async function computeQueryData(
  restaurantId: string,
  input: unknown,
): Promise<QueryResult | QueryUnavailable | QueryError> {
  const parsed = QuerySchema.safeParse(input);
  if (!parsed.success) {
    return invalid(
      parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'requête'} : ${issue.message}`)
        .join(' ; '),
    );
  }
  // Le schéma des sources est construit à l'exécution : sa forme commune est celle de ParsedQuery.
  const query = parsed.data as unknown as ParsedQuery;
  const problem = rangeProblem(query);
  if (problem) return invalid(problem);

  const source = SOURCES[query.entity as keyof typeof SOURCES] as Source;
  if (source.formula && !(await evaluateCapability(restaurantId, source.formula)).allowed) {
    return { unavailable: 'plan' };
  }
  try {
    await source.guard?.(restaurantId);
  } catch (error) {
    if (error instanceof WaitingListDisabledError) return { unavailable: 'disabled' };
    throw error;
  }

  const filters = Object.fromEntries(
    Object.entries((query.filters ?? {}) as Record<string, unknown>).filter(
      ([, value]) => value !== undefined,
    ),
  );
  const dateField = query.date_field ?? Object.keys(source.dates)[0];
  const groupBy = query.group_by;
  const dimension =
    groupBy && !TIME_GROUPS.some((time) => time === groupBy)
      ? source.dimensions[groupBy]
      : undefined;

  // Les horaires ne se lisent que si une dimension ou un filtre les demande.
  const specs = filtersOf(source);
  const hoursDimension = [groupBy, ...Object.keys(filters).map((name) => specs[name]?.dimension)]
    .map((name) => (name ? source.dimensions[name] : undefined))
    .find((dim) => dim?.requiresHours);
  let openingHours: unknown;
  if (hoursDimension) {
    const restaurant = await db.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { openingHours: true },
    });
    if (normalizeOpeningHours(restaurant.openingHours).length === 0) {
      return invalid(`horaires d’ouverture absents : ${hoursDimension.label} non calculable`);
    }
    openingHours = restaurant.openingHours;
  }

  const states = source.states
    ? ((filters.states ?? filters.state ?? [...source.states.default]) as string[])
    : [];
  const range = { gte: parisMidnight(query.from), lt: parisMidnight(addDays(query.to, 1)) };
  const items = await source.read({ restaurantId, dateField, range, states, openingHours });

  const matches = (item: Item): boolean =>
    Object.entries(filters).every(([name, value]) => {
      if (name === 'states') return true;
      if (name === 'weekdays') {
        return (value as number[]).includes(parisParts(item.dates[dateField]).weekday);
      }
      const filter = specs[name];
      const key = source.dimensions[filter.dimension].key(item);
      return filter.kind === 'flag' ? key === value : (value as Scalar[]).includes(key);
    });
  const kept = items.filter(matches);

  const keyOf = (item: Item): Scalar => {
    if (!groupBy) return null;
    if (TIME_GROUPS.some((time) => time === groupBy)) {
      return timeKey(groupBy as 'day' | 'weekday' | 'hour', item.dates[dateField]);
    }
    return dimension?.key(item) ?? null;
  };

  return {
    query: {
      ...query,
      date_field: dateField,
      filters: { ...filters, ...(source.states ? { states } : {}) },
    },
    ...summarize(
      kept,
      groupBy,
      dimension,
      (group) => measureValue(source.measures[query.metric], group),
      keyOf,
    ),
  };
}

const unique = (values: readonly string[]) => [...new Set(values)];
const sources = Object.entries(SOURCES) as Array<[string, Source]>;

/** Description de query_data, générée depuis le catalogue. */
export function queryDataDescription(): string {
  const measures = sources
    .map(
      ([name, source]) =>
        `${name} : ${Object.entries(source.measures)
          .map(([metric, spec]) => `${metric} = ${spec.definition}`)
          .join(' ; ')}`,
    )
    .join(' ; ');
  const dates = sources
    .filter(([, source]) => Object.keys(source.dates).length > 1)
    .map(
      ([name, source]) =>
        `${name} : ${Object.entries(source.dates)
          .map(([key, label]) => `${key} = ${label}`)
          .join(' ; ')}`,
    )
    .join(' ; ');
  const dimensions = sources
    .map(
      ([name, source]) =>
        `pour ${name}, ${Object.entries(source.dimensions)
          .map(([key, spec]) => `${key} (${spec.label})`)
          .join(', ')}`,
    )
    .join(' ; ');
  const filterNames = sources
    .flatMap(([, source]) => Object.keys(filtersOf(source)))
    .concat(sources.some(([, source]) => source.states) ? ['states'] : [], ['weekdays']);
  const stateNotes = sources.flatMap(([, source]) => (source.states ? [source.states.note] : []));
  return [
    `Requête sur une source du restaurant (entity) : le serveur calcule et ne renvoie que des totaux. Sources : ${sources.map(([name, source]) => `${name} = ${source.description}`).join(' ; ')}.`,
    `Mesures — ${measures}.`,
    `date_field (obligatoire si la source a plusieurs dates ; sinon la date unique) : ${dates}.`,
    `Regroupements (group_by, facultatif) : day (AAAA-MM-JJ), weekday (lundi à dimanche), hour (heure de début, 0 à 23) ; ${dimensions}.`,
    `Filtres (facultatifs) : ${unique(filterNames).join(', ')} (weekdays : 0 = dimanche … 6 = samedi).`,
    ...stateNotes,
    `from et to : AAAA-MM-JJ, premier et dernier jour inclus, jours de Paris ; écart ≤ ${MAX_SPAN_DAYS} jours ; regroupement par jour ≤ ${MAX_DAY_GROUP_SPAN_DAYS} jours.`,
  ].join(' ');
}

/** Périmètre du prompt, généré depuis le catalogue ; une source indisponible ne doit jamais valoir zéro. */
export function queryScope(): string {
  return sources
    .map(
      ([, source]) =>
        source.description +
        (source.formula
          ? ' (si la réponse est unavailable « plan » : « non inclus dans votre formule », sans annoncer zéro)'
          : '') +
        (source.guard
          ? ' (si la réponse est unavailable « disabled » : « non activée pour ce restaurant », sans annoncer zéro)'
          : ''),
    )
    .join(', ');
}

/** Paramètres JSON de query_data, générés depuis le catalogue. */
export function queryDataParameters() {
  const filterProperties: Record<string, unknown> = {
    weekdays: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 } },
  };
  if (sources.some(([, source]) => source.states)) {
    filterProperties.states = {
      type: 'array',
      items: { type: 'string', enum: [...RESERVATION_STATES] },
    };
  }
  for (const [, source] of sources) {
    for (const [name, filter] of Object.entries(filtersOf(source))) {
      const values = source.dimensions[filter.dimension].values ?? [];
      filterProperties[name] =
        filter.kind === 'flag'
          ? { type: 'boolean' }
          : {
              type: 'array',
              items: { type: typeof values[0] === 'number' ? 'integer' : 'string', enum: values },
            };
    }
  }
  return {
    type: 'object',
    properties: {
      entity: { type: 'string', enum: sources.map(([name]) => name) },
      metric: {
        type: 'string',
        enum: unique(sources.flatMap(([, source]) => Object.keys(source.measures))),
      },
      date_field: {
        type: 'string',
        enum: unique(sources.flatMap(([, source]) => Object.keys(source.dates))),
      },
      group_by: {
        type: 'string',
        enum: unique([
          ...TIME_GROUPS,
          ...sources.flatMap(([, source]) => Object.keys(source.dimensions)),
        ]),
      },
      filters: { type: 'object', properties: filterProperties, additionalProperties: false },
      from: { type: 'string', description: 'Premier jour inclus, AAAA-MM-JJ (heure de Paris).' },
      to: { type: 'string', description: 'Dernier jour inclus, AAAA-MM-JJ (heure de Paris).' },
    },
    required: ['entity', 'metric', 'from', 'to'],
    additionalProperties: false,
  };
}
