/**
 * Tests complémentaires pour CallSessionManager.
 *
 * manager.integration.test.ts couvre déjà : lifecycle, state machine de base,
 * mock LLM, barge-in, cleanup, transcript accumulation.
 *
 * Ce fichier couvre ce qui n'est PAS testé par l'integration test :
 *  - Singleton pattern & get/delete edge cases
 *  - create() avec overrides (giftCardMinimumAmount, personality)
 *  - State machine : transitions invalides rejetées
 *  - executeTool() via callLlm avec fetch mocké (tous les outils)
 *  - processUtteranceStreaming (SSE parsing basique)
 *  - cleanup ferme le WS Deepgram s'il est OPEN
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import {
  CallSessionManager,
  isSafeVoiceNameMatch,
  _resetCircuitBreakersForTesting,
} from '../stream/manager';
import type { CallSession, ChatMessage } from '../stream/types';
import type { getRestaurantTools } from '../tools';

// ── Module mocks ───────────────────────────────────────────────────────────

vi.mock('../../reservations/reservation.service', () => ({
  ReservationService: {
    create: vi.fn(),
    update: vi.fn(),
    availability: vi.fn(),
  },
}));

vi.mock('../../../shared/db/client', () => ({
  db: {
    restaurant: {
      findUnique: vi.fn().mockResolvedValue({ timezone: 'Europe/Paris' }),
    },
    reservation: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    reservationAuditLog: {
      create: vi.fn(),
    },
    message: {
      create: vi.fn(),
    },
  },
}));

const { mockGiftCardCreate } = vi.hoisted(() => ({
  mockGiftCardCreate: vi.fn().mockResolvedValue({ id: 'gc-1', code: 'SKR-ABC123' }),
}));

vi.mock('../../gift-cards/gift-card.service', () => ({
  GiftCardService: vi.fn().mockImplementation(function (
    this: Record<string, unknown>,
    db: unknown,
  ) {
    this.create = mockGiftCardCreate;
  }),
}));

vi.mock('../../gift-cards/gift-card-recommender', () => ({
  recommendGiftCardAmount: vi.fn().mockReturnValue({
    amount: 50,
    messageSuggestion: 'Un beau cadeau !',
  }),
}));

vi.mock('../../../shared/telnyx/client', () => ({
  sendSms: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../analytics/events.service', () => ({
  trackGiftCardEvent: vi.fn().mockResolvedValue(undefined),
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

import { ReservationService } from '../../reservations/reservation.service';
import { db } from '../../../shared/db/client';
import { GiftCardService } from '../../gift-cards/gift-card.service';
import { recommendGiftCardAmount } from '../../gift-cards/gift-card-recommender';
import { sendSms } from '../../../shared/telnyx/client';
import { trackGiftCardEvent } from '../../analytics/events.service';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTelnyxWs(): WebSocket {
  return {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
    OPEN: WebSocket.OPEN,
    CLOSED: WebSocket.CLOSED,
  } as unknown as WebSocket;
}

function makeSession(overrides: Partial<CallSession> = {}): CallSession {
  const mgr = CallSessionManager.getInstance();
  return mgr.create({
    callControlId: overrides.callControlId ?? 'cc-test-1',
    callSessionId: 'cs-test-1',
    from: '+33****0001',
    to: '+33****0000',
    restaurantId: 'rest-1',
    restaurantName: 'Test Resto',
    systemPrompt: "Tu es l'assistant vocal de Test Resto.",
    isVip: false,
    telnyxWs: overrides.telnyxWs ?? makeTelnyxWs(),
    callLegId: 'leg-test-1',
    codec: 'PCMA',
    giftCardMinimumAmount: overrides.giftCardMinimumAmount,
    personality: overrides.personality,
  });
}

/** Mock fetch pour retourner d'abord un tool_call, puis une réponse texte. */
function mockFetchToolCall(toolName: string, args: Record<string, unknown>, finalText: string) {
  const fetchMock = vi.fn();
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call-1',
                type: 'function',
                function: { name: toolName, arguments: JSON.stringify(args) },
              },
            ],
          },
        },
      ],
    }),
  });
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: vi.fn().mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: finalText } }],
    }),
  });
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  return fetchMock;
}

/** Mock fetch pour une réponse texte directe (pas de tool call). */
function mockFetchText(text: string) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: text } }],
    }),
  });
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  return fetchMock;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('CallSessionManager — singleton & CRUD', () => {
  beforeEach(() => {
    (CallSessionManager as unknown as { instance: CallSessionManager }).instance =
      new CallSessionManager();
    delete process.env.SOKAR_SIMULATE_MOCK_LLM;
  });

  it('getInstance retourne la même instance (singleton)', () => {
    const a = CallSessionManager.getInstance();
    const b = CallSessionManager.getInstance();
    expect(a).toBe(b);
  });

  it('get retourne undefined pour un callControlId inconnu', () => {
    const mgr = CallSessionManager.getInstance();
    expect(mgr.get('unknown-cc-id')).toBeUndefined();
  });

  it("delete est un no-op si la session n'existe pas", () => {
    const mgr = CallSessionManager.getInstance();
    expect(() => mgr.delete('nonexistent')).not.toThrow();
  });

  it('create puis get retourne la session avec les bonnes valeurs', () => {
    const mgr = CallSessionManager.getInstance();
    const session = makeSession({ callControlId: 'cc-crud-1' });

    expect(mgr.get('cc-crud-1')).toBe(session);
    expect(session.restaurantName).toBe('Test Resto');
    expect(session.state).toBe('IDLE');
    expect(session.history).toHaveLength(2);
    expect(session.history[0].role).toBe('system');
    expect(session.history[1].role).toBe('assistant');
    expect(session.history[1].content).toBe('Bonjour, Test Resto !');
  });

  it('create utilise giftCardMinimumAmount=10 par défaut', () => {
    const session = makeSession();
    expect(session.giftCardMinimumAmount).toBe(10);
  });

  it('create respecte giftCardMinimumAmount personnalisé', () => {
    const session = makeSession({ giftCardMinimumAmount: 25 });
    expect(session.giftCardMinimumAmount).toBe(25);
  });

  it('create assigne personality=null par défaut', () => {
    const session = makeSession();
    expect(session.personality).toBeNull();
  });

  it('create respecte personality personnalisée', () => {
    const personality = { fillerStyle: 'WARM' as const, systemPromptExtra: 'Soyez chaleureux.' };
    const session = makeSession({ personality });
    expect(session.personality).toEqual(personality);
  });

  it('delete supprime la session du Map', () => {
    const mgr = CallSessionManager.getInstance();
    makeSession({ callControlId: 'cc-del-1' });
    expect(mgr.get('cc-del-1')).toBeDefined();

    mgr.delete('cc-del-1');
    expect(mgr.get('cc-del-1')).toBeUndefined();
  });
});

