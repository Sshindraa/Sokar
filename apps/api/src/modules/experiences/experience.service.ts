import { createHash } from 'node:crypto';
import {
  ExperienceReservationStatus,
  ExperienceSessionStatus,
  ExperienceStatus,
  Prisma,
} from '@prisma/client';
import { db } from '../../shared/db/client';

const EXPERIENCE_KEY_PATTERN = /^[a-z][a-z0-9_.-]{1,63}$/;
const ACTOR_HASH_PREFIX = 'sokar:experience-actor:';
const IDEMPOTENCY_HASH_PREFIX = 'sokar:experience-idempotency:';
const MAX_LIST_LIMIT = 100;
const MAX_EXPIRY_SCAN = 1_000;

const EXPERIENCE_SELECT = {
  id: true,
  restaurantId: true,
  key: true,
  name: true,
  description: true,
  durationMinutes: true,
  priceCents: true,
  currency: true,
  capacity: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { sessions: true, reservations: true } },
} as const;

const SESSION_SELECT = {
  id: true,
  restaurantId: true,
  experienceId: true,
  startsAt: true,
  endsAt: true,
  capacityOverride: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  experience: {
    select: {
      key: true,
      name: true,
      priceCents: true,
      currency: true,
      capacity: true,
      status: true,
    },
  },
  _count: { select: { reservations: true } },
} as const;

const RESERVATION_SELECT = {
  id: true,
  restaurantId: true,
  experienceId: true,
  sessionId: true,
  customerId: true,
  reservationId: true,
  idempotencyKey: true,
  quantity: true,
  unitPriceCents: true,
  totalPriceCents: true,
  currency: true,
  status: true,
  createdByHash: true,
  cancelledByHash: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  experience: { select: { key: true, name: true, priceCents: true, currency: true } },
  session: { select: { startsAt: true, endsAt: true } },
  customer: { select: { name: true, phone: true } },
} as const;

type ExperienceRow = Prisma.ExperienceGetPayload<{ select: typeof EXPERIENCE_SELECT }>;
type SessionRow = Prisma.ExperienceSessionGetPayload<{ select: typeof SESSION_SELECT }>;
type ReservationRow = Prisma.ExperienceReservationGetPayload<{
  select: typeof RESERVATION_SELECT;
}>;

export class ExperienceInputError extends Error {
  constructor(
    readonly code:
      | 'EXPERIENCE_KEY_INVALID'
      | 'EXPERIENCE_NAME_INVALID'
      | 'EXPERIENCE_DESCRIPTION_INVALID'
      | 'EXPERIENCE_DURATION_INVALID'
      | 'EXPERIENCE_PRICE_INVALID'
      | 'EXPERIENCE_CURRENCY_INVALID'
      | 'EXPERIENCE_CAPACITY_INVALID'
      | 'EXPERIENCE_SESSION_TIME_INVALID'
      | 'EXPERIENCE_SESSION_CAPACITY_INVALID'
      | 'EXPERIENCE_QUANTITY_INVALID'
      | 'EXPERIENCE_IDEMPOTENCY_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'ExperienceInputError';
  }
}

export class ExperienceNotFoundError extends Error {
  readonly code = 'EXPERIENCE_NOT_FOUND';

  constructor() {
    super('Experience not found');
    this.name = 'ExperienceNotFoundError';
  }
}

export class ExperienceSessionNotFoundError extends Error {
  readonly code = 'EXPERIENCE_SESSION_NOT_FOUND';

  constructor() {
    super('Experience session not found');
    this.name = 'ExperienceSessionNotFoundError';
  }
}

export class ExperienceReservationNotFoundError extends Error {
  readonly code = 'EXPERIENCE_RESERVATION_NOT_FOUND';

  constructor() {
    super('Experience reservation not found');
    this.name = 'ExperienceReservationNotFoundError';
  }
}

export class ExperienceCustomerNotFoundError extends Error {
  readonly code = 'EXPERIENCE_CUSTOMER_NOT_FOUND';

