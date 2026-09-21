import { Prisma, ReservationPaymentStatus, ReservationPaymentType } from '@prisma/client';
import { db } from '../../shared/db/client';
import { transitionProjection } from '../../shared/reservations/reservation-state';

export const PAYMENT_AMOUNT_MODES = ['FIXED', 'PER_PERSON'] as const;
export type ReservationPaymentAmountMode = (typeof PAYMENT_AMOUNT_MODES)[number];

const PAYMENT_STATUS_TRANSITIONS: Readonly<
  Record<ReservationPaymentStatus, readonly ReservationPaymentStatus[]>
> = {
  REQUIRES_PAYMENT_METHOD: [
    ReservationPaymentStatus.REQUIRES_ACTION,
    ReservationPaymentStatus.AUTHORIZED,
    ReservationPaymentStatus.CAPTURED,
    ReservationPaymentStatus.FAILED,
    ReservationPaymentStatus.CANCELLED,
    ReservationPaymentStatus.EXPIRED,
  ],
  REQUIRES_ACTION: [
    ReservationPaymentStatus.AUTHORIZED,
    ReservationPaymentStatus.CAPTURED,
    ReservationPaymentStatus.FAILED,
    ReservationPaymentStatus.CANCELLED,
    ReservationPaymentStatus.EXPIRED,
  ],
  AUTHORIZED: [
    ReservationPaymentStatus.CAPTURED,
    ReservationPaymentStatus.PARTIALLY_REFUNDED,
    ReservationPaymentStatus.REFUNDED,
    ReservationPaymentStatus.CANCELLED,
  ],
  CAPTURED: [ReservationPaymentStatus.PARTIALLY_REFUNDED, ReservationPaymentStatus.REFUNDED],
  PARTIALLY_REFUNDED: [ReservationPaymentStatus.REFUNDED],
  REFUNDED: [],
  FAILED: [ReservationPaymentStatus.REQUIRES_PAYMENT_METHOD, ReservationPaymentStatus.CANCELLED],
  CANCELLED: [],
  EXPIRED: [],
};

const POLICY_SELECT = {
  id: true,
  restaurantId: true,
  version: true,
  type: true,
  amountMode: true,
  amount: true,
  minPartySize: true,
  cancellationHours: true,
  rules: true,
  activeFrom: true,
  activeUntil: true,
  createdAt: true,
} as const;