describe('CallSessionManager — state machine edge cases', () => {
  beforeEach(() => {
    (CallSessionManager as unknown as { instance: CallSessionManager }).instance =
      new CallSessionManager();
  });

  it('rejette IDLE → PROCESSING (transition invalide)', () => {
    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    expect(mgr.transition(session, 'PROCESSING')).toBe(false);
    expect(session.state).toBe('IDLE');
  });

  it('rejette LISTENING → SPEAKING (transition invalide)', () => {
    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    mgr.transition(session, 'LISTENING');
    expect(mgr.transition(session, 'SPEAKING')).toBe(false);
    expect(session.state).toBe('LISTENING');
  });

  it('rejette SPEAKING → PROCESSING (transition invalide)', () => {
    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    mgr.transition(session, 'SPEAKING');
    expect(mgr.transition(session, 'PROCESSING')).toBe(false);
    expect(session.state).toBe('SPEAKING');
  });

  it('accepte PROCESSING → LISTENING (annulation)', () => {
    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    mgr.transition(session, 'LISTENING');
    mgr.transition(session, 'PROCESSING');
    expect(mgr.transition(session, 'LISTENING')).toBe(true);
    expect(session.state).toBe('LISTENING');
  });

  it('accepte PROCESSING → IDLE (reset)', () => {
    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    mgr.transition(session, 'LISTENING');
    mgr.transition(session, 'PROCESSING');
    expect(mgr.transition(session, 'IDLE')).toBe(true);
    expect(session.state).toBe('IDLE');
  });

  it('met à jour lastActivityAt sur chaque transition valide', () => {
    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    const before = session.lastActivityAt;
    // Force a small delay
    session.lastActivityAt = before - 1000;
    mgr.transition(session, 'LISTENING');
    expect(session.lastActivityAt).toBeGreaterThan(before - 1000);
  });
});

