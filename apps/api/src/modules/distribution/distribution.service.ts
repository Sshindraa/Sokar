import { createHash } from 'node:crypto';
import {
  DistributionConnectionStatus,
  DistributionProvider,
  DistributionReservationLinkStatus,
  DistributionSyncDirection,
  DistributionSyncRunStatus,
  DistributionWebhookStatus,
  Prisma,
} from '@prisma/client';
import { db } from '../../shared/db/client';

const PROVIDERS = new Set(Object.values(DistributionProvider));
const ACTOR_HASH_PREFIX = 'sokar:distribution-actor:';
const IDEMPOTENCY_HASH_PREFIX = 'sokar:distribution-idempotency:';
const EXTERNAL_ID_HASH_PREFIX = 'sokar:distribution-external:';
const WEBHOOK_ID_HASH_PREFIX = 'sokar:distribution-webhook:';
const MAX_LIST_LIMIT = 100;
const MAX_RUN_LIMIT = 100;
const MAX_SLOT_LIMIT = 500;

export class DistributionInputError extends Error {
  constructor(
    readonly code:
      | 'DISTRIBUTION_PROVIDER_INVALID'
      | 'DISTRIBUTION_EXTERNAL_ACCOUNT_INVALID'
      | 'DISTRIBUTION_CREDENTIAL_REFERENCE_INVALID'
      | 'DISTRIBUTION_CONFIG_INVALID'
      | 'DISTRIBUTION_STATUS_INVALID'
      | 'DISTRIBUTION_DIRECTION_INVALID'
      | 'DISTRIBUTION_IDEMPOTENCY_INVALID'
      | 'DISTRIBUTION_DATE_INVALID'
      | 'DISTRIBUTION_WINDOW_INVALID'
      | 'DISTRIBUTION_SLOT_KEY_INVALID'
      | 'DISTRIBUTION_PARTY_SIZE_INVALID'
      | 'DISTRIBUTION_CAPACITY_INVALID'
      | 'DISTRIBUTION_EXTERNAL_EVENT_INVALID'
      | 'DISTRIBUTION_EVENT_TYPE_INVALID'
      | 'DISTRIBUTION_PAYLOAD_HASH_INVALID'
      | 'DISTRIBUTION_SOURCE_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'DistributionInputError';
  }
}

export class DistributionConnectionNotFoundError extends Error {
  readonly code = 'DISTRIBUTION_CONNECTION_NOT_FOUND';

  constructor() {
    super('Distribution connection not found');
    this.name = 'DistributionConnectionNotFoundError';
  }
}

export class DistributionReservationNotFoundError extends Error {
  readonly code = 'DISTRIBUTION_RESERVATION_NOT_FOUND';

  constructor() {
    super('Reservation not found');
    this.name = 'DistributionReservationNotFoundError';
  }
}

export class DistributionSyncRunNotFoundError extends Error {
  readonly code = 'DISTRIBUTION_SYNC_RUN_NOT_FOUND';

  constructor() {
    super('Distribution sync run not found');
    this.name = 'DistributionSyncRunNotFoundError';
  }
}

export class DistributionWebhookNotFoundError extends Error {
  readonly code = 'DISTRIBUTION_WEBHOOK_NOT_FOUND';

  constructor() {
    super('Distribution webhook event not found');
    this.name = 'DistributionWebhookNotFoundError';
  }
}

export class DistributionStateError extends Error {
  constructor(
    readonly code:
      | 'DISTRIBUTION_CONNECTION_DISCONNECTED'
      | 'DISTRIBUTION_SYNC_RUN_FINAL'
      | 'DISTRIBUTION_WEBHOOK_FINAL',
    message: string,
  ) {
    super(message);
    this.name = 'DistributionStateError';
  }
}

export class DistributionConflictError extends Error {
  constructor(
    readonly code:
      | 'DISTRIBUTION_CONNECTION_CONFLICT'
      | 'DISTRIBUTION_SYNC_IDEMPOTENCY_CONFLICT'
      | 'DISTRIBUTION_RESERVATION_LINK_CONFLICT'
      | 'DISTRIBUTION_WEBHOOK_CONFLICT',
    message: string,
  ) {
    super(message);
    this.name = 'DistributionConflictError';
  }
}

