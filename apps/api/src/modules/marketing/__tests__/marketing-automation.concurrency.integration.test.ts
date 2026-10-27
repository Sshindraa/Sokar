/**
 * PostgreSQL-only proof for the marketing automation dedupe and batch split.
 *
 * Skipped during the normal unit run; part of the `AGENTIC_INT_TESTS=1` integration profile.
 * Requires a disposable database with the migrations applied. No provider is contacted.
 */

import { afterAll, describe, expect, it, vi } from 'vitest';

vi.unmock('@prisma/client');

import { randomUUID } from 'node:crypto';
import {
  MarketingAutomationType,
  MarketingCampaignStatus,
  MarketingChannel,
  MarketingPermissionStatus,
  PrismaClient,
} from '@prisma/client';
import {
  createMarketingAutomationCampaign,
  evaluateMarketingAutomation,
} from '../marketing-automation.service';

const runIntegration = process.env.AGENTIC_INT_TESTS === '1';
const describeIntegration = runIntegration ? describe : describe.skip;
const prisma = new PrismaClient();

const restaurantIds: string[] = [];
const NOW = new Date();
const HONOURED_AT = new Date(NOW.getTime() - 3 * 86_400_000);

function randomPhone(prefix: string): string {
  return `+33${prefix}${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
}

async function createRestaurant(): Promise<string> {
  const id = `automation-it-${randomUUID()}`;
  await prisma.restaurant.create({
    data: {
      id,
      name: 'Automation integration',
      slug: id,
      managerPhone: '+33600000000',
      managerEmail: `${id}@example.com`,
      phoneNumber: randomPhone('7'),
      openingHours: {
        monday: { open: '00:00', close: '23:59' },
        tuesday: { open: '00:00', close: '23:59' },
        wednesday: { open: '00:00', close: '23:59' },
        thursday: { open: '00:00', close: '23:59' },
        friday: { open: '00:00', close: '23:59' },
        saturday: { open: '00:00', close: '23:59' },
        sunday: { open: '00:00', close: '23:59' },
      },
    },
  });
  restaurantIds.push(id);
  return id;
}

/** Un client qui a donné son accord e-mail et dont la première visite est honorée depuis trois jours. */
async function createHonouredCustomer(restaurantId: string, label: string) {
  const customer = await prisma.customer.create({
    data: {
      restaurantId,
      phone: randomPhone('6'),
      name: label,
      emailNormalized: `${label}-${randomUUID()}@example.com`,
    },
  });
  await prisma.marketingPermission.create({
    data: {
      restaurantId,
      customerId: customer.id,
      channel: MarketingChannel.EMAIL,
      status: MarketingPermissionStatus.OPTED_IN,
      source: 'INTEGRATION_TEST',
    },
  });
  const sourceId = `reservation-${randomUUID()}`;
  await prisma.customerTimelineEvent.create({
    data: {
      restaurantId,
      customerId: customer.id,
      eventType: 'RESERVATION_HONORED',
      sourceType: 'RESERVATION',
      sourceId,
      dedupeKey: `integration:${sourceId}`,
      occurredAt: HONOURED_AT,
      summaryCode: 'RESERVATION_HONORED',
    },
  });
  return { customer, sourceId };
}

async function createAutomation(restaurantId: string) {
  return prisma.marketingAutomation.create({
    data: {
      restaurantId,
      type: MarketingAutomationType.AFTER_FIRST_HONORED,
      channel: MarketingChannel.EMAIL,
      enabled: true,
      config: {
        bodyTemplate: 'Merci {{customer.firstName}} {{unsubscribeUrl}}',
        subject: 'Merci',
        timezone: 'Europe/Paris',
        delayHours: 24,
      },
    },
  });
}

describeIntegration('Marketing automations — PostgreSQL dedupe and batch split', () => {
  afterAll(async () => {
    if (!runIntegration) return;
    const where = { restaurantId: { in: restaurantIds } };
    await prisma.marketingAutomationDispatch.deleteMany({ where });
    await prisma.marketingCampaign.deleteMany({ where });
    await prisma.marketingAutomation.deleteMany({ where });
    await prisma.marketingPermission.deleteMany({ where });
    await prisma.customerTimelineEvent.deleteMany({ where });
    await prisma.customer.deleteMany({ where });
    await prisma.restaurant.deleteMany({ where: { id: { in: restaurantIds } } });
    await prisma.$disconnect();
  });

  it('une occasion servie n’est jamais renvoyée : la passe suivante ne crée rien', async () => {
    const restaurantId = await createRestaurant();
    const automation = await createAutomation(restaurantId);
    for (const label of ['alice', 'bob', 'claire']) {
      await createHonouredCustomer(restaurantId, label);
    }

    const first = await evaluateMarketingAutomation({ automation, now: NOW });
    expect(first).toMatchObject({ candidateCount: 3, eligibleCount: 3, deferred: 0 });
    expect(first.campaignId).not.toBeNull();

    const second = await evaluateMarketingAutomation({ automation, now: NOW });
    expect(second).toMatchObject({ candidateCount: 0, campaignId: null });
    expect(
      await prisma.marketingAutomationDispatch.count({ where: { automationId: automation.id } }),
    ).toBe(3);
  });

  it('un doublon dans le lot n’interrompt pas la transaction : skipDuplicates l’écarte', async () => {
    const restaurantId = await createRestaurant();
    const automation = await createAutomation(restaurantId);
    const served = await createHonouredCustomer(restaurantId, 'dina');
    await evaluateMarketingAutomation({ automation, now: NOW });
    const fresh = await createHonouredCustomer(restaurantId, 'emma');
    const candidate = (item: {
      customer: { id: string; name: string | null; phone: string; emailNormalized: string | null };
      sourceId: string;
    }) => ({
      customerId: item.customer.id,
      name: item.customer.name,
      phone: item.customer.phone,
      emailNormalized: item.customer.emailNormalized,
      triggerKey: `first-honored:${item.sourceId}`,
      occurredAt: HONOURED_AT,
      inclusionReason: 'AUTOMATION_AFTER_FIRST_HONORED',
    });

    // Lot construit sans le filtrage du finder : la première occasion est déjà servie.
    const result = await createMarketingAutomationCampaign({
      automation,
      candidates: [candidate(served), candidate(fresh)],
      now: NOW,
    });

    expect(result).toMatchObject({
      campaign: { id: expect.any(String) },
      dispatchCount: 1,
      deferred: 0,
    });
    expect(
      await prisma.marketingAutomationDispatch.count({ where: { automationId: automation.id } }),
    ).toBe(2);
  });

  it('deux passes simultanées ne servent jamais deux fois la même occasion', async () => {
    const restaurantId = await createRestaurant();
    const automation = await createAutomation(restaurantId);
    await createHonouredCustomer(restaurantId, 'farid');
    await createHonouredCustomer(restaurantId, 'gaelle');

    const results = await Promise.all([
      evaluateMarketingAutomation({ automation, now: NOW }),
      evaluateMarketingAutomation({ automation, now: NOW }),
    ]);

    expect(results.filter((result) => result.campaignId !== null)).toHaveLength(1);
    expect(
      await prisma.marketingAutomationDispatch.count({ where: { automationId: automation.id } }),
    ).toBe(2);
    const ready = await prisma.marketingCampaign.findMany({
      where: { restaurantId, status: MarketingCampaignStatus.READY },
    });
    expect(ready).toHaveLength(1);
    expect(ready[0]?.audienceCount).toBe(2);
  });
});
