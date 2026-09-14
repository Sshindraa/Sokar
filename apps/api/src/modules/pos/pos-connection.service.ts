import { PosConnectionStatus } from '@prisma/client';
import { db } from '../../shared/db/client';
import type { PosConnectionHealth, PosConnectionInput } from './pos-connector';

const PROVIDER_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,63})$/;
const LOCATION_PATTERN = /^[^\u0000-\u001f\u007f]{1,191}$/;
const OPAQUE_REFERENCE_PATTERN = /^[A-Za-z0-9._:/@+\-]+$/;

export class PosConnectionInputError extends Error {
  constructor(
    readonly code:
      | 'POS_PROVIDER_INVALID'
      | 'POS_LOCATION_INVALID'
      | 'POS_CREDENTIAL_REFERENCE_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'PosConnectionInputError';
  }
}

export class PosConnectionNotFoundError extends Error {
  readonly code = 'POS_CONNECTION_NOT_FOUND';

  constructor() {
    super('POS connection not found');
    this.name = 'PosConnectionNotFoundError';
  }
}

export class PosConnectionStateError extends Error {
  constructor(readonly code: 'POS_CONNECTION_DISCONNECTED') {
    super('POS connection is disconnected');
    this.name = 'PosConnectionStateError';
  }
}

function normalizeProvider(value: string): string {
  const provider = value.trim().toLowerCase();
  if (!PROVIDER_PATTERN.test(provider)) {
    throw new PosConnectionInputError(
      'POS_PROVIDER_INVALID',
      'Le fournisseur POS doit être un identifiant technique sûr.',
    );
  }
  return provider;
}

function normalizeLocation(value: string): string {
  const location = value.trim();
  if (!LOCATION_PATTERN.test(location) || location.length > 191) {
    throw new PosConnectionInputError(
      'POS_LOCATION_INVALID',
      'La localisation POS est obligatoire et ne doit pas contenir de contrôle.',
    );
  }
  return location;
}

/**
 * Accept an opaque secret-manager reference, never a token. Delimiters used by
 * common secret stores are allowed; whitespace, control characters and `=`
 * (typical of pasted credentials) are rejected at the boundary.
 */
export function normalizeCredentialReference(value: string): string {
  const reference = value.trim();
  const looksLikeCredential = /^(?:bearer\s|sk_|pk_|rk_|tok_|api[_-])/i.test(reference);
  if (
    reference.length === 0 ||
    reference.length > 191 ||
    looksLikeCredential ||
    !OPAQUE_REFERENCE_PATTERN.test(reference)
  ) {
    throw new PosConnectionInputError(
      'POS_CREDENTIAL_REFERENCE_INVALID',
      'credentialReference doit pointer vers un secret externe sans contenir le secret.',
    );
  }
  return reference;
}

function healthFromRow(row: {
  id: string;
  provider: string;
  externalLocationId: string;
  credentialReference: string;
  status: PosConnectionStatus;
  cursor: string | null;
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
  lastErrorCode: string | null;
}): PosConnectionHealth {
  return {
    id: row.id,
    provider: row.provider,
    externalLocationId: row.externalLocationId,
    status: row.status,
    hasCredentialReference: row.credentialReference.length > 0,
    cursorPresent: Boolean(row.cursor),
    lastSuccessAt: row.lastSuccessAt,
    lastAttemptAt: row.lastAttemptAt,
    lastErrorCode: row.lastErrorCode,
  };
}

const healthSelect = {
  id: true,
  provider: true,
  externalLocationId: true,
  credentialReference: true,
  status: true,
  cursor: true,
  lastSuccessAt: true,
  lastAttemptAt: true,
  lastErrorCode: true,
} as const;

export async function createOrUpdatePosConnection(
  restaurantId: string,
  input: PosConnectionInput,
): Promise<PosConnectionHealth> {
  const provider = normalizeProvider(input.provider);
  const externalLocationId = normalizeLocation(input.externalLocationId);
  const credentialReference = normalizeCredentialReference(input.credentialReference);

  const existing = await db.posConnection.findUnique({
    where: { restaurantId_provider: { restaurantId, provider } },
    select: {
      id: true,
      externalLocationId: true,
      credentialReference: true,
      status: true,
    },
  });

  const changed = Boolean(
    existing &&
    (existing.externalLocationId !== externalLocationId ||
      existing.credentialReference !== credentialReference),
  );
  const row = existing
    ? await db.posConnection.update({
        where: { id: existing.id },
        data: {
          externalLocationId,
          credentialReference,
          ...(changed
            ? {
                status: PosConnectionStatus.PENDING,
                cursor: null,
                lastSuccessAt: null,
                lastAttemptAt: null,
                lastErrorCode: null,
              }
            : {}),
        },
        select: healthSelect,
      })
    : await db.posConnection.create({
        data: {
          restaurantId,
          provider,
          externalLocationId,
          credentialReference,
          status: PosConnectionStatus.PENDING,
        },
        select: healthSelect,
      });

  return healthFromRow(row);
}

export async function listPosConnections(restaurantId: string): Promise<PosConnectionHealth[]> {
  const rows = await db.posConnection.findMany({
    where: { restaurantId },
    orderBy: [{ provider: 'asc' }, { createdAt: 'asc' }],
    select: healthSelect,
  });
  return rows.map(healthFromRow);
}

export async function getPosConnectionHealth(
  restaurantId: string,
  id: string,
): Promise<PosConnectionHealth> {
  const row = await db.posConnection.findFirst({
    where: { id, restaurantId },
    select: healthSelect,
  });
  if (!row) throw new PosConnectionNotFoundError();
  return healthFromRow(row);
}

export async function disconnectPosConnection(
  restaurantId: string,
  id: string,
): Promise<PosConnectionHealth> {
  const current = await db.posConnection.findFirst({
    where: { id, restaurantId },
    select: { id: true },
  });
  if (!current) throw new PosConnectionNotFoundError();

  const row = await db.posConnection.update({
    where: { id: current.id },
    data: { status: PosConnectionStatus.DISCONNECTED, lastErrorCode: null },
    select: healthSelect,
  });
  return healthFromRow(row);
}

export async function assertPosConnectionForImport(
  restaurantId: string,
  connectionId: string,
): Promise<{ id: string; status: PosConnectionStatus }> {
  const row = await db.posConnection.findFirst({
    where: { id: connectionId, restaurantId },
    select: { id: true, status: true },
  });
  if (!row) throw new PosConnectionNotFoundError();
  if (row.status === PosConnectionStatus.DISCONNECTED) {
    throw new PosConnectionStateError('POS_CONNECTION_DISCONNECTED');
  }
  return row;
}
