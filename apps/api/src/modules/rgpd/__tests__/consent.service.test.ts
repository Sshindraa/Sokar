/**
 * Tests for the RGPD consent service.
 *
 * - Enregistre chaque consentement dans customer_consents.
 * - Identifie le sujet par hash SHA-256 (jamais de téléphone en clair).
 * - reservationProcessing est obligatoire (ConsentRequiredError sinon).
 * - Permet de retirer le consentement marketing (les autres restent valides
 *   tant que la résa est en cours).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { ConsentService, ConsentRequiredError } from '../consent.service';

const FIXED_DATE = new Date('2026-07-08T12:00:00.000Z');
const sha256 = (s: string) => createHash('sha256').update(s.toLowerCase().trim()).digest('hex');

function makePrisma() {
  const create = vi.fn().mockResolvedValue({ id: 'consent-1' });
  const findFirst = vi.fn().mockResolvedValue(null);
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  return {
    prisma: {
      customerConsent: { create, findFirst, updateMany },
    } as unknown as PrismaClient,
    create,
    findFirst,
    updateMany,
  };
}

describe('ConsentService.hashSubject', () => {
  it('produit un hash SHA-256 hexadécimal (64 caractères)', () => {
    const hash = ConsentService.hashSubject('+336****5678');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('normalise le subject (lowercase + trim) avant hash', () => {
    const a = ConsentService.hashSubject('  +336****5678  ');
    const b = ConsentService.hashSubject('+336****5678');
    const c = ConsentService.hashSubject('+336****5678'.toUpperCase());
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('produit des hashes différents pour des sujets distincts', () => {
    const a = ConsentService.hashSubject('+336****5678');
    const b = ConsentService.hashSubject('+336****9999');
    expect(a).not.toBe(b);
  });

  it('correspond à un SHA-256 calculé manuellement (sanity check)', () => {
    const subject = '+336****5678';
    expect(ConsentService.hashSubject(subject)).toBe(sha256(subject));
  });
});

describe('ConsentService.recordConsent', () => {
  let service: ConsentService;
  let create: ReturnType<typeof vi.fn>;
  let findFirst: ReturnType<typeof vi.fn>;
  let updateMany: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const mocks = makePrisma();
    service = new ConsentService(mocks.prisma);
    create = mocks.create;
    findFirst = mocks.findFirst;
    updateMany = mocks.updateMany;
  });

  it('lève ConsentRequiredError si reservationProcessing est false', async () => {
    await expect(
      service.recordConsent({
        restaurantId: 'rest-1',
        customerId: null,
        reservationId: null,
        subject: '+336****5678',
        channel: 'PHONE',
        context: 'voice_call',
        consents: { reservationProcessing: false },
      }),
    ).rejects.toBeInstanceOf(ConsentRequiredError);
    expect(create).not.toHaveBeenCalled();
  });

  it('enregistre un consentement avec les flags fournis + version policy', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_DATE);
    try {
      const result = await service.recordConsent({
        restaurantId: 'rest-1',
        customerId: 'cust-1',
        reservationId: 'res-1',
        subject: '+336****5678',
        channel: 'MCP',
        context: 'openai_reserve',
        consents: {
          reservationProcessing: true,
          transactionalSms: true,
          marketingOptIn: true,
        },
        consentIpHash: 'ip-hash-1',
      });

      expect(result.id).toBe('consent-1');
      expect(result.version).toMatch(/.+/);
      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          restaurantId: 'rest-1',
          customerId: 'cust-1',
          reservationId: 'res-1',
          subjectHash: sha256('+336****5678'),
          channel: 'MCP',
          context: 'openai_reserve',
          reservationProcessing: true,
          transactionalSms: true,
          transactionalEmail: false,
          marketingOptIn: true,
          consentIpHash: 'ip-hash-1',
          consentedAt: FIXED_DATE,
        }),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('default transactionalSms/Email et marketingOptIn à false (opt-in)', async () => {
    await service.recordConsent({
      restaurantId: 'rest-1',
      customerId: null,
      reservationId: null,
      subject: '+336****5678',
      channel: 'WEB',
      context: 'website',
      consents: { reservationProcessing: true },
    });
    const call = create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(call.data.transactionalSms).toBe(false);
    expect(call.data.transactionalEmail).toBe(false);
    expect(call.data.marketingOptIn).toBe(false);
  });
});

describe('ConsentService.getLatestConsent', () => {
  let service: ConsentService;
  let findFirst: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const mocks = makePrisma();
    service = new ConsentService(mocks.prisma);
    findFirst = mocks.findFirst;
  });

  it('retourne null si aucun consentement', async () => {
    findFirst.mockResolvedValue(null);
    const result = await service.getLatestConsent('hash-x');
    expect(result).toBeNull();
  });

  it('retourne le consentement le plus récent par subjectHash', async () => {
    findFirst.mockResolvedValueOnce({
      reservationProcessing: true,
      transactionalSms: true,
      transactionalEmail: false,
      marketingOptIn: true,
      privacyPolicyVersion: '2026-01-01',
      consentedAt: new Date('2026-06-01'),
    });
    const result = await service.getLatestConsent('hash-abc');
    expect(result).toEqual({
      reservationProcessing: true,
      transactionalSms: true,
      transactionalEmail: false,
      marketingOptIn: true,
      privacyPolicyVersion: '2026-01-01',
      consentedAt: new Date('2026-06-01'),
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { subjectHash: 'hash-abc' },
      orderBy: { consentedAt: 'desc' },
    });
  });
});

describe('ConsentService.withdrawMarketingOptIn', () => {
  let service: ConsentService;
  let updateMany: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const mocks = makePrisma();
    service = new ConsentService(mocks.prisma);
    updateMany = mocks.updateMany;
  });

  it('met marketingOptIn=false pour tous les consentements du sujet', async () => {
    updateMany.mockResolvedValueOnce({ count: 3 });
    const result = await service.withdrawMarketingOptIn('hash-abc');
    expect(result).toEqual({ count: 3 });
    expect(updateMany).toHaveBeenCalledWith({
      where: { subjectHash: 'hash-abc' },
      data: { marketingOptIn: false },
    });
  });

  it('ne touche PAS aux autres flags (transactionalSms, transactionalEmail)', async () => {
    await service.withdrawMarketingOptIn('hash-abc');
    const call = updateMany.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(Object.keys(call.data)).toEqual(['marketingOptIn']);
  });
});
