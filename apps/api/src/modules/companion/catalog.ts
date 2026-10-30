/**
 * Catalogue des sources que le Companion lit : une fiche par source. Le moteur (query-data.ts)
 * valide, calcule et décrit chaque requête à partir de ces fiches : ajouter une source, c'est ajouter
 * une fiche. Chaque lecture ne sélectionne que les champs listés dans `select`.
 */
import type { EntitlementCapability } from '@sokar/config';
import type { ReservationState } from '@prisma/client';
import { db } from '../../shared/db/client';
import { COUNTED_RESERVATION_STATES } from '../../shared/reservations/reservation-state';
import { WaitingListDisabledError } from '../agentic-reservations/core/waiting-list.errors';
import { isWithinOpeningHours } from '../calls/call-stats';
import {
  RESERVATION_CHANNEL_GROUPS,
  reservationChannelGroup,
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
export const WAITLIST_STATUSES = ['PENDING', 'PROMOTED', 'CANCELLED', 'EXPIRED'] as const;
export const RECOVERY_VALUES = ['none', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED'] as const;

export type Scalar = string | number | boolean | null;

/** Un élément lu : ses dates et les valeurs utiles, sans donnée personnelle. */
export interface Item {
  dates: Record<string, Date>;
  fields: Record<string, Scalar>;
}

export interface Measure {
  label: string;
  definition: string;
  /** count : nombre d'éléments. sum ou avg : somme ou moyenne du champ `field` (nulls ignorés en moyenne). */
  kind: 'count' | 'sum' | 'avg';
  field?: string;
  /** Décimales du résultat : 0 par défaut. */
  decimals?: number;
}

export interface Dimension {
  label: string;
  /** Valeur de regroupement et de filtre, dérivée de l'élément. */
  key: (item: Item) => Scalar;
  /** Valeurs possibles, pour la validation des filtres. */
  values?: readonly Scalar[];
  /** Libellés affichés à la place d'une clé. */
  labels?: Record<string, string>;
  /** Ordre des groupes : par clé croissante, ou par valeur décroissante (défaut). */
  order?: 'key' | 'value';
  /** Ne se calcule qu'avec les horaires d'ouverture du restaurant. */
  requiresHours?: boolean;
}

export interface Filter {
  dimension: string;
  /** list : une liste de valeurs ; flag : vrai ou faux. */
  kind: 'list' | 'flag';
}

export interface ReadArgs {
  restaurantId: string;
  dateField: string;
  range: { gte: Date; lt: Date };
  /** États valables pour la lecture (sources avec `states` seulement). */
  states: readonly string[];
  /** Horaires d'ouverture bruts, seulement si la requête en a besoin. */
  openingHours?: unknown;
}

export interface Source {
  label: string;
  /** Décrit la source pour le modèle, dans la description de query_data et dans le périmètre. */
  description: string;
  /** Champs lus : fermés, jamais de nom, téléphone, e-mail, note ni demande spéciale. */
  select: object;
  /** Dates possibles, avec leur sens pour le modèle. */
  dates: Readonly<Record<string, string>>;
  /** États valables par défaut, et le texte qui le dit au modèle. */
  states?: { values: readonly string[]; default: readonly string[]; note: string };
  /** Droit de formule requis : sans lui, la réponse est { unavailable: 'plan' }. */
  formula?: EntitlementCapability;
  /** Garde-fou : lève WaitingListDisabledError si la source est désactivée pour le restaurant. */
  guard?: (restaurantId: string) => Promise<void>;
  measures: Readonly<Record<string, Measure>>;
  dimensions: Readonly<Record<string, Dimension>>;
  filters: Readonly<Record<string, Filter>>;
  read: (args: ReadArgs) => Promise<Item[]>;
}

const RESERVATION_SELECT = {
  reservedAt: true,
  createdAt: true,
  state: true,
  channel: true,
  source: true,
  partySize: true,
  estimatedRevenue: true,
  confirmedRevenue: true,
} as const;

const CALL_SELECT = {
  createdAt: true,
  intent: true,
  outcome: true,
  durationSec: true,
} as const;

const WAITLIST_SELECT = {
  slotStart: true,
  createdAt: true,
  status: true,
  partySize: true,
} as const;

const FEEDBACK_SELECT = {
  submittedAt: true,
  score: true,
  recoveryTask: { select: { status: true } },
} as const;

export const SOURCES = {
  reservations: {
    label: 'Réservations',
    description: 'les réservations prises pendant une période',
    select: RESERVATION_SELECT,
    dates: {
      service: 'jour du repas (date prévue de la réservation)',
      created: 'jour où la réservation a été prise',
    },
    states: {
      values: RESERVATION_STATES,
      default: COUNTED_RESERVATION_STATES,
      note: 'Sans filters.states, seules les réservations confirmées, installées ou honorées comptent : les annulées, les no-shows, celles en attente, échouées ou expirées sont exclues.',
    },
    measures: {
      count: { label: 'réservations', definition: 'nombre de réservations', kind: 'count' },
      covers: {
        label: 'couverts',
        definition: 'couverts (somme des tailles de groupe)',
        kind: 'sum',
        field: 'partySize',
      },
      estimated_revenue: {
        label: 'CA',
        definition: 'CA estimé en euros (montant confirmé s’il existe, sinon estimé)',
        kind: 'sum',
        field: 'revenue',
      },
    },
    dimensions: {
      channel: {
        label:
          'par où arrivent les clients : phone = téléphone, website = site du restaurant, google, ai = assistants IA, team = saisie par l’équipe',
        key: (item) => item.fields.channel,
        values: RESERVATION_CHANNEL_GROUPS,
      },
      state: {
        label: 'état de la réservation',
        key: (item) => item.fields.state,
        values: RESERVATION_STATES,
      },
      party_size: {
        label: 'taille du groupe',
        key: (item) => item.fields.partySize,
      },
    },
    filters: {
      channels: { dimension: 'channel', kind: 'list' },
    },
    read: async ({ restaurantId, dateField, range, states }) => {
      const rows = await db.reservation.findMany({
        where: {
          restaurantId,
          // Réservations de test du dashboard : jamais lues par le Companion.
          isTest: false,
          state: { in: states as ReservationState[] },
          ...(dateField === 'service' ? { reservedAt: range } : { createdAt: range }),
        },
        select: RESERVATION_SELECT,
      });
      return rows.map((row) => ({
        dates: { service: row.reservedAt, created: row.createdAt },
        fields: {
          state: row.state,
          channel: reservationChannelGroup(row),
          partySize: row.partySize,
          revenue: Number(row.confirmedRevenue ?? row.estimatedRevenue ?? 0),
        },
      }));
    },
  },

  calls: {
    label: 'Appels',
    description:
      'les appels reçus par l’assistant téléphonique (intention, résultat, hors horaires, durée moyenne)',
    select: CALL_SELECT,
    dates: { created: 'jour de l’appel' },
    measures: {
      count: { label: 'appels', definition: 'nombre d’appels', kind: 'count' },
      avg_duration_sec: {
        label: 'durée',
        definition: 'durée moyenne en secondes des appels qui ont une durée (null sinon)',
        kind: 'avg',
        field: 'durationSec',
      },
    },
    dimensions: {
      intent: {
        label: 'intention',
        key: (item) => item.fields.intent ?? 'unknown',
        values: CALL_INTENTS,
      },
      outcome: {
        label: 'résultat (unfinished = appel non terminé)',
        key: (item) => item.fields.outcome ?? 'unfinished',
        values: CALL_OUTCOMES,
      },
      after_hours: {
        label: 'hors horaires d’ouverture',
        key: (item) => item.fields.afterHours,
        values: [true, false],
        labels: { true: 'hors horaires', false: 'pendant les horaires' },
        requiresHours: true,
      },
    },
    filters: {
      intents: { dimension: 'intent', kind: 'list' },
      outcomes: { dimension: 'outcome', kind: 'list' },
      after_hours: { dimension: 'after_hours', kind: 'flag' },
    },
    read: async ({ restaurantId, range, openingHours }) => {
      const rows = await db.call.findMany({
        where: { restaurantId, createdAt: range },
        select: CALL_SELECT,
      });
      return rows.map((row) => ({
        dates: { created: row.createdAt },
        fields: {
          intent: row.intent,
          outcome: row.outcome,
          durationSec: row.durationSec,
          afterHours:
            openingHours === undefined ? null : !isWithinOpeningHours(row.createdAt, openingHours),
        },
      }));
    },
  },
  waitlist: {
    label: 'Liste d’attente',
    description: 'la liste d’attente (demandes en attente, obtenues, annulées ou expirées)',
    select: WAITLIST_SELECT,
    dates: {
      service: 'créneau demandé (service)',
      created: 'jour où la demande a été faite',
    },
    measures: {
      count: {
        label: 'demandes',
        definition: 'nombre de demandes en liste d’attente',
        kind: 'count',
      },
      covers: {
        label: 'couverts',
        definition: 'couverts demandés (somme des tailles de groupe)',
        kind: 'sum',
        field: 'partySize',
      },
    },
    dimensions: {
      status: {
        label:
          'statut (PROMOTED = a obtenu une table, PENDING = en attente, CANCELLED = annulée, EXPIRED = expirée)',
        key: (item) => item.fields.status,
        values: WAITLIST_STATUSES,
      },
      party_size: {
        label: 'taille du groupe',
        key: (item) => item.fields.partySize,
      },
    },
    filters: {},
    guard: async (restaurantId) => {
      const settings = await db.restaurantExposureSettings.findUnique({
        where: { restaurantId },
        select: { capacitySpecials: true },
      });
      const specials = (settings?.capacitySpecials ?? {}) as Record<string, unknown>;
      if (specials.waitingListEnabled !== true) throw new WaitingListDisabledError();
    },
    read: async ({ restaurantId, dateField, range }) => {
      const rows = await db.waitingListEntry.findMany({
        where: {
          restaurantId,
          ...(dateField === 'service' ? { slotStart: range } : { createdAt: range }),
        },
        select: WAITLIST_SELECT,
      });
      return rows.map((row) => ({
        dates: { service: row.slotStart, created: row.createdAt },
        fields: { status: row.status, partySize: row.partySize },
      }));
    },
  },

  feedback: {
    label: 'Avis clients',
    description: 'les avis clients après le repas (note de 1 à 5 et suivi des avis faibles)',
    select: FEEDBACK_SELECT,
    dates: { submitted: 'jour où l’avis a été envoyé' },
    formula: 'reputation.feedback',
    measures: {
      count: { label: 'avis', definition: 'nombre d’avis', kind: 'count' },
      avg_score: {
        label: 'note moyenne',
        definition: 'note moyenne de 1 à 5, arrondie à 0,1',
        kind: 'avg',
        field: 'score',
        decimals: 1,
      },
    },
    dimensions: {
      score: {
        label: 'note de 1 à 5',
        key: (item) => item.fields.score,
        values: [1, 2, 3, 4, 5],
        order: 'key',
      },
      recovery: {
        label:
          'suivi (none = pas de tâche de récupération, sinon son statut : OPEN, IN_PROGRESS, RESOLVED, DISMISSED)',
        key: (item) => item.fields.recovery,
        values: RECOVERY_VALUES,
      },
    },
    filters: {},
    read: async ({ restaurantId, range }) => {
      const rows = await db.reputationFeedback.findMany({
        where: { restaurantId, submittedAt: range },
        select: FEEDBACK_SELECT,
      });
      return rows.map((row) => ({
        dates: { submitted: row.submittedAt },
        fields: { score: row.score, recovery: row.recoveryTask?.status ?? 'none' },
      }));
    },
  },
} satisfies Record<string, Source>;

export type SourceName = keyof typeof SOURCES;
