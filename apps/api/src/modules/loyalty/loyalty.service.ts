import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  LoyaltyBenefitRule,
  LoyaltyBenefitStatus,
  LoyaltyGrantStatus,
  Prisma,
} from '@prisma/client';
import { db } from '../../shared/db/client';

export const LOYALTY_BENEFIT_RULES = [
  'ANY',
  'VIP',
  'MIN_VISITS',
  'BIRTHDAY_MONTH',
  'MIN_ESTIMATED_SPEND',
] as const;
export type LoyaltyBenefitRuleCode = (typeof LOYALTY_BENEFIT_RULES)[number];

export const LOYALTY_GRANT_STATUSES = ['ISSUED', 'REDEEMED', 'VOID', 'EXPIRED'] as const;

const BENEFIT_KEY_PATTERN = /^[a-z][a-z0-9_.-]{1,47}$/;
const CODE_PATTERN = /^[A-F0-9]{12}$/;
const ACTOR_HASH_PREFIX = 'sokar:loyalty-actor:';
const CODE_HASH_PREFIX = 'sokar:loyalty-code:';
const IDEMPOTENCY_HASH_PREFIX = 'sokar:loyalty-idempotency:';
const MAX_LIST_LIMIT = 100;
const MAX_EXPIRY_SCAN = 1_000;

const BENEFIT_SELECT = {
  id: true,
  restaurantId: true,
  key: true,
  name: true,
  description: true,
  rule: true,
  ruleValue: true,
  costCents: true,
  currency: true,
  validityDays: true,
  maxUsesPerCustomer: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { grants: true } },
} as const;

const GRANT_SELECT = {
  id: true,
  restaurantId: true,
  benefitId: true,
  customerId: true,
  reservationId: true,
  status: true,
  issuedAt: true,
  expiresAt: true,
  redeemedAt: true,
  voidedAt: true,
  redemptionNote: true,
  createdAt: true,
  updatedAt: true,
  benefit: { select: { key: true, name: true, costCents: true, currency: true } },
  customer: { select: { name: true, phone: true } },
} as const;

type BenefitRow = Prisma.LoyaltyBenefitGetPayload<{ select: typeof BENEFIT_SELECT }>;
type GrantRow = Prisma.LoyaltyGrantGetPayload<{ select: typeof GRANT_SELECT }>;

export class LoyaltyInputError extends Error {
  constructor(
    readonly code:
      | 'LOYALTY_BENEFIT_KEY_INVALID'
      | 'LOYALTY_BENEFIT_NAME_INVALID'
      | 'LOYALTY_BENEFIT_DESCRIPTION_INVALID'
      | 'LOYALTY_BENEFIT_RULE_INVALID'
      | 'LOYALTY_BENEFIT_RULE_VALUE_INVALID'
      | 'LOYALTY_BENEFIT_COST_INVALID'
      | 'LOYALTY_BENEFIT_CURRENCY_INVALID'
      | 'LOYALTY_BENEFIT_VALIDITY_INVALID'
      | 'LOYALTY_BENEFIT_MAX_USES_INVALID'
      | 'LOYALTY_GRANT_CODE_INVALID'
      | 'LOYALTY_GRANT_NOTE_INVALID'
      | 'LOYALTY_IDEMPOTENCY_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'LoyaltyInputError';
  }
}

export class LoyaltyBenefitNotFoundError extends Error {
  readonly code = 'LOYALTY_BENEFIT_NOT_FOUND';

  constructor() {
    super('Loyalty benefit not found');
    this.name = 'LoyaltyBenefitNotFoundError';
  }
}

export class LoyaltyCustomerNotFoundError extends Error {
  readonly code = 'LOYALTY_CUSTOMER_NOT_FOUND';

  constructor() {
    super('Customer not found');
    this.name = 'LoyaltyCustomerNotFoundError';
  }
}

export class LoyaltyGrantNotFoundError extends Error {
  readonly code = 'LOYALTY_GRANT_NOT_FOUND';

  constructor() {
    super('Loyalty grant not found');
    this.name = 'LoyaltyGrantNotFoundError';
  }
}