const PAYMENT_SELECT = {
  id: true,
  restaurantId: true,
  reservationId: true,
  policyId: true,
  status: true,
  amount: true,
  currency: true,
  stripeAccountId: true,
  stripeSetupIntentId: true,
  stripePaymentIntentId: true,
  idempotencyKey: true,
  policySnapshot: true,
  expiresAt: true,
  failureCode: true,
  lastProviderEventAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type PolicyRow = Prisma.ReservationPaymentPolicyGetPayload<{ select: typeof POLICY_SELECT }>;
type PaymentRow = Prisma.ReservationPaymentGetPayload<{ select: typeof PAYMENT_SELECT }>;

export class ReservationPaymentInputError extends Error {
  constructor(
    readonly code:
      | 'PAYMENT_POLICY_INVALID'
      | 'PAYMENT_AMOUNT_INVALID'
      | 'PAYMENT_IDEMPOTENCY_INVALID'
      | 'PAYMENT_EXPIRY_INVALID'
      | 'PAYMENT_EVENT_INVALID'
      | 'PAYMENT_CURRENCY_MISMATCH'
      | 'PAYMENT_AMOUNT_MISMATCH',
    message: string,
  ) {
    super(message);
    this.name = 'ReservationPaymentInputError';
  }
}

export class ReservationPaymentNotFoundError extends Error {
  readonly code = 'RESERVATION_PAYMENT_NOT_FOUND';

  constructor() {
    super('Reservation payment not found');
    this.name = 'ReservationPaymentNotFoundError';
  }
}

export class ReservationPaymentPolicyNotFoundError extends Error {
  readonly code = 'RESERVATION_PAYMENT_POLICY_NOT_FOUND';

  constructor() {
    super('Reservation payment policy not found');
    this.name = 'ReservationPaymentPolicyNotFoundError';
  }
}

export class ReservationPaymentReservationNotFoundError extends Error {
  readonly code = 'RESERVATION_NOT_FOUND';

  constructor() {
    super('Reservation not found');
    this.name = 'ReservationPaymentReservationNotFoundError';
  }
}

export class ReservationPaymentStateError extends Error {
  constructor(
    readonly code:
      | 'PAYMENT_TRANSITION_INVALID'
      | 'PAYMENT_IDEMPOTENCY_CONFLICT'
      | 'PAYMENT_POLICY_VERSION_CONFLICT',
  ) {
    super(
      code === 'PAYMENT_TRANSITION_INVALID'
        ? 'Reservation payment transition is not allowed'
        : code === 'PAYMENT_IDEMPOTENCY_CONFLICT'
          ? 'Payment idempotency key already belongs to another payment'
          : 'Reservation payment policy version already exists',
    );
    this.name = 'ReservationPaymentStateError';
  }
}

export interface CreateReservationPaymentPolicyInput {
  restaurantId: string;
  type: ReservationPaymentType;
  amountMode: ReservationPaymentAmountMode;
  amount: string | number;
  minPartySize?: number | null;
  cancellationHours?: number;
  rules?: Record<string, unknown>;
  activeFrom?: Date;
  activeUntil?: Date | null;
  version?: number;
}

export interface ReservationPaymentPolicyView {
  id: string;
  restaurantId: string;
  version: number;
  type: ReservationPaymentType;
  amountMode: ReservationPaymentAmountMode;
  amount: string;
  minPartySize: number | null;
  cancellationHours: number;
  rules: Record<string, unknown>;
  activeFrom: Date;
  activeUntil: Date | null;
  createdAt: Date;
}

export interface ReservationPaymentView {
  id: string;
  restaurantId: string;
  reservationId: string;
  policyId: string;
  status: ReservationPaymentStatus;
  amount: string;
  currency: string;
  hasStripeAccount: boolean;
  hasSetupIntent: boolean;
  hasPaymentIntent: boolean;
  idempotencyKey: string;
  expiresAt: Date | null;
  failureCode: string | null;
  lastProviderEventAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReservationPaymentPreparation {
  id: string | null;
  reservationId: string;
  policyId: string;
  type: ReservationPaymentType;
  status: ReservationPaymentStatus;
  amount: string;
  currency: string;
  idempotencyKey: string;
  expiresAt: Date;
  dryRun: boolean;
  provider: 'stripe';
  providerConfigured: false;
  requiresProviderSetup: true;
}

export interface ReservationPaymentProviderEventInput {
  restaurantId: string;
  paymentId: string;
  providerEventId: string;
  eventType: string;
  occurredAt: Date;
  payloadHash: string;
  amount?: string | number;
  currency?: string;
  stripeSetupIntentId?: string;
  stripePaymentIntentId?: string;
  failureCode?: string;
}

export interface ReservationPaymentProviderEventResult {
  eventId: string;
  paymentId: string;
  resultingStatus: ReservationPaymentStatus | null;
  changed: boolean;
  duplicate: boolean;
  stale: boolean;
  reservationConfirmed: boolean;
  ignoredReason?: 'UNSUPPORTED_EVENT' | 'STALE_EVENT';
}

function assertPlainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReservationPaymentInputError(
      'PAYMENT_POLICY_INVALID',
      'Les règles de paiement doivent être un objet JSON.',
    );
  }
  return value as Record<string, unknown>;
}

function normalizeRules(value: Record<string, unknown> | undefined): Record<string, unknown> {
  const rules = value ?? {};
  assertPlainObject(rules);
  let serialized: string;
  try {
    serialized = JSON.stringify(rules);
  } catch {
    throw new ReservationPaymentInputError(
      'PAYMENT_POLICY_INVALID',
      'Les règles de paiement doivent être sérialisables.',
    );
  }
  if (serialized.length > 8_192) {
    throw new ReservationPaymentInputError(
      'PAYMENT_POLICY_INVALID',
      'Les règles de paiement sont trop volumineuses.',
    );
  }
  return JSON.parse(serialized) as Record<string, unknown>;
}

