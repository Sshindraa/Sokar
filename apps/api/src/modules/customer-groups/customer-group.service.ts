import { Prisma, CustomerGroupConsentStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { db } from '../../shared/db/client';

const GROUP_SELECT = {
  id: true,
  accountId: true,
  name: true,
  consentStatus: true,
  consentedAt: true,
  createdByHash: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class CustomerGroupInputError extends Error {
  constructor(
    readonly code:
      | 'CUSTOMER_GROUP_NAME_INVALID'
      | 'CUSTOMER_GROUP_ACCOUNT_REQUIRED'
      | 'CUSTOMER_GROUP_CONSENT_REQUIRED'
      | 'CUSTOMER_GROUP_CONFIDENCE_INVALID'
      | 'CUSTOMER_GROUP_SOURCE_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'CustomerGroupInputError';
  }
}

export class CustomerGroupNotFoundError extends Error {
  readonly code = 'CUSTOMER_GROUP_NOT_FOUND';

  constructor() {
    super('Customer group not found');
    this.name = 'CustomerGroupNotFoundError';
  }
}

export class CustomerGroupCustomerNotFoundError extends Error {
  readonly code = 'CUSTOMER_GROUP_CUSTOMER_NOT_FOUND';

  constructor() {
    super('Customer is not available in this account');
    this.name = 'CustomerGroupCustomerNotFoundError';
  }
}

export class CustomerGroupConflictError extends Error {
  constructor(
    readonly code: 'CUSTOMER_GROUP_MEMBER_ALREADY_LINKED' | 'CUSTOMER_GROUP_ACCOUNT_MISMATCH',
  ) {
    super(
      code === 'CUSTOMER_GROUP_MEMBER_ALREADY_LINKED'
        ? 'Customer is already linked to another group in this account'
        : 'Customer group account does not match the active site',
    );
    this.name = 'CustomerGroupConflictError';
  }
}

export interface CustomerGroupView {
  id: string;
  accountId: string;
  name: string;
  consentStatus: CustomerGroupConsentStatus;
  consentedAt: Date | null;
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerGroupMemberView {
  customerId: string;
  restaurantId: string;
  customerName: string | null;
  phoneLast4: string;
  source: string;
  confidence: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerGroupDetail extends CustomerGroupView {
  members: CustomerGroupMemberView[];
}

function hashActor(actor: string): string {
  return createHash('sha256').update(`sokar:customer-group:${actor}`).digest('hex');
}

function hashIdempotencyKey(accountId: string, key: string): string {
  return createHash('sha256')
    .update(`sokar:customer-group-idempotency:${accountId}:${key}`)
    .digest('hex');
}

function normalizeIdempotencyKey(value: string | undefined): string | undefined {
  const key = value?.trim();
  return key ? key : undefined;
}

function normalizeName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new CustomerGroupInputError(
      'CUSTOMER_GROUP_NAME_INVALID',
      'Le nom du groupe doit contenir entre 1 et 120 caractères sûrs.',
    );
  }
  return name;
}

function normalizeConfidence(value: number | undefined): Prisma.Decimal {
  const confidence = value ?? 1;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new CustomerGroupInputError(
      'CUSTOMER_GROUP_CONFIDENCE_INVALID',
      'La confiance doit être comprise entre 0 et 1.',
    );
  }
  return new Prisma.Decimal(confidence.toFixed(3));
}

function normalizeSource(value: string): string {
  const source = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_.-]{1,31}$/.test(source)) {
    throw new CustomerGroupInputError(
      'CUSTOMER_GROUP_SOURCE_INVALID',
      'La source du rattachement est invalide.',
    );
  }
  return source;
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.slice(-4).padStart(4, '•');
}

/** Memberships use a composite primary key in Prisma; expose a stable opaque
 * identifier to clients without adding a second mutable database identity. */
function membershipIdFor(groupProfileId: string, restaurantId: string, customerId: string): string {
  return createHash('sha256')
    .update(`sokar:customer-group-membership:${groupProfileId}:${restaurantId}:${customerId}`)
    .digest('hex');
}

type GroupRow = {
  id: string;
  accountId: string;
  name: string;
  consentStatus: CustomerGroupConsentStatus;
  consentedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { memberships: number };
};

type GroupMemberRow = {
  customerId: string;
  restaurantId: string;
  source: string;
  confidence: Prisma.Decimal;
  createdAt: Date;
  updatedAt: Date;
  customer: { id: string; name: string | null; phone: string };
};

type GroupDetailRow = GroupRow & { memberships: GroupMemberRow[] };

