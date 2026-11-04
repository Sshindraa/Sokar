import { afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

vi.unmock('@prisma/client');
vi.unmock('../../../shared/db/client');

import { db } from '../../../shared/db/client';
import {
  upsertMarketingPermission,
  withdrawMarketingPermission,
} from '../marketing-permission.service';
import { previewMarketingAudience } from '../marketing-campaign.service';
import { loadOptedOutCustomerIds } from '../marketing-opt-out.service';
import { applyMarketingProviderEvent } from '../marketing-provider.service';
import { ConsentService } from '../../rgpd/consent.service';
import { ErasureService } from '../../rgpd/erasure.service';
import { applyMarketingSmsStop } from '../../sms/sms-marketing-stop';

const url = process.env.MARKETING_OPTOUT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    !/^\/sokar_optout_audit_[a-z0-9_]+$/.test(target.pathname) ||
    process.env.DATABASE_URL !== url
  ) {
    throw new Error('Marketing opt-out tests require the dedicated local database');
  }
}

describe.skipIf(!url)('marketing opt-out on PostgreSQL', () => {
  afterAll(async () => {
    vi.unstubAllEnvs();
    await db.$disconnect();
  });

  it('blocks a recreated profile and reports a register failure without unblocking the current profile', async () => {
    vi.stubEnv('MARKETING_OPTOUT_HASH_SECRET', 'k'.repeat(40));
    const tag = randomUUID();
    const phone = '+33612345678';
    const restaurant = await db.restaurant.create({
      data: {
        name: 'Opt-out test',
        managerPhone: '',
        managerEmail: '',
        phoneNumber: tag,
        openingHours: {},
      },
    });
    const original = await db.customer.create({
      data: { restaurantId: restaurant.id, phone, isVip: true },
    });
    await withdrawMarketingPermission({
      restaurantId: restaurant.id,
      customerId: original.id,
      channel: 'SMS',
    });
    await db.customer.delete({ where: { id: original.id } });
    const recreated = await db.customer.create({
      data: { restaurantId: restaurant.id, phone, isVip: true },
    });
    await db.marketingPermission.create({
      data: {
        restaurantId: restaurant.id,
        customerId: recreated.id,
        channel: 'SMS',
        status: 'OPTED_IN',
        source: 'SYNTHETIC_IMPORT',
      },
    });
    const preview = await previewMarketingAudience({
      restaurantId: restaurant.id,
      channel: 'SMS',
      definition: {
        version: 1,
        operator: 'AND',
        conditions: [{ field: 'isVip', op: 'EQ', value: true }],
      },
    });
    expect(preview.eligibleCount).toBe(0);
    expect(preview.excludedByReason.OPTED_OUT_REGISTER).toBe(1);
    vi.stubEnv('MARKETING_OPTOUT_HASH_SECRET', '');
    await expect(
      withdrawMarketingPermission({
        restaurantId: restaurant.id,
        customerId: recreated.id,
        channel: 'SMS',
      }),
    ).rejects.toThrow('MARKETING_OPTOUT_REGISTER_UNAVAILABLE');
    expect(
      (
        await db.marketingPermission.findUniqueOrThrow({
          where: { customerId_channel: { customerId: recreated.id, channel: 'SMS' } },
        })
      ).status,
    ).toBe('OPTED_OUT');
  });
  it('keeps permission and register consistent when consent and withdrawal race', async () => {
    vi.stubEnv('MARKETING_OPTOUT_HASH_SECRET', 'k'.repeat(40));
    const tag = randomUUID();
    const restaurant = await db.restaurant.create({
      data: {
        name: 'Race test',
        managerPhone: '',
        managerEmail: '',
        phoneNumber: tag,
        openingHours: {},
      },
    });
    const customer = await db.customer.create({
      data: { restaurantId: restaurant.id, phone: '+33612345679' },
    });
    for (let round = 0; round < 5; round++) {
      await Promise.all([
        withdrawMarketingPermission({
          restaurantId: restaurant.id,
          customerId: customer.id,
          channel: 'SMS',
        }),
        upsertMarketingPermission({
          restaurantId: restaurant.id,
          customerId: customer.id,
          channel: 'SMS',
          status: 'OPTED_IN',
          liftsOpposition: true,
          source: 'TEST',
          proofVersion: 'test',
          proof: 'test',
        }),
      ]);
      const permission = await db.marketingPermission.findUniqueOrThrow({
        where: { customerId_channel: { customerId: customer.id, channel: 'SMS' } },
      });
      const registered = await db.marketingOptOut.count({
        where: { restaurantId: restaurant.id, channel: 'SMS' },
      });
      expect(registered).toBe(permission.status === 'OPTED_OUT' ? 1 : 0);
    }
  });

  it('excludes both profiles sharing an email after one withdraws', async () => {
    vi.stubEnv('MARKETING_OPTOUT_HASH_SECRET', 'k'.repeat(40));
    const restaurant = await db.restaurant.create({
      data: {
        name: 'Shared email',
        managerPhone: '',
        managerEmail: '',
        phoneNumber: randomUUID(),
        openingHours: {},
      },
    });
    const first = await db.customer.create({
      data: {
        restaurantId: restaurant.id,
        phone: '+33612345672',
        emailNormalized: 'shared@example.test',
      },
    });
    const second = await db.customer.create({
      data: {
        restaurantId: restaurant.id,
        phone: '+33612345673',
        emailNormalized: 'shared@example.test',
      },
    });
    await withdrawMarketingPermission({
      restaurantId: restaurant.id,
      customerId: first.id,
      channel: 'EMAIL',
    });
    const result = await loadOptedOutCustomerIds({
      restaurantId: restaurant.id,
      channel: 'EMAIL',
      customers: [first, second],
    });
    expect(result.checked).toBe(true);
    expect(result.optedOut).toEqual(new Set([first.id, second.id]));
  });

  it('keeps two profiles sharing an email coherent when one withdraws while the other opts in', async () => {
    vi.stubEnv('MARKETING_OPTOUT_HASH_SECRET', 'k'.repeat(40));
    const definition = {
      version: 1,
      operator: 'AND',
      conditions: [{ field: 'isVip', op: 'EQ', value: true }],
    };
    for (let round = 0; round < 8; round++) {
      const restaurant = await db.restaurant.create({
        data: {
          name: 'Shared email race',
          managerPhone: '',
          managerEmail: '',
          phoneNumber: randomUUID(),
          openingHours: {},
        },
      });
      const email = `shared-${round}@example.test`;
      const withdrawing = await db.customer.create({
        data: {
          restaurantId: restaurant.id,
          phone: `+3361234600${round}`,
          emailNormalized: email,
          isVip: true,
        },
      });
      const optingIn = await db.customer.create({
        data: {
          restaurantId: restaurant.id,
          phone: `+3361234610${round}`,
          emailNormalized: email,
          isVip: true,
        },
      });
      // Both orders are valid; what must hold is that no call fails or blocks the other.
      await Promise.all([
        withdrawMarketingPermission({
          restaurantId: restaurant.id,
          customerId: withdrawing.id,
          channel: 'EMAIL',
        }),
        upsertMarketingPermission({
          restaurantId: restaurant.id,
          customerId: optingIn.id,
          channel: 'EMAIL',
          status: 'OPTED_IN',
          liftsOpposition: true,
          source: 'TEST',
          proofVersion: 'test',
          proof: 'test',
        }),
      ]);
      const statuses = await db.marketingPermission.findMany({
        where: { restaurantId: restaurant.id, channel: 'EMAIL' },
        select: { customerId: true, status: true },
      });
      expect(statuses.find((row) => row.customerId === withdrawing.id)?.status).toBe('OPTED_OUT');
      expect(statuses.find((row) => row.customerId === optingIn.id)?.status).toBe('OPTED_IN');
      const registered = await db.marketingOptOut.count({
        where: { restaurantId: restaurant.id, channel: 'EMAIL' },
      });
      expect([0, 1]).toContain(registered);
      const preview = await previewMarketingAudience({
        restaurantId: restaurant.id,
        channel: 'EMAIL',
        definition,
      });
      // The withdrawn profile is never selected; the other one is only if its opt-in came last.
      expect(preview.candidateCount).toBe(2);
      expect(preview.eligibleCount).toBe(registered === 0 ? 1 : 0);
    }
  });

  it('keeps a complaint suppressed and retryable when the register fails', async () => {
    const restaurant = await db.restaurant.create({
      data: {
        name: 'Complaint',
        managerPhone: '',
        managerEmail: '',
        phoneNumber: randomUUID(),
        openingHours: {},
      },
    });
    const customer = await db.customer.create({
      data: {
        restaurantId: restaurant.id,
        phone: '+33612345674',
        emailNormalized: 'complaint@example.test',
      },
    });
    const campaign = await db.marketingCampaign.create({
      data: {
        restaurantId: restaurant.id,
        name: 'Test',
        objective: 'TEST',
        channel: 'EMAIL',
        bodyTemplate: 'test',
        createdByHash: 'test',
      },
    });
    const member = await db.campaignAudienceMember.create({
      data: {
        campaignId: campaign.id,
        customerId: customer.id,
        audienceVersion: 1,
        inclusionReason: 'TEST',
        capturedAt: new Date(),
      },
    });
    const message = await db.campaignMessage.create({
      data: {
        campaignId: campaign.id,
        customerId: customer.id,
        audienceMemberId: member.id,
        channel: 'EMAIL',
        status: 'SENT',
        provider: 'resend',
        providerMessageId: randomUUID(),
        idempotencyKey: randomUUID(),
      },
    });
    const event = {
      provider: 'resend' as const,
      providerMessageId: message.providerMessageId!,
      eventType: 'email.complained',
    };
    vi.stubEnv('MARKETING_OPTOUT_HASH_SECRET', '');
    await expect(applyMarketingProviderEvent(event)).rejects.toThrow(
      'MARKETING_OPTOUT_REGISTER_UNAVAILABLE',
    );
    expect((await db.campaignMessage.findUniqueOrThrow({ where: { id: message.id } })).status).toBe(
      'SENT',
    );
    expect(
      await db.marketingSuppression.count({
        where: { restaurantId: restaurant.id, customerId: customer.id, reason: 'COMPLAINED' },
      }),
    ).toBe(1);
    expect(
      (await db.marketingCampaign.findUniqueOrThrow({ where: { id: campaign.id } })).failedCount,
    ).toBe(0);

    vi.stubEnv('MARKETING_OPTOUT_HASH_SECRET', 'k'.repeat(40));
    await db.customer.update({ where: { id: customer.id }, data: { emailNormalized: null } });
    await expect(applyMarketingProviderEvent(event)).rejects.toThrow(
      'MARKETING_OPTOUT_REGISTER_UNAVAILABLE',
    );
    expect((await db.campaignMessage.findUniqueOrThrow({ where: { id: message.id } })).status).toBe(
      'SENT',
    );
    await db.customer.update({
      where: { id: customer.id },
      data: { emailNormalized: customer.emailNormalized },
    });
    await db.$executeRawUnsafe(`CREATE FUNCTION audit_fail_complaint() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'simulated register failure'; END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER audit_fail_complaint BEFORE INSERT ON marketing_opt_outs
      FOR EACH ROW WHEN (NEW.source = 'RESEND_WEBHOOK') EXECUTE FUNCTION audit_fail_complaint()`);
    try {
      await expect(applyMarketingProviderEvent(event)).rejects.toThrow(
        'MARKETING_OPTOUT_REGISTER_UNAVAILABLE',
      );
      expect(
        (await db.campaignMessage.findUniqueOrThrow({ where: { id: message.id } })).status,
      ).toBe('SENT');
      expect(
        await db.marketingSuppression.count({
          where: { restaurantId: restaurant.id, customerId: customer.id, reason: 'COMPLAINED' },
        }),
      ).toBe(1);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER audit_fail_complaint ON marketing_opt_outs');
      await db.$executeRawUnsafe('DROP FUNCTION audit_fail_complaint()');
    }
    await expect(applyMarketingProviderEvent(event)).resolves.toMatchObject({
      changed: true,
      status: 'COMPLAINED',
    });
    expect(
      await db.marketingOptOut.count({
        where: { restaurantId: restaurant.id, channel: 'EMAIL', reason: 'COMPLAINT' },
      }),
    ).toBe(1);
    await expect(applyMarketingProviderEvent(event)).resolves.toMatchObject({ changed: false });
    expect(
      (await db.marketingCampaign.findUniqueOrThrow({ where: { id: campaign.id } })).failedCount,
    ).toBe(1);
    await new ErasureService(db).eraseSubject({
      subject: customer.phone,
      reason: 'TEST',
      actor: 'test',
    });
    const replacement = await db.customer.create({
      data: {
        restaurantId: restaurant.id,
        phone: customer.phone,
        emailNormalized: customer.emailNormalized,
      },
    });
    const afterErasure = await loadOptedOutCustomerIds({
      restaurantId: restaurant.id,
      channel: 'EMAIL',
      customers: [replacement],
    });
    expect(afterErasure.optedOut.has(replacement.id)).toBe(true);
  });

  it('preserves a pending complaint before erasing the customer', async () => {
    const restaurant = await db.restaurant.create({
      data: {
        name: 'Pending complaint',
        managerPhone: '',
        managerEmail: '',
        phoneNumber: randomUUID(),
        openingHours: {},
      },
    });
    const customer = await db.customer.create({
      data: {
        restaurantId: restaurant.id,
        phone: '+33612345676',
        emailNormalized: 'pending@example.test',
      },
    });
    const campaign = await db.marketingCampaign.create({
      data: {
        restaurantId: restaurant.id,
        name: 'Test',
        objective: 'TEST',
        channel: 'EMAIL',
        bodyTemplate: 'test',
        createdByHash: 'test',
      },
    });
    const member = await db.campaignAudienceMember.create({
      data: {
        campaignId: campaign.id,
        customerId: customer.id,
        audienceVersion: 1,
        inclusionReason: 'TEST',
        capturedAt: new Date(),
      },
    });
    const message = await db.campaignMessage.create({
      data: {
        campaignId: campaign.id,
        customerId: customer.id,
        audienceMemberId: member.id,
        channel: 'EMAIL',
        status: 'SENT',
        provider: 'resend',
        providerMessageId: randomUUID(),
        idempotencyKey: randomUUID(),
      },
    });
    const event = {
      provider: 'resend' as const,
      providerMessageId: message.providerMessageId!,
      eventType: 'email.complained',
    };
    const verificationJti = randomUUID();
    const erase = () =>
      new ErasureService(db).eraseSubject({
        subject: customer.phone,
        reason: 'TEST',
        actor: 'test',
        verificationJti,
      });
    vi.stubEnv('MARKETING_OPTOUT_HASH_SECRET', '');
    await expect(applyMarketingProviderEvent(event)).rejects.toThrow(
      'MARKETING_OPTOUT_REGISTER_UNAVAILABLE',
    );
    await expect(erase()).rejects.toThrow('MARKETING_OPTOUT_REGISTER_UNAVAILABLE');
    expect(await db.signedTokenUsage.findUnique({ where: { jti: verificationJti } })).toBeNull();
    expect(await db.campaignMessage.count({ where: { id: message.id } })).toBe(1);
    expect(
      (await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).archivedAt,
    ).toBeNull();
    vi.stubEnv('MARKETING_OPTOUT_HASH_SECRET', 'k'.repeat(40));
    await db.$executeRawUnsafe(`CREATE FUNCTION audit_fail_erasure_register() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'simulated register failure'; END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER audit_fail_erasure_register BEFORE INSERT ON marketing_opt_outs
      FOR EACH ROW WHEN (NEW.source = 'RGPD_ERASURE') EXECUTE FUNCTION audit_fail_erasure_register()`);
    try {
      await expect(erase()).rejects.toThrow();
      expect(await db.campaignMessage.count({ where: { id: message.id } })).toBe(1);
      expect(
        (await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).archivedAt,
      ).toBeNull();
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER audit_fail_erasure_register ON marketing_opt_outs');
      await db.$executeRawUnsafe('DROP FUNCTION audit_fail_erasure_register()');
    }
    await db.$executeRawUnsafe(`CREATE FUNCTION audit_delay_erasure() RETURNS trigger AS $$
      BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER audit_delay_erasure BEFORE INSERT ON marketing_opt_outs
      FOR EACH ROW WHEN (NEW.source = 'RGPD_ERASURE') EXECUTE FUNCTION audit_delay_erasure()`);
    try {
      const erasure = erase();
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        const rows = await db.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'PgSleep'
        ) AS waiting`;
        waiting = rows[0].waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await Promise.all([erasure, applyMarketingProviderEvent(event)]);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER audit_delay_erasure ON marketing_opt_outs');
      await db.$executeRawUnsafe('DROP FUNCTION audit_delay_erasure()');
    }
    const replacement = await db.customer.create({
      data: {
        restaurantId: restaurant.id,
        phone: customer.phone,
        emailNormalized: customer.emailNormalized,
      },
    });
    const result = await loadOptedOutCustomerIds({
      restaurantId: restaurant.id,
      channel: 'EMAIL',
      customers: [replacement],
    });
    expect(result.optedOut.has(replacement.id)).toBe(true);
  });

  it('requires a new SMS consent for a profile recreated after erasure', async () => {
    vi.stubEnv('MARKETING_OPTOUT_HASH_SECRET', 'k'.repeat(40));
    const tag = randomUUID();
    const phone = `+336${randomUUID().replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`;
    const restaurant = await db.restaurant.create({
      data: {
        name: 'Legacy consent test',
        managerPhone: '',
        managerEmail: '',
        phoneNumber: tag,
        openingHours: {},
      },
    });
    await db.customer.create({ data: { restaurantId: restaurant.id, phone, isVip: true } });
    const consent = {
      restaurantId: restaurant.id,
      subjectHash: ConsentService.hashSubject(phone),
      channel: 'WEB' as const,
      context: 'test',
      reservationProcessing: true,
      transactionalSms: true,
      transactionalEmail: false,
      marketingOptIn: true,
      privacyPolicyVersion: 'test',
      consentedAt: new Date(),
    };
    await db.customerConsent.create({ data: consent });
    const eligibleCount = async () =>
      (
        await previewMarketingAudience({
          restaurantId: restaurant.id,
          channel: 'SMS',
          definition: {
            version: 1,
            operator: 'AND',
            conditions: [{ field: 'isVip', op: 'EQ', value: true }],
          },
        })
      ).eligibleCount;
    expect(await eligibleCount()).toBe(1);

    await new ErasureService(db).eraseSubject({ subject: phone, reason: 'TEST', actor: 'test' });
    await db.customer.create({ data: { restaurantId: restaurant.id, phone, isVip: true } });

    expect(await eligibleCount()).toBe(0);
    expect(
      await db.customerConsent.count({
        where: { restaurantId: restaurant.id, subjectHash: consent.subjectHash },
      }),
    ).toBe(1);

    await db.customerConsent.create({ data: consent });
    expect(await eligibleCount()).toBe(1);
  });

  it('keeps withdrawal proof when a register write fails during a concurrent opt-in', async () => {
    vi.stubEnv('MARKETING_OPTOUT_HASH_SECRET', 'k'.repeat(40));
    const restaurant = await db.restaurant.create({
      data: {
        name: 'Failed register race',
        managerPhone: '',
        managerEmail: '',
        phoneNumber: randomUUID(),
        openingHours: {},
      },
    });
    const customer = await db.customer.create({
      data: { restaurantId: restaurant.id, phone: '+33612345670' },
    });
    await db.$executeRawUnsafe(`CREATE FUNCTION audit_fail_optout() RETURNS trigger AS $$
      BEGIN PERFORM pg_sleep(0.5); RAISE EXCEPTION 'simulated register failure'; END;
      $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER audit_fail_optout BEFORE INSERT ON marketing_opt_outs
      FOR EACH ROW WHEN (NEW.source = 'AUDIT_FAIL') EXECUTE FUNCTION audit_fail_optout()`);
    try {
      const withdrawal = withdrawMarketingPermission({
        restaurantId: restaurant.id,
        customerId: customer.id,
        channel: 'SMS',
        source: 'AUDIT_FAIL',
      });
      const failed = expect(withdrawal).rejects.toThrow('MARKETING_OPTOUT_REGISTER_UNAVAILABLE');
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        const rows = await db.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'PgSleep'
        ) AS waiting`;
        waiting = rows[0].waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      const optIn = upsertMarketingPermission({
        restaurantId: restaurant.id,
        customerId: customer.id,
        channel: 'SMS',
        status: 'OPTED_IN',
        liftsOpposition: true,
        source: 'AUDIT_OPT_IN',
        proofVersion: 'test',
        proof: 'test',
      });
      await Promise.all([failed, optIn]);
      const permission = await db.marketingPermission.findUniqueOrThrow({
        where: { customerId_channel: { customerId: customer.id, channel: 'SMS' } },
      });
      expect(permission.status).toBe('OPTED_IN');
      expect(
        await db.marketingPermissionEvent.count({
          where: { restaurantId: restaurant.id, customerId: customer.id, source: 'AUDIT_FAIL' },
        }),
      ).toBe(1);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER audit_fail_optout ON marketing_opt_outs');
      await db.$executeRawUnsafe('DROP FUNCTION audit_fail_optout()');
    }
  });

  it('rolls back the withdrawal if its proof cannot be saved', async () => {
    const restaurant = await db.restaurant.create({
      data: {
        name: 'Failed proof',
        managerPhone: '',
        managerEmail: '',
        phoneNumber: randomUUID(),
        openingHours: {},
      },
    });
    const customer = await db.customer.create({
      data: { restaurantId: restaurant.id, phone: '+33612345671' },
    });
    await db.$executeRawUnsafe(`CREATE FUNCTION audit_fail_proof() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'simulated proof failure'; END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER audit_fail_proof BEFORE INSERT ON marketing_permission_events
      FOR EACH ROW WHEN (NEW.source = 'AUDIT_PROOF_FAIL') EXECUTE FUNCTION audit_fail_proof()`);
    try {
      await expect(
        withdrawMarketingPermission({
          restaurantId: restaurant.id,
          customerId: customer.id,
          channel: 'SMS',
          source: 'AUDIT_PROOF_FAIL',
        }),
      ).rejects.toThrow();
      expect(
        await db.marketingPermission.count({
          where: { restaurantId: restaurant.id, customerId: customer.id },
        }),
      ).toBe(0);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER audit_fail_proof ON marketing_permission_events');
      await db.$executeRawUnsafe('DROP FUNCTION audit_fail_proof()');
    }
  });
  it('applies an SMS STOP to the restaurant of the last SMS once, leaving other restaurants alone', async () => {
    vi.stubEnv('MARKETING_OPTOUT_HASH_SECRET', 'k'.repeat(40));
    const phone = '+33612345679';
    const restaurant = await db.restaurant.create({
      data: {
        name: 'SMS STOP',
        managerPhone: '',
        managerEmail: '',
        phoneNumber: randomUUID(),
        openingHours: {},
      },
    });
    const other = await db.restaurant.create({
      data: {
        name: 'SMS STOP other',
        managerPhone: '',
        managerEmail: '',
        phoneNumber: randomUUID(),
        openingHours: {},
      },
    });
    const customer = await db.customer.create({ data: { restaurantId: restaurant.id, phone } });
    const otherCustomer = await db.customer.create({
      data: { restaurantId: other.id, phone },
    });
    const campaign = await db.marketingCampaign.create({
      data: {
        restaurantId: restaurant.id,
        name: 'SMS test',
        objective: 'TEST',
        channel: 'SMS',
        bodyTemplate: 'test',
        createdByHash: 'test',
      },
    });
    const member = await db.campaignAudienceMember.create({
      data: {
        campaignId: campaign.id,
        customerId: customer.id,
        audienceVersion: 1,
        inclusionReason: 'TEST',
        capturedAt: new Date(),
      },
    });
    await db.campaignMessage.create({
      data: {
        campaignId: campaign.id,
        customerId: customer.id,
        audienceMemberId: member.id,
        channel: 'SMS',
        status: 'SENT',
        provider: 'telnyx',
        providerMessageId: randomUUID(),
        idempotencyKey: randomUUID(),
      },
    });

    await expect(applyMarketingSmsStop(phone)).resolves.toBe(true);
    // Rejeu du même webhook : aucune nouvelle fiche touchée, aucun doublon.
    await expect(applyMarketingSmsStop(phone)).resolves.toBe(true);

    const permission = await db.marketingPermission.findUniqueOrThrow({
      where: { customerId_channel: { customerId: customer.id, channel: 'SMS' } },
    });
    expect(permission.status).toBe('OPTED_OUT');
    expect(permission.source).toBe('SMS_STOP');
    expect(await db.marketingPermissionEvent.count({ where: { customerId: customer.id } })).toBe(1);
    expect(await db.marketingPermission.count({ where: { customerId: otherCustomer.id } })).toBe(0);
    const optOuts = await db.marketingOptOut.findMany({
      where: { channel: 'SMS', restaurantId: { in: [restaurant.id, other.id] } },
    });
    expect(optOuts).toHaveLength(1);
    expect(optOuts[0]).toMatchObject({
      restaurantId: restaurant.id,
      reason: 'UNSUBSCRIBE',
      source: 'SMS_STOP',
    });
  });
});
