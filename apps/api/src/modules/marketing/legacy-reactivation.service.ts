import { createHash } from 'node:crypto';
import {
  MarketingCampaignStatus,
  MarketingChannel,
  Prisma,
  type MarketingCampaign,
} from '@prisma/client';
import { db } from '../../shared/db/client';
import { ensureCampaignMessages, validateMarketingTemplate } from './marketing-campaign.service';

/**
 * The old VIP reactivation table is still kept for history and for the
 * existing dashboard route. Sending from that table directly would bypass
 * channel permission, suppression, frequency and unsubscribe checks. This
 * service converts one legacy snapshot into the governed campaign model in a
 * single serializable transaction.
 */

export const LEGACY_REACTIVATION_BODY_TEMPLATE =
  "Bonjour {{customer.firstName}}, cela fait un moment qu'on ne vous a pas vu chez {{restaurant.name}}. On serait ravis de vous revoir ! Réservez ici : {{reservationLink}} {{unsubscribeUrl}}";

export const MAX_LEGACY_REACTIVATION_CUSTOMERS = 10_000;

const MAX_MIGRATION_RETRIES = 3;

export type LegacyReactivationMigrationResult = {
  reactivationCampaignId: string;
  marketingCampaignId: string;
  campaign: MarketingCampaign;
  sourceCustomerCount: number;
  audienceCount: number;
  droppedCustomerCount: number;
  replayed: boolean;
};

function isSerializationFailure(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2034' || error.code === 'P2028')
  );
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function actorHash(actor: string | undefined): string {
  return createHash('sha256')
    .update(actor?.trim() || 'legacy-reactivation')
    .digest('hex');
}