export type DistributionConnectionView = {
  id: string;
  provider: DistributionProvider;
  externalAccountLast4: string | null;
  credentialReferencePresent: boolean;
  configHash: string;
  status: DistributionConnectionStatus;
  cursorPresent: boolean;
  lastSyncAt: string | null;
  lastErrorCode: string | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DistributionSyncRunView = {
  id: string;
  connectionId: string;
  provider: DistributionProvider;
  direction: DistributionSyncDirection;
  status: DistributionSyncRunStatus;
  windowStart: string | null;
  windowEnd: string | null;
  sourceCursor: string | null;
  targetCursor: string | null;
  pushedCount: number;
  pulledCount: number;
  failedCount: number;
  errorCode: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  replayed?: boolean;
};

export type DistributionAvailabilityView = {
  id: string;
  connectionId: string;
  provider: DistributionProvider;
  slotKey: string;
  serviceDate: string;
  startsAt: string;
  endsAt: string;
  partySize: number;
  available: number;
  capacity: number;
  sourceRevision: string | null;
  payloadHash: string;
  observedAt: string;
  updatedAt: string;
};

export type DistributionReservationLinkView = {
  id: string;
  connectionId: string;
  provider: DistributionProvider;
  reservationId: string;
  externalIdLast4: string;
  status: DistributionReservationLinkStatus;
  source: string;
  linkedAt: string;
  unlinkedAt: string | null;
  createdAt: string;
  updatedAt: string;
  replayed?: boolean;
};

export type DistributionWebhookView = {
  id: string;
  connectionId: string | null;
  provider: DistributionProvider;
  eventType: string;
  payloadHash: string;
  status: DistributionWebhookStatus;
  errorCode: string | null;
  receivedAt: string;
  processedAt: string | null;
  createdAt: string;
  replayed?: boolean;
};

const CONNECTION_SELECT = {
  id: true,
  provider: true,
  externalAccountHash: true,
  externalAccountLast4: true,
  credentialRef: true,
  configHash: true,
  status: true,
  cursor: true,
  lastSyncAt: true,
  lastErrorCode: true,
  connectedAt: true,
  disconnectedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const SYNC_RUN_SELECT = {
  id: true,
  connectionId: true,
  direction: true,
  status: true,
  windowStart: true,
  windowEnd: true,
  sourceCursor: true,
  targetCursor: true,
  pushedCount: true,
  pulledCount: true,
  failedCount: true,
  errorCode: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
  updatedAt: true,
  connection: { select: { provider: true } },
} as const;

const AVAILABILITY_SELECT = {
  id: true,
  connectionId: true,
  slotKey: true,
  serviceDate: true,
  startsAt: true,
  endsAt: true,
  partySize: true,
  available: true,
  capacity: true,
  sourceRevision: true,
  payloadHash: true,
  observedAt: true,
  updatedAt: true,
  connection: { select: { provider: true } },
} as const;

const LINK_SELECT = {
  id: true,
  connectionId: true,
  reservationId: true,
  externalIdHash: true,
  externalIdLast4: true,
  status: true,
  source: true,
  linkedAt: true,
  unlinkedAt: true,
  createdAt: true,
  updatedAt: true,
  connection: { select: { provider: true } },
} as const;

const WEBHOOK_SELECT = {
  id: true,
  connectionId: true,
  provider: true,
  eventType: true,
  payloadHash: true,
  status: true,
  errorCode: true,
  receivedAt: true,
  processedAt: true,
  createdAt: true,
} as const;

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashWithPrefix(prefix: string, ...parts: string[]): string {
  return hash(`${prefix}${parts.join(':')}`);
}

export function hashDistributionActor(actor: string): string {
  return hashWithPrefix(ACTOR_HASH_PREFIX, actor.trim());
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeProvider(value: DistributionProvider | string): DistributionProvider {
  const provider = String(value).trim().toUpperCase() as DistributionProvider;
  if (!PROVIDERS.has(provider)) {
    throw new DistributionInputError(
      'DISTRIBUTION_PROVIDER_INVALID',
      'Le fournisseur de distribution est invalide.',
    );
  }
  return provider;
}

function normalizeStatus(
  value: DistributionConnectionStatus | string,
): DistributionConnectionStatus {
  if (
    !Object.values(DistributionConnectionStatus).includes(value as DistributionConnectionStatus)
  ) {
    throw new DistributionInputError(
      'DISTRIBUTION_STATUS_INVALID',
      'Le statut de connexion est invalide.',
    );
  }
  return value as DistributionConnectionStatus;
}

function normalizeDirection(value: DistributionSyncDirection | string): DistributionSyncDirection {
  if (!Object.values(DistributionSyncDirection).includes(value as DistributionSyncDirection)) {
    throw new DistributionInputError(
      'DISTRIBUTION_DIRECTION_INVALID',
      'La direction de synchronisation est invalide.',
    );
  }
  return value as DistributionSyncDirection;
}

function normalizeText(
  value: string | null | undefined,
  code: DistributionInputError['code'],
  label: string,
  max: number,
): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > max ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new DistributionInputError(code, `${label} est invalide.`);
  }
  return normalized;
}

function normalizeExternalAccount(value: string | null | undefined): string | null {
  return normalizeText(value, 'DISTRIBUTION_EXTERNAL_ACCOUNT_INVALID', 'externalAccountId', 191);
}

function normalizeCredentialReference(value: string | null | undefined): string | null {
  const reference = normalizeText(
    value,
    'DISTRIBUTION_CREDENTIAL_REFERENCE_INVALID',
    'credentialReference',
    200,
  );
  if (reference === null) return null;
  if (
    !/^[A-Za-z0-9._:/@+\-]+$/.test(reference) ||
    /^(?:bearer\s|sk_|pk_|rk_|tok_|api[_-])/i.test(reference)
  ) {
    throw new DistributionInputError(
      'DISTRIBUTION_CREDENTIAL_REFERENCE_INVALID',
      'credentialReference doit pointer vers un secret externe sans contenir le secret.',
    );
  }
  return reference;
}

function normalizeConfigFingerprint(value: unknown): string {
  const serialized = stableStringify(value ?? {});
  if (serialized.length > 4_000 || /[\u0000-\u001f\u007f]/.test(serialized)) {
    throw new DistributionInputError(
      'DISTRIBUTION_CONFIG_INVALID',
      'La configuration de canal est invalide.',
    );
  }
  return hash(serialized);
}

function normalizeIdempotencyKey(value: string | null | undefined): string {
  const key = normalizeText(value, 'DISTRIBUTION_IDEMPOTENCY_INVALID', 'Idempotency-Key', 200);
  if (!key || key.length < 8) {
    throw new DistributionInputError(
      'DISTRIBUTION_IDEMPOTENCY_INVALID',
      "Une clé d'idempotence d'au moins 8 caractères est requise.",
    );
  }
  return key;
}

function normalizeDate(value: Date | string | null | undefined, label: string): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new DistributionInputError(
      'DISTRIBUTION_DATE_INVALID',
      `${label} doit être une date valide.`,
    );
  }
  return date;
}