  constructor() {
    super('Customer not found');
    this.name = 'ExperienceCustomerNotFoundError';
  }
}

export class ExperienceConflictError extends Error {
  constructor(
    readonly code:
      | 'EXPERIENCE_KEY_CONFLICT'
      | 'EXPERIENCE_SESSION_CONFLICT'
      | 'EXPERIENCE_CAPACITY_EXCEEDED'
      | 'EXPERIENCE_SESSION_CLOSED'
      | 'EXPERIENCE_SESSION_IN_PAST'
      | 'EXPERIENCE_NOT_ACTIVE'
      | 'EXPERIENCE_IDEMPOTENCY_CONFLICT'
      | 'EXPERIENCE_RESERVATION_INVALID',
  ) {
    super(
      code === 'EXPERIENCE_KEY_CONFLICT'
        ? 'An experience with this key already exists for this restaurant'
        : code === 'EXPERIENCE_SESSION_CONFLICT'
          ? 'A session already exists at this time'
          : code === 'EXPERIENCE_CAPACITY_EXCEEDED'
            ? 'The requested quantity exceeds the remaining capacity'
            : code === 'EXPERIENCE_SESSION_CLOSED'
              ? 'The experience session is not open'
              : code === 'EXPERIENCE_SESSION_IN_PAST'
                ? 'The experience session has already started'
                : code === 'EXPERIENCE_NOT_ACTIVE'
                  ? 'The experience is not active'
                  : code === 'EXPERIENCE_IDEMPOTENCY_CONFLICT'
                    ? 'The idempotency key was already used for another booking'
                    : 'The linked reservation is not available for this booking',
    );
    this.name = 'ExperienceConflictError';
  }
}

export class ExperienceReservationStateError extends Error {
  constructor(readonly code: 'EXPERIENCE_RESERVATION_CANCELLED') {
    super('The experience reservation has already been cancelled');
    this.name = 'ExperienceReservationStateError';
  }
}