describe('CallSessionManager — tool execution', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    (CallSessionManager as unknown as { instance: CallSessionManager }).instance =
      new CallSessionManager();
    delete process.env.SOKAR_SIMULATE_MOCK_LLM;
    originalFetch = globalThis.fetch;
    vi.clearAllMocks();
    // Re-set the mock implementation after clearAllMocks
    mockGiftCardCreate.mockResolvedValue({ id: 'gc-1', code: 'SKR-ABC123' });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('createReservation : appelle ReservationService.create et retourne la confirmation', async () => {
    vi.mocked(ReservationService.create).mockResolvedValue({ id: 'res-new' } as unknown as Awaited<
      ReturnType<typeof ReservationService.create>
    >);
    mockFetchToolCall(
      'createReservation',
      {
        date: '2026-07-16',
        time: '19:30',
        partySize: 2,
        customerName: 'Jean',
        customerPhone: '+33****0001',
      },
      "Parfait, c'est noté.",
    );

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    const reply = await mgr.processUtterance(session, 'Je voudrais réserver');

    expect(ReservationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: 'rest-1',
        callId: 'leg-test-1',
        partySize: 2,
        customerName: 'Jean',
        customerPhone: '+33****0001',
      }),
    );
    expect(reply).toBe("Parfait, c'est noté.");
  });

  it('createReservation : retourne message de créneau indisponible si SLOT_NOT_AVAILABLE', async () => {
    vi.mocked(ReservationService.create).mockRejectedValue(new Error('SLOT_NOT_AVAILABLE'));
    mockFetchToolCall(
      'createReservation',
      { date: '2026-07-16', time: '12:00', partySize: 4, customerName: 'Marie' },
      'Désolé pour le désagrément.',
    );

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    const reply = await mgr.processUtterance(session, 'Réserver pour 4');

    // Le tool result contient le message de créneau indisponible,
    // puis le LLM produit une réponse finale.
    expect(reply).toBe('Désolé pour le désagrément.');
    expect(ReservationService.create).toHaveBeenCalled();
  });

  it('checkAvailability : retourne les créneaux disponibles', async () => {
    vi.mocked(ReservationService.availability).mockResolvedValue({
      slots: ['12:00', '12:30', '13:00', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30'],
    } as unknown as Awaited<ReturnType<typeof ReservationService.availability>>);
    mockFetchToolCall(
      'checkAvailability',
      { date: '2026-07-16', partySize: 2 },
      'Voici les créneaux disponibles.',
    );

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    const reply = await mgr.processUtterance(session, "C'est disponible ?");

    expect(ReservationService.availability).toHaveBeenCalledWith('rest-1', '2026-07-16', 2);
    expect(reply).toBe('Voici les créneaux disponibles.');
  });

  it('checkAvailability : vérifie le créneau exact demandé', async () => {
    vi.mocked(ReservationService.availability).mockResolvedValue({
      slots: ['19:30', '20:00', '20:30'],
    } as unknown as Awaited<ReturnType<typeof ReservationService.availability>>);
    mockFetchToolCall(
      'checkAvailability',
      { date: '2026-07-16', partySize: 2, time: '20:00' },
      'Très bien, quel est votre nom ?',
    );

    const mgr = CallSessionManager.getInstance();
    const reply = await mgr.processUtterance(makeSession(), 'Demain à 20 heures pour deux');

    expect(ReservationService.availability).toHaveBeenCalledWith('rest-1', '2026-07-16', 2);
    expect(reply).toBe('Très bien, quel est votre nom ?');
  });

  it('checkAvailability : retourne message si aucun créneau', async () => {
    vi.mocked(ReservationService.availability).mockResolvedValue({
      slots: [],
    } as unknown as Awaited<ReturnType<typeof ReservationService.availability>>);
    mockFetchToolCall(
      'checkAvailability',
      { date: '2026-07-16', partySize: 6 },
      'Malheureusement complet.',
    );

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    await mgr.processUtterance(session, 'Dispo pour 6 ?');

    expect(ReservationService.availability).toHaveBeenCalledWith('rest-1', '2026-07-16', 6);
  });

  it('cancelReservation : single match avec nom sûr → annule', async () => {
    vi.mocked(db.reservation.findMany).mockResolvedValue([
      {
        id: 'res-cancel-1',
        customerName: 'Jean Dupont',
        customerPhone: null,
        reservedAt: new Date('2026-07-16T19:30:00'),
      } as unknown as Awaited<ReturnType<typeof db.reservation.findMany>>[number],
    ]);
    mockFetchToolCall(
      'cancelReservation',
      { customerName: 'Jean Dupont', date: '2026-07-16' },
      "C'est annulé.",
    );

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    await mgr.processUtterance(session, 'Annuler ma résa');

    expect(db.reservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          restaurantId: 'rest-1',
          customerName: { contains: 'Jean Dupont', mode: 'insensitive' },
          status: 'CONFIRMED',
        }),
      }),
    );
    expect(ReservationService.update).toHaveBeenCalledWith('res-cancel-1', 'rest-1', {
      status: 'CANCELLED',
    });
  });

  it('cancelReservation : retourne message si aucune résa trouvée', async () => {
    vi.mocked(db.reservation.findMany).mockResolvedValue([]);
    mockFetchToolCall(
      'cancelReservation',
      { customerName: 'Inconnu', date: '2026-07-16' },
      'Désolé, pas de résa.',
    );

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    await mgr.processUtterance(session, 'Annuler');

    expect(ReservationService.update).not.toHaveBeenCalled();
  });

  it('cancelReservation : transfère au gérant si plusieurs réservations au même nom (ambiguïté)', async () => {
    vi.mocked(db.reservation.findMany).mockResolvedValue([
      {
        id: 'res-amb-1',
        customerName: 'Jean Dupont',
        customerPhone: '+33****0099',
        reservedAt: new Date('2026-07-16T19:30:00Z'),
      },
      {
        id: 'res-amb-2',
        customerName: 'Jean Dupont',
        customerPhone: '+33****0088',
        reservedAt: new Date('2026-07-16T20:00:00Z'),
      },
    ] as unknown as Awaited<ReturnType<typeof db.reservation.findMany>>);
    mockFetchToolCall(
      'cancelReservation',
      { customerName: 'Jean Dupont', date: '2026-07-16' },
      'Annule ma résa.',
    );

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    await mgr.processUtterance(session, 'Annuler ma résa');

    // Ambiguïté non résolue → PAS d'annulation (handoff au gérant côté tool).
    expect(ReservationService.update).not.toHaveBeenCalled();
  });

  it('cancelReservation : résout par téléphone appelant si plusieurs réservations au même nom', async () => {
    vi.mocked(db.reservation.findMany).mockResolvedValue([
      {
        id: 'res-phone-1',
        customerName: 'Jean Dupont',
        customerPhone: '+33****0001',
        reservedAt: new Date('2026-07-16T19:30:00Z'),
      },
      {
        id: 'res-phone-2',
        customerName: 'Jean Dupont',
        customerPhone: '+33****0002',
        reservedAt: new Date('2026-07-16T20:00:00Z'),
      },
    ] as unknown as Awaited<ReturnType<typeof db.reservation.findMany>>);
    mockFetchToolCall(
      'cancelReservation',
      { customerName: 'Jean Dupont', date: '2026-07-16' },
      'Annule ma résa.',
    );

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    await mgr.processUtterance(session, 'Annuler ma résa');

    expect(ReservationService.update).toHaveBeenCalledWith('res-phone-1', 'rest-1', {
      status: 'CANCELLED',
    });
  });

  it('cancelReservation : résout par heure si fournie et téléphone ne matche pas', async () => {
    vi.mocked(db.reservation.findMany).mockResolvedValue([
      {
        id: 'res-time-1',
        customerName: 'Jean Dupont',
        customerPhone: '+33****0099',
        // 19:30 Paris (UTC+2 été) = 17:30 UTC
        reservedAt: new Date('2026-07-16T17:30:00Z'),
      },
      {
        id: 'res-time-2',
        customerName: 'Jean Dupont',
        customerPhone: '+33****0088',
        // 20:00 Paris (UTC+2 été) = 18:00 UTC
        reservedAt: new Date('2026-07-16T18:00:00Z'),
      },
    ] as unknown as Awaited<ReturnType<typeof db.reservation.findMany>>);
    mockFetchToolCall(
      'cancelReservation',
      { customerName: 'Jean Dupont', date: '2026-07-16', time: '19:30' },
      'Annule ma résa de 19h30.',
    );

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    await mgr.processUtterance(session, 'Annuler ma résa de 19h30');

    expect(ReservationService.update).toHaveBeenCalledWith('res-time-1', 'rest-1', {
      status: 'CANCELLED',
    });
  });

  it('cancelReservation : transfère si heure fournie mais plusieurs réservations à cette heure', async () => {
    vi.mocked(db.reservation.findMany).mockResolvedValue([
      {
        id: 'res-same-1',
        customerName: 'Jean Dupont',
        customerPhone: '+33****0099',
        // 19:30 Paris (UTC+2 été) = 17:30 UTC
        reservedAt: new Date('2026-07-16T17:30:00Z'),
      },
      {
        id: 'res-same-2',
        customerName: 'Jean Dupont',
        customerPhone: '+33****0088',
        // 19:30 Paris (UTC+2 été) = 17:30 UTC
        reservedAt: new Date('2026-07-16T17:30:00Z'),
      },
    ] as unknown as Awaited<ReturnType<typeof db.reservation.findMany>>);
    mockFetchToolCall(
      'cancelReservation',
      { customerName: 'Jean Dupont', date: '2026-07-16', time: '19:30' },
      'Annule ma résa de 19h30.',
    );

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    await mgr.processUtterance(session, 'Annuler ma résa de 19h30');

    // Plusieurs réservations à la même heure → ambiguïté, PAS d'annulation.
    expect(ReservationService.update).not.toHaveBeenCalled();
  });

  it('cancelReservation : résout par nom sûr si téléphone ne matche pas', async () => {
    vi.mocked(db.reservation.findMany).mockResolvedValue([
      {
        id: 'res-safename-1',
        customerName: 'Jean Dupont',
        customerPhone: '+33****0099',
        reservedAt: new Date('2026-07-16T17:30:00Z'),
      },
      {
        id: 'res-safename-2',
        customerName: 'Jean Martin',
        customerPhone: '+33****0088',
        reservedAt: new Date('2026-07-16T18:00:00Z'),
      },
    ] as unknown as Awaited<ReturnType<typeof db.reservation.findMany>>);
    mockFetchToolCall(
      'cancelReservation',
      { customerName: 'Jean Dupont', date: '2026-07-16' },
      'Annule ma résa.',
    );

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    await mgr.processUtterance(session, 'Annuler ma résa');

    expect(ReservationService.update).toHaveBeenCalledWith('res-safename-1', 'rest-1', {
      status: 'CANCELLED',
    });
  });

  it('cancelReservation : single match mais nom ne correspond pas sûrement → transfert', async () => {
    vi.mocked(db.reservation.findMany).mockResolvedValue([
      {
        id: 'res-unsafe-1',
        customerName: 'Jean Dupont',
        customerPhone: null,
        reservedAt: new Date('2026-07-16T17:30:00Z'),
      } as unknown as Awaited<ReturnType<typeof db.reservation.findMany>>[number],
    ]);
    mockFetchToolCall(
      'cancelReservation',
      { customerName: 'Jean', date: '2026-07-16' },
      'Annule ma résa.',
    );

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    await mgr.processUtterance(session, 'Annuler ma résa');

    // "Jean" = 1 token → isSafeVoiceNameMatch retourne false → transfert, PAS d'annulation.
    expect(ReservationService.update).not.toHaveBeenCalled();
  });

  it('cancelReservation : tous les customerPhone null → pas de faux match téléphone', async () => {
    vi.mocked(db.reservation.findMany).mockResolvedValue([
      {
        id: 'res-nullphone-1',
        customerName: 'Jean Dupont',
        customerPhone: null,
        reservedAt: new Date('2026-07-16T17:30:00Z'),
      },
      {
        id: 'res-nullphone-2',
        customerName: 'Jean Dupont',
        customerPhone: null,
        reservedAt: new Date('2026-07-16T18:00:00Z'),
      },
    ] as unknown as Awaited<ReturnType<typeof db.reservation.findMany>>);
    mockFetchToolCall(
      'cancelReservation',
      { customerName: 'Jean Dupont', date: '2026-07-16' },
      'Annule ma résa.',
    );

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    await mgr.processUtterance(session, 'Annuler ma résa');

    // normalizeVoicePhone(null) → "" ≠ "330001" → pas de match téléphone.
    // Pas d'heure fournie → ambigu → transfert, PAS d'annulation.
    expect(ReservationService.update).not.toHaveBeenCalled();
  });

  it('cancelReservation : résout par heure avec timezone restaurant', async () => {
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({
      timezone: 'Europe/Paris',
    } as unknown as Awaited<ReturnType<typeof db.restaurant.findUnique>>);
    vi.mocked(db.reservation.findMany).mockResolvedValue([
      {
        id: 'res-tz-1',
        customerName: 'Jean Dupont',
        customerPhone: '+33****0099',
        // 19:30 Paris (UTC+2 été) = 17:30 UTC
        reservedAt: new Date('2026-07-16T17:30:00Z'),
      },
      {
        id: 'res-tz-2',
        customerName: 'Jean Dupont',
        customerPhone: '+33****0088',
        // 20:00 Paris (UTC+2 été) = 18:00 UTC
        reservedAt: new Date('2026-07-16T18:00:00Z'),
      },
    ] as unknown as Awaited<ReturnType<typeof db.reservation.findMany>>);
    mockFetchToolCall(
      'cancelReservation',
      { customerName: 'Jean Dupont', date: '2026-07-16', time: '19:30' },
      'Annule ma résa de 19h30.',
    );

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    await mgr.processUtterance(session, 'Annuler ma résa de 19h30');

    expect(db.restaurant.findUnique).toHaveBeenCalledWith({
      where: { id: 'rest-1' },
      select: { timezone: true },
    });
    expect(ReservationService.update).toHaveBeenCalledWith('res-tz-1', 'rest-1', {
      status: 'CANCELLED',
    });
  });

  it('takeMessage : enregistre le message en DB', async () => {
    vi.mocked(db.message.create).mockResolvedValue({ id: 'msg-1' } as unknown as Awaited<
      ReturnType<typeof db.message.create>
    >);
    mockFetchToolCall(
      'takeMessage',
      { customerName: 'Paul', message: 'Rappelez-moi', callbackPhone: '+33****0001' },
      'Message noté, au revoir.',
    );

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    await mgr.processUtterance(session, 'Laissez un message');

    expect(db.message.create).toHaveBeenCalledWith({
      data: {
        restaurantId: 'rest-1',
        callId: 'leg-test-1',
        customerName: 'Paul',
        customerPhone: '+33****0001',
        content: 'Rappelez-moi',
        status: 'PENDING',
      },
    });
  });

  it('reportDelay : audite le retard sans modifier la réservation', async () => {
    vi.mocked(db.reservation.findFirst).mockResolvedValue({ id: 'res-delay-1' } as never);
    mockFetchToolCall(
      'reportDelay',
      { customerName: 'Jean', date: '2026-07-16', time: '19:30', delayMinutes: 20 },
      'Merci, c’est noté.',
    );

    const mgr = CallSessionManager.getInstance();
    await mgr.processUtterance(makeSession(), 'Nous aurons vingt minutes de retard');

    expect(db.reservationAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event: 'reservation_delay_reported',
          reservationId: 'res-delay-1',
          correlationId: 'leg-test-1',
          metadata: { delayMinutes: 20, source: 'voice' },
        }),
      }),
    );
    expect(db.reservation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ startsAt: new Date('2026-07-16T17:30:00.000Z') }),
      }),
    );
    expect(ReservationService.update).not.toHaveBeenCalled();
  });

  it('reportDelay : résout une variation STT unique sur le créneau exact', async () => {
    vi.mocked(db.reservation.findFirst).mockResolvedValue(null);
    vi.mocked(db.reservation.findMany).mockResolvedValue([
      {
        id: 'res-delay-martin',
        customerName: 'Martin Test Copilot',
        customerPhone: '+33900000001',
      },
      {
        id: 'res-delay-alice',
        customerName: 'Alice Test Copilot',
        customerPhone: '+33900000002',
      },
    ] as never);
    mockFetchToolCall(
      'reportDelay',
      {
        customerName: 'Martin copilote',
        date: '2026-07-23',
        time: '19:30',
        delayMinutes: 25,
      },
      'Merci, c’est noté.',
    );

    const mgr = CallSessionManager.getInstance();
    await mgr.processUtterance(makeSession(), 'Nous aurons vingt-cinq minutes de retard');

    expect(db.reservationAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event: 'reservation_delay_reported',
          reservationId: 'res-delay-martin',
          metadata: { delayMinutes: 25, source: 'voice' },
        }),
      }),
    );
  });

  it('ne rapproche pas un prénom seul ni une identité ambiguë', () => {
    expect(isSafeVoiceNameMatch('Martin copilote', 'Martin Test Copilot')).toBe(true);
    expect(isSafeVoiceNameMatch('Martin', 'Martin Test Copilot')).toBe(false);
    expect(isSafeVoiceNameMatch('Martin Durand', 'Martin Test Copilot')).toBe(false);
  });

  it('handoffToManager : retourne le message de transfert', async () => {
    mockFetchToolCall('handoffToManager', {}, 'Je vous transfère.');
    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    await mgr.processUtterance(session, 'Parler au gérant');
    // handoffToManager retourne un texte fixe, pas d'effet de bord à vérifier
    expect(session.history.length).toBeGreaterThan(2);
  });

  it('recommendGiftCardAmount : appelle le recommender', async () => {
    mockFetchToolCall(
      'recommendGiftCardAmount',
      { occasion: 'anniversaire', partySize: 2, budget: 100 },
      'Je suggère 50€.',
    );
    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    await mgr.processUtterance(session, 'Conseil carte cadeau');

    expect(recommendGiftCardAmount).toHaveBeenCalledWith({
      occasion: 'anniversaire',
      partySize: 2,
      budget: 100,
    });
  });

  it('purchaseGiftCard : rejette si montant < minimum (10€)', async () => {
    mockFetchToolCall(
      'purchaseGiftCard',
      {
        amount: 5,
        occasion: 'anniversaire',
        senderName: 'Jean',
        senderPhone: '+33612345678',
        recipientName: 'Marie',
      },
      'Montant trop bas.',
    );
    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    await mgr.processUtterance(session, 'Carte cadeau 5€');

    // GiftCardService ne doit pas être instancié si montant < minimum
    expect(GiftCardService).not.toHaveBeenCalled();
  });

  it('purchaseGiftCard : rejette si numéro de téléphone invalide', async () => {
    mockFetchToolCall(
      'purchaseGiftCard',
      {
        amount: 50,
        occasion: 'anniversaire',
        senderName: 'Jean',
        senderPhone: '0612345678',
        recipientName: 'Marie',
      },
      'Numéro invalide.',
    );
    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    await mgr.processUtterance(session, 'Carte cadeau');

    expect(GiftCardService).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('purchaseGiftCard : crée la carte, envoie SMS par WhatsApp et track les events', async () => {
    mockFetchToolCall(
      'purchaseGiftCard',
      {
        amount: 50,
        occasion: 'anniversaire',
        senderName: 'Jean',
        senderPhone: '+33612345678',
        recipientName: 'Marie',
        message: 'Joyeux anniv !',
      },
      'Carte envoyée !',
    );
    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    await mgr.processUtterance(session, 'Acheter carte cadeau 50€');

    expect(GiftCardService).toHaveBeenCalledWith(db);
    expect(trackGiftCardEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'gift_card_purchase_started',
        restaurantId: 'rest-1',
        source: 'voice',
        amount: 50,
      }),
    );
    expect(sendSms).toHaveBeenCalledWith('+33612345678', expect.stringContaining('SKR-ABC123'));
    expect(trackGiftCardEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'gift_card_purchase_completed',
        giftCardId: 'gc-1',
        amount: 50,
      }),
    );
  });

  it('outil inconnu : retourne "Outil inconnu : ..."', async () => {
    mockFetchToolCall('unknownTool', {}, 'Réponse finale.');
    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    const reply = await mgr.processUtterance(session, 'Test');

    // Le tool result "Outil inconnu" est passé au LLM qui produit une réponse finale
    expect(reply).toBe('Réponse finale.');
  });
});

