import { afterAll, describe, expect, it, vi } from 'vitest';
import { createHash, randomInt } from 'node:crypto';
import type Redis from 'ioredis';

vi.unmock('@prisma/client');
import { PrismaClient } from '@prisma/client';
import { IdentityVerificationService } from '../identity-verification.service';

const url = process.env.RGPD_AUDIT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    !/^\/sokar_rgpd_audit_[a-z0-9_]+$/.test(target.pathname)
  ) {
    throw new Error('RGPD audit requires a dedicated local database');
  }
}

describe.skipIf(!url)('RGPD verification concurrency on PostgreSQL', () => {
  const db = new PrismaClient({
    datasources: { db: { url: url ?? 'postgresql://localhost/sokar_rgpd_audit_unused' } },
  });
  const service = new IdentityVerificationService(db, {} as Redis);
  afterAll(async () => db.$disconnect());

  it('consumes the code and action token once under concurrent requests', async () => {
    const subject = `test-${randomInt(1_000_000_000)}`;
    const code = String(randomInt(1_000_000)).padStart(6, '0');
    await db.identityVerificationOtp.create({
      data: {
        subject,
        intent: 'export',
        otpHash: createHash('sha256').update(code).digest('hex'),
        channel: 'sms',
        destination: subject,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const confirmations = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        service.confirmVerification({ subject, intent: 'export', code }),
      ),
    );
    const successes = confirmations.filter((result) => result.status === 'fulfilled');
    expect(successes).toHaveLength(1);
    const token = (successes[0] as PromiseFulfilledResult<{ verificationToken: string }>).value
      .verificationToken;
    const uses = await Promise.allSettled(
      Array.from({ length: 8 }, () => service.verifyVerificationToken(token, 'export')),
    );
    expect(uses.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  });
});