function normalizeMoney(value: string | number): Prisma.Decimal {
  const raw = typeof value === 'number' ? String(value) : value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new ReservationPaymentInputError(
      'PAYMENT_AMOUNT_INVALID',
      'Le montant doit être positif et contenir au plus deux décimales.',
    );
  }
  const amount = new Prisma.Decimal(raw);
  if (!amount.greaterThan(0) || amount.greaterThanOrEqualTo(100_000)) {
    throw new ReservationPaymentInputError(
      'PAYMENT_AMOUNT_INVALID',
      'Le montant doit être compris entre 0 et 100 000 euros.',
    );
  }
  return amount;
}

function normalizeIdempotencyKey(value: string): string {
  const key = value.trim();
  if (key.length < 8 || key.length > 200 || /[\u0000-\u001f\u007f]/.test(key)) {
    throw new ReservationPaymentInputError(
      'PAYMENT_IDEMPOTENCY_INVALID',
      'La clé d’idempotence doit contenir entre 8 et 200 caractères sûrs.',
    );
  }
  return key;
}

function normalizeCurrency(value: string | undefined): string {
  const currency = (value ?? 'EUR').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ReservationPaymentInputError(
      'PAYMENT_POLICY_INVALID',
      'La devise doit être un code ISO 4217.',
    );
  }
  return currency;
}

function normalizeProviderId(value: string, field: string): string {
  const id = value.trim();
  if (!id || id.length > 256 || /[\u0000-\u001f\u007f]/.test(id)) {
    throw new ReservationPaymentInputError('PAYMENT_EVENT_INVALID', `${field} est invalide.`);
  }
  return id;
}

function normalizePayloadHash(value: string): string {
  const hash = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new ReservationPaymentInputError('PAYMENT_EVENT_INVALID', 'payloadHash est invalide.');
  }
  return hash;
}

function policySnapshot(policy: PolicyRow): Prisma.InputJsonObject {
  return {
    id: policy.id,
    version: policy.version,
    type: policy.type,
    amountMode: policy.amountMode,
    amount: policy.amount.toFixed(2),
    minPartySize: policy.minPartySize,
    cancellationHours: policy.cancellationHours,
    rules: normalizeRules(policy.rules as Record<string, unknown>) as Prisma.InputJsonValue,
    activeFrom: policy.activeFrom.toISOString(),
    activeUntil: policy.activeUntil?.toISOString() ?? null,
  };
}

function asRules(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function serializePolicy(row: PolicyRow): ReservationPaymentPolicyView {
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    version: row.version,
    type: row.type,
    amountMode: row.amountMode as ReservationPaymentAmountMode,
    amount: row.amount.toFixed(2),
    minPartySize: row.minPartySize,
    cancellationHours: row.cancellationHours,
    rules: asRules(row.rules),
    activeFrom: row.activeFrom,
    activeUntil: row.activeUntil,
    createdAt: row.createdAt,
  };
}

function serializePayment(row: PaymentRow): ReservationPaymentView {
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    reservationId: row.reservationId,
    policyId: row.policyId,
    status: row.status,
    amount: row.amount.toFixed(2),
    currency: row.currency,
    hasStripeAccount: Boolean(row.stripeAccountId),
    hasSetupIntent: Boolean(row.stripeSetupIntentId),
    hasPaymentIntent: Boolean(row.stripePaymentIntentId),
    idempotencyKey: row.idempotencyKey,
    expiresAt: row.expiresAt,
    failureCode: row.failureCode,
    lastProviderEventAt: row.lastProviderEventAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function computeReservationPaymentAmount(
  policy: Pick<PolicyRow, 'amount' | 'amountMode'>,
  partySize: number,
): Prisma.Decimal {
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 100) {
    throw new ReservationPaymentInputError(
      'PAYMENT_POLICY_INVALID',
      'Le nombre de couverts doit être compris entre 1 et 100.',
    );
  }
  const amount = policy.amountMode === 'PER_PERSON' ? policy.amount.mul(partySize) : policy.amount;
  if (!amount.greaterThan(0) || amount.greaterThanOrEqualTo(100_000)) {
    throw new ReservationPaymentInputError(
      'PAYMENT_AMOUNT_INVALID',
      'Le montant calculé est hors limites.',
    );
  }
  return amount.toDecimalPlaces(2);
}