describe('CallSessionManager — processUtteranceStreaming', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    (CallSessionManager as unknown as { instance: CallSessionManager }).instance =
      new CallSessionManager();
    delete process.env.SOKAR_SIMULATE_MOCK_LLM;
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('parse un stream SSE et yield les phrases via onPhrase', async () => {
    // Construire un stream SSE simulé avec des tokens formant 2 phrases
    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"Bonjour."}}]}\n',
      'data: {"choices":[{"delta":{"content":" Comment ça va ?"}}]}\n',
      'data: [DONE]\n',
    ];
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of sseChunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: stream,
    }) as unknown as typeof globalThis.fetch;

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    const phrases: string[] = [];

    const fullText = await mgr.processUtteranceStreaming(session, 'Salut', (phrase) => {
      phrases.push(phrase);
    });

    expect(fullText).toContain('Bonjour');
    expect(fullText).toContain('Comment ça va');
    expect(phrases.length).toBeGreaterThanOrEqual(1);
    expect(session.state).toBe('SPEAKING');
    expect(session.turnCount).toBe(1);
  });

  it('reconstruit un tool_call depuis le stream sans réémission non-streaming', async () => {
    // Round 0 — streaming fetch : accumulate les deltas de tool_call
    const sseWithToolCall = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tc-1","type":"function","function":{"name":"handoffToManager","arguments":""}}]}}]}\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]}}]}\n',
      'data: [DONE]\n',
    ];
    const encoder = new TextEncoder();
    const streamWithToolCall = new ReadableStream({
      start(controller) {
        for (const chunk of sseWithToolCall) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    // Round 1 — streaming fetch : retourne du texte normal (pas de tool_call)
    const sseText = [
      'data: {"choices":[{"delta":{"content":"Transfert en cours."}}]}\n',
      'data: [DONE]\n',
    ];
    const streamText = new ReadableStream({
      start(controller) {
        for (const chunk of sseText) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    const fetchMock = vi.fn();
    // 1. Streaming fetch (round 0) — accumule les deltas de tool_call
    fetchMock.mockResolvedValueOnce({
      ok: true,
      body: streamWithToolCall,
    });
    // 2. Streaming fetch (round 1) — retourne du texte
    fetchMock.mockResolvedValueOnce({
      ok: true,
      body: streamText,
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    const phrases: string[] = [];

    const fullText = await mgr.processUtteranceStreaming(session, 'Parler au gérant', (phrase) => {
      phrases.push(phrase);
    });

    expect(fullText).toBe('Transfert en cours.');
    // Pas de réémission non-streaming : seulement 2 appels fetch (les 2 rounds streaming)
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reconstruit un tool_call avec arguments fragmentés depuis le stream', async () => {
    vi.mocked(ReservationService.create).mockResolvedValue({ id: 'res-new' } as unknown as Awaited<
      ReturnType<typeof ReservationService.create>
    >);

    // Round 0 — streaming fetch : tool_call createReservation avec arguments fragmentés
    const sseWithToolCall = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tc-1","type":"function","function":{"name":"createReservation","arguments":""}}]}}]}\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"date\\":\\"2026-07-16\\""}}]}}]}\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":",\\"time\\":\\"19:30\\",\\"partySize\\":2,\\"customerName\\":\\"Jean Dupont\\"}"}}]}}]}\n',
      'data: [DONE]\n',
    ];
    const encoder = new TextEncoder();
    const streamWithToolCall = new ReadableStream({
      start(controller) {
        for (const chunk of sseWithToolCall) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    // Round 1 — streaming fetch : retourne du texte normal
    const sseText = [
      'data: {"choices":[{"delta":{"content":"C\'est confirmé."}}]}\n',
      'data: [DONE]\n',
    ];
    const streamText = new ReadableStream({
      start(controller) {
        for (const chunk of sseText) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      body: streamWithToolCall,
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      body: streamText,
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    const phrases: string[] = [];

    const fullText = await mgr.processUtteranceStreaming(
      session,
      'Réserver pour demain',
      (phrase) => {
        phrases.push(phrase);
      },
    );

    expect(fullText).toBe("C'est confirmé.");
    expect(ReservationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: 'rest-1',
        callId: 'leg-test-1',
        partySize: 2,
        customerName: 'Jean Dupont',
        customerPhone: '+33****0001',
      }),
    );
    // Seulement 2 appels fetch (les 2 rounds streaming), pas de fallback non-streaming
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('préserve le texte avant et après un tool_call dans le même stream', async () => {
    // Round 0 — streaming fetch : texte, puis tool_call deltas, puis texte à nouveau
    const sseWithToolCall = [
      'data: {"choices":[{"delta":{"content":"Je vais vérifier."}}]}\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tc-1","type":"function","function":{"name":"handoffToManager","arguments":""}}]}}]}\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]}}]}\n',
      'data: {"choices":[{"delta":{"content":" Un instant."}}]}\n',
      'data: [DONE]\n',
    ];
    const encoder = new TextEncoder();
    const streamWithToolCall = new ReadableStream({
      start(controller) {
        for (const chunk of sseWithToolCall) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    // Round 1 — streaming fetch : retourne du texte normal (pas de tool_call)
    const sseText = [
      'data: {"choices":[{"delta":{"content":"Transfert en cours."}}]}\n',
      'data: [DONE]\n',
    ];
    const streamText = new ReadableStream({
      start(controller) {
        for (const chunk of sseText) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    const fetchMock = vi.fn();
    // 1. Streaming fetch (round 0) — texte + tool_call + texte
    fetchMock.mockResolvedValueOnce({
      ok: true,
      body: streamWithToolCall,
    });
    // 2. Streaming fetch (round 1) — retourne du texte
    fetchMock.mockResolvedValueOnce({
      ok: true,
      body: streamText,
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    const phrases: string[] = [];

    const fullText = await mgr.processUtteranceStreaming(session, 'Parler au gérant', (phrase) => {
      phrases.push(phrase);
    });

    // fullText est le retour du round 1 (dernier round)
    expect(fullText).toBe('Transfert en cours.');

    // Le texte du round 0 (avant et après le tool_call) est dans l'historique
    // comme contenu du message assistant avec tool_calls.
    const assistantWithToolCalls = session.history.find(
      (m) => m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0,
    );
    expect(assistantWithToolCalls).toBeDefined();
    expect(assistantWithToolCalls!.content).toContain('Je vais vérifier');
    expect(assistantWithToolCalls!.content).toContain('Un instant');

    // Seulement 2 appels fetch (les 2 rounds streaming), pas de fallback non-streaming
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // ── Mid-stream timeout fallback ────────────────────────────────────────────

  /**
   * Crée un ReadableStream qui envoie les chunks fournis puis throw une AbortError
   * sur le prochain read() (simule un timeout mid-stream).
   */
  function makeStreamThatAbortsAfter(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let i = 0;
    return new ReadableStream({
      pull(controller) {
        if (i < chunks.length) {
          controller.enqueue(encoder.encode(chunks[i]));
          i++;
        } else {
          // Simule l'AbortError propagée par AbortSignal.timeout pendant la lecture
          controller.error(new DOMException('The operation was aborted', 'AbortError'));
        }
      },
    });
  }

  /** Crée un ReadableStream normal qui envoie les chunks puis ferme. */
  function makeNormalStream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
  }

  it("mid-stream timeout : retry sur l'autre provider si aucun audio envoyé", async () => {
    process.env.VOICE_LLM_PROVIDER = 'cerebras';
    process.env.CEREBRAS_API_KEY = 'test-k1';
    process.env.OPENROUTER_API_KEY = 'test-k2';
    _resetCircuitBreakersForTesting();

    // 1er fetch (Cerebras) : stream qui abort immédiatement (aucun token envoyé)
    const abortingStream = makeStreamThatAbortsAfter([]);
    // 2e fetch (OpenRouter fallback) : stream normal avec du texte
    const retryStream = makeNormalStream([
      'data: {"choices":[{"delta":{"content":"Bonjour, ça va ?"}}]}\n',
      'data: [DONE]\n',
    ]);

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('cerebras.ai')) {
        return Promise.resolve({ ok: true, body: abortingStream });
      }
      return Promise.resolve({ ok: true, body: retryStream });
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    const phrases: string[] = [];

    const fullText = await mgr.processUtteranceStreaming(session, 'Salut', (phrase) => {
      phrases.push(phrase);
    });

    // Le texte vient du retry (OpenRouter)
    expect(fullText).toContain('Bonjour');
    // 2 appels fetch : Cerebras (abort) + OpenRouter (retry)
    expect(fetchMock).toHaveBeenCalledTimes(2);

    delete process.env.VOICE_LLM_PROVIDER;
    delete process.env.CEREBRAS_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
  });

  it('mid-stream timeout : pas de retry si audio déjà envoyé', async () => {
    process.env.VOICE_LLM_PROVIDER = 'cerebras';
    process.env.CEREBRAS_API_KEY = 'test-k1';
    process.env.OPENROUTER_API_KEY = 'test-k2';
    _resetCircuitBreakersForTesting();

    // 1er fetch (Cerebras) : stream qui envoie "Bonjour." puis abort
    const abortingStream = makeStreamThatAbortsAfter([
      'data: {"choices":[{"delta":{"content":"Bonjour."}}]}\n',
    ]);
    // 2e fetch (OpenRouter) : ne devrait PAS être appelé
    const retryStream = makeNormalStream([
      'data: {"choices":[{"delta":{"content":"Ne devrait pas être lu."}}]}\n',
      'data: [DONE]\n',
    ]);

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('cerebras.ai')) {
        return Promise.resolve({ ok: true, body: abortingStream });
      }
      return Promise.resolve({ ok: true, body: retryStream });
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    const phrases: string[] = [];

    const fullText = await mgr.processUtteranceStreaming(session, 'Salut', (phrase) => {
      phrases.push(phrase);
    });

    // Le texte partiel vient de Cerebras (avant le timeout)
    expect(fullText).toContain('Bonjour');
    // Pas de retry : seulement 1 appel fetch (Cerebras)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Une phrase a été yield avant le timeout
    expect(phrases).toContain('Bonjour.');

    delete process.env.VOICE_LLM_PROVIDER;
    delete process.env.CEREBRAS_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
  });

  it('mid-stream timeout : pas de tool call incomplet exécuté', async () => {
    process.env.VOICE_LLM_PROVIDER = 'cerebras';
    process.env.CEREBRAS_API_KEY = 'test-k1';
    process.env.OPENROUTER_API_KEY = 'test-k2';
    _resetCircuitBreakersForTesting();

    // 1er fetch (Cerebras) : stream qui envoie un tool_call partiel (nom sans arguments complets) puis abort
    const abortingStream = makeStreamThatAbortsAfter([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tc-1","type":"function","function":{"name":"handoffToManager","arguments":""}}]}}]}\n',
    ]);

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('cerebras.ai')) {
        return Promise.resolve({ ok: true, body: abortingStream });
      }
      return Promise.resolve({
        ok: true,
        body: makeNormalStream(['data: [DONE]\n']),
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    const phrases: string[] = [];

    const fullText = await mgr.processUtteranceStreaming(session, 'Parler au gérant', (phrase) => {
      phrases.push(phrase);
    });

    // Pas de tool exécuté (tool call incomplet → skip)
    // handoffToManager n'a pas d'effet métier mais on vérifie qu'aucun tool n'est exécuté
    // en vérifiant qu'aucun message "tool" n'est ajouté à l'historique
    const toolMessages = session.history.filter((m) => m.role === 'tool');
    expect(toolMessages).toHaveLength(0);
    // Pas de retry (tool_call détecté = hasToolCall=true, mais midStreamTimedOut=true → pas de retry non plus)
    // Seulement 1 appel fetch
    expect(fetchMock).toHaveBeenCalledTimes(1);

    delete process.env.VOICE_LLM_PROVIDER;
    delete process.env.CEREBRAS_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
  });

  it('mid-stream session abort : pas de retry (raccroché)', async () => {
    process.env.VOICE_LLM_PROVIDER = 'cerebras';
    process.env.CEREBRAS_API_KEY = 'test-k1';
    process.env.OPENROUTER_API_KEY = 'test-k2';
    _resetCircuitBreakersForTesting();

    const abortController = new AbortController();

    // Stream qui envoie un chunk puis throw AbortError (session abortée = raccroché)
    const encoder = new TextEncoder();
    const abortingStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Bonjour"}}]}\n'));
        // Abort la session (simule raccroché / barge-in)
        abortController.abort();
        // Throw AbortError pour simuler le stream interrompu par l'abort
        const err = new Error('Aborted');
        err.name = 'AbortError';
        throw err;
      },
    });

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('cerebras.ai')) {
        return Promise.resolve({ ok: true, body: abortingStream });
      }
      // OpenRouter ne devrait jamais être appelé (pas de retry sur session abort)
      return Promise.resolve({
        ok: true,
        body: makeNormalStream([
          'data: {"choices":[{"delta":{"content":"Ne devrait pas être lu."}}]}\n',
          'data: [DONE]\n',
        ]),
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    session.abortController = abortController;

    // L'erreur doit propager (session abortée, pas de retry)
    await expect(mgr.processUtteranceStreaming(session, 'Salut', () => {})).rejects.toThrow();

    // Seulement 1 appel fetch (Cerebras) — pas de retry sur session abort
    expect(fetchMock).toHaveBeenCalledTimes(1);

    delete process.env.VOICE_LLM_PROVIDER;
    delete process.env.CEREBRAS_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
  });

  it('mid-stream timeout : retry aussi timeout → erreur remonte', async () => {
    process.env.VOICE_LLM_PROVIDER = 'cerebras';
    process.env.CEREBRAS_API_KEY = 'test-k1';
    process.env.OPENROUTER_API_KEY = 'test-k2';
    _resetCircuitBreakersForTesting();

    // Stream qui throw AbortError immédiatement (timeout, session non abortée)
    const makeAbortStream = (): ReadableStream<Uint8Array> =>
      new ReadableStream<Uint8Array>({
        pull() {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          throw err;
        },
      });

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      // Cerebras puis OpenRouter — les deux timeout
      if (url.includes('cerebras.ai')) {
        return Promise.resolve({ ok: true, body: makeAbortStream() });
      }
      return Promise.resolve({ ok: true, body: makeAbortStream() });
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    // Ne pas abort la session — simule un timeout-only

    // L'erreur doit propager (retry aussi timeout)
    await expect(mgr.processUtteranceStreaming(session, 'Salut', () => {})).rejects.toThrow();

    // 2 appels : Cerebras + OpenRouter retry. Pas de retry supplémentaire.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    delete process.env.VOICE_LLM_PROVIDER;
    delete process.env.CEREBRAS_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
  });
});

describe('CallSessionManager — cleanup avancé', () => {
  beforeEach(() => {
    (CallSessionManager as unknown as { instance: CallSessionManager }).instance =
      new CallSessionManager();
  });

  it("ferme le WS Deepgram s'il est OPEN", () => {
    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    const deepgramWs = { readyState: WebSocket.OPEN, close: vi.fn() } as unknown as WebSocket;
    session.deepgramWs = deepgramWs;

    mgr.cleanup(session);

    expect(deepgramWs.close).toHaveBeenCalled();
    expect(session.deepgramWs).toBeNull();
  });

  it("ne ferme pas le WS Deepgram s'il n'est pas OPEN", () => {
    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    const deepgramWs = { readyState: WebSocket.CLOSED, close: vi.fn() } as unknown as WebSocket;
    session.deepgramWs = deepgramWs;

    mgr.cleanup(session);

    expect(deepgramWs.close).not.toHaveBeenCalled();
    expect(session.deepgramWs).toBeNull();
  });

  it("vide l'audioBuffer", () => {
    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    session.audioBuffer.push(Buffer.from('chunk1'), Buffer.from('chunk2'));

    mgr.cleanup(session);

    expect(session.audioBuffer).toEqual([]);
  });

  it("abort l'AbortController en cours", () => {
    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    const ac = new AbortController();
    const abortSpy = vi.spyOn(ac, 'abort');
    session.abortController = ac;

    mgr.cleanup(session);

    expect(abortSpy).toHaveBeenCalled();
    expect(session.abortController).toBeNull();
  });

  it("clear le speechFinalTimer s'il existe", () => {
    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    const timer = setTimeout(() => {}, 60_000);
    session.speechFinalTimer = timer;

    mgr.cleanup(session);

    expect(session.speechFinalTimer).toBeNull();
  });
});

// ── Circuit breaker + timeout + network-error fallback ─────────────────────

type LlmOpts = {
  tools?: ReturnType<typeof getRestaurantTools>;
  maxTokens: number;
  temperature: number;
  signal?: AbortSignal;
};

/** Accès au fetchLlmCompletion privé pour les tests unitaires du circuit breaker. */
function callFetchLlmCompletion(
  mgr: CallSessionManager,
  messages: ChatMessage[],
  opts: LlmOpts,
): Promise<Response> {
  return (
    mgr as unknown as {
      fetchLlmCompletion: (m: ChatMessage[], o: LlmOpts) => Promise<Response>;
    }
  ).fetchLlmCompletion(messages, opts);
}

/** Mock fetch qui retourne 503 pour Cerebras et 200 pour OpenRouter. */
function mockFetchCerebrasFailOpenRouterOk() {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url.includes('cerebras.ai')) {
      return Promise.resolve({
        ok: false,
        status: 503,
        text: vi.fn().mockResolvedValue('Service Unavailable'),
        json: vi.fn().mockResolvedValue({}),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(''),
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { role: 'assistant', content: 'OK from OpenRouter' } }],
      }),
    });
  });
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  return fetchMock;
}

/** Mock fetch qui retourne 503 pour OpenRouter et 200 pour Cerebras. */
function mockFetchOpenRouterFailCerebrasOk() {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url.includes('openrouter.ai')) {
      return Promise.resolve({
        ok: false,
        status: 503,
        text: vi.fn().mockResolvedValue('Service Unavailable'),
        json: vi.fn().mockResolvedValue({}),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(''),
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { role: 'assistant', content: 'OK from Cerebras' } }],
      }),
    });
  });
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  return fetchMock;
}

