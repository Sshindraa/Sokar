/**
 * Requête unique du Companion (outil query_data) : le modèle compose une requête, le serveur la valide,
 * la borne au restaurant, calcule et ne renvoie que des totaux. Les champs lus sont fixés ici : jamais
 * de nom, téléphone, e-mail, note ni transcription.
 */
import { normalizeOpeningHours } from '@sokar/shared';
import { z } from 'zod';
import { db } from '../../shared/db/client';
import { COUNTED_RESERVATION_STATES } from '../../shared/reservations/reservation-state';
import { isWithinOpeningHours } from '../calls/call-stats';
import {
  RESERVATION_CHANNEL_GROUPS,
  reservationChannelGroup,
  type ReservationChannelGroup,
} from '../dashboard/reservation-channels';

export const RESERVATION_STATES = [
  'PENDING',
  'CONFIRMED',
  'SEATED',
  'HONORED',
  'CANCELLED',
  'NO_SHOW',
  'FAILED',
  'EXPIRED',
] as const;
export const CALL_INTENTS = ['RESERVATION', 'HOURS', 'MENU', 'CANCEL', 'OTHER'] as const;
export const CALL_OUTCOMES = [
  'RESERVED',
  'INFO',
  'MESSAGE',
  'NO_ACTION',
  'HANDOFF',
  'ERROR',
  'unfinished',
] as const;

const DAY_MS = 86_400_000;
const MAX_SPAN_DAYS = 400;
const MAX_DAY_GROUP_SPAN_DAYS = 62;

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

const isRealDay = (value: string) => {
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
};
const DateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealDay, 'date inexistante');
const WeekdaySchema = z.number().int().min(0).max(6);

const reservationsQuery = z
  .object({
    entity: z.literal('reservations'),
    metric: z.enum(['count', 'covers', 'estimated_revenue']),
    date_field: z.enum(['service', 'created']),
    group_by: z.enum(['day', 'weekday', 'hour', 'channel', 'state', 'party_size']).optional(),
    filters: z
      .object({
        states: z.array(z.enum(RESERVATION_STATES)).optional(),
        channels: z.array(z.enum(RESERVATION_CHANNEL_GROUPS)).optional(),
        weekdays: z.array(WeekdaySchema).optional(),
      })
      .strict()
      .optional(),
    from: DateSchema,
    to: DateSchema,
  })
  .strict();

const callsQuery = z
  .object({
    entity: z.literal('calls'),
    metric: z.enum(['count', 'avg_duration_sec']),
    date_field: z.literal('created').optional(),
    group_by: z.enum(['day', 'weekday', 'hour', 'intent', 'outcome', 'after_hours']).optional(),
    filters: z
      .object({
        intents: z.array(z.enum(CALL_INTENTS)).optional(),
        outcomes: z.array(z.enum(CALL_OUTCOMES)).optional(),
        after_hours: z.boolean().optional(),
        weekdays: z.array(WeekdaySchema).optional(),
      })
      .strict()
      .optional(),
    from: DateSchema,
    to: DateSchema,
  })
  .strict();

export const QuerySchema = z.discriminatedUnion('entity', [reservationsQuery, callsQuery]);
type ReservationsQuery = z.infer<typeof reservationsQuery>;
type CallsQuery = z.infer<typeof callsQuery>;

export interface QueryGroup {
  key: string | number;
  value: number | null;
}
export interface QueryResult {
  query: unknown;
  total: number | null;
  groups?: QueryGroup[];
}
export interface QueryError {
  error: 'invalid_query';
  detail: string;
}

interface DateRange {
  gte: Date;
  lt: Date;
}

