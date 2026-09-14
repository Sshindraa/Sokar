import { createHash } from 'node:crypto';
import { Prisma, type CustomerSegment } from '@prisma/client';
import { z } from 'zod';
import { db } from '../../shared/db/client';
import { CUSTOMER_PREFERENCE_KEYS } from './customer-crm.service';

const SegmentOperatorSchema = z.enum([
  'EQ',
  'GTE',
  'LTE',
  'IS_NULL',
  'BEFORE_DAYS_AGO',
  'AFTER_DAYS_AGO',
  'EXISTS',
]);
const SegmentFieldSchema = z.enum([
  'honored30d',
  'honored90d',
  'honored365d',
  'cancelled365d',
  'noShow365d',
  'covers365d',
  'estimatedSpend365d',
  'actualSpend365d',
  'actualLifetimeSpend',
  'lastHonoredAt',
  'nextReservationAt',
  'birthMonth',
  'birthDay',
  'isVip',
  'tag',
  'preference',
]);

const SegmentValueSchema = z.union([
  z.string().trim().min(1).max(128),
  z.number().refine(Number.isFinite, 'value must be finite'),
  z.boolean(),
]);

export const SegmentConditionSchema = z
  .object({
    field: SegmentFieldSchema,
    op: SegmentOperatorSchema,
    value: SegmentValueSchema.optional(),
  })
  .strict();

const SegmentGroupSchema = z
  .object({
    operator: z.enum(['AND', 'OR']),
    conditions: z
      .array(SegmentConditionSchema)
      .min(1)
      .max(20, 'a segment cannot contain more than 20 conditions'),
  })
  .strict();

export const CustomerSegmentDefinitionSchema = z
  .object({
    version: z.literal(1),
    operator: z.enum(['AND', 'OR']),
    conditions: z
      .array(z.union([SegmentConditionSchema, SegmentGroupSchema]))
      .min(1)
      .max(20, 'a segment cannot contain more than 20 conditions'),
  })
  .strict();

export type CustomerSegmentDefinition = z.infer<typeof CustomerSegmentDefinitionSchema>;
export type SegmentCondition = z.infer<typeof SegmentConditionSchema>;

const NUMERIC_METRIC_FIELDS = new Set([
  'honored30d',
  'honored90d',
  'honored365d',
  'cancelled365d',
  'noShow365d',
  'covers365d',
  'estimatedSpend365d',
  'actualSpend365d',
  'actualLifetimeSpend',
]);
const DATE_METRIC_FIELDS = new Set(['lastHonoredAt', 'nextReservationAt']);
const CUSTOMER_NUMBER_FIELDS = new Set(['birthMonth', 'birthDay']);

function isGroup(
  node: SegmentCondition | { operator: 'AND' | 'OR'; conditions: SegmentCondition[] },
): node is { operator: 'AND' | 'OR'; conditions: SegmentCondition[] } {
  return 'conditions' in node;
}

function assertCondition(condition: SegmentCondition): void {
  const needsValue = condition.op !== 'IS_NULL';
  if (needsValue && condition.value === undefined) {
    throw new Error(`segment condition ${condition.field}/${condition.op} requires a value`);
  }
  if (!needsValue && condition.value !== undefined) {
    throw new Error(`segment condition ${condition.field}/IS_NULL cannot have a value`);
  }

  if (NUMERIC_METRIC_FIELDS.has(condition.field) || CUSTOMER_NUMBER_FIELDS.has(condition.field)) {
    if (!['EQ', 'GTE', 'LTE'].includes(condition.op) || typeof condition.value !== 'number') {
      throw new Error(`segment field ${condition.field} accepts EQ, GTE or LTE with a number`);
    }
    if (condition.field === 'birthMonth' && (condition.value < 1 || condition.value > 12)) {
      throw new Error('birthMonth must be between 1 and 12');
    }
    if (condition.field === 'birthDay' && (condition.value < 1 || condition.value > 31)) {
      throw new Error('birthDay must be between 1 and 31');
    }
    return;
  }

  if (DATE_METRIC_FIELDS.has(condition.field)) {
    if (condition.op === 'IS_NULL') return;
    if (!['BEFORE_DAYS_AGO', 'AFTER_DAYS_AGO'].includes(condition.op)) {
      throw new Error(`segment field ${condition.field} accepts only relative date operators`);
    }
    if (
      typeof condition.value !== 'number' ||
      !Number.isInteger(condition.value) ||
      condition.value < 0 ||
      condition.value > 3_650
    ) {
      throw new Error('relative date value must be an integer between 0 and 3650 days');
    }
    return;
  }

  if (condition.field === 'isVip') {
    if (condition.op !== 'EQ' || typeof condition.value !== 'boolean') {
      throw new Error('isVip accepts only EQ with a boolean');
    }
    return;
  }

  if (condition.field === 'tag') {
    if (condition.op !== 'EXISTS' || typeof condition.value !== 'string') {
      throw new Error('tag accepts only EXISTS with a tag key');
    }
    if (!/^[a-z][a-z0-9_.-]{1,63}$/.test(condition.value)) {
      throw new Error('tag key must be a lowercase slug');
    }
    return;
  }

  if (condition.field === 'preference') {
    if (condition.op !== 'EXISTS' || typeof condition.value !== 'string') {
      throw new Error('preference accepts only EXISTS with a preference key');
    }
    if (!(CUSTOMER_PREFERENCE_KEYS as readonly string[]).includes(condition.value)) {
      throw new Error('preference key is not allow-listed');
    }
    return;
  }

  throw new Error(`unsupported segment field: ${condition.field}`);
}

