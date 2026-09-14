import { createHash, randomBytes } from 'node:crypto';
import {
  EventOrderStatus,
  EventSessionStatus,
  EventStatus,
  EventTicketStatus,
  EventTicketTypeStatus,
  EventWaitlistStatus,
  Prisma,
} from '@prisma/client';
import { db } from '../../shared/db/client';

const EVENT_KEY_PATTERN = /^[a-z][a-z0-9_.-]{1,63}$/;
const TICKET_TYPE_KEY_PATTERN = /^[a-z][a-z0-9_.-]{1,47}$/;
const ACTOR_HASH_PREFIX = 'sokar:event-actor:';
const IDEMPOTENCY_HASH_PREFIX = 'sokar:event-idempotency:';
const WAITLIST_IDEMPOTENCY_PREFIX = 'sokar:event-waitlist-idempotency:';
const REFUND_IDEMPOTENCY_PREFIX = 'sokar:event-refund-idempotency:';
const TICKET_CODE_PREFIX = 'sokar:event-ticket:';
const MAX_LIST_LIMIT = 100;
const MAX_EXPIRY_SCAN = 1_000;

const EVENT_SELECT = {
  id: true,
  restaurantId: true,
  key: true,
  name: true,
  description: true,
  timezone: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { sessions: true, ticketTypes: true, orders: true, waitlistEntries: true } },
} as const;

const SESSION_SELECT = {
  id: true,
  restaurantId: true,
  eventId: true,
  startsAt: true,
  endsAt: true,
  capacity: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  event: { select: { key: true, name: true, status: true } },
  _count: { select: { orders: true, tickets: true, waitlistEntries: true } },
} as const;

const TICKET_TYPE_SELECT = {
  id: true,
  restaurantId: true,
  eventId: true,
  key: true,
  name: true,
  priceCents: true,
  currency: true,
  maxPerOrder: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { orders: true, tickets: true } },
} as const;

const ORDER_SELECT = {
  id: true,
  restaurantId: true,
  eventId: true,
  sessionId: true,
  ticketTypeId: true,
  customerId: true,
  reservationId: true,
  idempotencyKey: true,
  quantity: true,
  unitPriceCents: true,
  totalPriceCents: true,
  currency: true,
  status: true,
  invoiceNumber: true,
  invoicedAt: true,
  refundReason: true,
  refundedAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  event: { select: { key: true, name: true } },
  session: { select: { startsAt: true, endsAt: true } },
  ticketType: { select: { key: true, name: true, priceCents: true, currency: true } },
  customer: { select: { name: true, phone: true } },
  _count: { select: { tickets: true } },
} as const;

const TICKET_SELECT = {
  id: true,
  restaurantId: true,
  eventId: true,
  sessionId: true,
  orderId: true,
  ticketTypeId: true,
  codeLast4: true,
  status: true,
  checkedInAt: true,
  createdAt: true,
  updatedAt: true,
  event: { select: { key: true, name: true } },
  session: { select: { startsAt: true, endsAt: true } },
  ticketType: { select: { key: true, name: true } },
  order: { select: { customer: { select: { name: true, phone: true } } } },
} as const;

const WAITLIST_SELECT = {
  id: true,
  restaurantId: true,
  eventId: true,
  sessionId: true,
  customerId: true,
  quantity: true,
  idempotencyKey: true,
  status: true,
  promotedAt: true,
  createdAt: true,
  updatedAt: true,
  event: { select: { key: true, name: true } },
  session: { select: { startsAt: true, endsAt: true } },
  customer: { select: { name: true, phone: true } },
} as const;

type EventRow = Prisma.EventGetPayload<{ select: typeof EVENT_SELECT }>;
type SessionRow = Prisma.EventSessionGetPayload<{ select: typeof SESSION_SELECT }>;
type TicketTypeRow = Prisma.EventTicketTypeGetPayload<{ select: typeof TICKET_TYPE_SELECT }>;
type OrderRow = Prisma.EventOrderGetPayload<{ select: typeof ORDER_SELECT }>;
type TicketRow = Prisma.EventTicketGetPayload<{ select: typeof TICKET_SELECT }>;
type WaitlistRow = Prisma.EventWaitlistEntryGetPayload<{ select: typeof WAITLIST_SELECT }>;

export class EventInputError extends Error {
  constructor(
    readonly code:
      | 'EVENT_KEY_INVALID'
      | 'EVENT_NAME_INVALID'
      | 'EVENT_DESCRIPTION_INVALID'
      | 'EVENT_TIMEZONE_INVALID'
      | 'EVENT_SESSION_TIME_INVALID'
      | 'EVENT_SESSION_CAPACITY_INVALID'
      | 'EVENT_TICKET_TYPE_KEY_INVALID'
      | 'EVENT_TICKET_TYPE_NAME_INVALID'
      | 'EVENT_TICKET_PRICE_INVALID'
      | 'EVENT_TICKET_CURRENCY_INVALID'
      | 'EVENT_TICKET_MAX_PER_ORDER_INVALID'
      | 'EVENT_QUANTITY_INVALID'
      | 'EVENT_IDEMPOTENCY_INVALID'
      | 'EVENT_TICKET_CODE_INVALID'
      | 'EVENT_REFUND_REASON_INVALID'
      | 'EVENT_INVOICE_NUMBER_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'EventInputError';
  }
}

export class EventNotFoundError extends Error {
  readonly code = 'EVENT_NOT_FOUND';

  constructor() {
    super('Event not found');
    this.name = 'EventNotFoundError';
  }
}

export class EventSessionNotFoundError extends Error {
  readonly code = 'EVENT_SESSION_NOT_FOUND';

  constructor() {
    super('Event session not found');
    this.name = 'EventSessionNotFoundError';
  }
}

export class EventTicketTypeNotFoundError extends Error {
  readonly code = 'EVENT_TICKET_TYPE_NOT_FOUND';

  constructor() {
    super('Event ticket type not found');
    this.name = 'EventTicketTypeNotFoundError';
  }
}

export class EventOrderNotFoundError extends Error {
  readonly code = 'EVENT_ORDER_NOT_FOUND';

  constructor() {
    super('Event order not found');
    this.name = 'EventOrderNotFoundError';
  }
}

export class EventTicketNotFoundError extends Error {
  readonly code = 'EVENT_TICKET_NOT_FOUND';

  constructor() {
    super('Event ticket not found');
    this.name = 'EventTicketNotFoundError';
  }
}

export class EventWaitlistNotFoundError extends Error {
  readonly code = 'EVENT_WAITLIST_NOT_FOUND';

  constructor() {
    super('Event waitlist entry not found');
    this.name = 'EventWaitlistNotFoundError';
  }
}