function serializeGroup(row: GroupRow): CustomerGroupView {
  return {
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    consentStatus: row.consentStatus,
    consentedAt: row.consentedAt,
    memberCount: row._count?.memberships ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function assertAccountSite(
  accountId: string | null | undefined,
  restaurantId: string,
): Promise<string> {
  if (!accountId) {
    throw new CustomerGroupInputError(
      'CUSTOMER_GROUP_ACCOUNT_REQUIRED',
      'Un compte multi-site est requis pour le CRM groupe.',
    );
  }
  const site = await db.restaurant.findFirst({
    where: { id: restaurantId, accountId, siteStatus: { notIn: ['ARCHIVED', 'SUSPENDED'] } },
    select: { id: true, accountId: true },
  });
  if (!site || site.accountId !== accountId) {
    throw new CustomerGroupConflictError('CUSTOMER_GROUP_ACCOUNT_MISMATCH');
  }
  return accountId;
}

export async function createCustomerGroup(input: {
  accountId: string | null | undefined;
  restaurantId: string;
  name: string;
  consentStatus?: CustomerGroupConsentStatus;
  idempotencyKey?: string;
  actor: string;
}): Promise<CustomerGroupView> {
  const accountId = await assertAccountSite(input.accountId, input.restaurantId);
  const name = normalizeName(input.name);
  const consentStatus = input.consentStatus ?? CustomerGroupConsentStatus.UNKNOWN;
  const consentedAt = consentStatus === CustomerGroupConsentStatus.OPTED_IN ? new Date() : null;
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const idempotencyHash = idempotencyKey
    ? hashIdempotencyKey(accountId, idempotencyKey)
    : undefined;
  if (idempotencyHash) {
    const existing = await db.customerGroupProfile.findUnique({
      where: { idempotencyKey: idempotencyHash },
      select: { ...GROUP_SELECT, _count: { select: { memberships: true } } },
    });
    if (existing) return serializeGroup(existing);
  }
  let row: GroupRow;
  try {
    row = await db.customerGroupProfile.create({
      data: {
        accountId,
        ...(idempotencyHash ? { idempotencyKey: idempotencyHash } : {}),
        name,
        consentStatus,
        consentedAt,
        createdByHash: hashActor(input.actor),
      },
      select: { ...GROUP_SELECT, _count: { select: { memberships: true } } },
    });
  } catch (error) {
    if (
      !idempotencyHash ||
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      throw error;
    }
    const raced = await db.customerGroupProfile.findUnique({
      where: { idempotencyKey: idempotencyHash },
      select: { ...GROUP_SELECT, _count: { select: { memberships: true } } },
    });
    if (!raced) throw error;
    return serializeGroup(raced);
  }
  return serializeGroup(row);
}

export async function listCustomerGroups(input: {
  accountId: string | null | undefined;
  restaurantId: string;
}): Promise<CustomerGroupView[]> {
  const accountId = await assertAccountSite(input.accountId, input.restaurantId);
  const rows = await db.customerGroupProfile.findMany({
    where: { accountId },
    orderBy: [{ updatedAt: 'desc' }],
    select: { ...GROUP_SELECT, _count: { select: { memberships: true } } },
  });
  return rows.map(serializeGroup);
}

export async function getCustomerGroup(input: {
  accountId: string | null | undefined;
  restaurantId: string;
  groupId: string;
}): Promise<CustomerGroupDetail> {
  const accountId = await assertAccountSite(input.accountId, input.restaurantId);
  const row = (await db.customerGroupProfile.findFirst({
    where: { id: input.groupId, accountId },
    select: {
      ...GROUP_SELECT,
      memberships: {
        orderBy: [{ createdAt: 'asc' }],
        select: {
          customerId: true,
          restaurantId: true,
          source: true,
          confidence: true,
          createdAt: true,
          updatedAt: true,
          customer: { select: { id: true, name: true, phone: true } },
        },
      },
    },
  })) as GroupDetailRow | null;
  if (!row) throw new CustomerGroupNotFoundError();
  const group: CustomerGroupView = {
    ...serializeGroup(row),
    memberCount: row.memberships.length,
  };
  return {
    ...group,
    members: row.memberships.map((member) => ({
      customerId: member.customerId,
      restaurantId: member.restaurantId,
      customerName: member.customer.name,
      phoneLast4: maskPhone(member.customer.phone),
      source: member.source,
      confidence: member.confidence.toFixed(3),
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
    })),
  };
}

export async function updateCustomerGroupConsent(input: {
  accountId: string | null | undefined;
  restaurantId: string;
  groupId: string;
  consentStatus: CustomerGroupConsentStatus;
}): Promise<CustomerGroupView> {
  const accountId = await assertAccountSite(input.accountId, input.restaurantId);
  const existing = await db.customerGroupProfile.findFirst({
    where: { id: input.groupId, accountId },
    select: { id: true },
  });
  if (!existing) throw new CustomerGroupNotFoundError();
  const row = await db.$transaction(async (tx) => {
    // Revoking inter-site consent also removes the account-level links. The
    // per-site Customer projections remain untouched and can be re-linked only
    // after a fresh OPTED_IN decision.
    if (input.consentStatus === CustomerGroupConsentStatus.OPTED_OUT) {
      await tx.customerGroupMembership.deleteMany({
        where: { accountId, groupProfileId: existing.id },
      });
    }
    return tx.customerGroupProfile.update({
      where: { id: existing.id },
      data: {
        consentStatus: input.consentStatus,
        consentedAt:
          input.consentStatus === CustomerGroupConsentStatus.OPTED_IN ? new Date() : null,
      },
      select: { ...GROUP_SELECT, _count: { select: { memberships: true } } },
    });
  });
  return serializeGroup(row);
}

export async function linkCustomerToGroup(input: {
  accountId: string | null | undefined;
  restaurantId: string;
  groupId: string;
  customerId: string;
  source: string;
  confidence?: number;
}): Promise<{ membershipId: string; idempotent: boolean }> {
  const accountId = await assertAccountSite(input.accountId, input.restaurantId);
  const group = await db.customerGroupProfile.findFirst({
    where: { id: input.groupId, accountId },
    select: { id: true, accountId: true, consentStatus: true },
  });
  if (!group) throw new CustomerGroupNotFoundError();
  if (group.consentStatus !== CustomerGroupConsentStatus.OPTED_IN) {
    throw new CustomerGroupInputError(
      'CUSTOMER_GROUP_CONSENT_REQUIRED',
      'Le consentement inter-établissements doit être OPTED_IN avant un rattachement.',
    );
  }
  const customer = await db.customer.findFirst({
    where: {
      id: input.customerId,
      restaurantId: input.restaurantId,
      restaurant: { accountId, siteStatus: { notIn: ['ARCHIVED', 'SUSPENDED'] } },
    },
    select: { id: true, restaurantId: true },
  });
  if (!customer) throw new CustomerGroupCustomerNotFoundError();
  const source = normalizeSource(input.source);
  const confidence = normalizeConfidence(input.confidence);
  const existing = await db.customerGroupMembership.findUnique({
    where: { accountId_customerId: { accountId, customerId: customer.id } },
    select: { groupProfileId: true, restaurantId: true, customerId: true },
  });
  if (existing) {
    if (existing.groupProfileId !== group.id) {
      throw new CustomerGroupConflictError('CUSTOMER_GROUP_MEMBER_ALREADY_LINKED');
    }
    return {
      membershipId: membershipIdFor(
        existing.groupProfileId,
        existing.restaurantId,
        existing.customerId,
      ),
      idempotent: true,
    };
  }
  let membership: {
    groupProfileId: string;
    restaurantId: string;
    customerId: string;
  };
  try {
    membership = await db.customerGroupMembership.create({
      data: {
        accountId,
        groupProfileId: group.id,
        restaurantId: customer.restaurantId,
        customerId: customer.id,
        source,
        confidence,
      },
      select: { groupProfileId: true, restaurantId: true, customerId: true },
    });
  } catch (error) {
    // Two workers can pass the read-before-write check simultaneously. The
    // account/customer unique index is authoritative; re-read it so the
    // losing request is idempotent for the same group and a conflict for a
    // different group.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }
    const raced = await db.customerGroupMembership.findUnique({
      where: { accountId_customerId: { accountId, customerId: customer.id } },
      select: { groupProfileId: true, restaurantId: true, customerId: true },
    });
    if (!raced) throw error;
    if (raced.groupProfileId !== group.id) {
      throw new CustomerGroupConflictError('CUSTOMER_GROUP_MEMBER_ALREADY_LINKED');
    }
    membership = raced;
    return {
      membershipId: membershipIdFor(
        membership.groupProfileId,
        membership.restaurantId,
        membership.customerId,
      ),
      idempotent: true,
    };
  }
  return {
    membershipId: membershipIdFor(
      membership.groupProfileId,
      membership.restaurantId,
      membership.customerId,
    ),
    idempotent: false,
  };
}

export async function unlinkCustomerFromGroup(input: {
  accountId: string | null | undefined;
  restaurantId: string;
  groupId: string;
  customerId: string;
}): Promise<{ removed: boolean }> {
  const accountId = await assertAccountSite(input.accountId, input.restaurantId);
  const membership = await db.customerGroupMembership.findFirst({
    where: {
      accountId,
      groupProfileId: input.groupId,
      restaurantId: input.restaurantId,
      customerId: input.customerId,
    },
    select: { groupProfileId: true, restaurantId: true, customerId: true },
  });
  if (!membership) return { removed: false };
  await db.customerGroupMembership.delete({
    where: {
      groupProfileId_restaurantId_customerId: {
        groupProfileId: membership.groupProfileId,
        restaurantId: membership.restaurantId,
        customerId: membership.customerId,
      },
    },
  });
  return { removed: true };
}