export class LoyaltyGrantConflictError extends Error {
  constructor(
    readonly code:
      | 'LOYALTY_BENEFIT_KEY_CONFLICT'
      | 'LOYALTY_GRANT_LIMIT_REACHED'
      | 'LOYALTY_RESERVATION_INVALID',
  ) {
    super(
      code === 'LOYALTY_BENEFIT_KEY_CONFLICT'
        ? 'A benefit with this key already exists for this restaurant'
        : code === 'LOYALTY_GRANT_LIMIT_REACHED'
          ? 'The customer has reached the usage limit for this benefit'
          : 'The reservation is not available for this customer',
    );
    this.name = 'LoyaltyGrantConflictError';
  }
}

export class LoyaltyNotEligibleError extends Error {
  readonly code = 'LOYALTY_CUSTOMER_NOT_ELIGIBLE';

  constructor(readonly reason: string) {
    super('Customer does not match the benefit rule');
    this.name = 'LoyaltyNotEligibleError';
  }
}

export class LoyaltyGrantStateError extends Error {
  constructor(
    readonly code:
      | 'LOYALTY_GRANT_ALREADY_REDEEMED'
      | 'LOYALTY_GRANT_VOID'
      | 'LOYALTY_GRANT_EXPIRED'
      | 'LOYALTY_GRANT_REDEMPTION_CONFLICT',
  ) {
    super(
      code === 'LOYALTY_GRANT_ALREADY_REDEEMED'
        ? 'The benefit has already been redeemed'
        : code === 'LOYALTY_GRANT_VOID'
          ? 'The benefit has been voided'
          : code === 'LOYALTY_GRANT_EXPIRED'
            ? 'The benefit has expired'
            : 'The benefit changed while it was being redeemed',
    );
    this.name = 'LoyaltyGrantStateError';
  }
}

export interface LoyaltyBenefitView {
  id: string;
  restaurantId: string;
  key: string;
  name: string;
  description: string | null;
  rule: LoyaltyBenefitRule;
  ruleValue: number | null;
  costCents: number | null;
  currency: string;
  validityDays: number;
  maxUsesPerCustomer: number;
  status: LoyaltyBenefitStatus;
  grantCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface LoyaltyGrantView {
  id: string;
  restaurantId: string;
  benefitId: string;
  customerId: string;
  reservationId: string | null;
  status: LoyaltyGrantStatus;
  issuedAt: Date;
  expiresAt: Date;
  redeemedAt: Date | null;
  voidedAt: Date | null;
  redemptionNote: string | null;
  benefit: { key: string; name: string; costCents: number | null; currency: string };
  customerName: string | null;
  phoneLast4: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface LoyaltyGrantMutationResult extends LoyaltyGrantView {
  code: string | null;
  providerContacted: false;
  dryRun: true;
  replayed: boolean;
}

function hashActor(actor: string): string {
  return createHash('sha256').update(`${ACTOR_HASH_PREFIX}${actor}`).digest('hex');
}

function hashCode(code: string): string {
  return createHash('sha256').update(`${CODE_HASH_PREFIX}${code}`).digest('hex');
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
    throw new LoyaltyInputError(
      'LOYALTY_IDEMPOTENCY_INVALID',
      "La clé d'idempotence doit contenir entre 8 et 200 caractères sûrs.",
    );
  }
  return key;
}

function normalizeKey(value: string): string {
  const key = value.trim().toLowerCase();
  if (!BENEFIT_KEY_PATTERN.test(key)) {
    throw new LoyaltyInputError(
      'LOYALTY_BENEFIT_KEY_INVALID',
      'La clé de l’avantage doit être un identifiant technique de 2 à 48 caractères.',
    );
  }
  return key;
}

function normalizeName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new LoyaltyInputError(
      'LOYALTY_BENEFIT_NAME_INVALID',
      'Le nom de l’avantage doit contenir entre 1 et 120 caractères sûrs.',
    );
  }
  return name;
}

function normalizeDescription(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const description = value.trim().replace(/\s+/g, ' ');
  if (description.length > 1_000 || /[\u0000-\u001f\u007f]/.test(description)) {
    throw new LoyaltyInputError(
      'LOYALTY_BENEFIT_DESCRIPTION_INVALID',
      'La description ne doit pas dépasser 1 000 caractères sûrs.',
    );
  }
  return description || null;
}

function normalizeRule(value: LoyaltyBenefitRuleCode | undefined): LoyaltyBenefitRule {
  const rule = value ?? 'ANY';
  if (!(LOYALTY_BENEFIT_RULES as readonly string[]).includes(rule)) {
    throw new LoyaltyInputError(
      'LOYALTY_BENEFIT_RULE_INVALID',
      'La règle de l’avantage est invalide.',
    );
  }
  return rule as LoyaltyBenefitRule;
}