export interface ExperienceView {
  id: string;
  restaurantId: string;
  key: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceCents: number;
  currency: string;
  capacity: number;
  status: ExperienceStatus;
  sessionCount: number;
  reservationCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExperienceSessionView {
  id: string;
  restaurantId: string;
  experienceId: string;
  startsAt: Date;
  endsAt: Date;
  capacityOverride: number | null;
  status: ExperienceSessionStatus;
  experience: {
    key: string;
    name: string;
    priceCents: number;
    currency: string;
    capacity: number;
    status: ExperienceStatus;
  };
  reservationCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExperienceReservationView {
  id: string;
  restaurantId: string;
  experienceId: string;
  sessionId: string;
  customerId: string | null;
  reservationId: string | null;
  quantity: number;
  unitPriceCents: number;
  totalPriceCents: number;
  currency: string;
  status: ExperienceReservationStatus;
  experience: { key: string; name: string; priceCents: number; currency: string };
  session: { startsAt: Date; endsAt: Date };
  customerName: string | null;
  phoneLast4: string | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExperienceReservationMutationResult extends ExperienceReservationView {
  replayed: boolean;
}

function hashActor(actor: string): string {
  return createHash('sha256').update(`${ACTOR_HASH_PREFIX}${actor}`).digest('hex');
}

function hashIdempotencyKey(restaurantId: string, key: string): string {
  return createHash('sha256')
    .update(`${IDEMPOTENCY_HASH_PREFIX}${restaurantId}:${key}`)
    .digest('hex');
}

function normalizeIdempotencyKey(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const key = value.trim();
  if (key.length < 8 || key.length > 200 || /[\u0000-\u001f\u007f]/.test(key)) {
    throw new ExperienceInputError(
      'EXPERIENCE_IDEMPOTENCY_INVALID',
      "La clé d'idempotence doit contenir entre 8 et 200 caractères sûrs.",
    );
  }
  return key;
}

function normalizeKey(value: string): string {
  const key = value.trim().toLowerCase();
  if (!EXPERIENCE_KEY_PATTERN.test(key)) {
    throw new ExperienceInputError(
      'EXPERIENCE_KEY_INVALID',
      "La clé de l'expérience doit être un identifiant technique de 2 à 64 caractères.",
    );
  }
  return key;
}

function normalizeSafeText(
  value: string,
  code: 'EXPERIENCE_NAME_INVALID' | 'EXPERIENCE_DESCRIPTION_INVALID',
  label: string,
  maxLength: number,
): string {
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new ExperienceInputError(
      code,
      `${label} doit contenir entre 1 et ${maxLength} caractères sûrs.`,
    );
  }
  return text;
}

function normalizeDescription(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return normalizeSafeText(value, 'EXPERIENCE_DESCRIPTION_INVALID', 'La description', 1_000);
}

function normalizeDuration(value: number): number {
  if (!Number.isInteger(value) || value < 15 || value > 1_440) {
    throw new ExperienceInputError(
      'EXPERIENCE_DURATION_INVALID',
      'La durée doit être comprise entre 15 et 1 440 minutes.',
    );
  }
  return value;
}

function normalizePrice(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 1_000_000) {
    throw new ExperienceInputError(
      'EXPERIENCE_PRICE_INVALID',
      'Le prix doit être un nombre entier de centimes entre 0 et 10 000 €.',
    );
  }
  return value;
}

function normalizeCurrency(value: string | undefined): string {
  const currency = (value ?? 'EUR').trim().toUpperCase();
  if (currency !== 'EUR') {
    throw new ExperienceInputError(
      'EXPERIENCE_CURRENCY_INVALID',
      'Seule la devise EUR est supportée par cette fondation.',
    );
  }
  return currency;
}

function normalizeCapacity(
  value: number,
  code:
    | 'EXPERIENCE_CAPACITY_INVALID'
    | 'EXPERIENCE_SESSION_CAPACITY_INVALID' = 'EXPERIENCE_CAPACITY_INVALID',
): number {
  if (!Number.isInteger(value) || value < 1 || value > 1_000) {
    throw new ExperienceInputError(
      code,
      'La capacité doit être comprise entre 1 et 1 000 personnes.',
    );
  }
  return value;
}

function normalizeSessionCapacity(value: number | null | undefined): number | null | undefined {
  if (value === undefined || value === null) return value;
  return normalizeCapacity(value, 'EXPERIENCE_SESSION_CAPACITY_INVALID');
}

function normalizeQuantity(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 1_000) {
    throw new ExperienceInputError(
      'EXPERIENCE_QUANTITY_INVALID',
      'La quantité doit être comprise entre 1 et 1 000 personnes.',
    );
  }
  return value;
}

function normalizeDate(value: Date | string, code: 'EXPERIENCE_SESSION_TIME_INVALID'): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ExperienceInputError(code, 'La date de session est invalide.');
  }
  return date;
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.slice(-4).padStart(4, '•');
}

