import {
  Prisma,
  type Customer,
  type CustomerDataSource,
  type CustomerIdentityType,
  type CustomerMetricSnapshot,
} from '@prisma/client';
import { db } from '../../shared/db/client';
import { logger } from '../../shared/logger/pino';

type CrmWriter = Pick<
  Prisma.TransactionClient,
  | 'customer'
  | 'customerIdentity'
  | 'customerTimelineEvent'
  | 'customerMetricSnapshot'
  | 'customerPreference'
  | 'customerTag'
  | 'customerTagAssignment'
  | 'reservation'
>;

export type CustomerIdentitySource = 'VOICE' | 'RESERVATION' | 'MANUAL' | 'POS' | 'IMPORT';

export interface CustomerIdentityUpsertInput {
  restaurantId: string;
  customerId: string;
  type: CustomerIdentityType;
  value: string;
  source: CustomerIdentitySource | string;
  verifiedAt?: Date | null;
}

export type CustomerIdentityUpsertResult =
  | { status: 'created' | 'updated' | 'unchanged'; identityId: string; customerId: string }
  | { status: 'conflict'; identityId: string; customerId: string };

export interface CustomerTimelineEventInput {
  restaurantId: string;
  customerId: string;
  eventType: string;
  sourceType: string;
  sourceId?: string | null;
  dedupeKey: string;
  occurredAt?: Date;
  summaryCode: string;
  metadata?: Record<string, unknown>;
}

export interface CustomerMetricSnapshotInput {
  restaurantId: string;
  customerId: string;
  now?: Date;
}

export type CustomerMetricSnapshotRepairValues = {
  lastHonoredAt: Date | null;
  nextReservationAt: Date | null;
  honored30d: number;
  honored90d: number;
  honored365d: number;
  cancelled365d: number;
  noShow365d: number;
  covers365d: number;
  estimatedSpend365d: Prisma.Decimal;
  actualSpend365d: Prisma.Decimal | null;
  actualLifetimeSpend: Prisma.Decimal | null;
};

export type CustomerMetricSnapshotRepairPreview = {
  customerId: string;
  restaurantId: string;
  calculatedAt: string;
  reservationCount: number;
  changed: boolean;
  current: Record<string, unknown> | null;
  expected: Record<string, unknown>;
};

export type CustomerMetricSnapshotRepairResult = CustomerMetricSnapshotRepairPreview & {
  projectionVersion: number;
  repaired: boolean;
  replayed: boolean;
};

export class CustomerMetricSnapshotRepairError extends Error {
  constructor(
    readonly code:
      | 'CUSTOMER_NOT_FOUND'
      | 'CRM_TENANT_MISMATCH'
      | 'CUSTOMER_NOT_ACTIVE'
      | 'IDEMPOTENCY_KEY_REQUIRED'
      | 'IDEMPOTENCY_KEY_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'CustomerMetricSnapshotRepairError';
  }
}

export const CUSTOMER_PREFERENCE_KEYS = [
  'preferred_section',
  'preferred_table',
  'dietary_restrictions',
  'accessibility_needs',
  'preferred_language',
  'occasion_type',
  'service_preference',
  'group_pattern',
] as const;

export type CustomerPreferenceKey = (typeof CUSTOMER_PREFERENCE_KEYS)[number];

export interface CustomerPreferenceUpsertInput {
  restaurantId: string;
  customerId: string;
  key: string;
  value: unknown;
  source: CustomerDataSource;
  confidence?: number | null;
  confirmedAt?: Date | null;
  expiresAt?: Date | null;
}

export interface CustomerTagUpsertInput {
  restaurantId: string;
  key: string;
  label: string;
  colorToken?: string | null;
  isSystem?: boolean;
}

export interface CustomerTagAssignmentInput {
  restaurantId: string;
  customerId: string;
  tagId: string;
  source: CustomerDataSource;
  ruleId?: string | null;
  ruleVersion?: number | null;
}

const SAFE_PHONE_PATTERN = /^\+?[0-9]{7,15}$/;
const SAFE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PII_KEY_PATTERN =
  /(?:phone|email|customername|fullname|transcript|messagebody|secret|token)/iu;