export function parseCustomerSegmentDefinition(input: unknown): CustomerSegmentDefinition {
  const definition = CustomerSegmentDefinitionSchema.parse(input);
  let conditionCount = 0;
  for (const node of definition.conditions) {
    if (isGroup(node)) {
      conditionCount += node.conditions.length;
      for (const condition of node.conditions) assertCondition(condition);
    } else {
      conditionCount += 1;
      assertCondition(node);
    }
  }
  if (conditionCount > 20) throw new Error('a segment cannot contain more than 20 conditions');
  return definition;
}

function compileCondition(condition: SegmentCondition, now: Date): Prisma.CustomerWhereInput {
  assertCondition(condition);
  if (NUMERIC_METRIC_FIELDS.has(condition.field)) {
    const value = condition.value as number;
    const filter =
      condition.op === 'EQ' ? value : condition.op === 'GTE' ? { gte: value } : { lte: value };
    return { metricSnapshot: { is: { [condition.field]: filter } } };
  }
  if (CUSTOMER_NUMBER_FIELDS.has(condition.field)) {
    const value = condition.value as number;
    const filter =
      condition.op === 'EQ' ? value : condition.op === 'GTE' ? { gte: value } : { lte: value };
    return { [condition.field]: filter };
  }
  if (DATE_METRIC_FIELDS.has(condition.field)) {
    if (condition.op === 'IS_NULL') {
      return { metricSnapshot: { is: { [condition.field]: null } } };
    }
    const days = condition.value as number;
    const threshold = new Date(now.getTime() - days * 86_400_000);
    return {
      metricSnapshot: {
        is: {
          [condition.field]:
            condition.op === 'BEFORE_DAYS_AGO' ? { lt: threshold } : { gt: threshold },
        },
      },
    };
  }
  if (condition.field === 'isVip') return { isVip: condition.value as boolean };
  if (condition.field === 'tag') {
    return { tagAssignments: { some: { tag: { key: condition.value as string } } } };
  }
  return { preferences: { some: { key: condition.value as string } } };
}

export function compileCustomerSegmentWhere(
  input: unknown,
  now = new Date(),
): Prisma.CustomerWhereInput {
  const definition = parseCustomerSegmentDefinition(input);
  const nodes = definition.conditions.map((node) => {
    if (isGroup(node)) {
      const conditions = node.conditions.map((condition) => compileCondition(condition, now));
      return node.operator === 'AND' ? { AND: conditions } : { OR: conditions };
    }
    return compileCondition(node, now);
  });
  return definition.operator === 'AND' ? { AND: nodes } : { OR: nodes };
}

function hashActor(actor: string | undefined): string {
  return createHash('sha256')
    .update(actor?.trim() || 'unknown')
    .digest('hex');
}

export type SystemCustomerSegment = {
  key: string;
  name: string;
  description: string;
  definition: CustomerSegmentDefinition;
};

/**
 * Stable, explainable audiences available to every Pro restaurant. They are
 * deliberately expressed through the same bounded AST as custom segments so
 * a campaign can be moved between a system and custom audience safely.
 */
export const SYSTEM_CUSTOMER_SEGMENTS: readonly SystemCustomerSegment[] = [
  {
    key: 'first_visit_30d',
    name: 'Première visite récente',
    description: 'Une visite honorée sur les 30 derniers jours.',
    definition: {
      version: 1,
      operator: 'AND',
      conditions: [{ field: 'honored30d', op: 'EQ', value: 1 }],
    },
  },
  {
    key: 'regulars_365d',
    name: 'Habitués',
    description: 'Au moins trois visites honorées sur un an.',
    definition: {
      version: 1,
      operator: 'AND',
      conditions: [{ field: 'honored365d', op: 'GTE', value: 3 }],
    },
  },
  {
    key: 'vip_manual',
    name: 'VIP manuels',
    description: 'Profils marqués VIP dans Sokar.',
    definition: {
      version: 1,
      operator: 'AND',
      conditions: [{ field: 'isVip', op: 'EQ', value: true }],
    },
  },
  {
    key: 'dormant_90d',
    name: 'Dormants sans réservation',
    description: 'Dernière visite avant 90 jours et aucune réservation à venir.',
    definition: {
      version: 1,
      operator: 'AND',
      conditions: [
        { field: 'lastHonoredAt', op: 'BEFORE_DAYS_AGO', value: 90 },
        { field: 'nextReservationAt', op: 'IS_NULL' },
      ],
    },
  },
  {
    key: 'cancelled_without_return',
    name: 'Annulés à relancer',
    description: 'Une annulation sur un an sans réservation future.',
    definition: {
      version: 1,
      operator: 'AND',
      conditions: [
        { field: 'cancelled365d', op: 'GTE', value: 1 },
        { field: 'nextReservationAt', op: 'IS_NULL' },
      ],
    },
  },
  {
    key: 'no_show_365d',
    name: 'No-show à traiter',
    description: 'Au moins un no-show sur les 365 derniers jours.',
    definition: {
      version: 1,
      operator: 'AND',
      conditions: [{ field: 'noShow365d', op: 'GTE', value: 1 }],
    },
  },
  {
    key: 'real_spend',
    name: 'Dépense caisse connue',
    description: 'Dépense encaissée remontée par une caisse connectée.',
    definition: {
      version: 1,
      operator: 'AND',
      conditions: [{ field: 'actualLifetimeSpend', op: 'GTE', value: 1 }],
    },
  },
  {
    key: 'language_known',
    name: 'Langue renseignée',
    description: 'Une préférence de langue structurée est présente.',
    definition: {
      version: 1,
      operator: 'AND',
      conditions: [{ field: 'preference', op: 'EXISTS', value: 'preferred_language' }],
    },
  },
];