export function canTransitionReservationPayment(
  from: ReservationPaymentStatus,
  to: ReservationPaymentStatus,
): boolean {
  return from === to || PAYMENT_STATUS_TRANSITIONS[from].includes(to);
}

export function reservationPaymentStatusForProviderEvent(
  eventType: string,
): ReservationPaymentStatus | null {
  switch (eventType) {
    case 'setup_intent.succeeded':
      return ReservationPaymentStatus.AUTHORIZED;
    case 'payment_intent.requires_action':
      return ReservationPaymentStatus.REQUIRES_ACTION;
    case 'payment_intent.succeeded':
      return ReservationPaymentStatus.CAPTURED;
    case 'payment_intent.payment_failed':
      return ReservationPaymentStatus.FAILED;
    case 'payment_intent.canceled':
      return ReservationPaymentStatus.CANCELLED;
    case 'payment_intent.expired':
      return ReservationPaymentStatus.EXPIRED;
    case 'charge.refunded':
      return ReservationPaymentStatus.REFUNDED;
    default:
      return null;
  }
}

function assertPolicyInput(input: CreateReservationPaymentPolicyInput): {
  amount: Prisma.Decimal;
  rules: Record<string, unknown>;
  activeFrom: Date;
  activeUntil: Date | null;
} {
  if (!Object.values(ReservationPaymentType).includes(input.type)) {
    throw new ReservationPaymentInputError('PAYMENT_POLICY_INVALID', 'Type de paiement invalide.');
  }
  if (!PAYMENT_AMOUNT_MODES.includes(input.amountMode)) {
    throw new ReservationPaymentInputError(
      'PAYMENT_POLICY_INVALID',
      'Le mode de montant doit être FIXED ou PER_PERSON.',
    );
  }
  const amount = normalizeMoney(input.amount);
  const minPartySize = input.minPartySize ?? null;
  if (
    minPartySize !== null &&
    (!Number.isInteger(minPartySize) || minPartySize < 1 || minPartySize > 100)
  ) {
    throw new ReservationPaymentInputError(
      'PAYMENT_POLICY_INVALID',
      'Le seuil de couverts est compris entre 1 et 100.',
    );
  }
  const cancellationHours = input.cancellationHours ?? 24;
  if (!Number.isInteger(cancellationHours) || cancellationHours < 0 || cancellationHours > 720) {
    throw new ReservationPaymentInputError(
      'PAYMENT_POLICY_INVALID',
      'Le délai d’annulation est compris entre 0 et 720 heures.',
    );
  }
  const activeFrom = input.activeFrom ?? new Date();
  if (Number.isNaN(activeFrom.getTime())) {
    throw new ReservationPaymentInputError('PAYMENT_POLICY_INVALID', 'activeFrom est invalide.');
  }
  const activeUntil = input.activeUntil ?? null;
  if (activeUntil && (Number.isNaN(activeUntil.getTime()) || activeUntil <= activeFrom)) {
    throw new ReservationPaymentInputError(
      'PAYMENT_POLICY_INVALID',
      'activeUntil doit être postérieur à activeFrom.',
    );
  }
  return { amount, rules: normalizeRules(input.rules), activeFrom, activeUntil };
}