function normalizeWindow(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined,
): { start: Date | null; end: Date | null } {
  const windowStart = normalizeDate(start, 'windowStart');
  const windowEnd = normalizeDate(end, 'windowEnd');
  if (
    (windowStart && !windowEnd) ||
    (!windowStart && windowEnd) ||
    (windowStart && windowEnd && windowEnd <= windowStart)
  ) {
    throw new DistributionInputError(
      'DISTRIBUTION_WINDOW_INVALID',
      'La fenêtre de synchronisation est invalide.',
    );
  }
  return { start: windowStart, end: windowEnd };
}

function normalizeSlotKey(value: string): string {
  const key = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(key)) {
    throw new DistributionInputError(
      'DISTRIBUTION_SLOT_KEY_INVALID',
      'slotKey doit être un identifiant technique sûr.',
    );
  }
  return key;
}

function normalizePartySize(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new DistributionInputError(
      'DISTRIBUTION_PARTY_SIZE_INVALID',
      'partySize doit être compris entre 1 et 100.',
    );
  }
  return value;
}

function normalizeCapacity(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new DistributionInputError(
      'DISTRIBUTION_CAPACITY_INVALID',
      `${label} doit être compris entre 0 et 10 000.`,
    );
  }
  return value;
}

function normalizeHash(
  value: string | null | undefined,
  code: 'DISTRIBUTION_PAYLOAD_HASH_INVALID',
  label: string,
): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new DistributionInputError(code, `${label} doit être un SHA-256 hexadécimal.`);
  }
  return normalized;
}

function normalizeSource(value: string): string {
  const source = normalizeText(value, 'DISTRIBUTION_SOURCE_INVALID', 'source', 80);
  if (!source)
    throw new DistributionInputError('DISTRIBUTION_SOURCE_INVALID', 'source est obligatoire.');
  return source;
}

function normalizeExternalEventId(value: string): string {
  const id = normalizeText(value, 'DISTRIBUTION_EXTERNAL_EVENT_INVALID', 'externalEventId', 256);
  if (!id)
    throw new DistributionInputError(
      'DISTRIBUTION_EXTERNAL_EVENT_INVALID',
      'externalEventId est obligatoire.',
    );
  return id;
}

function normalizeEventType(value: string): string {
  const eventType = normalizeText(value, 'DISTRIBUTION_EVENT_TYPE_INVALID', 'eventType', 120);
  if (!eventType)
    throw new DistributionInputError(
      'DISTRIBUTION_EVENT_TYPE_INVALID',
      'eventType est obligatoire.',
    );
  return eventType;
}

