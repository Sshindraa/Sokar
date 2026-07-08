/**
 * Tests for the RGPD export service (Article 15 — droit d'accès).
 *
 * Retourne toutes les données d'un sujet dans un payload JSON portable.
 * Le caller fournit le téléphone exact utilisé lors des résas.
 *
 * Si aucune résa et aucun consent → ExportSubjectNotFoundError.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { ExportService, ExportSubjectNotFoundError } from '../export.service';

function makePrisma() {
  return {
    reservation: { findMany: vi.fn() },
    customerConsent: { findMany: vi.fn() },
  } as unknown as PrismaClient;
}

describe('ExportService.exportSubject', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: ExportService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makePrisma();
    service = new ExportService(prisma);
  });

  it('lève ExportSubjectNotFoundError si aucune résa et aucun consent', async () => {
    (prisma.reservation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.customerConsent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await expect(service.exportSubject({ subject: '+336****0000' })).rejects.toBeInstanceOf(
      ExportSubjectNotFoundError,
    );
  });

  it('export les résas triées desc par date avec profil de la première résa', async () => {
    const future = new Date('2026-07-15T19:00:00Z');
    (prisma.reservation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'res-1',
        restaurantId: 'rest-1',
        startsAt: future,
        endsAt: future,
        partySize: 4,
        state: 'CONFIRMED',
        channel: 'PHONE',
        customerName: 'Alice',
        customerPhone: '+336****1111',
        specialRequests: 'Allergie gluten',
        createdAt: new Date('2026-07-01T10:00:00Z'),
        restaurant: { name: 'Chez Sokar' },
      },
    ]);
    (prisma.customerConsent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await service.exportSubject({ subject: '+336****1111' });

    expect(result.reservations).toHaveLength(1);
    expect(result.reservations[0]).toMatchObject({
      id: 'res-1',
      restaurantName: 'Chez Sokar',
      partySize: 4,
      customerName: 'Alice',
    });
    // Le profile vient de la première résa
    expect(result.profile).toEqual({
      customerName: 'Alice',
      customerPhone: '+336****1111',
      customerEmail: null,
    });
  });

  it('export les consents avec privacy policy version', async () => {
    (prisma.reservation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.customerConsent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'c-1',
        restaurantId: 'rest-1',
        channel: 'MCP',
        context: 'openai_reserve',
        reservationProcessing: true,
        transactionalSms: false,
        transactionalEmail: false,
        marketingOptIn: true,
        privacyPolicyVersion: '2026-01-01',
        consentedAt: new Date('2026-06-15T10:00:00Z'),
      },
    ]);

    const result = await service.exportSubject({ subject: '+336****2222' });

    expect(result.consents).toHaveLength(1);
    expect(result.consents[0]).toMatchObject({
      id: 'c-1',
      channel: 'MCP',
      marketingOptIn: true,
    });
  });

  it("profile est null si le sujet n'a aucune résa (mais a des consents)", async () => {
    (prisma.reservation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.customerConsent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'c-1',
        restaurantId: 'rest-1',
        channel: 'WEB',
        context: 'web_form',
        reservationProcessing: true,
        transactionalSms: false,
        transactionalEmail: false,
        marketingOptIn: false,
        privacyPolicyVersion: '2026-01-01',
        consentedAt: new Date(),
      },
    ]);

    const result = await service.exportSubject({ subject: '+336****3333' });

    expect(result.profile).toBeNull();
    expect(result.consents).toHaveLength(1);
  });

  it("retourne le hash prefix (8 premiers chars hex) et le timestamp d'export", async () => {
    (prisma.reservation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'res-1',
        restaurantId: 'rest-1',
        startsAt: new Date('2026-07-01'),
        endsAt: new Date('2026-07-01'),
        partySize: 2,
        state: 'CONFIRMED',
        channel: 'PHONE',
        customerName: 'X',
        customerPhone: '+336****9999',
        specialRequests: null,
        createdAt: new Date('2026-06-15'),
        restaurant: { name: 'Resto' },
      },
    ]);
    (prisma.customerConsent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await service.exportSubject({ subject: '+336****9999' });

    expect(result.subject.hashPrefix).toMatch(/^[0-9a-f]{8}$/);
    expect(result.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.privacyPolicyVersion).toMatch(/.+/);
  });
});
