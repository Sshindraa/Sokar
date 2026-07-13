/**
 * Tests unitaires du service RGPD : consent, erasure, export, anonymization.
 * Utilise un mock Prisma.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

type TransactionClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

import { ConsentService, ConsentRequiredError } from '../consent.service';
import { ErasureService, ErasureSubjectNotFoundError } from '../erasure.service';
import { ExportService, ExportSubjectNotFoundError } from '../export.service';
import { runAnonymization, ANONYMIZATION_RETENTION_DAYS } from '../anonymization.worker';
import { CURRENT_PRIVACY_POLICY_VERSION } from '../privacy-policy';
import { queues } from '../../../shared/queue/queues';

function makeMockPrisma() {
  return {
    customerConsent: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
    reservation: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    message: {
      updateMany: vi.fn(),
    },
    reservationAuditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  } as unknown as PrismaClient;
}

describe('RGPD', () => {
  let prisma: ReturnType<typeof makeMockPrisma>;

  beforeEach(() => {
    prisma = makeMockPrisma();
    vi.clearAllMocks();
  });

  describe('ConsentService', () => {
    it('hashSubject est déterministe et case-insensitive', () => {
      const a = ConsentService.hashSubject('+33****0000');
      const b = ConsentService.hashSubject('+33****0000');
      const c = ConsentService.hashSubject('+33****0001');
      const d = ConsentService.hashSubject('+33****0000');
      expect(a).toBe(b);
      expect(a).toBe(d);
      expect(a).not.toBe(c);
    });

    it('refuse si reservationProcessing=false', async () => {
      const service = new ConsentService(prisma);
      await expect(
        service.recordConsent({
          restaurantId: 'r-1',
          customerId: null,
          reservationId: null,
          subject: 'test',
          channel: 'MCP',
          context: 'create_reservation',
          consents: { reservationProcessing: false },
        }),
      ).rejects.toThrow(ConsentRequiredError);
    });

    it('enregistre un consentement avec version et hash', async () => {
      vi.mocked(prisma.customerConsent.create).mockResolvedValueOnce({
        id: 'c-1',
      } as unknown as Awaited<ReturnType<typeof prisma.customerConsent.create>>);
      const service = new ConsentService(prisma);
      const result = await service.recordConsent({
        restaurantId: 'r-1',
        customerId: null,
        reservationId: 'res-1',
        subject: '+33****0000',
        channel: 'MCP',
        context: 'create_reservation',
        consents: {
          reservationProcessing: true,
          marketingOptIn: true,
        },
      });
      expect(result.id).toBe('c-1');
      expect(result.version).toBe(CURRENT_PRIVACY_POLICY_VERSION);
      expect(prisma.customerConsent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reservationProcessing: true,
            marketingOptIn: true,
            privacyPolicyVersion: CURRENT_PRIVACY_POLICY_VERSION,
          }),
        }),
      );
    });

    it('withdrawMarketingOptIn update marketing à false', async () => {
      vi.mocked(prisma.customerConsent.updateMany).mockResolvedValueOnce({ count: 3 });
      const service = new ConsentService(prisma);
      const result = await service.withdrawMarketingOptIn('hash-abc');
      expect(result.count).toBe(3);
      expect(prisma.customerConsent.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { marketingOptIn: false } }),
      );
    });
  });

  describe('ErasureService', () => {
    it('jette si aucune donnée trouvée', async () => {
      vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.customerConsent.findFirst).mockResolvedValueOnce(null);
      const service = new ErasureService(prisma);
      await expect(
        service.eraseSubject({ subject: '+33****0000', reason: 'test', actor: 'rgpd:test' }),
      ).rejects.toThrow(ErasureSubjectNotFoundError);
    });

    it('anonymise les résas du sujet (PII effacée, structure conservée)', async () => {
      vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
        id: 'res-1',
      } as unknown as Awaited<ReturnType<typeof prisma.reservation.findFirst>>);
      vi.mocked(prisma.customerConsent.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.$transaction).mockImplementationOnce(
        async (callback: Parameters<PrismaClient['$transaction']>[0]) =>
          callback({
            reservation: { updateMany: vi.fn().mockResolvedValueOnce({ count: 5 }) },
          } as unknown as TransactionClient),
      );
      vi.mocked(prisma.message.updateMany).mockResolvedValueOnce({ count: 2 });
      vi.mocked(prisma.customerConsent.count).mockResolvedValueOnce(0);
      vi.mocked(prisma.reservationAuditLog.create).mockResolvedValueOnce({
        id: 'audit-1',
      } as unknown as Awaited<ReturnType<typeof prisma.reservationAuditLog.create>>);

      const service = new ErasureService(prisma);
      const result = await service.eraseSubject({
        subject: '+33****0000',
        reason: 'user_request',
        actor: 'rgpd:test',
      });

      expect(result.reservationsAnonymized).toBe(5);
      expect(result.callsAnonymized).toBe(2);
      expect(result.consentsRetained).toBe(0);
    });

    it('émet un event rgpd_erasure sur la queue analytics (OBLIGATOIRE)', async () => {
      // Setup : données présentes, audit + analytics event doivent être déclenchés.
      vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce({
        id: 'res-1',
      } as unknown as Awaited<ReturnType<typeof prisma.reservation.findFirst>>);
      vi.mocked(prisma.customerConsent.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.$transaction).mockImplementationOnce(
        async (callback: Parameters<PrismaClient['$transaction']>[0]) =>
          callback({
            reservation: { updateMany: vi.fn().mockResolvedValueOnce({ count: 3 }) },
          } as unknown as TransactionClient),
      );
      vi.mocked(prisma.message.updateMany).mockResolvedValueOnce({ count: 1 });
      vi.mocked(prisma.customerConsent.count).mockResolvedValueOnce(0);
      vi.mocked(prisma.reservationAuditLog.create).mockResolvedValueOnce({
        id: 'audit-1',
      } as unknown as Awaited<ReturnType<typeof prisma.reservationAuditLog.create>>);

      const analyticsAdd = vi.mocked(queues.analytics.add);
      analyticsAdd.mockClear();

      const service = new ErasureService(prisma);
      await service.eraseSubject({
        subject: '+33****0000',
        reason: 'user_request',
        actor: 'rgpd:user',
      });

      // L'event doit avoir été ajouté à la queue `analytics` avec le bon
      // discriminant + aucun PII brute (uniquement subjectHashPrefix).
      const rgpdEventCall = analyticsAdd.mock.calls.find(
        (call) => call[0] === 'track' && (call[1] as { event?: string })?.event === 'rgpd_erasure',
      );
      expect(rgpdEventCall).toBeDefined();
      const payload = rgpdEventCall![1] as Record<string, unknown>;
      expect(payload.intent).toBe('erase');
      expect(payload.actor).toBe('rgpd:user');
      expect(typeof payload.subjectHashPrefix).toBe('string');
      expect((payload.subjectHashPrefix as string).length).toBe(8);
      // Pas de PII brute dans le payload
      expect(JSON.stringify(payload)).not.toContain('+33****0000');
      // Comptages propagés pour le dashboard pilot
      const meta = payload.metadata as Record<string, number>;
      expect(meta.reservationsAnonymized).toBe(3);
      expect(meta.callsAnonymized).toBe(1);
    });

    it("n'émet PAS d'event analytics quand aucune donnée trouvée (404 avant)", async () => {
      vi.mocked(prisma.reservation.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.customerConsent.findFirst).mockResolvedValueOnce(null);
      const analyticsAdd = vi.mocked(queues.analytics.add);
      analyticsAdd.mockClear();

      const service = new ErasureService(prisma);
      await expect(
        service.eraseSubject({ subject: '+33****9999', reason: 'test', actor: 'rgpd:test' }),
      ).rejects.toThrow(ErasureSubjectNotFoundError);

      const rgpdEventCall = analyticsAdd.mock.calls.find(
        (call) => (call[1] as { event?: string })?.event === 'rgpd_erasure',
      );
      expect(rgpdEventCall).toBeUndefined();
    });
  });

  describe('ExportService', () => {
    it('jette si aucune donnée', async () => {
      vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([]);
      vi.mocked(prisma.customerConsent.findMany).mockResolvedValueOnce([]);
      const service = new ExportService(prisma);
      await expect(service.exportSubject({ subject: '+33****0000' })).rejects.toThrow(
        ExportSubjectNotFoundError,
      );
    });

    it('exporte résas + consents avec hash prefix', async () => {
      vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([
        {
          id: 'res-1',
          restaurantId: 'r-1',
          startsAt: new Date('2026-06-01T19:00:00Z'),
          endsAt: new Date('2026-06-01T21:00:00Z'),
          partySize: 4,
          state: 'CONFIRMED',
          channel: 'MCP',
          customerName: 'Jean Test',
          customerPhone: '+33****0000',
          specialRequests: null,
          createdAt: new Date('2026-05-01T10:00:00Z'),
          restaurant: { name: 'Le Bistrot' },
        },
      ] as unknown as Awaited<ReturnType<typeof prisma.reservation.findMany>>);
      vi.mocked(prisma.customerConsent.findMany).mockResolvedValueOnce([
        {
          id: 'c-1',
          restaurantId: 'r-1',
          channel: 'MCP',
          context: 'create_reservation',
          reservationProcessing: true,
          transactionalSms: true,
          transactionalEmail: false,
          marketingOptIn: false,
          privacyPolicyVersion: 'v1.0-2026-06',
          consentedAt: new Date('2026-05-01T10:00:00Z'),
        },
      ] as unknown as Awaited<ReturnType<typeof prisma.customerConsent.findMany>>);
      const service = new ExportService(prisma);
      const result = await service.exportSubject({ subject: '+33****0000' });
      expect(result.reservations).toHaveLength(1);
      expect(result.reservations[0].customerName).toBe('Jean Test');
      expect(result.reservations[0].restaurantName).toBe('Le Bistrot');
      expect(result.consents).toHaveLength(1);
      expect(result.subject.hashPrefix).toHaveLength(8);
      expect(result.profile?.customerName).toBe('Jean Test');
    });
  });

  describe('Anonymization worker', () => {
    it('anonymise les résas > 2 ans sans résa récente', async () => {
      const oldReservation = {
        id: 'res-old',
        customerPhone: '+33****0000',
        restaurantId: 'r-1',
      };
      vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([
        oldReservation,
      ] as unknown as Awaited<ReturnType<typeof prisma.reservation.findMany>>);
      vi.mocked(prisma.reservation.groupBy).mockResolvedValueOnce([]);
      vi.mocked(prisma.reservation.update).mockResolvedValueOnce({
        id: 'res-old',
      } as unknown as Awaited<ReturnType<typeof prisma.reservation.update>>);

      const result = await runAnonymization(prisma);
      expect(result.scanned).toBe(1);
      expect(result.anonymized).toBe(1);
      expect(result.errors).toBe(0);
      expect(prisma.reservation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'res-old' },
          data: expect.objectContaining({
            customerName: 'ANON',
            customerPhone: null,
            customerId: null,
            specialRequests: null,
          }),
        }),
      );
    });

    it('NE anonymise PAS si résa récente (< 6 mois)', async () => {
      vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([
        { id: 'res-old', customerPhone: '+33****0000', restaurantId: 'r-1' },
      ] as unknown as Awaited<ReturnType<typeof prisma.reservation.findMany>>);
      vi.mocked(prisma.reservation.groupBy).mockResolvedValueOnce([
        { customerPhone: '+33****0000', _count: { customerPhone: 2 } },
      ] as unknown as Awaited<ReturnType<typeof prisma.reservation.groupBy>>);

      const result = await runAnonymization(prisma);
      expect(result.scanned).toBe(1);
      expect(result.anonymized).toBe(0);
      expect(prisma.reservation.update).not.toHaveBeenCalled();
    });

    it('anonymise sans phone si customerName pas encore ANON', async () => {
      vi.mocked(prisma.reservation.findMany).mockResolvedValueOnce([
        { id: 'res-1', customerPhone: null, restaurantId: 'r-1' },
      ] as unknown as Awaited<ReturnType<typeof prisma.reservation.findMany>>);
      vi.mocked(prisma.reservation.update).mockResolvedValueOnce({
        id: 'res-1',
      } as unknown as Awaited<ReturnType<typeof prisma.reservation.update>>);

      const result = await runAnonymization(prisma);
      expect(result.anonymized).toBe(1);
    });

    it('constante de rétention est 730 jours (2 ans)', () => {
      expect(ANONYMIZATION_RETENTION_DAYS).toBe(730);
    });
  });
});