export async function createReservationPaymentPolicy(
  input: CreateReservationPaymentPolicyInput,
): Promise<ReservationPaymentPolicyView> {
  const normalized = assertPolicyInput(input);
  let version = input.version;
  if (version === undefined) {
    const latest = await db.reservationPaymentPolicy.findFirst({
      where: { restaurantId: input.restaurantId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    version = (latest?.version ?? 0) + 1;
  }
  if (!Number.isInteger(version) || version < 1 || version > 10_000) {
    throw new ReservationPaymentInputError('PAYMENT_POLICY_INVALID', 'version est invalide.');
  }

  let row: PolicyRow;
  try {
    row = await db.reservationPaymentPolicy.create({
      data: {
        restaurantId: input.restaurantId,
        version,
        type: input.type,
        amountMode: input.amountMode,
        amount: normalized.amount,
        minPartySize: input.minPartySize ?? null,
        cancellationHours: input.cancellationHours ?? 24,
        rules: normalized.rules as Prisma.InputJsonValue,
        activeFrom: normalized.activeFrom,
        activeUntil: normalized.activeUntil,
      },
      select: POLICY_SELECT,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ReservationPaymentStateError('PAYMENT_POLICY_VERSION_CONFLICT');
    }
    throw error;
  }
  return serializePolicy(row);
}

export async function listReservationPaymentPolicies(
  restaurantId: string,
): Promise<ReservationPaymentPolicyView[]> {
  const rows = await db.reservationPaymentPolicy.findMany({
    where: { restaurantId },
    orderBy: [{ version: 'desc' }],
    select: POLICY_SELECT,
  });
  return rows.map(serializePolicy);
}

async function findPolicy(
  restaurantId: string,
  policyId: string | undefined,
  at: Date,
): Promise<PolicyRow> {
  const row = policyId
    ? await db.reservationPaymentPolicy.findFirst({
        where: { id: policyId, restaurantId },
        select: POLICY_SELECT,
      })
    : await db.reservationPaymentPolicy.findFirst({
        where: {
          restaurantId,
          activeFrom: { lte: at },
          OR: [{ activeUntil: null }, { activeUntil: { gt: at } }],
        },
        orderBy: { version: 'desc' },
        select: POLICY_SELECT,
      });
  if (!row) throw new ReservationPaymentPolicyNotFoundError();
  return row;
}

export async function prepareReservationPayment(input: {
  restaurantId: string;
  reservationId: string;
  policyId?: string;
  idempotencyKey: string;
  currency?: string;
  expiresAt?: Date;
  now?: Date;
  dryRun?: boolean;
}): Promise<ReservationPaymentPreparation | ReservationPaymentView> {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const now = input.now ?? new Date();
  const reservation = await db.reservation.findFirst({
    where: { id: input.reservationId, restaurantId: input.restaurantId },
    select: {
      id: true,
      restaurantId: true,
      partySize: true,
      status: true,
      state: true,
    },
  });
  if (!reservation) throw new ReservationPaymentReservationNotFoundError();
  if (reservation.status === 'CANCELLED' || reservation.status === 'NO_SHOW') {
    throw new ReservationPaymentStateError('PAYMENT_TRANSITION_INVALID');
  }

  const policy = await findPolicy(input.restaurantId, input.policyId, now);
  if (policy.minPartySize !== null && reservation.partySize < policy.minPartySize) {
    throw new ReservationPaymentStateError('PAYMENT_TRANSITION_INVALID');
  }
  const amount = computeReservationPaymentAmount(policy, reservation.partySize);
  const currency = normalizeCurrency(input.currency);
  const expiresAt = input.expiresAt ?? new Date(now.getTime() + 30 * 60 * 1000);
  if (
    Number.isNaN(expiresAt.getTime()) ||
    expiresAt <= now ||
    expiresAt > new Date(now.getTime() + 24 * 60 * 60 * 1000)
  ) {
    throw new ReservationPaymentInputError(
      'PAYMENT_EXPIRY_INVALID',
      'expiresAt doit être dans les prochaines 24 heures.',
    );
  }

  if (input.dryRun !== false) {
    return {
      id: null,
      reservationId: reservation.id,
      policyId: policy.id,
      type: policy.type,
      status: ReservationPaymentStatus.REQUIRES_PAYMENT_METHOD,
      amount: amount.toFixed(2),
      currency,
      idempotencyKey,
      expiresAt,
      dryRun: true,
      provider: 'stripe',
      providerConfigured: false,
      requiresProviderSetup: true,
    };
  }

  const existing = await db.reservationPayment.findUnique({
    where: { idempotencyKey },
    select: PAYMENT_SELECT,
  });
  if (existing) {
    if (
      existing.restaurantId !== input.restaurantId ||
      existing.reservationId !== reservation.id ||
      existing.policyId !== policy.id ||
      !existing.amount.equals(amount) ||
      existing.currency !== currency
    ) {
      throw new ReservationPaymentStateError('PAYMENT_IDEMPOTENCY_CONFLICT');
    }
    return serializePayment(existing);
  }

  try {
    const row = await db.reservationPayment.create({
      data: {
        restaurantId: input.restaurantId,
        reservationId: reservation.id,
        policyId: policy.id,
        status: ReservationPaymentStatus.REQUIRES_PAYMENT_METHOD,
        amount,
        currency,
        idempotencyKey,
        policySnapshot: policySnapshot(policy),
        expiresAt,
      },
      select: PAYMENT_SELECT,
    });
    return serializePayment(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const replay = await db.reservationPayment.findUnique({
        where: { idempotencyKey },
        select: PAYMENT_SELECT,
      });
      if (replay) {
        if (
          replay.restaurantId !== input.restaurantId ||
          replay.reservationId !== reservation.id ||
          replay.policyId !== policy.id ||
          !replay.amount.equals(amount) ||
          replay.currency !== currency
        ) {
          throw new ReservationPaymentStateError('PAYMENT_IDEMPOTENCY_CONFLICT');
        }
        return serializePayment(replay);
      }
    }
    throw error;
  }
}

export async function getReservationPayment(
  restaurantId: string,
  reservationId: string,
): Promise<ReservationPaymentView | null> {
  const row = await db.reservationPayment.findFirst({
    where: { restaurantId, reservationId },
    orderBy: [{ createdAt: 'desc' }],
    select: PAYMENT_SELECT,
  });
  return row ? serializePayment(row) : null;
}

export async function transitionReservationPayment(input: {
  restaurantId: string;
  paymentId: string;
  to: ReservationPaymentStatus;
  failureCode?: string | null;
}): Promise<ReservationPaymentView> {
  const current = await db.reservationPayment.findFirst({
    where: { id: input.paymentId, restaurantId: input.restaurantId },
    select: PAYMENT_SELECT,
  });
  if (!current) throw new ReservationPaymentNotFoundError();
  if (!canTransitionReservationPayment(current.status, input.to)) {
    throw new ReservationPaymentStateError('PAYMENT_TRANSITION_INVALID');
  }
  if (current.status === input.to) return serializePayment(current);
  const row = await db.reservationPayment.update({
    where: { id: current.id },
    data: {
      status: input.to,
      failureCode: input.failureCode ?? null,
    },
    select: PAYMENT_SELECT,
  });
  return serializePayment(row);
}

export async function applyReservationPaymentProviderEvent(
  input: ReservationPaymentProviderEventInput,
): Promise<ReservationPaymentProviderEventResult> {
  const providerEventId = normalizeProviderId(input.providerEventId, 'providerEventId');
  const eventType = normalizeProviderId(input.eventType, 'eventType');
  const payloadHash = normalizePayloadHash(input.payloadHash);
  const resultingStatus = reservationPaymentStatusForProviderEvent(eventType);

  const existingEvent = await db.reservationPaymentEvent.findUnique({
    where: { providerEventId },
    select: { id: true, paymentId: true, resultingStatus: true },
  });
  if (existingEvent) {
    return {
      eventId: existingEvent.id,
      paymentId: existingEvent.paymentId,
      resultingStatus: existingEvent.resultingStatus,
      changed: false,
      duplicate: true,
      stale: false,
      reservationConfirmed: false,
    };
  }

  const payment = await db.reservationPayment.findFirst({
    where: { id: input.paymentId, restaurantId: input.restaurantId },
    select: PAYMENT_SELECT,
  });
  if (!payment) throw new ReservationPaymentNotFoundError();

  if (!resultingStatus) {
    const event = await db.reservationPaymentEvent.create({
      data: {
        restaurantId: input.restaurantId,
        paymentId: payment.id,
        providerEventId,
        eventType,
        resultingStatus: null,
        payloadHash,
        occurredAt: input.occurredAt,
      },
      select: { id: true },
    });
    return {
      eventId: event.id,
      paymentId: payment.id,
      resultingStatus: null,
      changed: false,
      duplicate: false,
      stale: false,
      reservationConfirmed: false,
      ignoredReason: 'UNSUPPORTED_EVENT',
    };
  }

  if (input.currency && normalizeCurrency(input.currency) !== payment.currency) {
    throw new ReservationPaymentInputError(
      'PAYMENT_CURRENCY_MISMATCH',
      'La devise du provider ne correspond pas au paiement.',
    );
  }
  if (input.amount !== undefined && !normalizeMoney(input.amount).equals(payment.amount)) {
    throw new ReservationPaymentInputError(
      'PAYMENT_AMOUNT_MISMATCH',
      'Le montant du provider ne correspond pas au paiement.',
    );
  }
  if (payment.lastProviderEventAt && input.occurredAt < payment.lastProviderEventAt) {
    const event = await db.reservationPaymentEvent.create({
      data: {
        restaurantId: input.restaurantId,
        paymentId: payment.id,
        providerEventId,
        eventType,
        resultingStatus: payment.status,
        payloadHash,
        occurredAt: input.occurredAt,
      },
      select: { id: true },
    });
    return {
      eventId: event.id,
      paymentId: payment.id,
      resultingStatus: payment.status,
      changed: false,
      duplicate: false,
      stale: true,
      reservationConfirmed: false,
      ignoredReason: 'STALE_EVENT',
    };
  }
  if (!canTransitionReservationPayment(payment.status, resultingStatus)) {
    throw new ReservationPaymentStateError('PAYMENT_TRANSITION_INVALID');
  }

  const [event, updated, reservationConfirmed] = await db.$transaction(async (tx) => {
    const duplicateInTx = await tx.reservationPaymentEvent.findUnique({
      where: { providerEventId },
      select: { id: true, paymentId: true, resultingStatus: true },
    });
    if (duplicateInTx) return [duplicateInTx, null, false] as const;

    const updateData: Prisma.ReservationPaymentUpdateInput = {
      status: resultingStatus,
      lastProviderEventAt: input.occurredAt,
      ...(input.failureCode ? { failureCode: input.failureCode.slice(0, 120) } : {}),
      ...(input.stripeSetupIntentId
        ? {
            stripeSetupIntentId: normalizeProviderId(
              input.stripeSetupIntentId,
              'stripeSetupIntentId',
            ),
          }
        : {}),
      ...(input.stripePaymentIntentId
        ? {
            stripePaymentIntentId: normalizeProviderId(
              input.stripePaymentIntentId,
              'stripePaymentIntentId',
            ),
          }
        : {}),
    };
    const next = await tx.reservationPayment.update({
      where: { id: payment.id },
      data: updateData,
      select: PAYMENT_SELECT,
    });
    const createdEvent = await tx.reservationPaymentEvent.create({
      data: {
        restaurantId: input.restaurantId,
        paymentId: payment.id,
        providerEventId,
        eventType,
        resultingStatus,
        payloadHash,
        occurredAt: input.occurredAt,
      },
      select: { id: true, paymentId: true, resultingStatus: true },
    });

    let reservationConfirmed = false;
    if (
      resultingStatus === ReservationPaymentStatus.AUTHORIZED ||
      resultingStatus === ReservationPaymentStatus.CAPTURED
    ) {
      const confirmed = await tx.reservation.updateMany({
        where: {
          id: payment.reservationId,
          restaurantId: input.restaurantId,
          state: 'PENDING',
        },
        // La ligne visée est `state = PENDING`, qui porte `status = CONFIRMED`
        // (projection lossy, voir reservation-state.ts) : confirmer le paiement
        // projette donc CONFIRMED → CONFIRMED.
        data: transitionProjection('CONFIRMED', 'CONFIRMED'),
      });
      reservationConfirmed = confirmed.count > 0;
    }

    return [createdEvent, next, reservationConfirmed] as const;
  });

  if (!updated) {
    return {
      eventId: event.id,
      paymentId: event.paymentId,
      resultingStatus: event.resultingStatus,
      changed: false,
      duplicate: true,
      stale: false,
      reservationConfirmed: false,
    };
  }

  return {
    eventId: event.id,
    paymentId: payment.id,
    resultingStatus,
    changed: payment.status !== resultingStatus,
    duplicate: false,
    stale: false,
    reservationConfirmed,
  };
}

export async function expireReservationPayments(now = new Date()): Promise<number> {
  const result = await db.reservationPayment.updateMany({
    where: {
      status: {
        in: [
          ReservationPaymentStatus.REQUIRES_PAYMENT_METHOD,
          ReservationPaymentStatus.REQUIRES_ACTION,
        ],
      },
      expiresAt: { lte: now },
    },
    data: { status: ReservationPaymentStatus.EXPIRED },
  });
  return result.count;
}

export { PAYMENT_SELECT, POLICY_SELECT, serializePayment, serializePolicy };