function deterministicCampaignId(reactivationCampaignId: string): string {
  const digest = createHash('sha256')
    .update(`sokar:legacy-reactivation:${reactivationCampaignId}`)
    .digest('hex')
    .slice(0, 32);
  return `legacy-reactivation-${digest}`;
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function replayResult(
  reactivationCampaignId: string,
  campaign: MarketingCampaign,
  sourceCustomerCount: number,
): LegacyReactivationMigrationResult {
  return {
    reactivationCampaignId,
    marketingCampaignId: campaign.id,
    campaign,
    sourceCustomerCount,
    audienceCount: campaign.audienceCount,
    droppedCustomerCount: Math.max(0, sourceCustomerCount - campaign.audienceCount),
    replayed: true,
  };
}

async function migrateInTransaction(args: {
  restaurantId: string;
  reactivationCampaignId: string;
  actor?: string;
  now: Date;
}): Promise<LegacyReactivationMigrationResult> {
  return db.$transaction(
    async (tx) => {
      const legacy = await tx.reactivationCampaign.findFirst({
        where: {
          id: args.reactivationCampaignId,
          restaurantId: args.restaurantId,
        },
        select: {
          id: true,
          status: true,
          customerIds: true,
          marketingCampaignId: true,
          createdAt: true,
        },
      });
      if (!legacy) throw new Error('REACTIVATION_CAMPAIGN_NOT_FOUND');

      const sourceIds = uniqueIds(legacy.customerIds);
      if (legacy.marketingCampaignId) {
        const linked = await tx.marketingCampaign.findFirst({
          where: {
            id: legacy.marketingCampaignId,
            restaurantId: args.restaurantId,
          },
        });
        if (!linked) throw new Error('REACTIVATION_MIGRATION_INCONSISTENT');
        return replayResult(legacy.id, linked, sourceIds.length);
      }
      if (legacy.status !== 'PENDING') {
        throw new Error('REACTIVATION_CAMPAIGN_NOT_PENDING');
      }
      if (sourceIds.length > MAX_LEGACY_REACTIVATION_CUSTOMERS) {
        throw new Error(`REACTIVATION_AUDIENCE_TOO_LARGE:${MAX_LEGACY_REACTIVATION_CUSTOMERS}`);
      }

      const customers =
        sourceIds.length === 0
          ? []
          : await tx.customer.findMany({
              where: {
                restaurantId: args.restaurantId,
                id: { in: sourceIds },
                archivedAt: null,
                mergedIntoId: null,
              },
              select: { id: true, isVip: true },
            });

      const bodyTemplate = validateMarketingTemplate({
        channel: 'SMS',
        bodyTemplate: LEGACY_REACTIVATION_BODY_TEMPLATE,
      }).bodyTemplate;
      const campaignId = deterministicCampaignId(legacy.id);
      const campaign = await tx.marketingCampaign.create({
        data: {
          id: campaignId,
          restaurantId: args.restaurantId,
          name: `Réactivation VIP historique — ${legacy.createdAt.toISOString().slice(0, 10)}`,
          objective: 'LEGACY_REACTIVATION',
          channel: MarketingChannel.SMS,
          segmentId: null,
          status:
            customers.length > 0
              ? MarketingCampaignStatus.READY
              : MarketingCampaignStatus.CANCELLED,
          subject: null,
          bodyTemplate,
          scheduledAt: null,
          timezone: 'Europe/Paris',
          audienceVersion: 1,
          audienceCount: customers.length,
          completedAt: customers.length === 0 ? args.now : null,
          lastErrorCode: customers.length === 0 ? 'LEGACY_REACTIVATION_AUDIENCE_EMPTY' : null,
          createdByHash: actorHash(args.actor),
        },
      });

      if (customers.length > 0) {
        await tx.campaignAudienceMember.createMany({
          data: customers.map((customer) => ({
            campaignId: campaign.id,
            customerId: customer.id,
            audienceVersion: 1,
            inclusionReason: 'LEGACY_REACTIVATION_SNAPSHOT',
            snapshot: {
              source: 'reactivation_campaign',
              legacyCampaignId: legacy.id,
              capturedAt: args.now.toISOString(),
              isVip: customer.isVip,
            } as Prisma.InputJsonValue,
            capturedAt: args.now,
          })),
        });
        await ensureCampaignMessages(campaign.id, 'SMS', tx);
      }

      const linked = await tx.reactivationCampaign.updateMany({
        where: {
          id: legacy.id,
          restaurantId: args.restaurantId,
          status: 'PENDING',
          marketingCampaignId: null,
        },
        data: {
          status: 'MIGRATED',
          marketingCampaignId: campaign.id,
        },
      });
      if (linked.count !== 1) throw new Error('REACTIVATION_MIGRATION_CONFLICT');

      return {
        reactivationCampaignId: legacy.id,
        marketingCampaignId: campaign.id,
        campaign,
        sourceCustomerCount: sourceIds.length,
        audienceCount: customers.length,
        droppedCustomerCount: sourceIds.length - customers.length,
        replayed: false,
      };
    },
    {
      maxWait: 10_000,
      timeout: 30_000,
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}

/**
 * Converts a legacy PENDING snapshot once. Replays return the linked campaign
 * instead of creating a second campaign, which also makes double-clicks and
 * concurrent dashboard requests safe.
 */
export async function migrateLegacyReactivationCampaign(args: {
  restaurantId: string;
  reactivationCampaignId: string;
  actor?: string;
  now?: Date;
}): Promise<LegacyReactivationMigrationResult> {
  const now = args.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('now must be valid');

  for (let attempt = 0; attempt < MAX_MIGRATION_RETRIES; attempt += 1) {
    try {
      return await migrateInTransaction({ ...args, now });
    } catch (error) {
      if (isSerializationFailure(error) && attempt < MAX_MIGRATION_RETRIES - 1) continue;
      if (isUniqueViolation(error)) {
        const legacy = await db.reactivationCampaign.findFirst({
          where: {
            id: args.reactivationCampaignId,
            restaurantId: args.restaurantId,
          },
          select: { marketingCampaignId: true, customerIds: true },
        });
        if (legacy?.marketingCampaignId) {
          const campaign = await db.marketingCampaign.findFirst({
            where: {
              id: legacy.marketingCampaignId,
              restaurantId: args.restaurantId,
            },
          });
          if (campaign) {
            return replayResult(
              args.reactivationCampaignId,
              campaign,
              uniqueIds(legacy.customerIds).length,
            );
          }
        }
      }
      throw error;
    }
  }
  throw new Error('REACTIVATION_MIGRATION_RETRY_EXHAUSTED');
}