export class EventCustomerNotFoundError extends Error {
  readonly code = 'EVENT_CUSTOMER_NOT_FOUND';

  constructor() {
    super('Customer not found');
    this.name = 'EventCustomerNotFoundError';
  }
}

export class EventConflictError extends Error {
  constructor(
    readonly code:
      | 'EVENT_KEY_CONFLICT'
      | 'EVENT_SESSION_CONFLICT'
      | 'EVENT_TICKET_TYPE_CONFLICT'
      | 'EVENT_CAPACITY_EXCEEDED'
      | 'EVENT_SESSION_CLOSED'
      | 'EVENT_SESSION_IN_PAST'
      | 'EVENT_NOT_ACTIVE'
      | 'EVENT_TICKET_TYPE_INACTIVE'
      | 'EVENT_IDEMPOTENCY_CONFLICT'
      | 'EVENT_RESERVATION_INVALID'
      | 'EVENT_WAITLIST_CLOSED'
      | 'EVENT_WAITLIST_ALREADY_PROMOTED',
  ) {
    super(
      code === 'EVENT_KEY_CONFLICT'
        ? 'An event with this key already exists for this restaurant'
        : code === 'EVENT_SESSION_CONFLICT'
          ? 'A session already exists at this time'
          : code === 'EVENT_TICKET_TYPE_CONFLICT'
            ? 'A ticket type with this key already exists for this event'
            : code === 'EVENT_CAPACITY_EXCEEDED'
              ? 'The requested quantity exceeds the remaining capacity'
              : code === 'EVENT_SESSION_CLOSED'
                ? 'The event session is not open'
                : code === 'EVENT_SESSION_IN_PAST'
                  ? 'The event session has already started'
                  : code === 'EVENT_NOT_ACTIVE'
                    ? 'The event is not active'
                    : code === 'EVENT_TICKET_TYPE_INACTIVE'
                      ? 'The ticket type is not active'
                      : code === 'EVENT_IDEMPOTENCY_CONFLICT'
                        ? 'The idempotency key was already used for another order'
                        : code === 'EVENT_RESERVATION_INVALID'
                          ? 'The linked reservation is not available for this order'
                          : code === 'EVENT_WAITLIST_CLOSED'
                            ? 'The event session is not accepting waitlist entries'
                            : 'The waitlist entry has already been promoted',
    );
    this.name = 'EventConflictError';
  }
}

export class EventOrderStateError extends Error {
  constructor(
    readonly code:
      | 'EVENT_ORDER_CANCELLED'
      | 'EVENT_ORDER_REFUNDED'
      | 'EVENT_ORDER_REFUND_CONFLICT'
      | 'EVENT_ORDER_INVOICE_CONFLICT',
  ) {
    super(
      code === 'EVENT_ORDER_CANCELLED'
        ? 'The event order has already been cancelled'
        : code === 'EVENT_ORDER_REFUNDED'
          ? 'The event order has already been refunded'
          : code === 'EVENT_ORDER_REFUND_CONFLICT'
            ? 'The refund idempotency key belongs to another refund'
            : 'The event order already has a different invoice',
    );
    this.name = 'EventOrderStateError';
  }
}

export class EventTicketStateError extends Error {
  constructor(readonly code: 'EVENT_TICKET_CHECKED_IN' | 'EVENT_TICKET_UNAVAILABLE') {
    super(
      code === 'EVENT_TICKET_CHECKED_IN'
        ? 'The ticket has already been checked in'
        : 'The ticket is no longer valid for admission',
    );
    this.name = 'EventTicketStateError';
  }
}