function normalizeRuleValue(
  rule: LoyaltyBenefitRule,
  value: number | null | undefined,
): number | null {
  if (value === null || value === undefined) {
    if (rule === LoyaltyBenefitRule.MIN_VISITS || rule === LoyaltyBenefitRule.MIN_ESTIMATED_SPEND) {
      throw new LoyaltyInputError(
        'LOYALTY_BENEFIT_RULE_VALUE_INVALID',
        'Cette règle exige une valeur entière strictement positive.',
      );
    }
    return null;
  }
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    (rule === LoyaltyBenefitRule.MIN_VISITS && value > 1_000) ||
    (rule === LoyaltyBenefitRule.MIN_ESTIMATED_SPEND && value > 5_000_000) ||
    (rule !== LoyaltyBenefitRule.MIN_VISITS && rule !== LoyaltyBenefitRule.MIN_ESTIMATED_SPEND)
  ) {
    throw new LoyaltyInputError(
      'LOYALTY_BENEFIT_RULE_VALUE_INVALID',
      'La valeur de règle est incompatible avec le type choisi.',
    );
  }
  return value;
}

function normalizeCostCents(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 0 || value > 1_000_000) {
    throw new LoyaltyInputError(
      'LOYALTY_BENEFIT_COST_INVALID',
      'Le coût estimé doit être un nombre entier de centimes entre 0 et 10 000 €.',
    );
  }
  return value;
}

function normalizeCurrency(value: string | undefined): string {
  const currency = (value ?? 'EUR').trim().toUpperCase();
  if (currency !== 'EUR') {
    throw new LoyaltyInputError(
      'LOYALTY_BENEFIT_CURRENCY_INVALID',
      'Seule la devise EUR est supportée par cette fondation.',
    );
  }
  return currency;
}

function normalizeValidityDays(value: number | undefined): number {
  const days = value ?? 30;
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new LoyaltyInputError(
      'LOYALTY_BENEFIT_VALIDITY_INVALID',
      'La validité doit être comprise entre 1 et 365 jours.',
    );
  }
  return days;
}

function normalizeMaxUses(value: number | undefined): number {
  const maxUses = value ?? 1;
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100) {
    throw new LoyaltyInputError(
      'LOYALTY_BENEFIT_MAX_USES_INVALID',
      'La limite doit être comprise entre 1 et 100 utilisations par client.',
    );
  }
  return maxUses;
}

function normalizeCode(value: string): string {
  const code = value.trim().replace(/\s+/g, '').toUpperCase();
  if (!CODE_PATTERN.test(code)) {
    throw new LoyaltyInputError(
      'LOYALTY_GRANT_CODE_INVALID',
      'Le code de l’avantage est invalide.',
    );
  }
  return code;
}

