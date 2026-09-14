import type { Prisma, PosConnectionStatus } from '@prisma/client';

/** Provider-neutral input accepted by the import boundary. */
export interface PosConnectionInput {
  provider: string;
  externalLocationId: string;
  /** Opaque reference to a secret-manager entry; never a provider token. */
  credentialReference: string;
}

export interface PosConnectionHealth {
  id: string;
  provider: string;
  externalLocationId: string;
  status: PosConnectionStatus;
  hasCredentialReference: boolean;
  cursorPresent: boolean;
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
  lastErrorCode: string | null;
}

export interface PosMatchingHints {
  reservationExternalId?: string | null;
  partySize?: number | null;
  customerPhone?: string | null;
  customerToken?: string | null;
  conflict?: boolean;
}

/** A raw, provider-shaped ticket after its fields have been mapped. */
export interface PosCheckInput {
  externalId: string;
  externalRevision?: string | null;
  openedAt: Date | string;
  closedAt?: Date | string | null;
  tableReference?: string | null;
  subtotal: Prisma.Decimal | string | number;
  tax: Prisma.Decimal | string | number;
  tip?: Prisma.Decimal | string | number | null;
  discount?: Prisma.Decimal | string | number | null;
  total: Prisma.Decimal | string | number;
  refundedAmount?: Prisma.Decimal | string | number | null;
  currency?: string | null;
  /** Used only to produce an audit hash; the payload itself is never stored. */
  rawPayload?: unknown;
  /** Optional explicit reservation hint used by the local matcher only. */
  reservationId?: string | null;
  matchingHints?: PosMatchingHints | null;
}

export interface NormalizedPosCheckInput {
  externalId: string;
  externalRevision: string | null;
  openedAt: Date;
  closedAt: Date | null;
  tableReference: string | null;
  subtotal: Prisma.Decimal;
  tax: Prisma.Decimal;
  tip: Prisma.Decimal;
  discount: Prisma.Decimal;
  total: Prisma.Decimal;
  refundedAmount: Prisma.Decimal;
  currency: string;
  rawPayloadHash: string;
  reservationId: string | null;
  matchingHints: PosMatchingHints | null;
}

export interface PosCheckView {
  id: string;
  connectionId: string;
  externalId: string;
  externalRevision: string | null;
  openedAt: string;
  closedAt: string | null;
  tableReference: string | null;
  subtotal: string;
  tax: string;
  tip: string;
  discount: string;
  total: string;
  refundedAmount: string;
  currency: string;
  rawPayloadHash: string;
  importedAt: string;
  updatedAt: string;
}

export interface ConnectionResult {
  connectionId: string;
  status: PosConnectionStatus;
}

export interface SyncPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Contract implemented by a real connector after a provider has been chosen.
 * The current branch deliberately ships only this boundary and the local
 * persistence layer; no provider implementation is registered yet.
 */
export interface PosConnector {
  connect(input: PosConnectionInput): Promise<ConnectionResult>;
  verifyConnection(): Promise<PosConnectionHealth>;
  syncChecks(cursor?: string): Promise<SyncPage<PosCheckInput>>;
  getCheck(id: string): Promise<PosCheckInput | null>;
  disconnect(): Promise<void>;
}
