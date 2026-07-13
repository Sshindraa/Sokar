/**
 * Tests for reply-handler.ts — parseReply + handleReply.
 *
 * parseReply est une fonction pure (déjà couverte partiellement par
 * sms-reply-parser.test.ts, on la re-teste ici via l'API exportée).
 * handleReply orchestre : DB lookup → confirmation / annulation → SMS gérant.
 *
 * Toutes les deps externes (db, sendSms, ReservationService, logger) sont mockées.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../../shared/db/client', () => ({
  db: {
    reservation: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../../shared/telnyx/client', () => ({
  sendSms: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../reservations/reservation.service', () => ({
  ReservationService: {
    update: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../shared/logger/pino', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));

// ── Imports under test ─────────────────────────────────────────────────────

import { parseReply, handleReply } from '../reply-handler';
import { db } from '../../../shared/db/client';
import { sendSms } from '../../../shared/telnyx/client';
import { ReservationService } from '../../reservations/reservation.service';

const mockFindFirst = vi.mocked(db.reservation.findFirst);
const mockUpdate = vi.mocked(db.reservation.update);
const mockSendSms = vi.mocked(sendSms);
const mockReservationUpdate = vi.mocked(ReservationService.update);

// ── Helpers ────────────────────────────────────────────────────────────────

function makeReservation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'res-1',
    customerPhone: '+336****0001',
    customerName: 'Jean Dupont',
    partySize: 4,
    reservedAt: new Date('2026-07-15T19:30:00+02:00'),
    status: 'CONFIRMED',
    confirmationStatus: 'PENDING',
    restaurantId: 'rest-1',
    restaurant: {
      id: 'rest-1',
      name: 'Chez Sokar',
      managerPhone: '+336****9999',
    },
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('parseReply', () => {
  it('parse une réponse positive (OUI)', () => {
    expect(parseReply('OUI')).toBe('CONFIRMED');
  });

  it('parse une réponse positive (ok)', () => {
    expect(parseReply('ok')).toBe('CONFIRMED');
  });

  it('parse une réponse négative (NON)', () => {
    expect(parseReply('NON')).toBe('CANCELLED');
  });

  it('parse une réponse négative (annulation)', () => {
    expect(parseReply('annulation')).toBe('CANCELLED');
  });

  it('retourne UNKNOWN pour un texte non reconnu', () => {
    expect(parseReply('bonjour')).toBe('UNKNOWN');
  });

  it('retourne UNKNOWN pour une chaîne vide', () => {
    expect(parseReply('')).toBe('UNKNOWN');
  });

  it('trim les espaces avant de parser', () => {
    expect(parseReply('  OUI  ')).toBe('CONFIRMED');
  });
});

describe('handleReply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retourne UNKNOWN sans chercher en DB si le texte est non reconnu', async () => {
    const result = await handleReply('+336****0001', 'bonjour', 'sms');
    expect(result.intent).toBe('UNKNOWN');
    expect(result.action).toBeUndefined();
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it('retourne no_reservation si aucune résa PENDING trouvée', async () => {
    mockFindFirst.mockResolvedValue(null);

    const result = await handleReply('+336****0001', 'OUI', 'sms');

    expect(result.intent).toBe('CONFIRMED');
    expect(result.action).toBe('no_reservation');
    expect(mockFindFirst).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('confirme la résa et met à jour confirmationStatus=CONFIRMED', async () => {
    mockFindFirst.mockResolvedValue(
      makeReservation() as unknown as Awaited<ReturnType<typeof db.reservation.findFirst>>,
    );

    const result = await handleReply('+336****0001', 'OUI', 'sms');

    expect(result.intent).toBe('CONFIRMED');
    expect(result.action).toBe('confirmed');
    expect(result.reservationId).toBe('res-1');
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: {
        confirmationStatus: 'CONFIRMED',
        confirmedAt: expect.any(Date),
      },
    });
    // Pas d'envoi de SMS au gérant sur confirmation
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it('annule la résa via ReservationService.update et envoie un SMS au gérant', async () => {
    mockFindFirst.mockResolvedValue(
      makeReservation() as unknown as Awaited<ReturnType<typeof db.reservation.findFirst>>,
    );

    const result = await handleReply('+336****0001', 'NON', 'sms');

    expect(result.intent).toBe('CANCELLED');
    expect(result.action).toBe('cancelled');
    expect(result.reservationId).toBe('res-1');

    expect(mockReservationUpdate).toHaveBeenCalledWith('res-1', 'rest-1', {
      status: 'CANCELLED',
    });
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: {
        confirmationStatus: 'CANCELLED',
        confirmedAt: expect.any(Date),
      },
    });
    expect(mockSendSms).toHaveBeenCalledTimes(1);
    expect(mockSendSms).toHaveBeenCalledWith(
      '+336****9999',
      expect.stringContaining('Table libérée'),
    );
  });

  it('mentionne WhatsApp dans le SMS au gérant si channel=whatsapp', async () => {
    mockFindFirst.mockResolvedValue(
      makeReservation() as unknown as Awaited<ReturnType<typeof db.reservation.findFirst>>,
    );

    await handleReply('+336****0001', 'NON', 'whatsapp');

    expect(mockSendSms).toHaveBeenCalledWith('+336****9999', expect.stringContaining('WhatsApp'));
  });

  it("n'envoie pas de SMS au gérant si managerPhone est null", async () => {
    mockFindFirst.mockResolvedValue(
      makeReservation({
        restaurant: { id: 'rest-1', name: 'Chez Sokar', managerPhone: null },
      }) as unknown as Awaited<ReturnType<typeof db.reservation.findFirst>>,
    );

    const result = await handleReply('+336****0001', 'NON', 'sms');

    expect(result.action).toBe('cancelled');
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it("retourne l'intent sans action si ReservationService.update lève une erreur", async () => {
    mockFindFirst.mockResolvedValue(
      makeReservation() as unknown as Awaited<ReturnType<typeof db.reservation.findFirst>>,
    );
    mockReservationUpdate.mockRejectedValue(new Error('DB down'));

    const result = await handleReply('+336****0001', 'NON', 'sms');

    expect(result.intent).toBe('CANCELLED');
    expect(result.action).toBeUndefined();
    expect(result.reservationId).toBe('res-1');
  });

  it('filtre par customerPhone, status=CONFIRMED et confirmationStatus=PENDING', async () => {
    mockFindFirst.mockResolvedValue(null);

    await handleReply('+336****0001', 'OUI', 'sms');

    const callArg = mockFindFirst.mock.calls[0][0]!;
    const reservedAt = callArg.where!.reservedAt as { gte: Date; lte: Date };
    expect(callArg.where!.customerPhone).toBe('+336****0001');
    expect(callArg.where!.status).toBe('CONFIRMED');
    expect(callArg.where!.confirmationStatus).toBe('PENDING');
    expect(reservedAt).toBeDefined();
    expect(reservedAt.gte).toBeInstanceOf(Date);
    expect(reservedAt.lte).toBeInstanceOf(Date);
    expect(callArg.include!.restaurant).toEqual({
      select: { id: true, name: true, managerPhone: true },
    });
  });

  it('la fenêtre de recherche couvre [hier 00:00, J+1 23:59]', async () => {
    mockFindFirst.mockResolvedValue(null);

    const now = new Date();
    await handleReply('+336****0001', 'OUI', 'sms');

    const callArg = mockFindFirst.mock.calls[0][0]!;
    const reservedAt = callArg.where!.reservedAt as { gte: Date; lte: Date };
    const gte = reservedAt.gte;
    const lte = reservedAt.lte;

    // gte = hier 00:00
    expect(gte.getHours()).toBe(0);
    expect(gte.getMinutes()).toBe(0);
    const expectedGteDate = new Date(now);
    expectedGteDate.setDate(expectedGteDate.getDate() - 1);
    expect(gte.getDate()).toBe(expectedGteDate.getDate());

    // lte = demain 23:59
    expect(lte.getHours()).toBe(23);
    expect(lte.getMinutes()).toBe(59);
    const expectedLteDate = new Date(now);
    expectedLteDate.setDate(expectedLteDate.getDate() + 1);
    expect(lte.getDate()).toBe(expectedLteDate.getDate());
  });
});