/** Mock fetch qui throw une TypeError (network error) pour Cerebras, 200 pour OpenRouter. */
function mockFetchCerebrasNetworkErrorOpenRouterOk() {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url.includes('cerebras.ai')) {
      return Promise.reject(new TypeError('fetch failed'));
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(''),
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { role: 'assistant', content: 'OK from OpenRouter' } }],
      }),
    });
  });
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  return fetchMock;
}

/** Mock fetch qui ne résout jamais et rejette sur abort du signal. */
function mockFetchHanging() {
  const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init.signal;
      if (signal) {
        if (signal.aborted) {
          reject(new DOMException('The operation was aborted', 'AbortError'));
          return;
        }
        signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'));
        });
      }
    });
  });
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  return fetchMock;
}

/** Mock fetch qui retourne 503 pour Cerebras ET OpenRouter (les deux providers en panne). */
function mockFetchAllProvidersFail() {
  const fetchMock = vi.fn().mockImplementation((_url: string) => {
    return Promise.resolve({
      ok: false,
      status: 503,
      text: vi.fn().mockResolvedValue('Service Unavailable'),
      json: vi.fn().mockResolvedValue({}),
    });
  });
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  return fetchMock;
}

describe('CallSessionManager — circuit breaker + timeout + fallback', () => {
  let originalFetch: typeof globalThis.fetch;
  let savedProvider: string | undefined;
  let savedTimeout: string | undefined;
  let savedCerebrasKey: string | undefined;
  let savedOpenRouterKey: string | undefined;

  beforeEach(() => {
    (CallSessionManager as unknown as { instance: CallSessionManager }).instance =
      new CallSessionManager();
    originalFetch = globalThis.fetch;
    savedProvider = process.env.VOICE_LLM_PROVIDER;
    savedTimeout = process.env.VOICE_LLM_TIMEOUT_MS;
    savedCerebrasKey = process.env.CEREBRAS_API_KEY;
    savedOpenRouterKey = process.env.OPENROUTER_API_KEY;
    _resetCircuitBreakersForTesting();
    // Clés API présentes pour que les fallbacks soient activés
    process.env.CEREBRAS_API_KEY = 'test-k1';
    process.env.OPENROUTER_API_KEY = 'test-k2';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetCircuitBreakersForTesting();
    // Restaurer les env vars
    if (savedProvider === undefined) delete process.env.VOICE_LLM_PROVIDER;
    else process.env.VOICE_LLM_PROVIDER = savedProvider;
    if (savedTimeout === undefined) delete process.env.VOICE_LLM_TIMEOUT_MS;
    else process.env.VOICE_LLM_TIMEOUT_MS = savedTimeout;
    if (savedCerebrasKey === undefined) delete process.env.CEREBRAS_API_KEY;
    else process.env.CEREBRAS_API_KEY = savedCerebrasKey;
    if (savedOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = savedOpenRouterKey;
    vi.useRealTimers();
  });

  it('circuit breaker : skip Cerebras après 3 échecs consécutifs', async () => {
    process.env.VOICE_LLM_PROVIDER = 'cerebras';
    const fetchMock = mockFetchCerebrasFailOpenRouterOk();
    const mgr = CallSessionManager.getInstance();
    const messages: ChatMessage[] = [{ role: 'user', content: 'test' }];
    const opts: LlmOpts = { maxTokens: 100, temperature: 0.7 };

    // 3 appels : Cerebras 503 → fallback OpenRouter OK
    for (let i = 0; i < 3; i++) {
      const res = await callFetchLlmCompletion(mgr, messages, opts);
      expect(res.ok).toBe(true);
    }

    // Le 4e appel : circuit breaker open → Cerebras n'est PAS appelé
    fetchMock.mockClear();
    const res4 = await callFetchLlmCompletion(mgr, messages, opts);
    expect(res4.ok).toBe(true);

    // Vérifier qu'aucun appel fetch ne contient l'URL Cerebras
    const cerebrasCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('cerebras.ai'));
    expect(cerebrasCalls).toHaveLength(0);
    // OpenRouter doit avoir été appelé
    const openRouterCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('openrouter.ai'),
    );
    expect(openRouterCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('fallback sur erreur réseau (timeout)', async () => {
    process.env.VOICE_LLM_PROVIDER = 'cerebras';
    mockFetchCerebrasNetworkErrorOpenRouterOk();
    const mgr = CallSessionManager.getInstance();
    const messages: ChatMessage[] = [{ role: 'user', content: 'test' }];
    const opts: LlmOpts = { maxTokens: 100, temperature: 0.7 };

    const res = await callFetchLlmCompletion(mgr, messages, opts);
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
  });

  it('timeout : abort la requête après VOICE_LLM_TIMEOUT_MS', async () => {
    process.env.VOICE_LLM_PROVIDER = 'cerebras';
    // Désactiver le fallback pour que l'erreur de timeout remonte directement
    delete process.env.OPENROUTER_API_KEY;
    process.env.VOICE_LLM_TIMEOUT_MS = '100';
    mockFetchHanging();
    const mgr = CallSessionManager.getInstance();
    const messages: ChatMessage[] = [{ role: 'user', content: 'test' }];
    const opts: LlmOpts = { maxTokens: 100, temperature: 0.7 };

    // La requête doit rejeter à cause du timeout (≤ 500ms de marge)
    await expect(callFetchLlmCompletion(mgr, messages, opts)).rejects.toThrow();
  });

  it('circuit breaker : se réinitialise après cooldown', async () => {
    process.env.VOICE_LLM_PROVIDER = 'cerebras';
    vi.useFakeTimers();
    const fetchMock = mockFetchCerebrasFailOpenRouterOk();
    const mgr = CallSessionManager.getInstance();
    const messages: ChatMessage[] = [{ role: 'user', content: 'test' }];
    const opts: LlmOpts = { maxTokens: 100, temperature: 0.7 };

    // 3 échecs pour ouvrir le circuit breaker
    for (let i = 0; i < 3; i++) {
      await callFetchLlmCompletion(mgr, messages, opts);
    }

    // Avancer le temps au-delà du cooldown (31s)
    vi.advanceTimersByTime(31_000);

    // Le prochain appel doit tenter Cerebras à nouveau (half-open)
    fetchMock.mockClear();
    await callFetchLlmCompletion(mgr, messages, opts);
    const cerebrasCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('cerebras.ai'));
    expect(cerebrasCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('fallback bidirectionnel : OpenRouter primaire → Cerebras fallback', async () => {
    process.env.VOICE_LLM_PROVIDER = 'openrouter';
    mockFetchOpenRouterFailCerebrasOk();
    const mgr = CallSessionManager.getInstance();
    const messages: ChatMessage[] = [{ role: 'user', content: 'test' }];
    const opts: LlmOpts = { maxTokens: 100, temperature: 0.7 };

    const res = await callFetchLlmCompletion(mgr, messages, opts);
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
  });

  it('circuit breaker : half-open failure redémarre le cooldown', async () => {
    process.env.VOICE_LLM_PROVIDER = 'cerebras';
    vi.useFakeTimers();
    const fetchMock = mockFetchCerebrasFailOpenRouterOk();
    const mgr = CallSessionManager.getInstance();
    const messages: ChatMessage[] = [{ role: 'user', content: 'test' }];
    const opts: LlmOpts = { maxTokens: 100, temperature: 0.7 };

    // 3 échecs pour ouvrir le circuit breaker (Cerebras 503 → fallback OpenRouter OK)
    for (let i = 0; i < 3; i++) {
      await callFetchLlmCompletion(mgr, messages, opts);
    }

    // Avancer le temps au-delà du cooldown (31s) → half-open
    vi.advanceTimersByTime(31_000);

    // Le prochain appel tente Cerebras (half-open), échoue, fallback OpenRouter OK
    fetchMock.mockClear();
    await callFetchLlmCompletion(mgr, messages, opts);
    const cerebrasCallsAfterHalfOpen = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('cerebras.ai'),
    );
    expect(cerebrasCallsAfterHalfOpen.length).toBeGreaterThanOrEqual(1);

    // Avancer le temps de 29s (toujours dans le nouveau cooldown)
    vi.advanceTimersByTime(29_000);

    // Le prochain appel doit SKIP Cerebras (cooldown non expiré), aller direct sur OpenRouter
    fetchMock.mockClear();
    await callFetchLlmCompletion(mgr, messages, opts);
    const cerebrasCallsAfterRestart = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('cerebras.ai'),
    );
    expect(cerebrasCallsAfterRestart).toHaveLength(0);
    const openRouterCallsAfterRestart = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('openrouter.ai'),
    );
    expect(openRouterCallsAfterRestart.length).toBeGreaterThanOrEqual(1);
  });

  it('circuit breaker : les deux providers en panne → erreur remonte au caller', async () => {
    process.env.VOICE_LLM_PROVIDER = 'cerebras';
    const fetchMock = mockFetchAllProvidersFail();
    const mgr = CallSessionManager.getInstance();
    const messages: ChatMessage[] = [{ role: 'user', content: 'test' }];
    const opts: LlmOpts = { maxTokens: 100, temperature: 0.7 };

    // 3 appels : Cerebras 503 → fallback OpenRouter 503 → réponse 503 (erreur remonte)
    for (let i = 0; i < 3; i++) {
      const res = await callFetchLlmCompletion(mgr, messages, opts);
      expect(res.ok).toBe(false);
      expect(res.status).toBe(503);
    }

    // Les deux circuit breakers doivent être open (failures >= 3)
    // 4e appel : les deux breakers sont open → fetchWithFallback tente half-open sur OpenRouter → échoue → 503
    const callsBefore4th = fetchMock.mock.calls.length;
    const res4 = await callFetchLlmCompletion(mgr, messages, opts);
    expect(res4.ok).toBe(false);
    expect(res4.status).toBe(503);

    // Vérifier qu'il n'y a pas de retry infini : nombre d'appels fetch fini et borné
    const callsAfter4th = fetchMock.mock.calls.length;
    expect(callsAfter4th - callsBefore4th).toBeLessThanOrEqual(3);
    expect(callsAfter4th).toBeLessThan(50);
  });
});