function normalizeNote(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const note = value.trim().replace(/\s+/g, ' ');
  if (note.length > 1_000 || /[\u0000-\u001f\u007f]/.test(note)) {
    throw new LoyaltyInputError(
      'LOYALTY_GRANT_NOTE_INVALID',
      'La note de consommation ne doit pas dépasser 1 000 caractères sûrs.',
    );
  }
  return note || null;
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.slice(-4).padStart(4, '•');
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function generateCode(): string {
  return randomBytes(6).toString('hex').toUpperCase();
}

function serializeBenefit(row: BenefitRow): LoyaltyBenefitView {
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    key: row.key,
    name: row.name,
    description: row.description,
    rule: row.rule,
    ruleValue: row.ruleValue,
    costCents: row.costCents,
    currency: row.currency,
    validityDays: row.validityDays,
    maxUsesPerCustomer: row.maxUsesPerCustomer,
    status: row.status,
    grantCount: row._count?.grants ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializeGrant(
  row: GrantRow,
  mutation?: Partial<LoyaltyGrantMutationResult>,
): LoyaltyGrantView {
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    benefitId: row.benefitId,
    customerId: row.customerId,
    reservationId: row.reservationId,
    status: row.status,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    redeemedAt: row.redeemedAt,
    voidedAt: row.voidedAt,
    redemptionNote: row.redemptionNote,
    benefit: row.benefit,
    customerName: row.customer.name,
    phoneLast4: maskPhone(row.customer.phone),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(mutation ?? {}),
  };
}

async function assertRestaurantActive(restaurantId: string): Promise<void> {
  const restaurant = await db.restaurant.findFirst({
    where: { id: restaurantId, siteStatus: { notIn: ['ARCHIVED', 'SUSPENDED'] } },
    select: { id: true },
  });
  if (!restaurant) throw new LoyaltyBenefitNotFoundError();
}

export async function createLoyaltyBenefit(input: {
  restaurantId: string;
  key: string;
  name: string;
  description?: string | null;
  rule?: LoyaltyBenefitRuleCode;
  ruleValue?: number | null;
  costCents?: number | null;
  currency?: string;
  validityDays?: number;
  maxUsesPerCustomer?: number;
  actor: string;
}): Promise<LoyaltyBenefitView> {
  await assertRestaurantActive(input.restaurantId);
  const key = normalizeKey(input.key);
  const name = normalizeName(input.name);
  const description = normalizeDescription(input.description);
  const rule = normalizeRule(input.rule);
  const ruleValue = normalizeRuleValue(rule, input.ruleValue);
  const costCents = normalizeCostCents(input.costCents);
  const currency = normalizeCurrency(input.currency);
  const validityDays = normalizeValidityDays(input.validityDays);
  const maxUsesPerCustomer = normalizeMaxUses(input.maxUsesPerCustomer);

  try {
    const row = await db.loyaltyBenefit.create({
      data: {
        restaurantId: input.restaurantId,
        key,
        name,
        description,
        rule,
        ruleValue,
        costCents,
        currency,
        validityDays,
        maxUsesPerCustomer,
        status: LoyaltyBenefitStatus.ACTIVE,
        createdByHash: hashActor(input.actor),
      },
      select: BENEFIT_SELECT,
    });
    return serializeBenefit(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new LoyaltyGrantConflictError('LOYALTY_BENEFIT_KEY_CONFLICT');
    }
    throw error;
  }
}

export async function listLoyaltyBenefits(input: {
  restaurantId: string;
  status?: LoyaltyBenefitStatus;
  limit?: number;
}): Promise<LoyaltyBenefitView[]> {
  const limit = Math.min(Math.max(input.limit ?? MAX_LIST_LIMIT, 1), MAX_LIST_LIMIT);
  const rows = await db.loyaltyBenefit.findMany({
    where: { restaurantId: input.restaurantId, ...(input.status ? { status: input.status } : {}) },
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    take: limit,
    select: BENEFIT_SELECT,
  });
  return rows.map(serializeBenefit);
}

export async function updateLoyaltyBenefit(input: {
  restaurantId: string;
  benefitId: string;
  name?: string;
  description?: string | null;
  rule?: LoyaltyBenefitRuleCode;
  ruleValue?: number | null;
  costCents?: number | null;
  currency?: string;
  validityDays?: number;
  maxUsesPerCustomer?: number;
  status?: LoyaltyBenefitStatus;
}): Promise<LoyaltyBenefitView> {
  const current = await db.loyaltyBenefit.findFirst({
    where: { id: input.benefitId, restaurantId: input.restaurantId },
    select: BENEFIT_SELECT,
  });
  if (!current) throw new LoyaltyBenefitNotFoundError();

  const rule = input.rule === undefined ? current.rule : normalizeRule(input.rule);
  const data: Prisma.LoyaltyBenefitUpdateInput = {};
  if (input.name !== undefined) data.name = normalizeName(input.name);
  if (input.description !== undefined) data.description = normalizeDescription(input.description);
  if (input.rule !== undefined) data.rule = rule;
  if (input.ruleValue !== undefined || input.rule !== undefined) {
    data.ruleValue = normalizeRuleValue(
      rule,
      input.ruleValue ?? (input.rule ? null : current.ruleValue),
    );
  }
  if (input.costCents !== undefined) data.costCents = normalizeCostCents(input.costCents);
  if (input.currency !== undefined) data.currency = normalizeCurrency(input.currency);
  if (input.validityDays !== undefined)
    data.validityDays = normalizeValidityDays(input.validityDays);
  if (input.maxUsesPerCustomer !== undefined) {
    data.maxUsesPerCustomer = normalizeMaxUses(input.maxUsesPerCustomer);
  }
  if (input.status !== undefined) data.status = input.status;
  if (Object.keys(data).length === 0) return serializeBenefit(current);

  const row = await db.loyaltyBenefit.update({
    where: { id: current.id },
    data,
    select: BENEFIT_SELECT,
  });
  return serializeBenefit(row);
}

async function findGrantByIdempotency(
  idempotencyKey: string | undefined,
): Promise<GrantRow | null> {
  if (!idempotencyKey) return null;
  return db.loyaltyGrant.findUnique({
    where: { idempotencyKey },
    select: GRANT_SELECT,
  });
}

function spendInCents(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const amount = typeof value === 'number' ? value : Number(value.toString());
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : 0;
}

async function assertCustomerEligible(input: {
  restaurantId: string;
  customerId: string;
  benefit: BenefitRow;
  now: Date;
}): Promise<void> {
  const customer = await db.customer.findFirst({
    where: {
      id: input.customerId,
      restaurantId: input.restaurantId,
      archivedAt: null,
      mergedIntoId: null,
    },
    select: {
      id: true,
      isVip: true,
      visitCount: true,
      birthMonth: true,
      metricSnapshot: { select: { estimatedSpend365d: true } },
    },
  });
  if (!customer) throw new LoyaltyCustomerNotFoundError();

  switch (input.benefit.rule) {
    case LoyaltyBenefitRule.ANY:
      return;
    case LoyaltyBenefitRule.VIP:
      if (customer.isVip) return;
      throw new LoyaltyNotEligibleError('VIP_REQUIRED');
    case LoyaltyBenefitRule.MIN_VISITS:
      if (customer.visitCount >= (input.benefit.ruleValue ?? Number.MAX_SAFE_INTEGER)) return;
      throw new LoyaltyNotEligibleError('MIN_VISITS_NOT_REACHED');
    case LoyaltyBenefitRule.BIRTHDAY_MONTH:
      if (customer.birthMonth === input.now.getUTCMonth() + 1) return;
      throw new LoyaltyNotEligibleError('BIRTHDAY_MONTH_MISMATCH');
    case LoyaltyBenefitRule.MIN_ESTIMATED_SPEND:
      if (
        spendInCents(customer.metricSnapshot?.estimatedSpend365d) >=
        (input.benefit.ruleValue ?? Number.MAX_SAFE_INTEGER)
      ) {
        return;
      }
      throw new LoyaltyNotEligibleError('MIN_ESTIMATED_SPEND_NOT_REACHED');
    default:
      throw new LoyaltyNotEligibleError('RULE_UNSUPPORTED');
  }
}

async function assertReservationForCustomer(input: {
  restaurantId: string;
  customerId: string;
  reservationId: string | undefined;
}): Promise<void> {
  if (!input.reservationId) return;
  const reservation = await db.reservation.findFirst({
    where: {
      id: input.reservationId,
      restaurantId: input.restaurantId,
      customerId: input.customerId,
      state: { notIn: ['CANCELLED', 'NO_SHOW'] },
    },
    select: { id: true },
  });
  if (!reservation) throw new LoyaltyGrantConflictError('LOYALTY_RESERVATION_INVALID');
}

export async function issueLoyaltyGrant(input: {
  restaurantId: string;
  benefitId: string;
  customerId: string;
  reservationId?: string;
  idempotencyKey?: string;
  actor: string;
  now?: Date;
}): Promise<LoyaltyGrantMutationResult> {
  const now = input.now ?? new Date();
  const rawIdempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const idempotencyKey = rawIdempotencyKey
    ? hashIdempotencyKey(input.restaurantId, rawIdempotencyKey)
    : undefined;

  const replay = await findGrantByIdempotency(idempotencyKey);
  if (replay) {
    return serializeGrant(replay, {
      code: null,
      providerContacted: false,
      dryRun: true,
      replayed: true,
    }) as LoyaltyGrantMutationResult;
  }

  const benefit = await db.loyaltyBenefit.findFirst({
    where: {
      id: input.benefitId,
      restaurantId: input.restaurantId,
      status: LoyaltyBenefitStatus.ACTIVE,
    },
    select: BENEFIT_SELECT,
  });
  if (!benefit) throw new LoyaltyBenefitNotFoundError();
  await assertCustomerEligible({
    restaurantId: input.restaurantId,
    customerId: input.customerId,
    benefit,
    now,
  });
  await assertReservationForCustomer({
    restaurantId: input.restaurantId,
    customerId: input.customerId,
    reservationId: input.reservationId,
  });

  const code = generateCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(now.getTime() + benefit.validityDays * 24 * 60 * 60 * 1_000);

  try {
    const row = await db.$transaction(async (tx) => {
      // The advisory lock serializes different idempotency keys for the same
      // customer/benefit pair, so maxUsesPerCustomer cannot be exceeded by a
      // pair of simultaneous operators. The key is a hash-safe string.
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`loyalty:${input.restaurantId}:${benefit.id}:${input.customerId}`}))`,
      );
      const used = await tx.loyaltyGrant.count({
        where: {
          restaurantId: input.restaurantId,
          benefitId: benefit.id,
          customerId: input.customerId,
          status: { in: [LoyaltyGrantStatus.ISSUED, LoyaltyGrantStatus.REDEEMED] },
        },
      });
      if (used >= benefit.maxUsesPerCustomer) {
        throw new LoyaltyGrantConflictError('LOYALTY_GRANT_LIMIT_REACHED');
      }
      return tx.loyaltyGrant.create({
        data: {
          restaurantId: input.restaurantId,
          benefitId: benefit.id,
          customerId: input.customerId,
          reservationId: input.reservationId,
          idempotencyKey,
          codeHash,
          status: LoyaltyGrantStatus.ISSUED,
          issuedAt: now,
          expiresAt,
          issuedByHash: hashActor(input.actor),
        },
        select: GRANT_SELECT,
      });
    });
    return serializeGrant(row, {
      code,
      providerContacted: false,
      dryRun: true,
      replayed: false,
    }) as LoyaltyGrantMutationResult;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      idempotencyKey
    ) {
      const raced = await findGrantByIdempotency(idempotencyKey);
      if (raced) {
        return serializeGrant(raced, {
          code: null,
          providerContacted: false,
          dryRun: true,
          replayed: true,
        }) as LoyaltyGrantMutationResult;
      }
    }
    throw error;
  }
}

export async function listLoyaltyGrants(input: {
  restaurantId: string;
  customerId?: string;
  status?: LoyaltyGrantStatus;
  limit?: number;
}): Promise<LoyaltyGrantView[]> {
  const limit = Math.min(Math.max(input.limit ?? MAX_LIST_LIMIT, 1), MAX_LIST_LIMIT);
  const rows = await db.loyaltyGrant.findMany({
    where: {
      restaurantId: input.restaurantId,
      ...(input.customerId ? { customerId: input.customerId } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
    orderBy: [{ status: 'asc' }, { issuedAt: 'desc' }],
    take: limit,
    select: GRANT_SELECT,
  });
  return rows.map((row) => serializeGrant(row));
}

export async function redeemLoyaltyGrant(input: {
  restaurantId: string;
  grantId: string;
  code: string;
  reservationId?: string;
  actor: string;
  note?: string | null;
  now?: Date;
}): Promise<LoyaltyGrantMutationResult> {
  const now = input.now ?? new Date();
  const code = normalizeCode(input.code);
  const note = normalizeNote(input.note);
  const current = await db.loyaltyGrant.findFirst({
    where: { id: input.grantId, restaurantId: input.restaurantId },
    select: { ...GRANT_SELECT, codeHash: true },
  });
  if (!current) throw new LoyaltyGrantNotFoundError();
  if (!constantTimeEquals(current.codeHash, hashCode(code))) {
    throw new LoyaltyInputError(
      'LOYALTY_GRANT_CODE_INVALID',
      'Le code de l’avantage est invalide.',
    );
  }
  if (input.reservationId !== undefined) {
    await assertReservationForCustomer({
      restaurantId: input.restaurantId,
      customerId: current.customerId,
      reservationId: input.reservationId,
    });
  }
  if (current.status === LoyaltyGrantStatus.REDEEMED) {
    return serializeGrant(current, {
      code: null,
      providerContacted: false,
      dryRun: true,
      replayed: true,
    }) as LoyaltyGrantMutationResult;
  }
  if (current.status === LoyaltyGrantStatus.VOID) {
    throw new LoyaltyGrantStateError('LOYALTY_GRANT_VOID');
  }
  if (current.status === LoyaltyGrantStatus.EXPIRED || current.expiresAt <= now) {
    await db.loyaltyGrant.updateMany({
      where: {
        id: current.id,
        restaurantId: input.restaurantId,
        status: LoyaltyGrantStatus.ISSUED,
      },
      data: { status: LoyaltyGrantStatus.EXPIRED },
    });
    throw new LoyaltyGrantStateError('LOYALTY_GRANT_EXPIRED');
  }

  const updated = await db.loyaltyGrant.updateMany({
    where: {
      id: current.id,
      restaurantId: input.restaurantId,
      status: LoyaltyGrantStatus.ISSUED,
      expiresAt: { gt: now },
      codeHash: current.codeHash,
    },
    data: {
      status: LoyaltyGrantStatus.REDEEMED,
      redeemedAt: now,
      redeemedByHash: hashActor(input.actor),
      ...(input.reservationId !== undefined ? { reservationId: input.reservationId } : {}),
      ...(note !== undefined ? { redemptionNote: note } : {}),
    },
  });
  if ((updated as { count?: number }).count !== 1) {
    const latest = await db.loyaltyGrant.findFirst({
      where: { id: current.id, restaurantId: input.restaurantId },
      select: { ...GRANT_SELECT, codeHash: true },
    });
    if (latest?.status === LoyaltyGrantStatus.REDEEMED) {
      return serializeGrant(latest, {
        code: null,
        providerContacted: false,
        dryRun: true,
        replayed: true,
      }) as LoyaltyGrantMutationResult;
    }
    throw new LoyaltyGrantStateError('LOYALTY_GRANT_REDEMPTION_CONFLICT');
  }

  const row = await db.loyaltyGrant.findFirst({
    where: { id: current.id, restaurantId: input.restaurantId },
    select: GRANT_SELECT,
  });
  if (!row) throw new LoyaltyGrantNotFoundError();
  return serializeGrant(row, {
    code: null,
    providerContacted: false,
    dryRun: true,
    replayed: false,
  }) as LoyaltyGrantMutationResult;
}

export async function voidLoyaltyGrant(input: {
  restaurantId: string;
  grantId: string;
  actor: string;
  note?: string | null;
  now?: Date;
}): Promise<LoyaltyGrantView> {
  const note = normalizeNote(input.note);
  const updated = await db.loyaltyGrant.updateMany({
    where: {
      id: input.grantId,
      restaurantId: input.restaurantId,
      status: LoyaltyGrantStatus.ISSUED,
    },
    data: {
      status: LoyaltyGrantStatus.VOID,
      voidedAt: input.now ?? new Date(),
      ...(note !== undefined ? { redemptionNote: note } : {}),
      redeemedByHash: hashActor(input.actor),
    },
  });
  if ((updated as { count?: number }).count !== 1) {
    const current = await db.loyaltyGrant.findFirst({
      where: { id: input.grantId, restaurantId: input.restaurantId },
      select: GRANT_SELECT,
    });
    if (!current) throw new LoyaltyGrantNotFoundError();
    if (current.status === LoyaltyGrantStatus.REDEEMED) {
      throw new LoyaltyGrantStateError('LOYALTY_GRANT_ALREADY_REDEEMED');
    }
    if (current.status === LoyaltyGrantStatus.VOID) return serializeGrant(current);
    if (current.status === LoyaltyGrantStatus.EXPIRED) {
      throw new LoyaltyGrantStateError('LOYALTY_GRANT_EXPIRED');
    }
    throw new LoyaltyGrantStateError('LOYALTY_GRANT_REDEMPTION_CONFLICT');
  }
  const row = await db.loyaltyGrant.findFirst({
    where: { id: input.grantId, restaurantId: input.restaurantId },
    select: GRANT_SELECT,
  });
  if (!row) throw new LoyaltyGrantNotFoundError();
  return serializeGrant(row);
}

export async function expireLoyaltyGrants(input?: { now?: Date; limit?: number }): Promise<number> {
  const now = input?.now ?? new Date();
  const limit = Math.min(Math.max(input?.limit ?? MAX_EXPIRY_SCAN, 1), MAX_EXPIRY_SCAN);
  const rows = await db.loyaltyGrant.findMany({
    where: { status: LoyaltyGrantStatus.ISSUED, expiresAt: { lte: now } },
    orderBy: { expiresAt: 'asc' },
    take: limit,
    select: { id: true },
  });
  if (rows.length === 0) return 0;
  const result = await db.loyaltyGrant.updateMany({
    where: { id: { in: rows.map((row) => row.id) }, status: LoyaltyGrantStatus.ISSUED },
    data: { status: LoyaltyGrantStatus.EXPIRED },
  });
  return (result as { count?: number }).count ?? 0;
}
