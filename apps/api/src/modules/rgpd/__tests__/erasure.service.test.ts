/**
 * Tests for the RGPD erasure service (Article 17 — droit à l'effacement).
 *
 * Stratégie Phase 5 MVP : on anonymise au lieu de supprimer (préserve
 * stats et obligations comptables). Champs anonymisés :
 *   - reservation.customerName → "ANON"
 *   - reservation.customerPhone → null
 *   - reservation.customerId → null
 *   - reservation.specialRequests → null
 *   - call.customerPhone → null (best-effort)
 *
 * Les customer_consents sont conservés (preuve légale).
 * Un audit log 'rgpd_erasure' est créé (preuve légale + observabilité).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { ErasureService, ErasureSubjectNotFoundError } from '../erasure.service';

// L'erasure service importe trackRgpdEvent (depuis analytics/events.service)
// et AuditLogService (depuis agentic-reservations/core/audit-log.service).
// Ces deux dépendances utilisent des mocks globaux de setup.ts :
//   - queues.analytics.add (mocké en no-op)
//   - reservationAuditLog.create (mocké en no-op)
// Donc on n'a rien d'autre à mocker ici.

function makePrisma() {
  return {
    reservation: {
      findFirst: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    customerConsent: {
      findFirst: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    message: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    reservationAuditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(),
  } as unknown as PrismaClient;
}

describe('ErasureService.eraseSubject', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: ErasureService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makePrisma();
    service = new ErasureService(prisma);
  });

  it('lève ErasureSubjectNotFoundError si aucune résa et aucun consent', async () => {
    (prisma.reservation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.customerConsent.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await expect(
      service.eraseSubject({
        subject: '+336****0000',
        reason: 'Article 17',
        actor: 'user:self-service',
      }),
    ).rejects.toBeInstanceOf(ErasureSubjectNotFoundError);
  });

  it('anonymise les résas via une transaction (atomicité)', async () => {
    (prisma.reservation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'res-1',
    });
    (prisma.customerConsent.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    // La transaction prend une fonction callback, on l'exécute avec un tx mock.
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: { reservation: typeof prisma.reservation }) => unknown) =>
        fn({ reservation: prisma.reservation }),
    );
    (prisma.reservation.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 3 });

    const result = await service.eraseSubject({
      subject: '+336****1111',
      reason: 'GDPR right to erasure',
      actor: 'admin:hamza',
    });

    expect(prisma.reservation.updateMany).toHaveBeenCalledWith({
      where: { customerPhone: '+336****1111' },
      data: {
        customerName: 'ANON',
        customerPhone: null,
        customerId: null,
        specialRequests: null,
      },
    });
    expect(result.reservationsAnonymized).toBe(3);
  });

  it('anonymise les messages d appels (Message a customerPhone/customerName)', async () => {
    (prisma.reservation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'res-1' });
    (prisma.customerConsent.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: { reservation: typeof prisma.reservation }) => unknown) =>
        fn({ reservation: prisma.reservation }),
    );
    (prisma.message.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 2 });

    const result = await service.eraseSubject({
      subject: '+336****2222',
      reason: 'r',
      actor: 'a',
    });

    expect(result.callsAnonymized).toBe(2);
  });

  it("ne fait pas échouer si la table Message n'a pas de customerPhone (catch silencieux)", async () => {
    (prisma.reservation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'res-1' });
    (prisma.customerConsent.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: { reservation: typeof prisma.reservation }) => unknown) =>
        fn({ reservation: prisma.reservation }),
    );
    (prisma.message.updateMany as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Unknown field `customerPhone`');
    });

    const result = await service.eraseSubject({
      subject: '+336****3333',
      reason: 'r',
      actor: 'a',
    });

    expect(result.callsAnonymized).toBe(0);
    // L'erasure a tout de même lieu.
    expect(result.reservationsAnonymized).toBe(0);
  });

  it('conserve les consents (preuve légale) et les compte', async () => {
    (prisma.reservation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'res-1' });
    (prisma.customerConsent.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'c-1' });
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: { reservation: typeof prisma.reservation }) => unknown) =>
        fn({ reservation: prisma.reservation }),
    );
    (prisma.customerConsent.count as ReturnType<typeof vi.fn>).mockResolvedValue(4);

    const result = await service.eraseSubject({
      subject: '+336****4444',
      reason: 'r',
      actor: 'a',
    });

    expect(result.consentsRetained).toBe(4);
  });

  it("retourne le hash du subject (SHA-256 hex 64 chars) et la date d'effacement", async () => {
    (prisma.reservation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'res-1' });
    (prisma.customerConsent.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: { reservation: typeof prisma.reservation }) => unknown) =>
        fn({ reservation: prisma.reservation }),
    );

    const result = await service.eraseSubject({
      subject: '+336****5555',
      reason: 'r',
      actor: 'a',
    });

    expect(result.subjectHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.subjectHash).toHaveLength(64);
    expect(result.erasedAt).toBeInstanceOf(Date);
  });
});