const invalid = (detail: string): QueryError => ({ error: 'invalid_query', detail });

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
function parisParts(date: Date) {
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

function addDays(dayKey: string, days: number): string {
  return new Date(Date.parse(`${dayKey}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function matchesWeekdays(at: Date, weekdays: number[] | undefined): boolean {
  return !weekdays || weekdays.includes(parisParts(at).weekday);
}

function rangeProblem(query: { from: string; to: string; group_by?: string }): string | null {
  const span = (Date.parse(query.to) - Date.parse(query.from)) / DAY_MS;
  if (span < 0) return 'to est antérieur à from';
  if (span > MAX_SPAN_DAYS) return `plage de ${MAX_SPAN_DAYS} jours au plus`;
  if (query.group_by === 'day' && span > MAX_DAY_GROUP_SPAN_DAYS) {
    return `regroupement par jour sur ${MAX_DAY_GROUP_SPAN_DAYS} jours au plus`;
  }
  return null;
}

function timeKey(groupBy: string, at: Date): string | number {
  const parts = parisParts(at);
  if (groupBy === 'day') return parts.dayKey;
  if (groupBy === 'hour') return parts.hour;
  return WEEKDAY_NAMES[parts.weekday];
}

function compareGroups(groupBy: string, a: QueryGroup, b: QueryGroup): number {
  if (groupBy === 'day') return String(a.key) < String(b.key) ? -1 : 1;
  if (groupBy === 'hour') return Number(a.key) - Number(b.key);
  if (groupBy === 'weekday') return WEEKDAY_RANK[String(a.key)] - WEEKDAY_RANK[String(b.key)];
  return (b.value ?? 0) - (a.value ?? 0);
}

// Totaux d'un ensemble, puis un groupe par clé (ordre naturel, sinon décroissant).
function summarize<T>(
  items: T[],
  groupBy: string | undefined,
  value: (group: T[]) => number | null,
  keyOf: (item: T) => string | number,
): { total: number | null; groups?: QueryGroup[] } {
  const total = value(items);
  if (!groupBy) return { total };
  const buckets = new Map<string | number, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  const groups = [...buckets].map(([key, bucket]) => ({ key, value: value(bucket) }));
  groups.sort((a, b) => compareGroups(groupBy, a, b));
  return { total, groups };
}

interface ReservationItem {
  at: Date;
  state: string;
  channel: ReservationChannelGroup;
  partySize: number;
  revenue: number;
}

async function runReservations(
  restaurantId: string,
  query: ReservationsQuery,
  range: DateRange,
): Promise<QueryResult> {
  const states = query.filters?.states ?? [...COUNTED_RESERVATION_STATES];
  const rows = await db.reservation.findMany({
    where: {
      restaurantId,
      state: { in: states },
      ...(query.date_field === 'service' ? { reservedAt: range } : { createdAt: range }),
    },
    select: {
      reservedAt: true,
      createdAt: true,
      state: true,
      channel: true,
      source: true,
      partySize: true,
      estimatedRevenue: true,
      confirmedRevenue: true,
    },
  });
  const channels = query.filters?.channels;
  const items: ReservationItem[] = rows
    .map((row) => ({
      at: query.date_field === 'service' ? row.reservedAt : row.createdAt,
      state: row.state,
      channel: reservationChannelGroup(row),
      partySize: row.partySize,
      revenue: Number(row.confirmedRevenue ?? row.estimatedRevenue ?? 0),
    }))
    .filter(
      (item) =>
        (!channels || channels.includes(item.channel)) &&
        matchesWeekdays(item.at, query.filters?.weekdays),
    );

  const value = (group: ReservationItem[]): number => {
    if (query.metric === 'count') return group.length;
    if (query.metric === 'covers') return group.reduce((sum, item) => sum + item.partySize, 0);
    return Math.round(group.reduce((sum, item) => sum + item.revenue, 0));
  };
  const keyOf = (item: ReservationItem): string | number => {
    if (query.group_by === 'channel') return item.channel;
    if (query.group_by === 'state') return item.state;
    if (query.group_by === 'party_size') return item.partySize;
    return timeKey(query.group_by ?? 'day', item.at);
  };

  return {
    query: {
      ...query,
      filters: { states, channels: query.filters?.channels, weekdays: query.filters?.weekdays },
    },
    ...summarize(items, query.group_by, value, keyOf),
  };
}

interface CallItem {
  at: Date;
  intent: (typeof CALL_INTENTS)[number] | null;
  outcome: (typeof CALL_OUTCOMES)[number] | null;
  durationSec: number | null;
  afterHours: boolean | null;
}

async function runCalls(
  restaurantId: string,
  query: CallsQuery,
  range: DateRange,
): Promise<QueryResult | QueryError> {
  const restaurant = await db.restaurant.findUniqueOrThrow({
    where: { id: restaurantId },
    select: { openingHours: true },
  });
  const hasHours = normalizeOpeningHours(restaurant.openingHours).length > 0;
  const needsHours = query.group_by === 'after_hours' || query.filters?.after_hours !== undefined;
  if (needsHours && !hasHours) {
    return invalid('horaires d’ouverture absents : hors horaires non calculable');
  }

  const rows = await db.call.findMany({
    where: { restaurantId, createdAt: range },
    select: { createdAt: true, intent: true, outcome: true, durationSec: true },
  });
  const filters = query.filters;
  const items: CallItem[] = rows
    .map((row) => ({
      at: row.createdAt,
      intent: row.intent,
      outcome: row.outcome,
      durationSec: row.durationSec,
      afterHours: hasHours ? !isWithinOpeningHours(row.createdAt, restaurant.openingHours) : null,
    }))
    .filter(
      (item) =>
        (!filters?.intents || (item.intent !== null && filters.intents.includes(item.intent))) &&
        (!filters?.outcomes || filters.outcomes.includes(item.outcome ?? 'unfinished')) &&
        (filters?.after_hours === undefined || item.afterHours === filters.after_hours) &&
        matchesWeekdays(item.at, filters?.weekdays),
    );

  const value = (group: CallItem[]): number | null => {
    if (query.metric === 'count') return group.length;
    const durations = group.flatMap((item) =>
      item.durationSec === null ? [] : [item.durationSec],
    );
    if (durations.length === 0) return null;
    return Math.round(durations.reduce((sum, seconds) => sum + seconds, 0) / durations.length);
  };
  const keyOf = (item: CallItem): string | number => {
    if (query.group_by === 'intent') return item.intent ?? 'unknown';
    if (query.group_by === 'outcome') return item.outcome ?? 'unfinished';
    if (query.group_by === 'after_hours') {
      return item.afterHours ? 'hors horaires' : 'pendant les horaires';
    }
    return timeKey(query.group_by ?? 'day', item.at);
  };

  return {
    query: { ...query, date_field: 'created', filters: filters ?? {} },
    ...summarize(items, query.group_by, value, keyOf),
  };
}

/**
 * Valide la requête du modèle, puis la calcule. Une requête invalide renvoie { error } au modèle :
 * elle ne lève jamais d'exception.
 */
export async function computeQueryData(
  restaurantId: string,
  input: unknown,
): Promise<QueryResult | QueryError> {
  const parsed = QuerySchema.safeParse(input);
  if (!parsed.success) {
    return invalid(
      parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'requête'} : ${issue.message}`)
        .join(' ; '),
    );
  }
  const query = parsed.data;
  const problem = rangeProblem(query);
  if (problem) return invalid(problem);

  const range = { gte: parisMidnight(query.from), lt: parisMidnight(addDays(query.to, 1)) };
  return query.entity === 'reservations'
    ? runReservations(restaurantId, query, range)
    : runCalls(restaurantId, query, range);
}