function serializeConnection(row: {
  id: string;
  provider: DistributionProvider;
  externalAccountHash: string | null;
  externalAccountLast4: string | null;
  credentialRef: string | null;
  configHash: string;
  status: DistributionConnectionStatus;
  cursor: string | null;
  lastSyncAt: Date | null;
  lastErrorCode: string | null;
  connectedAt: Date | null;
  disconnectedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): DistributionConnectionView {
  return {
    id: row.id,
    provider: row.provider,
    externalAccountLast4: row.externalAccountLast4,
    credentialReferencePresent: Boolean(row.credentialRef),
    configHash: row.configHash,
    status: row.status,
    cursorPresent: Boolean(row.cursor),
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    lastErrorCode: row.lastErrorCode,
    connectedAt: row.connectedAt?.toISOString() ?? null,
    disconnectedAt: row.disconnectedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeSyncRun(
  row: {
    id: string;
    connectionId: string;
    direction: DistributionSyncDirection;
    status: DistributionSyncRunStatus;
    windowStart: Date | null;
    windowEnd: Date | null;
    sourceCursor: string | null;
    targetCursor: string | null;
    pushedCount: number;
    pulledCount: number;
    failedCount: number;
    errorCode: string | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    connection: { provider: DistributionProvider };
  },
  replayed = false,
): DistributionSyncRunView {
  return {
    id: row.id,
    connectionId: row.connectionId,
    provider: row.connection.provider,
    direction: row.direction,
    status: row.status,
    windowStart: row.windowStart?.toISOString() ?? null,
    windowEnd: row.windowEnd?.toISOString() ?? null,
    sourceCursor: row.sourceCursor,
    targetCursor: row.targetCursor,
    pushedCount: row.pushedCount,
    pulledCount: row.pulledCount,
    failedCount: row.failedCount,
    errorCode: row.errorCode,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(replayed ? { replayed: true } : {}),
  };
}

function serializeAvailability(row: {
  id: string;
  connectionId: string;
  slotKey: string;
  serviceDate: Date;
  startsAt: Date;
  endsAt: Date;
  partySize: number;
  available: number;
  capacity: number;
  sourceRevision: string | null;
  payloadHash: string;
  observedAt: Date;
  updatedAt: Date;
  connection: { provider: DistributionProvider };
}): DistributionAvailabilityView {
  return {
    id: row.id,
    connectionId: row.connectionId,
    provider: row.connection.provider,
    slotKey: row.slotKey,
    serviceDate: row.serviceDate.toISOString().slice(0, 10),
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    partySize: row.partySize,
    available: row.available,
    capacity: row.capacity,
    sourceRevision: row.sourceRevision,
    payloadHash: row.payloadHash,
    observedAt: row.observedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeLink(
  row: {
    id: string;
    connectionId: string;
    reservationId: string;
    externalIdHash: string;
    externalIdLast4: string;
    status: DistributionReservationLinkStatus;
    source: string;
    linkedAt: Date;
    unlinkedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    connection: { provider: DistributionProvider };
  },
  replayed = false,
): DistributionReservationLinkView {
  return {
    id: row.id,
    connectionId: row.connectionId,
    provider: row.connection.provider,
    reservationId: row.reservationId,
    externalIdLast4: row.externalIdLast4,
    status: row.status,
    source: row.source,
    linkedAt: row.linkedAt.toISOString(),
    unlinkedAt: row.unlinkedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(replayed ? { replayed: true } : {}),
  };
}

function serializeWebhook(
  row: {
    id: string;
    connectionId: string | null;
    provider: DistributionProvider;
    eventType: string;
    payloadHash: string;
    status: DistributionWebhookStatus;
    errorCode: string | null;
    receivedAt: Date;
    processedAt: Date | null;
    createdAt: Date;
  },
  replayed = false,
): DistributionWebhookView {
  return {
    id: row.id,
    connectionId: row.connectionId,
    provider: row.provider,
    eventType: row.eventType,
    payloadHash: row.payloadHash,
    status: row.status,
    errorCode: row.errorCode,
    receivedAt: row.receivedAt.toISOString(),
    processedAt: row.processedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    ...(replayed ? { replayed: true } : {}),
  };
}

async function findConnection(restaurantId: string, connectionId: string) {
  const row = await db.distributionConnection.findFirst({
    where: { id: connectionId, restaurantId },
    select: CONNECTION_SELECT,
  });
  if (!row) throw new DistributionConnectionNotFoundError();
  return row;
}

function assertConnectionWritable(status: DistributionConnectionStatus): void {
  if (status === DistributionConnectionStatus.DISCONNECTED) {
    throw new DistributionStateError(
      'DISTRIBUTION_CONNECTION_DISCONNECTED',
      'La connexion de distribution est déconnectée.',
    );
  }
}

export async function createOrUpdateDistributionConnection(input: {
  restaurantId: string;
  provider: DistributionProvider | string;
  externalAccountId?: string | null;
  credentialReference?: string | null;
  configFingerprint?: unknown;
  status?: DistributionConnectionStatus | string;
  now?: Date;
}): Promise<DistributionConnectionView> {
  const provider = normalizeProvider(input.provider);
  const externalAccountId = normalizeExternalAccount(input.externalAccountId);
  const credentialReference = normalizeCredentialReference(input.credentialReference);
  const configHash = normalizeConfigFingerprint(input.configFingerprint);
  const requestedStatus = input.status === undefined ? undefined : normalizeStatus(input.status);
  const now = input.now ?? new Date();
  const existing = await db.distributionConnection.findUnique({
    where: { restaurantId_provider: { restaurantId: input.restaurantId, provider } },
    select: {
      id: true,
      externalAccountHash: true,
      externalAccountLast4: true,
      credentialRef: true,
      configHash: true,
      status: true,
    },
  });
  const externalHash = externalAccountId
    ? hashWithPrefix(EXTERNAL_ID_HASH_PREFIX, provider, externalAccountId)
    : null;
  const externalLast4 = externalAccountId ? externalAccountId.slice(-4) : null;
  const changed = Boolean(
    existing &&
    (existing.externalAccountHash !== externalHash ||
      existing.credentialRef !== credentialReference ||
      existing.configHash !== configHash),
  );
  const status =
    requestedStatus ??
    (changed
      ? DistributionConnectionStatus.PENDING
      : (existing?.status ?? DistributionConnectionStatus.PENDING));
  const stateDates =
    status === DistributionConnectionStatus.ACTIVE
      ? {
          connectedAt:
            existing?.status === DistributionConnectionStatus.ACTIVE && !changed ? undefined : now,
          disconnectedAt: null,
        }
      : status === DistributionConnectionStatus.DISCONNECTED
        ? { disconnectedAt: now }
        : { disconnectedAt: null };
  try {
    const row = existing
      ? await db.distributionConnection.update({
          where: { id: existing.id },
          data: {
            externalAccountHash: externalHash,
            externalAccountLast4: externalLast4,
            credentialRef: credentialReference,
            configHash,
            status,
            ...(changed ? { cursor: null, lastSyncAt: null, lastErrorCode: null } : {}),
            ...stateDates,
          },
          select: CONNECTION_SELECT,
        })
      : await db.distributionConnection.create({
          data: {
            restaurantId: input.restaurantId,
            provider,
            externalAccountHash: externalHash,
            externalAccountLast4: externalLast4,
            credentialRef: credentialReference,
            configHash,
            status,
            ...(status === DistributionConnectionStatus.ACTIVE ? { connectedAt: now } : {}),
            ...(status === DistributionConnectionStatus.DISCONNECTED
              ? { disconnectedAt: now }
              : {}),
          },
          select: CONNECTION_SELECT,
        });
    return serializeConnection(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new DistributionConflictError(
        'DISTRIBUTION_CONNECTION_CONFLICT',
        'Une connexion existe déjà pour ce fournisseur.',
      );
    }
    throw error;
  }
}

export async function listDistributionConnections(
  restaurantId: string,
): Promise<DistributionConnectionView[]> {
  const rows = await db.distributionConnection.findMany({
    where: { restaurantId },
    orderBy: [{ provider: 'asc' }, { createdAt: 'asc' }],
    take: MAX_LIST_LIMIT,
    select: CONNECTION_SELECT,
  });
  return rows.map(serializeConnection);
}

export async function getDistributionConnection(
  restaurantId: string,
  connectionId: string,
): Promise<DistributionConnectionView> {
  return serializeConnection(await findConnection(restaurantId, connectionId));
}

export async function disconnectDistributionConnection(
  restaurantId: string,
  connectionId: string,
  now?: Date,
): Promise<DistributionConnectionView> {
  const current = await findConnection(restaurantId, connectionId);
  const row = await db.distributionConnection.update({
    where: { id: current.id },
    data: {
      status: DistributionConnectionStatus.DISCONNECTED,
      disconnectedAt: now ?? new Date(),
      lastErrorCode: null,
    },
    select: CONNECTION_SELECT,
  });
  return serializeConnection(row);
}

export async function createDistributionSyncRun(input: {
  restaurantId: string;
  connectionId: string;
  direction: DistributionSyncDirection | string;
  idempotencyKey: string;
  windowStart?: Date | string | null;
  windowEnd?: Date | string | null;
  sourceCursor?: string | null;
  actor?: string;
}): Promise<DistributionSyncRunView> {
  const connection = await findConnection(input.restaurantId, input.connectionId);
  assertConnectionWritable(connection.status);
  const direction = normalizeDirection(input.direction);
  const rawKey = normalizeIdempotencyKey(input.idempotencyKey);
  const idempotencyKey = hashWithPrefix(
    IDEMPOTENCY_HASH_PREFIX,
    input.restaurantId,
    input.connectionId,
    rawKey,
  );
  const window = normalizeWindow(input.windowStart, input.windowEnd);
  const sourceCursor = normalizeText(
    input.sourceCursor,
    'DISTRIBUTION_CONFIG_INVALID',
    'sourceCursor',
    512,
  );
  const existing = await db.distributionSyncRun.findUnique({
    where: { idempotencyKey },
    select: SYNC_RUN_SELECT,
  });
  if (existing) {
    if (
      existing.connectionId !== input.connectionId ||
      existing.direction !== direction ||
      existing.windowStart?.getTime() !== window.start?.getTime() ||
      existing.windowEnd?.getTime() !== window.end?.getTime() ||
      existing.sourceCursor !== sourceCursor
    ) {
      throw new DistributionConflictError(
        'DISTRIBUTION_SYNC_IDEMPOTENCY_CONFLICT',
        'La clé de synchronisation est déjà utilisée avec une autre charge.',
      );
    }
    return serializeSyncRun(existing, true);
  }
  try {
    const row = await db.distributionSyncRun.create({
      data: {
        restaurantId: input.restaurantId,
        connectionId: input.connectionId,
        direction,
        status: DistributionSyncRunStatus.QUEUED,
        idempotencyKey,
        ...(input.actor?.trim() ? { actorHash: hashDistributionActor(input.actor) } : {}),
        windowStart: window.start,
        windowEnd: window.end,
        sourceCursor,
      },
      select: SYNC_RUN_SELECT,
    });
    return serializeSyncRun(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const raced = await db.distributionSyncRun.findUnique({
        where: { idempotencyKey },
        select: SYNC_RUN_SELECT,
      });
      if (
        raced &&
        raced.connectionId === input.connectionId &&
        raced.direction === direction &&
        raced.windowStart?.getTime() === window.start?.getTime() &&
        raced.windowEnd?.getTime() === window.end?.getTime() &&
        raced.sourceCursor === sourceCursor
      )
        return serializeSyncRun(raced, true);
      throw new DistributionConflictError(
        'DISTRIBUTION_SYNC_IDEMPOTENCY_CONFLICT',
        'La clé de synchronisation est déjà utilisée avec une autre charge.',
      );
    }
    throw error;
  }
}

export async function listDistributionSyncRuns(input: {
  restaurantId: string;
  connectionId?: string;
  status?: DistributionSyncRunStatus;
  limit?: number;
}): Promise<DistributionSyncRunView[]> {
  const limit = Math.min(Math.max(input.limit ?? MAX_RUN_LIMIT, 1), MAX_RUN_LIMIT);
  const rows = await db.distributionSyncRun.findMany({
    where: {
      restaurantId: input.restaurantId,
      ...(input.connectionId ? { connectionId: input.connectionId } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: SYNC_RUN_SELECT,
  });
  return rows.map((row) => serializeSyncRun(row));
}

export async function finishDistributionSyncRun(input: {
  restaurantId: string;
  runId: string;
  status: DistributionSyncRunStatus;
  pushedCount?: number;
  pulledCount?: number;
  failedCount?: number;
  targetCursor?: string | null;
  errorCode?: string | null;
  now?: Date;
}): Promise<DistributionSyncRunView> {
  const current = await db.distributionSyncRun.findFirst({
    where: { id: input.runId, restaurantId: input.restaurantId },
    select: SYNC_RUN_SELECT,
  });
  if (!current) throw new DistributionSyncRunNotFoundError();
  const terminal: DistributionSyncRunStatus[] = [
    DistributionSyncRunStatus.SUCCEEDED,
    DistributionSyncRunStatus.FAILED,
    DistributionSyncRunStatus.NEEDS_REVIEW,
  ];
  if (terminal.includes(current.status)) {
    if (current.status === input.status) return serializeSyncRun(current, true);
    throw new DistributionStateError(
      'DISTRIBUTION_SYNC_RUN_FINAL',
      'Le run de synchronisation est déjà final.',
    );
  }
  const pushedCount = input.pushedCount ?? current.pushedCount;
  const pulledCount = input.pulledCount ?? current.pulledCount;
  const failedCount = input.failedCount ?? current.failedCount;
  if (
    ![pushedCount, pulledCount, failedCount].every((value) => Number.isInteger(value) && value >= 0)
  ) {
    throw new DistributionInputError(
      'DISTRIBUTION_CAPACITY_INVALID',
      'Les compteurs de synchronisation sont invalides.',
    );
  }
  const now = input.now ?? new Date();
  const row = await db.distributionSyncRun.update({
    where: { id: current.id },
    data: {
      status: input.status,
      pushedCount,
      pulledCount,
      failedCount,
      targetCursor: normalizeText(
        input.targetCursor,
        'DISTRIBUTION_CONFIG_INVALID',
        'targetCursor',
        512,
      ),
      errorCode: normalizeText(input.errorCode, 'DISTRIBUTION_CONFIG_INVALID', 'errorCode', 128),
      startedAt: current.startedAt ?? now,
      finishedAt: now,
    },
    select: SYNC_RUN_SELECT,
  });
  return serializeSyncRun(row);
}

export async function upsertDistributionAvailability(input: {
  restaurantId: string;
  connectionId: string;
  slotKey: string;
  serviceDate: Date | string;
  startsAt: Date | string;
  endsAt: Date | string;
  partySize: number;
  available: number;
  capacity: number;
  sourceRevision?: string | null;
  payloadHash?: string | null;
  now?: Date;
}): Promise<DistributionAvailabilityView> {
  const connection = await findConnection(input.restaurantId, input.connectionId);
  assertConnectionWritable(connection.status);
  const slotKey = normalizeSlotKey(input.slotKey);
  const serviceDate = normalizeDate(input.serviceDate, 'serviceDate');
  const startsAt = normalizeDate(input.startsAt, 'startsAt');
  const endsAt = normalizeDate(input.endsAt, 'endsAt');
  if (!serviceDate || !startsAt || !endsAt || endsAt <= startsAt) {
    throw new DistributionInputError(
      'DISTRIBUTION_DATE_INVALID',
      'Les dates du créneau sont invalides.',
    );
  }
  const partySize = normalizePartySize(input.partySize);
  const capacity = normalizeCapacity(input.capacity, 'capacity');
  const available = normalizeCapacity(input.available, 'available');
  if (available > capacity)
    throw new DistributionInputError(
      'DISTRIBUTION_CAPACITY_INVALID',
      'available ne peut pas dépasser capacity.',
    );
  const sourceRevision = normalizeText(
    input.sourceRevision,
    'DISTRIBUTION_CONFIG_INVALID',
    'sourceRevision',
    128,
  );
  const suppliedHash = normalizeHash(
    input.payloadHash,
    'DISTRIBUTION_PAYLOAD_HASH_INVALID',
    'payloadHash',
  );
  const payloadHash =
    suppliedHash ??
    hash(
      stableStringify({
        slotKey,
        serviceDate,
        startsAt,
        endsAt,
        partySize,
        available,
        capacity,
        sourceRevision,
      }),
    );
  const row = await db.distributionAvailabilitySnapshot.upsert({
    where: { connectionId_slotKey: { connectionId: input.connectionId, slotKey } },
    create: {
      restaurantId: input.restaurantId,
      connectionId: input.connectionId,
      slotKey,
      serviceDate,
      startsAt,
      endsAt,
      partySize,
      available,
      capacity,
      sourceRevision,
      payloadHash,
      observedAt: input.now ?? new Date(),
    },
    update: {
      serviceDate,
      startsAt,
      endsAt,
      partySize,
      available,
      capacity,
      sourceRevision,
      payloadHash,
      observedAt: input.now ?? new Date(),
    },
    select: AVAILABILITY_SELECT,
  });
  return serializeAvailability(row);
}

export async function listDistributionAvailability(input: {
  restaurantId: string;
  connectionId: string;
  serviceDate?: Date | string;
  partySize?: number;
  limit?: number;
}): Promise<DistributionAvailabilityView[]> {
  await findConnection(input.restaurantId, input.connectionId);
  const serviceDate = input.serviceDate ? normalizeDate(input.serviceDate, 'serviceDate') : null;
  const partySize = input.partySize === undefined ? undefined : normalizePartySize(input.partySize);
  const limit = Math.min(Math.max(input.limit ?? MAX_SLOT_LIMIT, 1), MAX_SLOT_LIMIT);
  const rows = await db.distributionAvailabilitySnapshot.findMany({
    where: {
      restaurantId: input.restaurantId,
      connectionId: input.connectionId,
      ...(serviceDate ? { serviceDate } : {}),
      ...(partySize ? { partySize } : {}),
    },
    orderBy: [{ serviceDate: 'asc' }, { startsAt: 'asc' }],
    take: limit,
    select: AVAILABILITY_SELECT,
  });
  return rows.map(serializeAvailability);
}

export async function linkDistributionReservation(input: {
  restaurantId: string;
  connectionId: string;
  reservationId: string;
  externalReservationId: string;
  source: string;
  now?: Date;
}): Promise<DistributionReservationLinkView> {
  const connection = await findConnection(input.restaurantId, input.connectionId);
  assertConnectionWritable(connection.status);
  const reservation = await db.reservation.findFirst({
    where: { id: input.reservationId, restaurantId: input.restaurantId },
    select: { id: true },
  });
  if (!reservation) throw new DistributionReservationNotFoundError();
  const externalId = normalizeExternalAccount(input.externalReservationId);
  if (!externalId)
    throw new DistributionInputError(
      'DISTRIBUTION_EXTERNAL_ACCOUNT_INVALID',
      'externalReservationId est obligatoire.',
    );
  const source = normalizeSource(input.source);
  const externalIdHash = hashWithPrefix(EXTERNAL_ID_HASH_PREFIX, connection.provider, externalId);
  const externalIdLast4 = externalId.slice(-4);
  const existingExternal = await db.distributionReservationLink.findUnique({
    where: { connectionId_externalIdHash: { connectionId: input.connectionId, externalIdHash } },
    select: LINK_SELECT,
  });
  if (existingExternal) {
    if (existingExternal.reservationId !== input.reservationId)
      throw new DistributionConflictError(
        'DISTRIBUTION_RESERVATION_LINK_CONFLICT',
        'La référence partenaire est déjà liée à une autre réservation.',
      );
    return serializeLink(existingExternal, true);
  }
  const existingReservation = await db.distributionReservationLink.findUnique({
    where: {
      connectionId_reservationId: {
        connectionId: input.connectionId,
        reservationId: input.reservationId,
      },
    },
    select: LINK_SELECT,
  });
  if (existingReservation && existingReservation.externalIdHash !== externalIdHash)
    throw new DistributionConflictError(
      'DISTRIBUTION_RESERVATION_LINK_CONFLICT',
      'La réservation possède déjà une référence partenaire.',
    );
  try {
    const row = await db.distributionReservationLink.create({
      data: {
        restaurantId: input.restaurantId,
        connectionId: input.connectionId,
        reservationId: input.reservationId,
        externalIdHash,
        externalIdLast4,
        status: DistributionReservationLinkStatus.ACTIVE,
        source,
        linkedAt: input.now ?? new Date(),
      },
      select: LINK_SELECT,
    });
    return serializeLink(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const raced = await db.distributionReservationLink.findUnique({
        where: {
          connectionId_externalIdHash: { connectionId: input.connectionId, externalIdHash },
        },
        select: LINK_SELECT,
      });
      if (raced && raced.reservationId === input.reservationId) return serializeLink(raced, true);
      const racedReservation = await db.distributionReservationLink.findUnique({
        where: {
          connectionId_reservationId: {
            connectionId: input.connectionId,
            reservationId: input.reservationId,
          },
        },
        select: LINK_SELECT,
      });
      if (racedReservation) {
        throw new DistributionConflictError(
          'DISTRIBUTION_RESERVATION_LINK_CONFLICT',
          'La réservation possède déjà une référence partenaire.',
        );
      }
      throw new DistributionConflictError(
        'DISTRIBUTION_RESERVATION_LINK_CONFLICT',
        'La référence partenaire est déjà liée.',
      );
    }
    throw error;
  }
}

export async function listDistributionReservationLinks(input: {
  restaurantId: string;
  connectionId?: string;
  status?: DistributionReservationLinkStatus;
  limit?: number;
}): Promise<DistributionReservationLinkView[]> {
  const limit = Math.min(Math.max(input.limit ?? MAX_LIST_LIMIT, 1), MAX_LIST_LIMIT);
  const rows = await db.distributionReservationLink.findMany({
    where: {
      restaurantId: input.restaurantId,
      ...(input.connectionId ? { connectionId: input.connectionId } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: LINK_SELECT,
  });
  return rows.map((row) => serializeLink(row));
}

export async function ingestDistributionWebhook(input: {
  restaurantId: string;
  connectionId?: string | null;
  provider: DistributionProvider | string;
  externalEventId: string;
  eventType: string;
  payload?: unknown;
  payloadHash?: string | null;
  now?: Date;
}): Promise<DistributionWebhookView> {
  const provider = normalizeProvider(input.provider);
  const externalEventId = normalizeExternalEventId(input.externalEventId);
  const eventType = normalizeEventType(input.eventType);
  const suppliedHash = normalizeHash(
    input.payloadHash,
    'DISTRIBUTION_PAYLOAD_HASH_INVALID',
    'payloadHash',
  );
  const payloadHash = suppliedHash ?? hash(stableStringify(input.payload ?? {}));
  const connectionId: string | null = input.connectionId ?? null;
  if (connectionId) {
    const connection = await findConnection(input.restaurantId, connectionId);
    if (connection.provider !== provider)
      throw new DistributionConflictError(
        'DISTRIBUTION_WEBHOOK_CONFLICT',
        'Le fournisseur du webhook ne correspond pas à la connexion.',
      );
  }
  const externalEventHash = hashWithPrefix(
    WEBHOOK_ID_HASH_PREFIX,
    input.restaurantId,
    provider,
    externalEventId,
  );
  const existing = await db.distributionWebhookEvent.findUnique({
    where: {
      restaurantId_provider_externalEventHash: {
        restaurantId: input.restaurantId,
        provider,
        externalEventHash,
      },
    },
    select: WEBHOOK_SELECT,
  });
  if (existing) {
    if (
      existing.payloadHash !== payloadHash ||
      existing.eventType !== eventType ||
      existing.connectionId !== connectionId
    )
      throw new DistributionConflictError(
        'DISTRIBUTION_WEBHOOK_CONFLICT',
        'Le webhook existe avec une charge différente.',
      );
    return serializeWebhook(existing, true);
  }
  try {
    const row = await db.distributionWebhookEvent.create({
      data: {
        restaurantId: input.restaurantId,
        connectionId,
        provider,
        externalEventHash,
        eventType,
        payloadHash,
        status: DistributionWebhookStatus.RECEIVED,
        receivedAt: input.now ?? new Date(),
      },
      select: WEBHOOK_SELECT,
    });
    return serializeWebhook(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const raced = await db.distributionWebhookEvent.findUnique({
        where: {
          restaurantId_provider_externalEventHash: {
            restaurantId: input.restaurantId,
            provider,
            externalEventHash,
          },
        },
        select: WEBHOOK_SELECT,
      });
      if (
        raced &&
        raced.payloadHash === payloadHash &&
        raced.eventType === eventType &&
        raced.connectionId === connectionId
      )
        return serializeWebhook(raced, true);
      throw new DistributionConflictError(
        'DISTRIBUTION_WEBHOOK_CONFLICT',
        'Le webhook existe avec une charge différente.',
      );
    }
    throw error;
  }
}

export async function listDistributionWebhooks(input: {
  restaurantId: string;
  connectionId?: string;
  provider?: DistributionProvider;
  status?: DistributionWebhookStatus;
  limit?: number;
}): Promise<DistributionWebhookView[]> {
  const limit = Math.min(Math.max(input.limit ?? MAX_LIST_LIMIT, 1), MAX_LIST_LIMIT);
  const rows = await db.distributionWebhookEvent.findMany({
    where: {
      restaurantId: input.restaurantId,
      ...(input.connectionId ? { connectionId: input.connectionId } : {}),
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
    orderBy: { receivedAt: 'desc' },
    take: limit,
    select: WEBHOOK_SELECT,
  });
  return rows.map((row) => serializeWebhook(row));
}

export async function finishDistributionWebhook(input: {
  restaurantId: string;
  webhookId: string;
  status: DistributionWebhookStatus;
  errorCode?: string | null;
  now?: Date;
}): Promise<DistributionWebhookView> {
  const current = await db.distributionWebhookEvent.findFirst({
    where: { id: input.webhookId, restaurantId: input.restaurantId },
    select: WEBHOOK_SELECT,
  });
  if (!current) throw new DistributionWebhookNotFoundError();
  const terminal: DistributionWebhookStatus[] = [
    DistributionWebhookStatus.PROCESSED,
    DistributionWebhookStatus.IGNORED,
    DistributionWebhookStatus.FAILED,
  ];
  if (terminal.includes(current.status)) {
    if (current.status === input.status) return serializeWebhook(current, true);
    throw new DistributionStateError('DISTRIBUTION_WEBHOOK_FINAL', 'Le webhook est déjà final.');
  }
  const row = await db.distributionWebhookEvent.update({
    where: { id: current.id },
    data: {
      status: input.status,
      errorCode: normalizeText(input.errorCode, 'DISTRIBUTION_CONFIG_INVALID', 'errorCode', 128),
      processedAt: input.now ?? new Date(),
    },
    select: WEBHOOK_SELECT,
  });
  return serializeWebhook(row);
}