export function getSystemCustomerSegmentDescription(systemKey: string | null): string | null {
  if (!systemKey) return null;
  return SYSTEM_CUSTOMER_SEGMENTS.find((segment) => segment.key === systemKey)?.description ?? null;
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Ensure system audiences exist for one restaurant without overwriting edits. */
export async function ensureSystemCustomerSegments(args: { restaurantId: string }): Promise<void> {
  for (const systemSegment of SYSTEM_CUSTOMER_SEGMENTS) {
    const existing = await db.customerSegment.findFirst({
      where: { restaurantId: args.restaurantId, systemKey: systemSegment.key },
      select: { id: true },
    });
    if (existing) continue;

    const preview = await previewCustomerSegment({
      restaurantId: args.restaurantId,
      definition: systemSegment.definition,
    });
    try {
      await db.customerSegment.create({
        data: {
          restaurantId: args.restaurantId,
          systemKey: systemSegment.key,
          name: systemSegment.name,
          definition: systemSegment.definition as Prisma.InputJsonValue,
          createdByHash: hashActor(`system:${systemSegment.key}`),
          isSystem: true,
          lastCount: preview.count,
          lastEvaluatedAt: new Date(),
        },
      });
    } catch (error) {
      // Two dashboard tabs can initialize the same tenant at once. The
      // composite key makes the loser harmless; every other error is real.
      if (!isUniqueConstraint(error)) throw error;
    }
  }
}

export async function previewCustomerSegment(args: {
  restaurantId: string;
  definition: unknown;
  now?: Date;
  sampleLimit?: number;
}): Promise<{
  count: number;
  sample: Array<{ id: string; name: string | null; isVip: boolean; metricSnapshot: unknown }>;
}> {
  const now = args.now ?? new Date();
  const where: Prisma.CustomerWhereInput = {
    restaurantId: args.restaurantId,
    archivedAt: null,
    mergedIntoId: null,
    ...compileCustomerSegmentWhere(args.definition, now),
  };
  const sampleLimit = Math.min(Math.max(args.sampleLimit ?? 5, 1), 20);
  const [count, sample] = await Promise.all([
    db.customer.count({ where }),
    db.customer.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: sampleLimit,
      select: { id: true, name: true, isVip: true, metricSnapshot: true },
    }),
  ]);
  return { count, sample };
}

export async function createCustomerSegment(args: {
  restaurantId: string;
  name: string;
  definition: unknown;
  createdBy?: string;
  isSystem?: boolean;
}): Promise<CustomerSegment> {
  const name = args.name.trim();
  if (!name || name.length > 100) throw new Error('segment name must contain 1 to 100 characters');
  const definition = parseCustomerSegmentDefinition(args.definition);
  const preview = await previewCustomerSegment({ restaurantId: args.restaurantId, definition });
  return db.customerSegment.create({
    data: {
      restaurantId: args.restaurantId,
      name,
      definition: definition as Prisma.InputJsonValue,
      createdByHash: hashActor(args.createdBy),
      isSystem: args.isSystem ?? false,
      lastCount: preview.count,
      lastEvaluatedAt: new Date(),
    },
  });
}

export async function refreshCustomerSegment(args: {
  restaurantId: string;
  segmentId: string;
}): Promise<{ segment: CustomerSegment; count: number; sample: unknown[] }> {
  const segment = await db.customerSegment.findFirst({
    where: { id: args.segmentId, restaurantId: args.restaurantId },
  });
  if (!segment) throw new Error('SEGMENT_NOT_FOUND');
  const preview = await previewCustomerSegment({
    restaurantId: args.restaurantId,
    definition: segment.definition,
  });
  const updated = await db.customerSegment.update({
    where: { id: segment.id },
    data: { lastCount: preview.count, lastEvaluatedAt: new Date() },
  });
  return { segment: updated, count: preview.count, sample: preview.sample };
}