function serializeExperience(row: ExperienceRow): ExperienceView {
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    key: row.key,
    name: row.name,
    description: row.description,
    durationMinutes: row.durationMinutes,
    priceCents: row.priceCents,
    currency: row.currency,
    capacity: row.capacity,
    status: row.status,
    sessionCount: row._count.sessions,
    reservationCount: row._count.reservations,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializeSession(row: SessionRow): ExperienceSessionView {
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    experienceId: row.experienceId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    capacityOverride: row.capacityOverride,
    status: row.status,
    experience: row.experience,
    reservationCount: row._count.reservations,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializeReservation(row: ReservationRow): ExperienceReservationView {
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    experienceId: row.experienceId,
    sessionId: row.sessionId,
    customerId: row.customerId,
    reservationId: row.reservationId,
    quantity: row.quantity,
    unitPriceCents: row.unitPriceCents,
    totalPriceCents: row.totalPriceCents,
    currency: row.currency,
    status: row.status,
    experience: row.experience,
    session: row.session,
    customerName: row.customer?.name ?? null,
    phoneLast4: row.customer ? maskPhone(row.customer.phone) : null,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function assertRestaurantActive(restaurantId: string): Promise<void> {
  const restaurant = await db.restaurant.findFirst({
    where: { id: restaurantId, siteStatus: { notIn: ['ARCHIVED', 'SUSPENDED'] } },
    select: { id: true },
  });
  if (!restaurant) throw new ExperienceNotFoundError();
}

export async function createExperience(input: {
  restaurantId: string;
  key: string;
  name: string;
  description?: string | null;
  durationMinutes: number;
  priceCents: number;
  currency?: string;
  capacity: number;
  status?: ExperienceStatus;
  actor: string;
}): Promise<ExperienceView> {
  await assertRestaurantActive(input.restaurantId);
  const key = normalizeKey(input.key);
  const name = normalizeSafeText(
    input.name,
    'EXPERIENCE_NAME_INVALID',
    "Le nom de l'expérience",
    120,
  );
  const description = normalizeDescription(input.description);
  const durationMinutes = normalizeDuration(input.durationMinutes);
  const priceCents = normalizePrice(input.priceCents);
  const currency = normalizeCurrency(input.currency);
  const capacity = normalizeCapacity(input.capacity);

  try {
    const row = await db.experience.create({
      data: {
        restaurantId: input.restaurantId,
        key,
        name,
        description,
        durationMinutes,
        priceCents,
        currency,
        capacity,
        status: input.status ?? ExperienceStatus.DRAFT,
        createdByHash: hashActor(input.actor),
      },
      select: EXPERIENCE_SELECT,
    });
    return serializeExperience(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ExperienceConflictError('EXPERIENCE_KEY_CONFLICT');
    }
    throw error;
  }
}

export async function listExperiences(input: {
  restaurantId: string;
  status?: ExperienceStatus;
  limit?: number;
}): Promise<ExperienceView[]> {
  const limit = Math.min(Math.max(input.limit ?? MAX_LIST_LIMIT, 1), MAX_LIST_LIMIT);
  const rows = await db.experience.findMany({
    where: { restaurantId: input.restaurantId, ...(input.status ? { status: input.status } : {}) },
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    take: limit,
    select: EXPERIENCE_SELECT,
  });
  return rows.map(serializeExperience);
}

export async function updateExperience(input: {
  restaurantId: string;
  experienceId: string;
  name?: string;
  description?: string | null;
  durationMinutes?: number;
  priceCents?: number;
  currency?: string;
  capacity?: number;
  status?: ExperienceStatus;
}): Promise<ExperienceView> {
  const current = await db.experience.findFirst({
    where: { id: input.experienceId, restaurantId: input.restaurantId },
    select: EXPERIENCE_SELECT,
  });
  if (!current) throw new ExperienceNotFoundError();

  const data: Prisma.ExperienceUpdateInput = {};
  if (input.name !== undefined) {
    data.name = normalizeSafeText(
      input.name,
      'EXPERIENCE_NAME_INVALID',
      "Le nom de l'expérience",
      120,
    );
  }
  if (input.description !== undefined) data.description = normalizeDescription(input.description);
  if (input.durationMinutes !== undefined)
    data.durationMinutes = normalizeDuration(input.durationMinutes);
  if (input.priceCents !== undefined) data.priceCents = normalizePrice(input.priceCents);
  if (input.currency !== undefined) data.currency = normalizeCurrency(input.currency);
  if (input.capacity !== undefined) data.capacity = normalizeCapacity(input.capacity);
  if (input.status !== undefined) data.status = input.status;
  if (Object.keys(data).length === 0) return serializeExperience(current);

  return serializeExperience(
    await db.experience.update({ where: { id: current.id }, data, select: EXPERIENCE_SELECT }),
  );
}

export async function createExperienceSession(input: {
  restaurantId: string;
  experienceId: string;
  startsAt: Date | string;
  endsAt: Date | string;
  capacityOverride?: number | null;
  actor: string;
}): Promise<ExperienceSessionView> {
  const experience = await db.experience.findFirst({
    where: {
      id: input.experienceId,
      restaurantId: input.restaurantId,
      status: { not: ExperienceStatus.ARCHIVED },
    },
    select: { id: true },
  });
  if (!experience) throw new ExperienceNotFoundError();
  const startsAt = normalizeDate(input.startsAt, 'EXPERIENCE_SESSION_TIME_INVALID');
  const endsAt = normalizeDate(input.endsAt, 'EXPERIENCE_SESSION_TIME_INVALID');
  if (endsAt <= startsAt) {
    throw new ExperienceInputError(
      'EXPERIENCE_SESSION_TIME_INVALID',
      'La fin de session doit être postérieure au début.',
    );
  }
  const capacityOverride = normalizeSessionCapacity(input.capacityOverride);

  try {
    const row = await db.experienceSession.create({
      data: {
        restaurantId: input.restaurantId,
        experienceId: input.experienceId,
        startsAt,
        endsAt,
        capacityOverride,
        status: ExperienceSessionStatus.OPEN,
      },
      select: SESSION_SELECT,
    });
    return serializeSession(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ExperienceConflictError('EXPERIENCE_SESSION_CONFLICT');
    }
    throw error;
  }
}

export async function listExperienceSessions(input: {
  restaurantId: string;
  experienceId?: string;
  status?: ExperienceSessionStatus;
  from?: Date;
  to?: Date;
  limit?: number;
}): Promise<ExperienceSessionView[]> {
  const limit = Math.min(Math.max(input.limit ?? MAX_LIST_LIMIT, 1), MAX_LIST_LIMIT);
  const rows = await db.experienceSession.findMany({
    where: {
      restaurantId: input.restaurantId,
      ...(input.experienceId ? { experienceId: input.experienceId } : {}),
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

export async function updateExperienceSession(input: {
  restaurantId: string;
  experienceId?: string;
  sessionId: string;
  startsAt?: Date | string;
  endsAt?: Date | string;
  capacityOverride?: number | null;
  status?: ExperienceSessionStatus;
}): Promise<ExperienceSessionView> {
  const current = await db.experienceSession.findFirst({
    where: {
      id: input.sessionId,
      restaurantId: input.restaurantId,
      ...(input.experienceId ? { experienceId: input.experienceId } : {}),
    },
    select: SESSION_SELECT,
  });
  if (!current) throw new ExperienceSessionNotFoundError();
  const startsAt =
    input.startsAt === undefined
      ? current.startsAt
      : normalizeDate(input.startsAt, 'EXPERIENCE_SESSION_TIME_INVALID');
  const endsAt =
    input.endsAt === undefined
      ? current.endsAt
      : normalizeDate(input.endsAt, 'EXPERIENCE_SESSION_TIME_INVALID');
  if (endsAt <= startsAt) {
    throw new ExperienceInputError(
      'EXPERIENCE_SESSION_TIME_INVALID',
      'La fin de session doit être postérieure au début.',
    );
  }
  const data: Prisma.ExperienceSessionUpdateInput = {};
  if (input.startsAt !== undefined) data.startsAt = startsAt;
  if (input.endsAt !== undefined) data.endsAt = endsAt;
  if (input.capacityOverride !== undefined) {
    data.capacityOverride = normalizeSessionCapacity(input.capacityOverride);
  }
  if (input.status !== undefined) data.status = input.status;
  if (Object.keys(data).length === 0) return serializeSession(current);
  try {
    return serializeSession(
      await db.experienceSession.update({
        where: { id: current.id },
        data,
        select: SESSION_SELECT,
      }),
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ExperienceConflictError('EXPERIENCE_SESSION_CONFLICT');
    }
    throw error;
  }
}

async function findReservationByIdempotency(
  idempotencyKey: string | undefined,
): Promise<ReservationRow | null> {
  if (!idempotencyKey) return null;
  return db.experienceReservation.findUnique({
    where: { idempotencyKey },
    select: RESERVATION_SELECT,
  });
}

async function assertCustomer(input: { restaurantId: string; customerId: string }): Promise<void> {
  const customer = await db.customer.findFirst({
    where: {
      id: input.customerId,
      restaurantId: input.restaurantId,
      archivedAt: null,
      mergedIntoId: null,
    },
    select: { id: true },
  });
  if (!customer) throw new ExperienceCustomerNotFoundError();
}

async function assertReservation(input: {
  restaurantId: string;
  customerId: string | undefined;
  reservationId: string | undefined;
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
  if (!reservation) throw new ExperienceConflictError('EXPERIENCE_RESERVATION_INVALID');
}

function assertReplayMatches(
  row: ReservationRow,
  input: { experienceId: string; sessionId: string; quantity: number },
): void {
  if (
    row.experienceId !== input.experienceId ||
    row.sessionId !== input.sessionId ||
    row.quantity !== input.quantity
  ) {
    throw new ExperienceConflictError('EXPERIENCE_IDEMPOTENCY_CONFLICT');
  }
}

export async function reserveExperience(input: {
  restaurantId: string;
  experienceId: string;
  sessionId: string;
  customerId?: string;
  reservationId?: string;
  quantity: number;
  idempotencyKey?: string;
  actor: string;
  now?: Date;
}): Promise<ExperienceReservationMutationResult> {
  const now = input.now ?? new Date();
  const quantity = normalizeQuantity(input.quantity);
  const rawIdempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const idempotencyKey = rawIdempotencyKey
    ? hashIdempotencyKey(input.restaurantId, rawIdempotencyKey)
    : undefined;
  const replay = await findReservationByIdempotency(idempotencyKey);
  if (replay) {
    assertReplayMatches(replay, input);
    return { ...serializeReservation(replay), replayed: true };
  }

  const session = await db.experienceSession.findFirst({
    where: {
      id: input.sessionId,
      restaurantId: input.restaurantId,
      experienceId: input.experienceId,
    },
    select: SESSION_SELECT,
  });
  if (!session) throw new ExperienceSessionNotFoundError();
  if (session.status !== ExperienceSessionStatus.OPEN) {
    throw new ExperienceConflictError('EXPERIENCE_SESSION_CLOSED');
  }
  if (session.startsAt <= now) throw new ExperienceConflictError('EXPERIENCE_SESSION_IN_PAST');
  if (input.customerId)
    await assertCustomer({ restaurantId: input.restaurantId, customerId: input.customerId });
  await assertReservation({
    restaurantId: input.restaurantId,
    customerId: input.customerId,
    reservationId: input.reservationId,
  });

  if (session.experience.status !== ExperienceStatus.ACTIVE) {
    throw new ExperienceConflictError('EXPERIENCE_NOT_ACTIVE');
  }

  try {
    const row = await db.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`experience:${input.restaurantId}:${input.sessionId}`}))`,
      );
      const currentSession = await tx.experienceSession.findFirst({
        where: {
          id: input.sessionId,
          restaurantId: input.restaurantId,
          experienceId: input.experienceId,
        },
        select: SESSION_SELECT,
      });
      if (!currentSession) throw new ExperienceSessionNotFoundError();
      if (currentSession.status !== ExperienceSessionStatus.OPEN) {
        throw new ExperienceConflictError('EXPERIENCE_SESSION_CLOSED');
      }
      if (currentSession.experience.status !== ExperienceStatus.ACTIVE) {
        throw new ExperienceConflictError('EXPERIENCE_NOT_ACTIVE');
      }
      if (currentSession.startsAt <= now) {
        throw new ExperienceConflictError('EXPERIENCE_SESSION_IN_PAST');
      }
      const booked = await tx.experienceReservation.findMany({
        where: {
          sessionId: input.sessionId,
          restaurantId: input.restaurantId,
          status: ExperienceReservationStatus.CONFIRMED,
        },
        select: { quantity: true },
      });
      const used = booked.reduce((sum, item) => sum + item.quantity, 0);
      const effectiveCapacity =
        currentSession.capacityOverride ?? currentSession.experience.capacity;
      if (used + quantity > effectiveCapacity) {
        throw new ExperienceConflictError('EXPERIENCE_CAPACITY_EXCEEDED');
      }
      return tx.experienceReservation.create({
        data: {
          restaurantId: input.restaurantId,
          experienceId: input.experienceId,
          sessionId: input.sessionId,
          customerId: input.customerId,
          reservationId: input.reservationId,
          idempotencyKey,
          quantity,
          unitPriceCents: currentSession.experience.priceCents,
          totalPriceCents: currentSession.experience.priceCents * quantity,
          currency: currentSession.experience.currency,
          status: ExperienceReservationStatus.CONFIRMED,
          createdByHash: hashActor(input.actor),
        },
        select: RESERVATION_SELECT,
      });
    });
    return { ...serializeReservation(row), replayed: false };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      idempotencyKey
    ) {
      const raced = await findReservationByIdempotency(idempotencyKey);
      if (raced) {
        assertReplayMatches(raced, input);
        return { ...serializeReservation(raced), replayed: true };
      }
    }
    throw error;
  }
}

export async function listExperienceReservations(input: {
  restaurantId: string;
  experienceId?: string;
  sessionId?: string;
  customerId?: string;
  status?: ExperienceReservationStatus;
  limit?: number;
}): Promise<ExperienceReservationView[]> {
  const limit = Math.min(Math.max(input.limit ?? MAX_LIST_LIMIT, 1), MAX_LIST_LIMIT);
  const rows = await db.experienceReservation.findMany({
    where: {
      restaurantId: input.restaurantId,
      ...(input.experienceId ? { experienceId: input.experienceId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.customerId ? { customerId: input.customerId } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: RESERVATION_SELECT,
  });
  return rows.map(serializeReservation);
}

export async function cancelExperienceReservation(input: {
  restaurantId: string;
  reservationId: string;
  actor: string;
  now?: Date;
}): Promise<ExperienceReservationMutationResult> {
  const now = input.now ?? new Date();
  const result = await db.experienceReservation.updateMany({
    where: {
      id: input.reservationId,
      restaurantId: input.restaurantId,
      status: ExperienceReservationStatus.CONFIRMED,
    },
    data: {
      status: ExperienceReservationStatus.CANCELLED,
      cancelledAt: now,
      cancelledByHash: hashActor(input.actor),
    },
  });
  if ((result as { count?: number }).count !== 1) {
    const current = await db.experienceReservation.findFirst({
      where: { id: input.reservationId, restaurantId: input.restaurantId },
      select: RESERVATION_SELECT,
    });
    if (!current) throw new ExperienceReservationNotFoundError();
    if (current.status === ExperienceReservationStatus.CANCELLED) {
      return { ...serializeReservation(current), replayed: true };
    }
    throw new ExperienceReservationStateError('EXPERIENCE_RESERVATION_CANCELLED');
  }
  const row = await db.experienceReservation.findFirst({
    where: { id: input.reservationId, restaurantId: input.restaurantId },
    select: RESERVATION_SELECT,
  });
  if (!row) throw new ExperienceReservationNotFoundError();
  return { ...serializeReservation(row), replayed: false };
}

export async function expireExperienceSessions(input?: {
  now?: Date;
  limit?: number;
}): Promise<number> {
  const now = input?.now ?? new Date();
  const limit = Math.min(Math.max(input?.limit ?? MAX_EXPIRY_SCAN, 1), MAX_EXPIRY_SCAN);
  const rows = await db.experienceSession.findMany({
    where: { status: ExperienceSessionStatus.OPEN, endsAt: { lte: now } },
    orderBy: { endsAt: 'asc' },
    take: limit,
    select: { id: true },
  });
  if (rows.length === 0) return 0;
  const result = await db.experienceSession.updateMany({
    where: { id: { in: rows.map((row) => row.id) }, status: ExperienceSessionStatus.OPEN },
    data: { status: ExperienceSessionStatus.CLOSED },
  });
  return (result as { count?: number }).count ?? 0;
}
