import { afterAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
vi.unmock('@prisma/client');
import { PrismaClient } from '@prisma/client';
import { ErasureService } from '../erasure.service';
import { ConsentService } from '../consent.service';

const url = process.env.RGPD_ERASURE_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    !/^\/sokar_rgpd_erasure_[a-z0-9_]+$/.test(target.pathname)
  ) {
    throw new Error('RGPD erasure tests require a dedicated local database');
  }
}
describe.skipIf(!url)('RGPD erasure on PostgreSQL', () => {
  const db = new PrismaClient({
    datasources: { db: { url: url ?? 'postgresql://localhost/sokar_rgpd_erasure_unused' } },
  });
  afterAll(async () => db.$disconnect());

  it('rolls back reservations when anonymizing a message fails, then detaches experience reservation', async () => {
    const tag = randomUUID();
    const phone = `synthetic-${tag}`;
    const restaurant = await db.restaurant.create({
      data: {
        name: 'RGPD audit',
        managerPhone: '',
        managerEmail: '',
        phoneNumber: `audit-${tag}`,
        openingHours: {},
      },
    });
    const reservation = await db.reservation.create({
      data: {
        restaurantId: restaurant.id,
        reservedAt: new Date(),
        partySize: 2,
        customerName: 'Synthetic',
        customerPhone: phone,
      },
    });
    const experience = await db.experience.create({
      data: {
        restaurantId: restaurant.id,
        key: `rgpd-${tag}`,
        name: 'Audit',
        durationMinutes: 60,
        priceCents: 100,
        capacity: 5,
        createdByHash: 'audit',
      },
    });
    const session = await db.experienceSession.create({
      data: {
        restaurantId: restaurant.id,
        experienceId: experience.id,
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 3600000),
      },
    });
    const booking = await db.experienceReservation.create({
      data: {
        restaurantId: restaurant.id,
        experienceId: experience.id,
        sessionId: session.id,
        reservationId: reservation.id,
        customerName: 'Synthetic',
        customerPhone: phone,
        customerEmail: 'synthetic@example.invalid',
        unitPriceCents: 100,
        totalPriceCents: 100,
        createdByHash: 'audit',
      },
    });
    await db.message.create({
      data: {
        restaurantId: restaurant.id,
        customerName: 'Synthetic',
        customerPhone: phone,
        content: 'synthetic',
      },
    });
    await db.$executeRawUnsafe(
      "CREATE OR REPLACE FUNCTION rgpd_audit_fail_message() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'rgpd audit failure'; END $$",
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER rgpd_audit_fail BEFORE UPDATE ON messages FOR EACH ROW EXECUTE FUNCTION rgpd_audit_fail_message()',
    );
    const service = new ErasureService(db);
    const verificationJti = randomUUID();
    const request = { subject: phone, reason: 'audit', actor: 'test', verificationJti };
    await expect(service.eraseSubject(request)).rejects.toThrow();
    expect(await db.signedTokenUsage.findUnique({ where: { jti: verificationJti } })).toBeNull();
    expect(
      (await db.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).customerPhone,
    ).toBe(phone);
    expect(
      (await db.experienceReservation.findUniqueOrThrow({ where: { id: booking.id } }))
        .reservationId,
    ).toBe(reservation.id);
    await db.$executeRawUnsafe('DROP TRIGGER rgpd_audit_fail ON messages');
    await service.eraseSubject(request);
    expect(
      await db.signedTokenUsage.findUnique({ where: { jti: verificationJti } }),
    ).not.toBeNull();
    expect(
      await db.experienceReservation.findUniqueOrThrow({ where: { id: booking.id } }),
    ).toMatchObject({
      reservationId: null,
      customerId: null,
    });
  });
  it('consumes a single token once when erasures run concurrently', async () => {
    const tag = randomUUID();
    const subject = `synthetic-${tag}`;
    const restaurant = await db.restaurant.create({
      data: {
        name: 'RGPD audit',
        managerPhone: '',
        managerEmail: '',
        phoneNumber: `audit-${tag}`,
        openingHours: {},
      },
    });
    await db.reservation.create({
      data: {
        restaurantId: restaurant.id,
        reservedAt: new Date(),
        partySize: 2,
        customerName: 'Synthetic',
        customerPhone: subject,
      },
    });
    await db.customerConsent.create({
      data: {
        restaurantId: restaurant.id,
        subjectHash: ConsentService.hashSubject(subject),
        channel: 'WEB',
        context: 'audit',
        reservationProcessing: true,
        transactionalSms: false,
        transactionalEmail: false,
        marketingOptIn: false,
        privacyPolicyVersion: 'audit',
        consentedAt: new Date(),
      },
    });
    const verificationJti = randomUUID();
    const service = new ErasureService(db);
    const args = { subject, reason: 'audit', actor: 'test', verificationJti };
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => service.eraseSubject(args)),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.signedTokenUsage.count({ where: { jti: verificationJti } })).toBe(1);
  });
  it('rolls back erasure if opposition cannot be preserved, then keeps it after profile recreation', async () => {
    const tag = randomUUID();
    const phone = '+33612345678';
    const restaurant = await db.restaurant.create({
      data: {
        name: 'RGPD opt-out test',
        managerPhone: '',
        managerEmail: '',
        phoneNumber: tag,
        openingHours: {},
      },
    });
    const customer = await db.customer.create({
      data: { restaurantId: restaurant.id, phone, emailNormalized: 'synthetic@example.invalid' },
    });
    await db.marketingPermission.create({
      data: {
        restaurantId: restaurant.id,
        customerId: customer.id,
        channel: 'SMS',
        status: 'OPTED_OUT',
        source: 'TEST',
        withdrawnAt: new Date(),
      },
    });
    await db.marketingSuppression.create({
      data: {
        restaurantId: restaurant.id,
        customerId: customer.id,
        channel: 'EMAIL',
        reason: 'COMPLAINED',
        source: 'TEST',
      },
    });
    const request = {
      subject: phone,
      reason: 'test',
      actor: 'test',
      verificationJti: randomUUID(),
    };
    vi.stubEnv('MARKETING_OPTOUT_HASH_SECRET', '');
    await expect(new ErasureService(db).eraseSubject(request)).rejects.toThrow(
      'MARKETING_OPTOUT_REGISTER_UNAVAILABLE',
    );
    expect(
      (await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).archivedAt,
    ).toBeNull();
    expect(
      await db.signedTokenUsage.findUnique({ where: { jti: request.verificationJti } }),
    ).toBeNull();
    vi.stubEnv('MARKETING_OPTOUT_HASH_SECRET', 'k'.repeat(40));
    await new ErasureService(db).eraseSubject(request);
    expect(
      await db.marketingOptOut.count({ where: { restaurantId: restaurant.id, channel: 'SMS' } }),
    ).toBe(1);
    expect(
      await db.marketingOptOut.count({ where: { restaurantId: restaurant.id, channel: 'EMAIL' } }),
    ).toBe(1);
    const recreated = await db.customer.create({ data: { restaurantId: restaurant.id, phone } });
    expect(recreated.id).not.toBe(customer.id);
    vi.unstubAllEnvs();
  });
  it('refuses recorded calls without consuming the token and clears linked call text after manual cleanup', async () => {
    const tag = randomUUID();
    const phone = '+33612345671';
    const restaurant = await db.restaurant.create({
      data: {
        name: 'Call privacy test',
        managerPhone: '',
        managerEmail: '',
        phoneNumber: tag,
        openingHours: {},
      },
    });
    const call = await db.call.create({
      data: {
        restaurantId: restaurant.id,
        callSid: tag,
        transcript: 'synthetic transcript',
        recordingStatus: 'AVAILABLE',
        recordingStorageKey: 'synthetic/audio',
        recordingProviderId: 'synthetic',
      },
    });
    const reservation = await db.reservation.create({
      data: {
        restaurantId: restaurant.id,
        callId: call.id,
        reservedAt: new Date(),
        partySize: 2,
        customerName: 'Synthetic',
        customerPhone: phone,
      },
    });
    const message = await db.message.create({
      data: {
        restaurantId: restaurant.id,
        callId: call.id,
        customerName: 'Synthetic',
        content: 'synthetic private message',
      },
    });
    await db.voiceDebugTurn.create({
      data: {
        restaurantId: restaurant.id,
        callId: call.id,
        turnId: tag,
        sequence: 1,
        callerText: 'synthetic dialogue',
        expiresAt: new Date(Date.now() + 10000),
      },
    });
    const request = {
      subject: phone,
      reason: 'test',
      actor: 'test',
      verificationJti: randomUUID(),
    };
    await expect(new ErasureService(db).eraseSubject(request)).rejects.toThrow(
      'RGPD_RECORDING_ERASURE_REQUIRES_MANUAL_REVIEW',
    );
    expect(
      (await db.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).customerPhone,
    ).toBe(phone);
    expect(
      await db.signedTokenUsage.findUnique({ where: { jti: request.verificationJti } }),
    ).toBeNull();
    await db.call.update({
      where: { id: call.id },
      data: { recordingStatus: 'DELETED', recordingStorageKey: null, recordingProviderId: null },
    });
    await new ErasureService(db).eraseSubject(request);
    expect((await db.call.findUniqueOrThrow({ where: { id: call.id } })).transcript).toBeNull();
    expect((await db.message.findUniqueOrThrow({ where: { id: message.id } })).content).toBe(
      '[effacé]',
    );
    expect(await db.voiceDebugTurn.count({ where: { callId: call.id } })).toBe(0);
  });
});