function normalizeText(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${field} must contain between 1 and ${maxLength} characters`);
  }
  return normalized;
}

/**
 * Normalize an E.164-like phone without guessing a country code. Invalid or
 * masked values return null so legacy call paths keep their original lookup.
 */
export function normalizeCustomerPhone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const compact = trimmed.replace(/[\s().-]/g, '');
  if (compact.startsWith('00')) {
    const international = `+${compact.slice(2)}`;
    return SAFE_PHONE_PATTERN.test(international) ? international : null;
  }
  return SAFE_PHONE_PATTERN.test(compact) ? compact : null;
}

/** Normalize email for identity matching while preserving no email address in logs. */
export function normalizeCustomerEmail(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized && SAFE_EMAIL_PATTERN.test(normalized) ? normalized : null;
}

function assertSafeMetadata(metadata: Record<string, unknown> | undefined): void {
  if (!metadata) return;
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      if (PII_KEY_PATTERN.test(key)) {
        throw new Error(`CRM timeline metadata contains forbidden field: ${key}`);
      }
      visit(nested);
    }
  };
  visit(metadata);
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function validDate(value: Date | undefined, field: string): Date {
  const date = value ?? new Date();
  if (Number.isNaN(date.getTime())) throw new Error(`${field} must be a valid date`);
  return date;
}

function validOptionalDate(value: Date | null | undefined, field: string): Date | null | undefined {
  if (value === undefined || value === null) return value;
  if (Number.isNaN(value.getTime())) throw new Error(`${field} must be a valid date`);
  return value;
}

function normalizePreferenceKey(value: string): CustomerPreferenceKey {
  const key = value.trim().toLowerCase();
  if (!(CUSTOMER_PREFERENCE_KEYS as readonly string[]).includes(key)) {
    throw new Error(`unsupported customer preference key: ${value}`);
  }
  return key as CustomerPreferenceKey;
}

function normalizeTagKey(value: string): string {
  const key = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_.-]{1,63}$/.test(key)) {
    throw new Error('tag key must be a lowercase slug between 2 and 64 characters');
  }
  return key;
}

function normalizeTagLabel(value: string): string {
  return normalizeText(value, 'tag label', 80);
}

function normalizeJsonValue(value: unknown, depth = 0): Prisma.InputJsonValue {
  if (depth > 4) throw new Error('preference value is too deeply nested');
  if (value === null)
    throw new Error('preference value cannot be null; delete the preference instead');
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('preference value contains an invalid number');
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => normalizeJsonValue(item, depth + 1));
  if (typeof value === 'object') {
    const result: Record<string, Prisma.InputJsonValue> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(key)) {
        throw new Error('preference value contains an invalid object key');
      }
      result[key] = normalizeJsonValue(nested, depth + 1);
    }
    return result;
  }
  throw new Error('preference value must be JSON serializable');
}

export function normalizeCustomerPreferenceValue(value: unknown): Prisma.InputJsonValue {
  const normalized = normalizeJsonValue(value);
  if (JSON.stringify(normalized).length > 2048) {
    throw new Error('preference value is too large');
  }
  return normalized;
}

async function assertCustomerTenant(
  writer: CrmWriter,
  customerId: string,
  restaurantId: string,
): Promise<void> {
  const customer = await writer.customer.findUnique({
    where: { id: customerId },
    select: { restaurantId: true },
  });
  if (customer && customer.restaurantId !== restaurantId) {
    throw new Error('CRM_TENANT_MISMATCH');
  }
}

/**
 * Stable dedupe key for source events. Event type is included because one
 * reservation can legitimately produce created, cancelled and honoured rows.
 */
export function buildCustomerTimelineDedupeKey(input: {
  restaurantId: string;
  customerId: string;
  eventType: string;
  sourceType: string;
  sourceId?: string | null;
}): string {
  const restaurantId = normalizeText(input.restaurantId, 'restaurantId', 128);
  const customerId = normalizeText(input.customerId, 'customerId', 128);
  const eventType = normalizeText(input.eventType, 'eventType', 64);
  const sourceType = normalizeText(input.sourceType, 'sourceType', 64);
  const sourceId = input.sourceId ? normalizeText(input.sourceId, 'sourceId', 191) : 'none';
  return `crm:${restaurantId}:${customerId}:${eventType}:${sourceType}:${sourceId}`;
}

/**
 * Add an identity without ever moving an identity from another customer. A
 * collision is returned to the caller so it can create a merge candidate.
 */
export async function upsertCustomerIdentity(
  input: CustomerIdentityUpsertInput,
  writer: CrmWriter = db,
): Promise<CustomerIdentityUpsertResult> {
  const restaurantId = normalizeText(input.restaurantId, 'restaurantId', 128);
  const customerId = normalizeText(input.customerId, 'customerId', 128);
  await assertCustomerTenant(writer, customerId, restaurantId);
  const value = normalizeText(input.value, 'value', 320);
  const source = normalizeText(input.source, 'source', 64);
  const normalizedValue =
    input.type === 'PHONE'
      ? normalizeCustomerPhone(value)
      : input.type === 'EMAIL'
        ? normalizeCustomerEmail(value)
        : normalizeText(value, 'normalizedValue', 320).toLowerCase();
  if (!normalizedValue) throw new Error('identity value is not normalizable');
  if (input.verifiedAt && Number.isNaN(input.verifiedAt.getTime())) {
    throw new Error('verifiedAt must be a valid date');
  }

  const where = {
    restaurantId_type_normalizedValue: {
      restaurantId,
      type: input.type,
      normalizedValue,
    },
  };
  const existing = await writer.customerIdentity.findUnique({ where });
  if (existing) {
    if (existing.customerId !== customerId) {
      return { status: 'conflict', identityId: existing.id, customerId: existing.customerId };
    }
    const changed =
      existing.value !== value ||
      existing.source !== source ||
      (input.verifiedAt?.getTime() ?? null) !== (existing.verifiedAt?.getTime() ?? null);
    if (!changed) {
      return { status: 'unchanged', identityId: existing.id, customerId: existing.customerId };
    }
    const updated = await writer.customerIdentity.update({
      where: { id: existing.id },
      data: {
        value,
        source,
        ...(input.verifiedAt !== undefined ? { verifiedAt: input.verifiedAt } : {}),
      },
    });
    return { status: 'updated', identityId: updated.id, customerId: updated.customerId };
  }

  try {
    const created = await writer.customerIdentity.create({
      data: {
        restaurantId,
        customerId,
        type: input.type,
        value,
        normalizedValue,
        source,
        verifiedAt: input.verifiedAt ?? null,
      },
    });
    return { status: 'created', identityId: created.id, customerId: created.customerId };
  } catch (error) {
    if (!isUniqueConstraint(error)) throw error;
    const raced = await writer.customerIdentity.findUnique({ where });
    if (!raced) throw error;
    if (raced.customerId !== customerId) {
      return { status: 'conflict', identityId: raced.id, customerId: raced.customerId };
    }
    return { status: 'unchanged', identityId: raced.id, customerId: raced.customerId };
  }
}

/** Append one timeline event; replays return the original row. */
export async function appendCustomerTimelineEvent(
  input: CustomerTimelineEventInput,
  writer: CrmWriter = db,
): Promise<{
  event: Awaited<ReturnType<typeof db.customerTimelineEvent.create>>;
  created: boolean;
}> {
  const restaurantId = normalizeText(input.restaurantId, 'restaurantId', 128);
  const customerId = normalizeText(input.customerId, 'customerId', 128);
  await assertCustomerTenant(writer, customerId, restaurantId);
  const eventType = normalizeText(input.eventType, 'eventType', 64);
  const sourceType = normalizeText(input.sourceType, 'sourceType', 64);
  const dedupeKey = normalizeText(input.dedupeKey, 'dedupeKey', 255);
  const summaryCode = normalizeText(input.summaryCode, 'summaryCode', 128);
  const occurredAt = validDate(input.occurredAt, 'occurredAt');
  assertSafeMetadata(input.metadata);

  try {
    const event = await writer.customerTimelineEvent.create({
      data: {
        restaurantId,
        customerId,
        eventType,
        sourceType,
        sourceId: input.sourceId ? normalizeText(input.sourceId, 'sourceId', 191) : null,
        dedupeKey,
        occurredAt,
        summaryCode,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
    return { event, created: true };
  } catch (error) {
    if (!isUniqueConstraint(error)) throw error;
    const existing = await writer.customerTimelineEvent.findUnique({ where: { dedupeKey } });
    if (!existing) throw error;
    return { event: existing, created: false };
  }
}

/** Upsert one allow-listed, structured preference for an active customer. */
export async function upsertCustomerPreference(
  input: CustomerPreferenceUpsertInput,
  writer: CrmWriter = db,
): Promise<Awaited<ReturnType<typeof db.customerPreference.upsert>>> {
  const restaurantId = normalizeText(input.restaurantId, 'restaurantId', 128);
  const customerId = normalizeText(input.customerId, 'customerId', 128);
  await assertCustomerTenant(writer, customerId, restaurantId);
  const key = normalizePreferenceKey(input.key);
  const value = normalizeCustomerPreferenceValue(input.value);
  if (input.confidence !== undefined && input.confidence !== null) {
    if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
      throw new Error('confidence must be between 0 and 1');
    }
  }
  const confirmedAt = validOptionalDate(input.confirmedAt, 'confirmedAt');
  const expiresAt = validOptionalDate(input.expiresAt, 'expiresAt');
  if (expiresAt && confirmedAt && expiresAt < confirmedAt) {
    throw new Error('expiresAt must be after confirmedAt');
  }

  return writer.customerPreference.upsert({
    where: { customerId_key: { customerId, key } },
    create: {
      restaurantId,
      customerId,
      key,
      value,
      source: input.source,
      confidence: input.confidence ?? null,
      confirmedAt: confirmedAt ?? null,
      expiresAt: expiresAt ?? null,
    },
    update: {
      restaurantId,
      value,
      source: input.source,
      confidence: input.confidence ?? null,
      confirmedAt: confirmedAt ?? null,
      expiresAt: expiresAt ?? null,
    },
  });
}

/** Delete a preference only when it belongs to the authenticated restaurant. */
export async function deleteCustomerPreference(
  input: { restaurantId: string; customerId: string; key: string },
  writer: CrmWriter = db,
): Promise<boolean> {
  const restaurantId = normalizeText(input.restaurantId, 'restaurantId', 128);
  const customerId = normalizeText(input.customerId, 'customerId', 128);
  await assertCustomerTenant(writer, customerId, restaurantId);
  const key = normalizePreferenceKey(input.key);
  const existing = await writer.customerPreference.findUnique({
    where: { customerId_key: { customerId, key } },
    select: { id: true, restaurantId: true },
  });
  if (!existing) return false;
  if (existing.restaurantId !== restaurantId) throw new Error('CRM_TENANT_MISMATCH');
  await writer.customerPreference.delete({ where: { id: existing.id } });
  return true;
}

/** Create or update a restaurant-owned tag definition. */
export async function upsertCustomerTag(
  input: CustomerTagUpsertInput,
  writer: CrmWriter = db,
): Promise<Awaited<ReturnType<typeof db.customerTag.upsert>>> {
  const restaurantId = normalizeText(input.restaurantId, 'restaurantId', 128);
  const key = normalizeTagKey(input.key);
  const label = normalizeTagLabel(input.label);
  const colorToken = input.colorToken?.trim() || null;
  if (colorToken && !/^[a-z][a-z0-9-]{1,31}$/.test(colorToken)) {
    throw new Error('colorToken must be a design-token slug');
  }
  return writer.customerTag.upsert({
    where: { restaurantId_key: { restaurantId, key } },
    create: {
      restaurantId,
      key,
      label,
      colorToken,
      isSystem: input.isSystem ?? false,
    },
    update: {
      label,
      colorToken,
      ...(input.isSystem === undefined ? {} : { isSystem: input.isSystem }),
    },
  });
}

/** Assign a tag idempotently; an existing assignment is updated in place. */
export async function assignCustomerTag(
  input: CustomerTagAssignmentInput,
  writer: CrmWriter = db,
): Promise<{
  assignment: Awaited<ReturnType<typeof db.customerTagAssignment.upsert>>;
  created: boolean;
}> {
  const restaurantId = normalizeText(input.restaurantId, 'restaurantId', 128);
  const customerId = normalizeText(input.customerId, 'customerId', 128);
  const tagId = normalizeText(input.tagId, 'tagId', 128);
  await assertCustomerTenant(writer, customerId, restaurantId);
  const tag = await writer.customerTag.findUnique({
    where: { id: tagId },
    select: { restaurantId: true },
  });
  if (tag && tag.restaurantId !== restaurantId) throw new Error('CRM_TENANT_MISMATCH');
  const existing = await writer.customerTagAssignment.findUnique({
    where: { customerId_tagId: { customerId, tagId } },
  });
  const assignment = await writer.customerTagAssignment.upsert({
    where: { customerId_tagId: { customerId, tagId } },
    create: {
      customerId,
      tagId,
      source: input.source,
      ruleId: input.ruleId ?? null,
      ruleVersion: input.ruleVersion ?? null,
    },
    update: {
      source: input.source,
      ruleId: input.ruleId ?? null,
      ruleVersion: input.ruleVersion ?? null,
    },
  });
  return { assignment, created: !existing };
}

/** Remove a tag assignment without deleting the tag definition. */
export async function removeCustomerTag(
  input: { restaurantId: string; customerId: string; tagId: string },
  writer: CrmWriter = db,
): Promise<boolean> {
  const restaurantId = normalizeText(input.restaurantId, 'restaurantId', 128);
  const customerId = normalizeText(input.customerId, 'customerId', 128);
  const tagId = normalizeText(input.tagId, 'tagId', 128);
  await assertCustomerTenant(writer, customerId, restaurantId);
  const tag = await writer.customerTag.findUnique({
    where: { id: tagId },
    select: { restaurantId: true },
  });
  if (!tag || tag.restaurantId !== restaurantId) return false;
  const assignment = await writer.customerTagAssignment.findUnique({
    where: { customerId_tagId: { customerId, tagId } },
  });
  if (!assignment) return false;
  await writer.customerTagAssignment.delete({ where: { customerId_tagId: { customerId, tagId } } });
  return true;
}

function dateInWindow(date: Date, start: Date, end: Date): boolean {
  return date >= start && date <= end;
}

type MetricSnapshotCalculation = {
  values: CustomerMetricSnapshotRepairValues;
  reservationCount: number;
};

async function calculateCustomerMetricSnapshot(
  input: CustomerMetricSnapshotInput,
  writer: CrmWriter,
): Promise<MetricSnapshotCalculation> {
  const restaurantId = normalizeText(input.restaurantId, 'restaurantId', 128);
  const customerId = normalizeText(input.customerId, 'customerId', 128);
  const now = validDate(input.now, 'now');
  const day30 = new Date(now.getTime() - 30 * 86_400_000);
  const day90 = new Date(now.getTime() - 90 * 86_400_000);
  const day365 = new Date(now.getTime() - 365 * 86_400_000);

  const reservations = await writer.reservation.findMany({
    where: { restaurantId, customerId },
    select: {
      state: true,
      status: true,
      reservedAt: true,
      startsAt: true,
      partySize: true,
      estimatedRevenue: true,
      confirmedRevenue: true,
    },
  });

  let honored30d = 0;
  let honored90d = 0;
  let honored365d = 0;
  let cancelled365d = 0;
  let noShow365d = 0;
  let covers365d = 0;
  let estimatedSpend365d = new Prisma.Decimal(0);
  let actualSpend365d = new Prisma.Decimal(0);
  let actualLifetimeSpend = new Prisma.Decimal(0);
  let actual365dCount = 0;
  let actualLifetimeCount = 0;
  let lastHonoredAt: Date | null = null;
  let nextReservationAt: Date | null = null;

  for (const reservation of reservations) {
    const reservationDate = reservation.startsAt ?? reservation.reservedAt;
    const state = String(reservation.state);
    const status = String(reservation.status);
    if (
      reservationDate >= now &&
      ['PENDING', 'CONFIRMED', 'SEATED'].includes(state) &&
      (!nextReservationAt || reservationDate < nextReservationAt)
    ) {
      nextReservationAt = reservationDate;
    }

    const isHonored = state === 'HONORED';
    if (isHonored && reservationDate <= now) {
      if (!lastHonoredAt || reservationDate > lastHonoredAt) lastHonoredAt = reservationDate;
      if (dateInWindow(reservationDate, day30, now)) honored30d += 1;
      if (dateInWindow(reservationDate, day90, now)) honored90d += 1;
      if (dateInWindow(reservationDate, day365, now)) {
        honored365d += 1;
        covers365d += reservation.partySize;
        if (reservation.estimatedRevenue !== null) {
          estimatedSpend365d = estimatedSpend365d.add(reservation.estimatedRevenue);
        }
        if (reservation.confirmedRevenue !== null) {
          actualSpend365d = actualSpend365d.add(reservation.confirmedRevenue);
          actual365dCount += 1;
        }
      }
      if (reservation.confirmedRevenue !== null) {
        actualLifetimeSpend = actualLifetimeSpend.add(reservation.confirmedRevenue);
        actualLifetimeCount += 1;
      }
    }
    if (
      reservationDate >= day365 &&
      reservationDate <= now &&
      (state === 'CANCELLED' || status === 'CANCELLED')
    ) {
      cancelled365d += 1;
    }
    if (
      reservationDate >= day365 &&
      reservationDate <= now &&
      (state === 'NO_SHOW' || status === 'NO_SHOW')
    ) {
      noShow365d += 1;
    }
  }

  return {
    values: {
      lastHonoredAt,
      nextReservationAt,
      honored30d,
      honored90d,
      honored365d,
      cancelled365d,
      noShow365d,
      covers365d,
      estimatedSpend365d,
      actualSpend365d: actual365dCount > 0 ? actualSpend365d : null,
      actualLifetimeSpend: actualLifetimeCount > 0 ? actualLifetimeSpend : null,
    },
    reservationCount: reservations.length,
  };
}

function serializeMetricSnapshot(
  snapshot: CustomerMetricSnapshotRepairValues | CustomerMetricSnapshot | null,
): Record<string, unknown> | null {
  if (!snapshot) return null;
  const decimal = (value: Prisma.Decimal | number | string | null | undefined): string | null =>
    value === null || value === undefined ? null : String(value);
  const date = (value: Date | string | null | undefined): string | null => {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  };
  return {
    lastHonoredAt: date(snapshot.lastHonoredAt),
    nextReservationAt: date(snapshot.nextReservationAt),
    honored30d: snapshot.honored30d,
    honored90d: snapshot.honored90d,
    honored365d: snapshot.honored365d,
    cancelled365d: snapshot.cancelled365d,
    noShow365d: snapshot.noShow365d,
    covers365d: snapshot.covers365d,
    estimatedSpend365d: decimal(snapshot.estimatedSpend365d),
    actualSpend365d: decimal(snapshot.actualSpend365d),
    actualLifetimeSpend: decimal(snapshot.actualLifetimeSpend),
  };
}

function metricSnapshotChanged(
  current: CustomerMetricSnapshot | null,
  expected: CustomerMetricSnapshotRepairValues,
): boolean {
  return (
    JSON.stringify(serializeMetricSnapshot(current)) !==
    JSON.stringify(serializeMetricSnapshot(expected))
  );
}

/**
 * Rebuild deterministic RFM-like metrics from reservations. This function is
 * deliberately a projection: it can be rerun after imports, repairs or a
 * future POS reconciliation without changing source reservations.
 */
export async function rebuildCustomerMetricSnapshot(
  input: CustomerMetricSnapshotInput,
  writer: CrmWriter = db,
): Promise<CustomerMetricSnapshot> {
  const restaurantId = normalizeText(input.restaurantId, 'restaurantId', 128);
  const customerId = normalizeText(input.customerId, 'customerId', 128);
  const now = validDate(input.now, 'now');
  const calculation = await calculateCustomerMetricSnapshot(
    { restaurantId, customerId, now },
    writer,
  );
  const { values } = calculation;

  return writer.customerMetricSnapshot.upsert({
    where: { customerId },
    create: {
      customerId,
      restaurantId,
      ...values,
      projectionVersion: 1,
      calculatedAt: now,
    },
    update: {
      restaurantId,
      ...values,
      projectionVersion: { increment: 1 },
      calculatedAt: now,
    },
  });
}

async function assertActiveCustomerForRepair(
  writer: CrmWriter,
  restaurantId: string,
  customerId: string,
): Promise<void> {
  const customer = await writer.customer.findUnique({
    where: { id: customerId },
    select: { restaurantId: true, archivedAt: true },
  });
  if (!customer) {
    throw new CustomerMetricSnapshotRepairError(
      'CUSTOMER_NOT_FOUND',
      'Customer does not exist in the CRM projection',
    );
  }
  if (customer.restaurantId !== restaurantId) {
    throw new CustomerMetricSnapshotRepairError(
      'CRM_TENANT_MISMATCH',
      'Customer belongs to another restaurant',
    );
  }
  if (customer.archivedAt) {
    throw new CustomerMetricSnapshotRepairError(
      'CUSTOMER_NOT_ACTIVE',
      'Archived customers cannot be repaired from the dashboard',
    );
  }
}

/** Read-only comparison used before an owner starts a projection repair. */
export async function previewCustomerMetricSnapshotRepair(args: {
  restaurantId: string;
  customerId: string;
  now?: Date;
}): Promise<CustomerMetricSnapshotRepairPreview> {
  const restaurantId = normalizeText(args.restaurantId, 'restaurantId', 128);
  const customerId = normalizeText(args.customerId, 'customerId', 128);
  const now = validDate(args.now, 'now');
  await assertActiveCustomerForRepair(db, restaurantId, customerId);
  const [current, calculation] = await Promise.all([
    db.customerMetricSnapshot.findUnique({ where: { customerId } }),
    calculateCustomerMetricSnapshot({ restaurantId, customerId, now }, db),
  ]);
  const expected = serializeMetricSnapshot(calculation.values) ?? {};
  return {
    customerId,
    restaurantId,
    calculatedAt: now.toISOString(),
    reservationCount: calculation.reservationCount,
    changed: metricSnapshotChanged(current, calculation.values),
    current: serializeMetricSnapshot(current),
    expected,
  };
}

function repairDedupeKey(restaurantId: string, customerId: string, idempotencyKey: string): string {
  return `crm:${restaurantId}:${customerId}:CUSTOMER_METRICS_REPAIRED:admin:${idempotencyKey}`;
}

function replayRepairResult(
  event: { metadata: unknown },
  restaurantId: string,
  customerId: string,
): CustomerMetricSnapshotRepairResult | null {
  if (!event.metadata || typeof event.metadata !== 'object') return null;
  const metadata = event.metadata as Record<string, unknown>;
  if (
    typeof metadata.calculatedAt !== 'string' ||
    typeof metadata.reservationCount !== 'number' ||
    typeof metadata.projectionVersion !== 'number' ||
    !metadata.expected ||
    typeof metadata.expected !== 'object'
  ) {
    return null;
  }
  return {
    customerId,
    restaurantId,
    calculatedAt: metadata.calculatedAt,
    reservationCount: metadata.reservationCount,
    changed: metadata.changed === true,
    current:
      metadata.current && typeof metadata.current === 'object'
        ? (metadata.current as Record<string, unknown>)
        : null,
    expected: metadata.expected as Record<string, unknown>,
    projectionVersion: metadata.projectionVersion,
    repaired: metadata.changed === true,
    replayed: true,
  };
}

/**
 * Owner-only, idempotent repair of one CRM metric projection. Source
 * reservations are read inside a serializable transaction; only the derived
 * snapshot and an aggregate timeline marker can change.
 */
export async function repairCustomerMetricSnapshot(args: {
  restaurantId: string;
  customerId: string;
  idempotencyKey: string;
  actor?: string;
  now?: Date;
}): Promise<CustomerMetricSnapshotRepairResult> {
  const restaurantId = normalizeText(args.restaurantId, 'restaurantId', 128);
  const customerId = normalizeText(args.customerId, 'customerId', 128);
  const idempotencyKey = args.idempotencyKey?.trim() ?? '';
  if (!idempotencyKey) {
    throw new CustomerMetricSnapshotRepairError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'Idempotency-Key is required for a projection repair',
    );
  }
  if (idempotencyKey.length > 120) {
    throw new CustomerMetricSnapshotRepairError(
      'IDEMPOTENCY_KEY_INVALID',
      'Idempotency-Key is too long for a projection repair',
    );
  }
  const now = validDate(args.now, 'now');
  const dedupeKey = repairDedupeKey(restaurantId, customerId, idempotencyKey);

  const result = await db.$transaction(
    async (tx) => {
      const existing = await tx.customerTimelineEvent.findUnique({
        where: { dedupeKey },
        select: { metadata: true },
      });
      if (existing) {
        const replay = replayRepairResult(existing, restaurantId, customerId);
        if (replay) return replay;
      }

      await assertActiveCustomerForRepair(tx, restaurantId, customerId);
      const [current, calculation] = await Promise.all([
        tx.customerMetricSnapshot.findUnique({ where: { customerId } }),
        calculateCustomerMetricSnapshot({ restaurantId, customerId, now }, tx),
      ]);
      const expected = serializeMetricSnapshot(calculation.values) ?? {};
      const currentSerialized = serializeMetricSnapshot(current);
      const changed = metricSnapshotChanged(current, calculation.values);
      const snapshot =
        changed || !current
          ? await rebuildCustomerMetricSnapshot({ restaurantId, customerId, now }, tx)
          : current;
      const metadata = {
        calculatedAt: now.toISOString(),
        reservationCount: calculation.reservationCount,
        changed,
        current: currentSerialized,
        expected,
        projectionVersion: snapshot.projectionVersion,
      } as Record<string, unknown>;
      const event = await appendCustomerTimelineEvent(
        {
          restaurantId,
          customerId,
          eventType: 'CUSTOMER_METRICS_REPAIRED',
          sourceType: 'customer_metric_snapshot_repair',
          sourceId: customerId,
          dedupeKey,
          occurredAt: now,
          summaryCode: 'customer.metrics_repaired',
          metadata,
        },
        tx,
      );
      if (!event.created) {
        const replay = replayRepairResult(event.event, restaurantId, customerId);
        if (replay) return replay;
      }
      return {
        customerId,
        restaurantId,
        calculatedAt: now.toISOString(),
        reservationCount: calculation.reservationCount,
        changed,
        current: currentSerialized,
        expected,
        projectionVersion: snapshot.projectionVersion,
        repaired: changed,
        replayed: false,
      };
    },
    {
      maxWait: 10_000,
      timeout: 30_000,
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
  return result;
}

/** Best-effort projection hook for legacy call paths. */
export async function safelyRebuildCustomerMetricSnapshot(
  input: CustomerMetricSnapshotInput,
): Promise<void> {
  try {
    await rebuildCustomerMetricSnapshot(input);
  } catch (error) {
    logger.warn(
      {
        err: error instanceof Error ? error.message : String(error),
        restaurantId: input.restaurantId,
        customerId: input.customerId,
      },
      '[crm] metric snapshot rebuild failed',
    );
  }
}

export type CustomerIdentityRecord = Customer & {
  identities?: Array<{
    id: string;
    type: CustomerIdentityType;
    value: string;
    normalizedValue: string;
    verifiedAt: Date | null;
    source: string;
  }>;
};