export interface EventView {
  id: string;
  restaurantId: string;
  key: string;
  name: string;
  description: string | null;
  timezone: string;
  status: EventStatus;
  sessionCount: number;
  ticketTypeCount: number;
  orderCount: number;
  waitlistCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventSessionView {
  id: string;
  restaurantId: string;
  eventId: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  status: EventSessionStatus;
  event: { key: string; name: string; status: EventStatus };
  orderCount: number;
  ticketCount: number;
  waitlistCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventTicketTypeView {
  id: string;
  restaurantId: string;
  eventId: string;
  key: string;
  name: string;
  priceCents: number;
  currency: string;
  maxPerOrder: number;
  status: EventTicketTypeStatus;
  orderCount: number;
  ticketCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventOrderView {
  id: string;
  restaurantId: string;
  eventId: string;
  sessionId: string;
  ticketTypeId: string;
  customerId: string | null;
  reservationId: string | null;
  quantity: number;
  unitPriceCents: number;
  totalPriceCents: number;
  currency: string;
  status: EventOrderStatus;
  invoiceNumber: string | null;
  invoicedAt: Date | null;
  refundReason: string | null;
  refundedAt: Date | null;
  cancelledAt: Date | null;
  event: { key: string; name: string };
  session: { startsAt: Date; endsAt: Date };
  ticketType: { key: string; name: string; priceCents: number; currency: string };
  customerName: string | null;
  phoneLast4: string | null;
  ticketCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventOrderMutationResult extends EventOrderView {
  ticketCodes: string[] | null;
  providerContacted: false;
  dryRun: true;
  replayed: boolean;
}

export interface EventTicketView {
  id: string;
  restaurantId: string;
  eventId: string;
  sessionId: string;
  orderId: string;
  ticketTypeId: string;
  codeLast4: string;
  status: EventTicketStatus;
  checkedInAt: Date | null;
  event: { key: string; name: string };
  session: { startsAt: Date; endsAt: Date };
  ticketType: { key: string; name: string };
  customerName: string | null;
  phoneLast4: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventTicketMutationResult extends EventTicketView {
  replayed: boolean;
}

export interface EventWaitlistView {
  id: string;
  restaurantId: string;
  eventId: string;
  sessionId: string;
  customerId: string | null;
  quantity: number;
  status: EventWaitlistStatus;
  promotedAt: Date | null;
  event: { key: string; name: string };
  session: { startsAt: Date; endsAt: Date };
  customerName: string | null;
  phoneLast4: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventWaitlistMutationResult extends EventWaitlistView {
  replayed: boolean;
}

function hashActor(actor: string): string {
  return createHash('sha256').update(`${ACTOR_HASH_PREFIX}${actor}`).digest('hex');
}

function hashWithPrefix(prefix: string, restaurantId: string, value: string): string {
  return createHash('sha256').update(`${prefix}${restaurantId}:${value}`).digest('hex');
}

function hashTicketCode(code: string): string {
  return createHash('sha256').update(`${TICKET_CODE_PREFIX}${code}`).digest('hex');
}

function normalizeIdempotencyKey(
  value: string | undefined,
  code = 'EVENT_IDEMPOTENCY_INVALID',
): string | undefined {
  if (value === undefined) return undefined;
  const key = value.trim();
  if (key.length < 8 || key.length > 200 || /[\u0000-\u001f\u007f]/.test(key)) {
    throw new EventInputError(
      code as 'EVENT_IDEMPOTENCY_INVALID',
      "La clé d'idempotence doit contenir entre 8 et 200 caractères sûrs.",
    );
  }
  return key;
}

function normalizeSafeText(
  value: string,
  code: 'EVENT_NAME_INVALID' | 'EVENT_DESCRIPTION_INVALID' | 'EVENT_TICKET_TYPE_NAME_INVALID',
  label: string,
  maxLength: number,
): string {
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new EventInputError(
      code,
      `${label} doit contenir entre 1 et ${maxLength} caractères sûrs.`,
    );
  }
  return text;
}

function normalizeDescription(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return normalizeSafeText(
    value,
    'EVENT_DESCRIPTION_INVALID',
    "La description de l'événement",
    2_000,
  );
}

function normalizeEventKey(value: string): string {
  const key = value.trim().toLowerCase();
  if (!EVENT_KEY_PATTERN.test(key)) {
    throw new EventInputError(
      'EVENT_KEY_INVALID',
      "La clé de l'événement doit être un identifiant technique de 2 à 64 caractères.",
    );
  }
  return key;
}

function normalizeTicketTypeKey(value: string): string {
  const key = value.trim().toLowerCase();
  if (!TICKET_TYPE_KEY_PATTERN.test(key)) {
    throw new EventInputError(
      'EVENT_TICKET_TYPE_KEY_INVALID',
      'La clé du tarif doit être un identifiant technique de 2 à 48 caractères.',
    );
  }
  return key;
}

function normalizeTimezone(value: string | undefined): string {
  const timezone = (value ?? 'Europe/Paris').trim();
  if (!timezone || timezone.length > 64 || /[\u0000-\u001f\u007f]/.test(timezone)) {
    throw new EventInputError('EVENT_TIMEZONE_INVALID', 'Le fuseau horaire est invalide.');
  }
  return timezone;
}

function normalizeDate(value: Date | string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new EventInputError('EVENT_SESSION_TIME_INVALID', 'La date de session est invalide.');
  }
  return date;
}

function normalizeCapacity(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 10_000) {
    throw new EventInputError(
      'EVENT_SESSION_CAPACITY_INVALID',
      'La jauge doit être comprise entre 1 et 10 000 personnes.',
    );
  }
  return value;
}

function normalizePrice(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 1_000_000) {
    throw new EventInputError(
      'EVENT_TICKET_PRICE_INVALID',
      'Le prix doit être un nombre entier de centimes entre 0 et 10 000 €.',
    );
  }
  return value;
}

function normalizeCurrency(value: string | undefined): string {
  const currency = (value ?? 'EUR').trim().toUpperCase();
  if (currency !== 'EUR') {
    throw new EventInputError(
      'EVENT_TICKET_CURRENCY_INVALID',
      'Seule la devise EUR est supportée par cette fondation.',
    );
  }
  return currency;
}

function normalizeMaxPerOrder(value: number | undefined): number {
  const max = value ?? 10;
  if (!Number.isInteger(max) || max < 1 || max > 100) {
    throw new EventInputError(
      'EVENT_TICKET_MAX_PER_ORDER_INVALID',
      'La limite par commande doit être comprise entre 1 et 100.',
    );
  }
  return max;
}

function normalizeQuantity(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new EventInputError(
      'EVENT_QUANTITY_INVALID',
      'La quantité doit être comprise entre 1 et 100 billets.',
    );
  }
  return value;
}

function normalizeReason(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const reason = value.trim().replace(/\s+/g, ' ');
  if (!reason || reason.length > 1_000 || /[\u0000-\u001f\u007f]/.test(reason)) {
    throw new EventInputError(
      'EVENT_REFUND_REASON_INVALID',
      'Le motif doit contenir entre 1 et 1 000 caractères sûrs.',
    );
  }
  return reason;
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.slice(-4).padStart(4, '•');
}

function serializeEvent(row: EventRow): EventView {
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    key: row.key,
    name: row.name,
    description: row.description,
    timezone: row.timezone,
    status: row.status,
    sessionCount: row._count.sessions,
    ticketTypeCount: row._count.ticketTypes,
    orderCount: row._count.orders,
    waitlistCount: row._count.waitlistEntries,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializeSession(row: SessionRow): EventSessionView {
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    eventId: row.eventId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    capacity: row.capacity,
    status: row.status,
    event: row.event,
    orderCount: row._count.orders,
    ticketCount: row._count.tickets,
    waitlistCount: row._count.waitlistEntries,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializeTicketType(row: TicketTypeRow): EventTicketTypeView {
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    eventId: row.eventId,
    key: row.key,
    name: row.name,
    priceCents: row.priceCents,
    currency: row.currency,
    maxPerOrder: row.maxPerOrder,
    status: row.status,
    orderCount: row._count.orders,
    ticketCount: row._count.tickets,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializeOrder(row: OrderRow): EventOrderView {
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    eventId: row.eventId,
    sessionId: row.sessionId,
    ticketTypeId: row.ticketTypeId,
    customerId: row.customerId,
    reservationId: row.reservationId,
    quantity: row.quantity,
    unitPriceCents: row.unitPriceCents,
    totalPriceCents: row.totalPriceCents,
    currency: row.currency,
    status: row.status,
    invoiceNumber: row.invoiceNumber,
    invoicedAt: row.invoicedAt,
    refundReason: row.refundReason,
    refundedAt: row.refundedAt,
    cancelledAt: row.cancelledAt,
    event: row.event,
    session: row.session,
    ticketType: row.ticketType,
    customerName: row.customer?.name ?? null,
    phoneLast4: row.customer ? maskPhone(row.customer.phone) : null,
    ticketCount: row._count.tickets,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializeTicket(row: TicketRow): EventTicketView {
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    eventId: row.eventId,
    sessionId: row.sessionId,
    orderId: row.orderId,
    ticketTypeId: row.ticketTypeId,
    codeLast4: row.codeLast4,
    status: row.status,
    checkedInAt: row.checkedInAt,
    event: row.event,
    session: row.session,
    ticketType: row.ticketType,
    customerName: row.order.customer?.name ?? null,
    phoneLast4: row.order.customer ? maskPhone(row.order.customer.phone) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializeWaitlist(row: WaitlistRow): EventWaitlistView {
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    eventId: row.eventId,
    sessionId: row.sessionId,
    customerId: row.customerId,
    quantity: row.quantity,
    status: row.status,
    promotedAt: row.promotedAt,
    event: row.event,
    session: row.session,
    customerName: row.customer?.name ?? null,
    phoneLast4: row.customer ? maskPhone(row.customer.phone) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function assertRestaurantActive(restaurantId: string): Promise<void> {
  const restaurant = await db.restaurant.findFirst({
    where: { id: restaurantId, siteStatus: { notIn: ['ARCHIVED', 'SUSPENDED'] } },
    select: { id: true },
  });
  if (!restaurant) throw new EventNotFoundError();
}

async function assertCustomer(restaurantId: string, customerId: string): Promise<void> {
  const customer = await db.customer.findFirst({
    where: { id: customerId, restaurantId, archivedAt: null, mergedIntoId: null },
    select: { id: true },
  });
  if (!customer) throw new EventCustomerNotFoundError();
}

async function assertReservation(input: {
  restaurantId: string;
  customerId?: string;
  reservationId?: string;
}): Promise<void> {
  if (!input.reservationId) return;
  const reservation = await db.reservation.findFirst({
    where: {
      id: input.reservationId,
      restaurantId: input.restaurantId,
      ...(input.customerId ? { customerId: input.customerId } : {}),
      state: { notIn: ['CANCELLED', 'NO_SHOW'] },
    },
    select: { id: true },
  });
  if (!reservation) throw new EventConflictError('EVENT_RESERVATION_INVALID');
}

function generateTicketCode(): string {
  return randomBytes(9).toString('hex').slice(0, 12).toUpperCase();
}

function invoiceNumberFor(orderId: string): string {
  return `SOKAR-EVT-${orderId.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
}

export async function createEvent(input: {
  restaurantId: string;
  key: string;
  name: string;
  description?: string | null;
  timezone?: string;
  status?: EventStatus;
  actor: string;
}): Promise<EventView> {
  await assertRestaurantActive(input.restaurantId);
  const key = normalizeEventKey(input.key);
  const name = normalizeSafeText(input.name, 'EVENT_NAME_INVALID', "Le nom de l'événement", 160);
  const description = normalizeDescription(input.description);
  const timezone = normalizeTimezone(input.timezone);
  try {
    const row = await db.event.create({
      data: {
        restaurantId: input.restaurantId,
        key,
        name,
        description,
        timezone,
        status: input.status ?? EventStatus.DRAFT,
        createdByHash: hashActor(input.actor),
      },
      select: EVENT_SELECT,
    });
    return serializeEvent(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new EventConflictError('EVENT_KEY_CONFLICT');
    }
    throw error;
  }
}

export async function listEvents(input: {
  restaurantId: string;
  status?: EventStatus;
  limit?: number;
}): Promise<EventView[]> {
  const limit = Math.min(Math.max(input.limit ?? MAX_LIST_LIMIT, 1), MAX_LIST_LIMIT);
  const rows = await db.event.findMany({
    where: { restaurantId: input.restaurantId, ...(input.status ? { status: input.status } : {}) },
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    take: limit,
    select: EVENT_SELECT,
  });
  return rows.map(serializeEvent);
}

export async function updateEvent(input: {
  restaurantId: string;
  eventId: string;
  name?: string;
  description?: string | null;
  timezone?: string;
  status?: EventStatus;
}): Promise<EventView> {
  const current = await db.event.findFirst({
    where: { id: input.eventId, restaurantId: input.restaurantId },
    select: EVENT_SELECT,
  });
  if (!current) throw new EventNotFoundError();
  const data: Prisma.EventUpdateInput = {};
  if (input.name !== undefined)
    data.name = normalizeSafeText(input.name, 'EVENT_NAME_INVALID', "Le nom de l'événement", 160);
  if (input.description !== undefined) data.description = normalizeDescription(input.description);
  if (input.timezone !== undefined) data.timezone = normalizeTimezone(input.timezone);
  if (input.status !== undefined) data.status = input.status;
  if (Object.keys(data).length === 0) return serializeEvent(current);
  return serializeEvent(
    await db.event.update({ where: { id: current.id }, data, select: EVENT_SELECT }),
  );
}

export async function createEventSession(input: {
  restaurantId: string;
  eventId: string;
  startsAt: Date | string;
  endsAt: Date | string;
  capacity: number;
}): Promise<EventSessionView> {
  const event = await db.event.findFirst({
    where: {
      id: input.eventId,
      restaurantId: input.restaurantId,
      status: { not: EventStatus.ARCHIVED },
    },
    select: { id: true },
  });
  if (!event) throw new EventNotFoundError();
  const startsAt = normalizeDate(input.startsAt);
  const endsAt = normalizeDate(input.endsAt);
  if (endsAt <= startsAt) {
    throw new EventInputError(
      'EVENT_SESSION_TIME_INVALID',
      'La fin de session doit être postérieure au début.',
    );
  }
  const capacity = normalizeCapacity(input.capacity);
  try {
    const row = await db.eventSession.create({
      data: {
        restaurantId: input.restaurantId,
        eventId: input.eventId,
        startsAt,
        endsAt,
        capacity,
      },
      select: SESSION_SELECT,
    });
    return serializeSession(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new EventConflictError('EVENT_SESSION_CONFLICT');
    }
    throw error;
  }
}

export async function listEventSessions(input: {
  restaurantId: string;
  eventId?: string;
  status?: EventSessionStatus;
  from?: Date;
  to?: Date;
  limit?: number;
}): Promise<EventSessionView[]> {
  const limit = Math.min(Math.max(input.limit ?? MAX_LIST_LIMIT, 1), MAX_LIST_LIMIT);
  const rows = await db.eventSession.findMany({
    where: {
      restaurantId: input.restaurantId,
      ...(input.eventId ? { eventId: input.eventId } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.from || input.to
        ? {
            startsAt: {
              ...(input.from ? { gte: input.from } : {}),
              ...(input.to ? { lt: input.to } : {}),
            },
          }
        : {}),
    },
    orderBy: { startsAt: 'asc' },
    take: limit,
    select: SESSION_SELECT,
  });
  return rows.map(serializeSession);
}

export async function updateEventSession(input: {
  restaurantId: string;
  eventId?: string;
  sessionId: string;
  startsAt?: Date | string;
  endsAt?: Date | string;
  capacity?: number;
  status?: EventSessionStatus;
}): Promise<EventSessionView> {
  const current = await db.eventSession.findFirst({
    where: {
      id: input.sessionId,
      restaurantId: input.restaurantId,
      ...(input.eventId ? { eventId: input.eventId } : {}),
    },
    select: SESSION_SELECT,
  });
  if (!current) throw new EventSessionNotFoundError();
  const startsAt = input.startsAt === undefined ? current.startsAt : normalizeDate(input.startsAt);
  const endsAt = input.endsAt === undefined ? current.endsAt : normalizeDate(input.endsAt);
  if (endsAt <= startsAt) {
    throw new EventInputError(
      'EVENT_SESSION_TIME_INVALID',
      'La fin de session doit être postérieure au début.',
    );
  }
  const data: Prisma.EventSessionUpdateInput = {};
  if (input.startsAt !== undefined) data.startsAt = startsAt;
  if (input.endsAt !== undefined) data.endsAt = endsAt;
  if (input.capacity !== undefined) data.capacity = normalizeCapacity(input.capacity);
  if (input.status !== undefined) data.status = input.status;
  if (Object.keys(data).length === 0) return serializeSession(current);
  try {
    return serializeSession(
      await db.eventSession.update({ where: { id: current.id }, data, select: SESSION_SELECT }),
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new EventConflictError('EVENT_SESSION_CONFLICT');
    }
    throw error;
  }
}

export async function createEventTicketType(input: {
  restaurantId: string;
  eventId: string;
  key: string;
  name: string;
  priceCents: number;
  currency?: string;
  maxPerOrder?: number;
}): Promise<EventTicketTypeView> {
  const event = await db.event.findFirst({
    where: {
      id: input.eventId,
      restaurantId: input.restaurantId,
      status: { not: EventStatus.ARCHIVED },
    },
    select: { id: true },
  });
  if (!event) throw new EventNotFoundError();
  const key = normalizeTicketTypeKey(input.key);
  const name = normalizeSafeText(
    input.name,
    'EVENT_TICKET_TYPE_NAME_INVALID',
    'Le nom du tarif',
    120,
  );
  const priceCents = normalizePrice(input.priceCents);
  const currency = normalizeCurrency(input.currency);
  const maxPerOrder = normalizeMaxPerOrder(input.maxPerOrder);
  try {
    const row = await db.eventTicketType.create({
      data: {
        restaurantId: input.restaurantId,
        eventId: input.eventId,
        key,
        name,
        priceCents,
        currency,
        maxPerOrder,
      },
      select: TICKET_TYPE_SELECT,
    });
    return serializeTicketType(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new EventConflictError('EVENT_TICKET_TYPE_CONFLICT');
    }
    throw error;
  }
}

export async function listEventTicketTypes(input: {
  restaurantId: string;
  eventId?: string;
  status?: EventTicketTypeStatus;
  limit?: number;
}): Promise<EventTicketTypeView[]> {
  const limit = Math.min(Math.max(input.limit ?? MAX_LIST_LIMIT, 1), MAX_LIST_LIMIT);
  const rows = await db.eventTicketType.findMany({
    where: {
      restaurantId: input.restaurantId,
      ...(input.eventId ? { eventId: input.eventId } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: TICKET_TYPE_SELECT,
  });
  return rows.map(serializeTicketType);
}

export async function updateEventTicketType(input: {
  restaurantId: string;
  eventId?: string;
  ticketTypeId: string;
  name?: string;
  priceCents?: number;
  currency?: string;
  maxPerOrder?: number;
  status?: EventTicketTypeStatus;
}): Promise<EventTicketTypeView> {
  const current = await db.eventTicketType.findFirst({
    where: {
      id: input.ticketTypeId,
      restaurantId: input.restaurantId,
      ...(input.eventId ? { eventId: input.eventId } : {}),
    },
    select: TICKET_TYPE_SELECT,
  });
  if (!current) throw new EventTicketTypeNotFoundError();
  const data: Prisma.EventTicketTypeUpdateInput = {};
  if (input.name !== undefined)
    data.name = normalizeSafeText(
      input.name,
      'EVENT_TICKET_TYPE_NAME_INVALID',
      'Le nom du tarif',
      120,
    );
  if (input.priceCents !== undefined) data.priceCents = normalizePrice(input.priceCents);
  if (input.currency !== undefined) data.currency = normalizeCurrency(input.currency);
  if (input.maxPerOrder !== undefined) data.maxPerOrder = normalizeMaxPerOrder(input.maxPerOrder);
  if (input.status !== undefined) data.status = input.status;
  if (Object.keys(data).length === 0) return serializeTicketType(current);
  return serializeTicketType(
    await db.eventTicketType.update({
      where: { id: current.id },
      data,
      select: TICKET_TYPE_SELECT,
    }),
  );
}

async function findOrderByIdempotency(
  idempotencyKey: string | undefined,
): Promise<OrderRow | null> {
  if (!idempotencyKey) return null;
  return db.eventOrder.findUnique({ where: { idempotencyKey }, select: ORDER_SELECT });
}

function assertOrderReplayMatches(
  row: OrderRow,
  input: { eventId: string; sessionId: string; ticketTypeId: string; quantity: number },
): void {
  if (
    row.eventId !== input.eventId ||
    row.sessionId !== input.sessionId ||
    row.ticketTypeId !== input.ticketTypeId ||
    row.quantity !== input.quantity
  ) {
    throw new EventConflictError('EVENT_IDEMPOTENCY_CONFLICT');
  }
}

export async function createEventOrder(input: {
  restaurantId: string;
  eventId: string;
  sessionId: string;
  ticketTypeId: string;
  customerId?: string;
  reservationId?: string;
  quantity: number;
  idempotencyKey?: string;
  actor: string;
  now?: Date;
}): Promise<EventOrderMutationResult> {
  const now = input.now ?? new Date();
  const quantity = normalizeQuantity(input.quantity);
  const rawKey = normalizeIdempotencyKey(input.idempotencyKey);
  const idempotencyKey = rawKey
    ? hashWithPrefix(IDEMPOTENCY_HASH_PREFIX, input.restaurantId, rawKey)
    : undefined;
  const replay = await findOrderByIdempotency(idempotencyKey);
  if (replay) {
    assertOrderReplayMatches(replay, input);
    return {
      ...serializeOrder(replay),
      ticketCodes: null,
      providerContacted: false,
      dryRun: true,
      replayed: true,
    };
  }
  const session = await db.eventSession.findFirst({
    where: { id: input.sessionId, restaurantId: input.restaurantId, eventId: input.eventId },
    select: SESSION_SELECT,
  });
  if (!session) throw new EventSessionNotFoundError();
  if (session.status !== EventSessionStatus.OPEN)
    throw new EventConflictError('EVENT_SESSION_CLOSED');
  if (session.startsAt <= now) throw new EventConflictError('EVENT_SESSION_IN_PAST');
  if (session.event.status !== EventStatus.ACTIVE) throw new EventConflictError('EVENT_NOT_ACTIVE');
  const ticketType = await db.eventTicketType.findFirst({
    where: { id: input.ticketTypeId, restaurantId: input.restaurantId, eventId: input.eventId },
    select: TICKET_TYPE_SELECT,
  });
  if (!ticketType) throw new EventTicketTypeNotFoundError();
  if (ticketType.status !== EventTicketTypeStatus.ACTIVE)
    throw new EventConflictError('EVENT_TICKET_TYPE_INACTIVE');
  if (quantity > ticketType.maxPerOrder)
    throw new EventInputError(
      'EVENT_QUANTITY_INVALID',
      'La quantité dépasse la limite de ce tarif.',
    );
  if (input.customerId) await assertCustomer(input.restaurantId, input.customerId);
  await assertReservation({
    restaurantId: input.restaurantId,
    customerId: input.customerId,
    reservationId: input.reservationId,
  });
  try {
    const created = await db.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`event:${input.restaurantId}:${input.sessionId}`}))`,
      );
      const currentSession = await tx.eventSession.findFirst({
        where: { id: input.sessionId, restaurantId: input.restaurantId, eventId: input.eventId },
        select: SESSION_SELECT,
      });
      if (!currentSession) throw new EventSessionNotFoundError();
      if (currentSession.status !== EventSessionStatus.OPEN)
        throw new EventConflictError('EVENT_SESSION_CLOSED');
      if (currentSession.startsAt <= now) throw new EventConflictError('EVENT_SESSION_IN_PAST');
      if (currentSession.event.status !== EventStatus.ACTIVE)
        throw new EventConflictError('EVENT_NOT_ACTIVE');
      const currentType = await tx.eventTicketType.findFirst({
        where: { id: input.ticketTypeId, restaurantId: input.restaurantId, eventId: input.eventId },
        select: TICKET_TYPE_SELECT,
      });
      if (!currentType) throw new EventTicketTypeNotFoundError();
      if (currentType.status !== EventTicketTypeStatus.ACTIVE)
        throw new EventConflictError('EVENT_TICKET_TYPE_INACTIVE');
      if (quantity > currentType.maxPerOrder)
        throw new EventInputError(
          'EVENT_QUANTITY_INVALID',
          'La quantité dépasse la limite de ce tarif.',
        );
      const booked = await tx.eventOrder.aggregate({
        where: {
          sessionId: input.sessionId,
          restaurantId: input.restaurantId,
          status: EventOrderStatus.CONFIRMED,
        },
        _sum: { quantity: true },
      });
      const used = booked._sum.quantity ?? 0;
      if (used + quantity > currentSession.capacity)
        throw new EventConflictError('EVENT_CAPACITY_EXCEEDED');
      const order = await tx.eventOrder.create({
        data: {
          restaurantId: input.restaurantId,
          eventId: input.eventId,
          sessionId: input.sessionId,
          ticketTypeId: input.ticketTypeId,
          customerId: input.customerId,
          reservationId: input.reservationId,
          idempotencyKey,
          quantity,
          unitPriceCents: currentType.priceCents,
          totalPriceCents: currentType.priceCents * quantity,
          currency: currentType.currency,
          status: EventOrderStatus.CONFIRMED,
          createdByHash: hashActor(input.actor),
        },
        select: ORDER_SELECT,
      });
      const ticketCodes: string[] = [];
      for (let index = 0; index < quantity; index += 1) {
        const code = generateTicketCode();
        ticketCodes.push(code);
        await tx.eventTicket.create({
          data: {
            restaurantId: input.restaurantId,
            eventId: input.eventId,
            sessionId: input.sessionId,
            orderId: order.id,
            ticketTypeId: input.ticketTypeId,
            codeHash: hashTicketCode(code),
            codeLast4: code.slice(-4),
            status: EventTicketStatus.ISSUED,
          },
          select: { id: true },
        });
      }
      return { order, ticketCodes };
    });
    return {
      ...serializeOrder(created.order),
      ticketCodes: created.ticketCodes,
      providerContacted: false,
      dryRun: true,
      replayed: false,
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      idempotencyKey
    ) {
      const raced = await findOrderByIdempotency(idempotencyKey);
      if (raced) {
        assertOrderReplayMatches(raced, input);
        return {
          ...serializeOrder(raced),
          ticketCodes: null,
          providerContacted: false,
          dryRun: true,
          replayed: true,
        };
      }
    }
    throw error;
  }
}

export async function listEventOrders(input: {
  restaurantId: string;
  eventId?: string;
  sessionId?: string;
  customerId?: string;
  status?: EventOrderStatus;
  limit?: number;
}): Promise<EventOrderView[]> {
  const limit = Math.min(Math.max(input.limit ?? MAX_LIST_LIMIT, 1), MAX_LIST_LIMIT);
  const rows = await db.eventOrder.findMany({
    where: {
      restaurantId: input.restaurantId,
      ...(input.eventId ? { eventId: input.eventId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.customerId ? { customerId: input.customerId } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: ORDER_SELECT,
  });
  return rows.map(serializeOrder);
}

export async function cancelEventOrder(input: {
  restaurantId: string;
  orderId: string;
  now?: Date;
}): Promise<EventOrderMutationResult> {
  const now = input.now ?? new Date();
  const result = await db.eventOrder.updateMany({
    where: {
      id: input.orderId,
      restaurantId: input.restaurantId,
      status: EventOrderStatus.CONFIRMED,
    },
    data: { status: EventOrderStatus.CANCELLED, cancelledAt: now },
  });
  if ((result as { count?: number }).count !== 1) {
    const current = await db.eventOrder.findFirst({
      where: { id: input.orderId, restaurantId: input.restaurantId },
      select: ORDER_SELECT,
    });
    if (!current) throw new EventOrderNotFoundError();
    if (current.status === EventOrderStatus.CANCELLED)
      return {
        ...serializeOrder(current),
        ticketCodes: null,
        providerContacted: false,
        dryRun: true,
        replayed: true,
      };
    if (current.status === EventOrderStatus.REFUNDED)
      throw new EventOrderStateError('EVENT_ORDER_REFUNDED');
    throw new EventOrderStateError('EVENT_ORDER_CANCELLED');
  }
  await db.eventTicket.updateMany({
    where: { orderId: input.orderId, status: EventTicketStatus.ISSUED },
    data: { status: EventTicketStatus.CANCELLED },
  });
  const row = await db.eventOrder.findFirst({
    where: { id: input.orderId, restaurantId: input.restaurantId },
    select: ORDER_SELECT,
  });
  if (!row) throw new EventOrderNotFoundError();
  return {
    ...serializeOrder(row),
    ticketCodes: null,
    providerContacted: false,
    dryRun: true,
    replayed: false,
  };
}

export async function issueEventOrderInvoice(input: {
  restaurantId: string;
  orderId: string;
  invoiceNumber?: string;
  now?: Date;
}): Promise<EventOrderMutationResult> {
  const now = input.now ?? new Date();
  const desired = input.invoiceNumber?.trim() || undefined;
  if (desired && (desired.length > 120 || /[\u0000-\u001f\u007f]/.test(desired))) {
    throw new EventInputError('EVENT_INVOICE_NUMBER_INVALID', 'Le numéro de facture est invalide.');
  }
  const current = await db.eventOrder.findFirst({
    where: { id: input.orderId, restaurantId: input.restaurantId },
    select: ORDER_SELECT,
  });
  if (!current) throw new EventOrderNotFoundError();
  const invoiceNumber = desired ?? invoiceNumberFor(current.id);
  if (current.invoiceNumber) {
    if (current.invoiceNumber !== invoiceNumber)
      throw new EventOrderStateError('EVENT_ORDER_INVOICE_CONFLICT');
    return {
      ...serializeOrder(current),
      ticketCodes: null,
      providerContacted: false,
      dryRun: true,
      replayed: true,
    };
  }
  try {
    const row = await db.eventOrder.update({
      where: { id: current.id },
      data: { invoiceNumber, invoicedAt: now },
      select: ORDER_SELECT,
    });
    return {
      ...serializeOrder(row),
      ticketCodes: null,
      providerContacted: false,
      dryRun: true,
      replayed: false,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new EventOrderStateError('EVENT_ORDER_INVOICE_CONFLICT');
    }
    throw error;
  }
}

export async function refundEventOrder(input: {
  restaurantId: string;
  orderId: string;
  idempotencyKey: string;
  reason?: string | null;
  now?: Date;
}): Promise<EventOrderMutationResult> {
  const now = input.now ?? new Date();
  const rawKey = normalizeIdempotencyKey(input.idempotencyKey);
  if (!rawKey)
    throw new EventInputError(
      'EVENT_IDEMPOTENCY_INVALID',
      "Une clé d'idempotence est requise pour un remboursement.",
    );
  const refundKey = hashWithPrefix(REFUND_IDEMPOTENCY_PREFIX, input.restaurantId, rawKey);
  const reason = normalizeReason(input.reason);
  const current = await db.eventOrder.findFirst({
    where: { id: input.orderId, restaurantId: input.restaurantId },
    select: ORDER_SELECT,
  });
  if (!current) throw new EventOrderNotFoundError();
  const existing = await db.eventOrder.findUnique({
    where: { refundIdempotencyKey: refundKey },
    select: ORDER_SELECT,
  });
  if (existing) {
    if (existing.id !== current.id) throw new EventOrderStateError('EVENT_ORDER_REFUND_CONFLICT');
    return {
      ...serializeOrder(existing),
      ticketCodes: null,
      providerContacted: false,
      dryRun: true,
      replayed: true,
    };
  }
  if (current.status === EventOrderStatus.REFUNDED)
    throw new EventOrderStateError('EVENT_ORDER_REFUNDED');
  if (
    current.status !== EventOrderStatus.CONFIRMED &&
    current.status !== EventOrderStatus.CANCELLED &&
    current.status !== EventOrderStatus.REFUND_PENDING
  ) {
    throw new EventOrderStateError('EVENT_ORDER_CANCELLED');
  }
  const row = await db.eventOrder.update({
    where: { id: current.id },
    data: {
      status: EventOrderStatus.REFUNDED,
      refundIdempotencyKey: refundKey,
      refundReason: reason,
      refundedAt: now,
    },
    select: ORDER_SELECT,
  });
  await db.eventTicket.updateMany({
    where: {
      orderId: current.id,
      status: { in: [EventTicketStatus.ISSUED, EventTicketStatus.CANCELLED] },
    },
    data: { status: EventTicketStatus.REFUNDED },
  });
  return {
    ...serializeOrder(row),
    ticketCodes: null,
    providerContacted: false,
    dryRun: true,
    replayed: false,
  };
}

export async function listEventTickets(input: {
  restaurantId: string;
  eventId?: string;
  sessionId?: string;
  orderId?: string;
  status?: EventTicketStatus;
  limit?: number;
}): Promise<EventTicketView[]> {
  const limit = Math.min(Math.max(input.limit ?? MAX_LIST_LIMIT, 1), MAX_LIST_LIMIT);
  const rows = await db.eventTicket.findMany({
    where: {
      restaurantId: input.restaurantId,
      ...(input.eventId ? { eventId: input.eventId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.orderId ? { orderId: input.orderId } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: TICKET_SELECT,
  });
  return rows.map(serializeTicket);
}

export async function checkInEventTicket(input: {
  restaurantId: string;
  ticketId?: string;
  code: string;
  actor: string;
  now?: Date;
}): Promise<EventTicketMutationResult> {
  const code = input.code.trim().toUpperCase();
  if (!/^[A-F0-9]{12}$/.test(code))
    throw new EventInputError('EVENT_TICKET_CODE_INVALID', 'Le code billet est invalide.');
  const current = await db.eventTicket.findFirst({
    where: {
      restaurantId: input.restaurantId,
      ...(input.ticketId ? { id: input.ticketId } : {}),
      codeHash: hashTicketCode(code),
    },
    select: TICKET_SELECT,
  });
  if (!current) throw new EventTicketNotFoundError();
  if (current.status === EventTicketStatus.CHECKED_IN)
    return { ...serializeTicket(current), replayed: true };
  if (current.status !== EventTicketStatus.ISSUED)
    throw new EventTicketStateError('EVENT_TICKET_UNAVAILABLE');
  const now = input.now ?? new Date();
  const result = await db.eventTicket.updateMany({
    where: { id: current.id, status: EventTicketStatus.ISSUED },
    data: {
      status: EventTicketStatus.CHECKED_IN,
      checkedInAt: now,
      checkedInByHash: hashActor(input.actor),
    },
  });
  if ((result as { count?: number }).count !== 1) {
    const raced = await db.eventTicket.findFirst({
      where: { id: current.id, restaurantId: input.restaurantId },
      select: TICKET_SELECT,
    });
    if (raced?.status === EventTicketStatus.CHECKED_IN)
      return { ...serializeTicket(raced), replayed: true };
    throw new EventTicketStateError('EVENT_TICKET_UNAVAILABLE');
  }
  const row = await db.eventTicket.findFirst({
    where: { id: current.id, restaurantId: input.restaurantId },
    select: TICKET_SELECT,
  });
  if (!row) throw new EventTicketNotFoundError();
  return { ...serializeTicket(row), replayed: false };
}

async function findWaitlistByIdempotency(
  idempotencyKey: string | undefined,
): Promise<WaitlistRow | null> {
  if (!idempotencyKey) return null;
  return db.eventWaitlistEntry.findUnique({ where: { idempotencyKey }, select: WAITLIST_SELECT });
}

export async function joinEventWaitlist(input: {
  restaurantId: string;
  eventId: string;
  sessionId: string;
  customerId?: string;
  quantity: number;
  idempotencyKey?: string;
  actor: string;
  now?: Date;
}): Promise<EventWaitlistMutationResult> {
  const now = input.now ?? new Date();
  const quantity = normalizeQuantity(input.quantity);
  const rawKey = normalizeIdempotencyKey(input.idempotencyKey);
  const idempotencyKey = rawKey
    ? hashWithPrefix(WAITLIST_IDEMPOTENCY_PREFIX, input.restaurantId, rawKey)
    : undefined;
  const replay = await findWaitlistByIdempotency(idempotencyKey);
  if (replay) return { ...serializeWaitlist(replay), replayed: true };
  const session = await db.eventSession.findFirst({
    where: { id: input.sessionId, restaurantId: input.restaurantId, eventId: input.eventId },
    select: SESSION_SELECT,
  });
  if (!session) throw new EventSessionNotFoundError();
  if (session.status !== EventSessionStatus.OPEN || session.startsAt <= now)
    throw new EventConflictError('EVENT_WAITLIST_CLOSED');
  if (session.event.status !== EventStatus.ACTIVE) throw new EventConflictError('EVENT_NOT_ACTIVE');
  if (input.customerId) await assertCustomer(input.restaurantId, input.customerId);
  try {
    const row = await db.eventWaitlistEntry.create({
      data: {
        restaurantId: input.restaurantId,
        eventId: input.eventId,
        sessionId: input.sessionId,
        customerId: input.customerId,
        quantity,
        idempotencyKey,
        status: EventWaitlistStatus.WAITING,
        createdByHash: hashActor(input.actor),
      },
      select: WAITLIST_SELECT,
    });
    return { ...serializeWaitlist(row), replayed: false };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      idempotencyKey
    ) {
      const raced = await findWaitlistByIdempotency(idempotencyKey);
      if (raced) return { ...serializeWaitlist(raced), replayed: true };
    }
    throw error;
  }
}

export async function listEventWaitlist(input: {
  restaurantId: string;
  eventId?: string;
  sessionId?: string;
  status?: EventWaitlistStatus;
  limit?: number;
}): Promise<EventWaitlistView[]> {
  const limit = Math.min(Math.max(input.limit ?? MAX_LIST_LIMIT, 1), MAX_LIST_LIMIT);
  const rows = await db.eventWaitlistEntry.findMany({
    where: {
      restaurantId: input.restaurantId,
      ...(input.eventId ? { eventId: input.eventId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: WAITLIST_SELECT,
  });
  return rows.map(serializeWaitlist);
}

export async function cancelEventWaitlist(input: {
  restaurantId: string;
  entryId: string;
  now?: Date;
}): Promise<EventWaitlistMutationResult> {
  const result = await db.eventWaitlistEntry.updateMany({
    where: {
      id: input.entryId,
      restaurantId: input.restaurantId,
      status: EventWaitlistStatus.WAITING,
    },
    data: { status: EventWaitlistStatus.CANCELLED },
  });
  if ((result as { count?: number }).count !== 1) {
    const current = await db.eventWaitlistEntry.findFirst({
      where: { id: input.entryId, restaurantId: input.restaurantId },
      select: WAITLIST_SELECT,
    });
    if (!current) throw new EventWaitlistNotFoundError();
    return {
      ...serializeWaitlist(current),
      replayed: current.status === EventWaitlistStatus.CANCELLED,
    };
  }
  const row = await db.eventWaitlistEntry.findFirst({
    where: { id: input.entryId, restaurantId: input.restaurantId },
    select: WAITLIST_SELECT,
  });
  if (!row) throw new EventWaitlistNotFoundError();
  return { ...serializeWaitlist(row), replayed: false };
}

export async function promoteEventWaitlist(input: {
  restaurantId: string;
  entryId: string;
  ticketTypeId: string;
  actor: string;
  now?: Date;
}): Promise<EventOrderMutationResult> {
  const entry = await db.eventWaitlistEntry.findFirst({
    where: { id: input.entryId, restaurantId: input.restaurantId },
    select: WAITLIST_SELECT,
  });
  if (!entry) throw new EventWaitlistNotFoundError();
  if (entry.status !== EventWaitlistStatus.WAITING) {
    if (entry.status === EventWaitlistStatus.PROMOTED)
      throw new EventConflictError('EVENT_WAITLIST_ALREADY_PROMOTED');
    throw new EventConflictError('EVENT_WAITLIST_CLOSED');
  }
  const result = await createEventOrder({
    restaurantId: input.restaurantId,
    eventId: entry.eventId,
    sessionId: entry.sessionId,
    ticketTypeId: input.ticketTypeId,
    customerId: entry.customerId ?? undefined,
    quantity: entry.quantity,
    idempotencyKey: `waitlist-${entry.id}`,
    actor: input.actor,
    now: input.now,
  });
  await db.eventWaitlistEntry.updateMany({
    where: { id: entry.id, restaurantId: input.restaurantId, status: EventWaitlistStatus.WAITING },
    data: { status: EventWaitlistStatus.PROMOTED, promotedAt: input.now ?? new Date() },
  });
  return result;
}

export async function expireEventSessions(input?: { now?: Date; limit?: number }): Promise<number> {
  const now = input?.now ?? new Date();
  const limit = Math.min(Math.max(input?.limit ?? MAX_EXPIRY_SCAN, 1), MAX_EXPIRY_SCAN);
  const rows = await db.eventSession.findMany({
    where: { status: EventSessionStatus.OPEN, endsAt: { lte: now } },
    orderBy: { endsAt: 'asc' },
    take: limit,
    select: { id: true },
  });
  if (rows.length === 0) return 0;
  const result = await db.eventSession.updateMany({
    where: { id: { in: rows.map((row) => row.id) }, status: EventSessionStatus.OPEN },
    data: { status: EventSessionStatus.CLOSED },
  });
  await db.eventWaitlistEntry.updateMany({
    where: { sessionId: { in: rows.map((row) => row.id) }, status: EventWaitlistStatus.WAITING },
    data: { status: EventWaitlistStatus.EXPIRED },
  });
  return (result as { count?: number }).count ?? 0;
}
