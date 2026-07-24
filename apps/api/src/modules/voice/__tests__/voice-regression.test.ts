/**
 * Mini-harness de régression déterministe pour le pipeline voice.
 *
 * Rejoue des transcripts connus via processUtterance (chemin non-streaming)
 * avec des réponses LLM scriptées et asserte sur les effets de bord
 * (appels de service, appels DB) — pas sur le texte de retour.
 *
 * Couverture des lots de durcissement :
 * - Lot 1 (Validation Zod)         : S9 — rejet d'args invalides
 * - Lot 2 (Annulation ambiguë)     : S2, S3, S4, S5 — ambiguous/phone/safe-name/unsafe-name
 * - Lot 3 (Création replay-safe)   : S10 — callId existant → pas de doublon
 * - Lot 6 (isSafeVoiceNameMatch)   : S4, S5 — safe/unsafe name
 * - Outils de base                  : S1, S6, S7, S8 — create/check/handoff/message
 *
 * Non couvert ici (couvert par stream-manager.test.ts) :
 * - Lot 4 (Reconstruction tool calls du stream) — tests streaming dédiés
 * - Lot 5 (Circuit breaker + timeout) — tests dédiés
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { CallSessionManager, _resetCircuitBreakersForTesting } from '../stream/manager';
import type { CallSession } from '../stream/types';

// ── Module mocks (identiques à stream-manager.test.ts) ─────────────────────

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
      findUnique: vi.fn(),
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

interface LlmRound {
  type: 'tool_call' | 'text';
  toolName?: string;
  args?: Record<string, unknown>;
  content?: string;
}

/**
 * Mock `globalThis.fetch` pour retourner des réponses LLM scriptées dans l'ordre.
 * Chaque round = un appel fetch (un tour `callLlm`).
 * - `tool_call` : le LLM répond avec un tool_call (format non-streaming).
 * - `text` : le LLM répond avec du texte simple (fin du tour).
 */
function mockLlmRounds(rounds: LlmRound[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn();
  rounds.forEach((round) => {
    if (round.type === 'tool_call') {
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
                    id: `call-${Math.random().toString(36).slice(2)}`,
                    type: 'function',
                    function: {
                      name: round.toolName,
                      arguments: JSON.stringify(round.args ?? {}),
                    },
                  },
                ],
              },
            },
          ],
        }),
      });
    } else {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { role: 'assistant', content: round.content } }],
        }),
      });
    }
  });
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  return fetchMock;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('voice regression harness', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    (CallSessionManager as unknown as { instance: CallSessionManager }).instance =
      new CallSessionManager();
    delete process.env.SOKAR_SIMULATE_MOCK_LLM;
    originalFetch = globalThis.fetch;
    vi.clearAllMocks();
    // Re-set the mock implementation after clearAllMocks
    mockGiftCardCreate.mockResolvedValue({ id: 'gc-1', code: 'SKR-ABC123' });
    // Re-set restaurant.findUnique default (cleared by clearAllMocks)
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({
      timezone: 'Europe/Paris',
    } as unknown as Awaited<ReturnType<typeof db.restaurant.findUnique>>);
    _resetCircuitBreakersForTesting();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ── Scénario 1 : Réservation simple (createReservation happy path) ──────

  it('S1 — createReservation : happy path crée la réservation avec les bons args', async () => {
    vi.mocked(ReservationService.create).mockResolvedValue({ id: 'res-1' } as unknown as Awaited<
      ReturnType<typeof ReservationService.create>
    >);

    mockLlmRounds([
      {
        type: 'tool_call',
        toolName: 'createReservation',
        args: {
          date: '2026-07-25',
          time: '19:30',
          partySize: 2,
          customerName: 'Jean Dupont',
          customerPhone: '+33****0001',
        },
      },
      { type: 'text', content: "Parfait, c'est noté." },
    ]);

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    const reply = await mgr.processUtterance(
      session,
      'Je voudrais réserver une table pour 2 demain à 19h30',
    );

    expect(reply).toBe("Parfait, c'est noté.");
    expect(ReservationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: 'rest-1',
        callId: 'leg-test-1',
        partySize: 2,
        customerName: 'Jean Dupont',
      }),
    );
  });

  // ── Scénario 2 : Annulation ambiguë → transfert (pas d'annulation) ──────

  it("S2 — cancelReservation : ambiguïté (2 résa, aucune ne matche le téléphone) → pas d'annulation", async () => {
    vi.mocked(db.reservation.findMany).mockResolvedValue([
      {
        id: 'res-amb-1',
        restaurantId: 'rest-1',
        customerName: 'Dupont',
        customerPhone: '+33****0099',
        reservedAt: new Date('2026-07-25T19:30:00Z'),
        partySize: 2,
        status: 'CONFIRMED',
      },
      {
        id: 'res-amb-2',
        restaurantId: 'rest-1',
        customerName: 'Dupont',
        customerPhone: '+33****0088',
        reservedAt: new Date('2026-07-25T20:00:00Z'),
        partySize: 2,
        status: 'CONFIRMED',
      },
    ] as unknown as Awaited<ReturnType<typeof db.reservation.findMany>>);

    mockLlmRounds([
      {
        type: 'tool_call',
        toolName: 'cancelReservation',
        args: { customerName: 'Dupont', date: '2026-07-25' },
      },
      { type: 'text', content: 'Je vous transfère au gérant.' },
    ]);

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    await mgr.processUtterance(session, 'Annuler ma réservation pour Dupont demain');

    expect(ReservationService.update).not.toHaveBeenCalled();
  });

  // ── Scénario 3 : Annulation résolue par téléphone appelant ──────────────

  it('S3 — cancelReservation : résolution par téléphone appelant parmi 2 résa', async () => {
    vi.mocked(db.reservation.findMany).mockResolvedValue([
      {
        id: 'res-phone-1',
        restaurantId: 'rest-1',
        customerName: 'Jean Dupont',
        customerPhone: '+33****0001',
        reservedAt: new Date('2026-07-25T19:30:00Z'),
        partySize: 2,
        status: 'CONFIRMED',
      },
      {
        id: 'res-phone-2',
        restaurantId: 'rest-1',
        customerName: 'Jean Dupont',
        customerPhone: '+33****0002',
        reservedAt: new Date('2026-07-25T20:00:00Z'),
        partySize: 2,
        status: 'CONFIRMED',
      },
    ] as unknown as Awaited<ReturnType<typeof db.reservation.findMany>>);
    vi.mocked(ReservationService.update).mockResolvedValue({
      id: 'res-phone-1',
      status: 'CANCELLED',
    } as unknown as Awaited<ReturnType<typeof ReservationService.update>>);

    mockLlmRounds([
      {
        type: 'tool_call',
        toolName: 'cancelReservation',
        args: { customerName: 'Jean Dupont', date: '2026-07-25' },
      },
      { type: 'text', content: "C'est annulé." },
    ]);

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    await mgr.processUtterance(session, 'Annuler ma résa');

    expect(ReservationService.update).toHaveBeenCalledWith('res-phone-1', 'rest-1', {
      status: 'CANCELLED',
    });
  });

  // ── Scénario 4 : Annulation single-match avec nom sûr ───────────────────

  it('S4 — cancelReservation : single-match avec nom sûr (2 tokens) → annulation', async () => {
    vi.mocked(db.reservation.findMany).mockResolvedValue([
      {
        id: 'res-1',
        restaurantId: 'rest-1',
        customerName: 'Jean Dupont',
        customerPhone: null,
        reservedAt: new Date('2026-07-25T19:30:00Z'),
        partySize: 2,
        status: 'CONFIRMED',
      },
    ] as unknown as Awaited<ReturnType<typeof db.reservation.findMany>>);
    vi.mocked(ReservationService.update).mockResolvedValue({
      id: 'res-1',
      status: 'CANCELLED',
    } as unknown as Awaited<ReturnType<typeof ReservationService.update>>);

    mockLlmRounds([
      {
        type: 'tool_call',
        toolName: 'cancelReservation',
        args: { customerName: 'Jean Dupont', date: '2026-07-25' },
      },
      { type: 'text', content: "C'est annulé." },
    ]);

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    await mgr.processUtterance(session, 'Annuler ma résa');

    expect(ReservationService.update).toHaveBeenCalledWith('res-1', 'rest-1', {
      status: 'CANCELLED',
    });
  });

  // ── Scénario 5 : Annulation single-match nom non sûr → transfert ────────

  it("S5 — cancelReservation : single-match mais nom non sûr (1 token) → pas d'annulation", async () => {
    vi.mocked(db.reservation.findMany).mockResolvedValue([
      {
        id: 'res-1',
        restaurantId: 'rest-1',
        customerName: 'Jean Dupont',
        customerPhone: null,
        reservedAt: new Date('2026-07-25T19:30:00Z'),
        partySize: 2,
        status: 'CONFIRMED',
      },
    ] as unknown as Awaited<ReturnType<typeof db.reservation.findMany>>);

    mockLlmRounds([
      {
        type: 'tool_call',
        toolName: 'cancelReservation',
        args: { customerName: 'Jean', date: '2026-07-25' },
      },
      { type: 'text', content: 'Je vous transfère.' },
    ]);

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    await mgr.processUtterance(session, 'Annuler ma résa');

    // "Jean" = 1 token → isSafeVoiceNameMatch retourne false → transfert, PAS d'annulation.
    expect(ReservationService.update).not.toHaveBeenCalled();
  });

  // ── Scénario 6 : Vérification de disponibilité (checkAvailability) ──────

  it('S6 — checkAvailability : appelle ReservationService.availability avec les bons args', async () => {
    vi.mocked(ReservationService.availability).mockResolvedValue({
      restaurantId: 'rest-1',
      date: '2026-07-25',
      partySize: 4,
      slots: ['19:00', '19:30', '20:00'],
      allSlots: [],
    } as unknown as Awaited<ReturnType<typeof ReservationService.availability>>);

    mockLlmRounds([
      {
        type: 'tool_call',
        toolName: 'checkAvailability',
        args: { date: '2026-07-25', partySize: 4 },
      },
      { type: 'text', content: 'Nous avons des créneaux disponibles.' },
    ]);

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    const reply = await mgr.processUtterance(
      session,
      'Est-ce que vous avez de la place pour 4 demain ?',
    );

    expect(reply).toBe('Nous avons des créneaux disponibles.');
    expect(ReservationService.availability).toHaveBeenCalledWith('rest-1', '2026-07-25', 4);
  });

  // ── Scénario 7 : Transfert gérant (handoffToManager) ────────────────────

  it('S7 — handoffToManager : aucun effet de bord, l\'historique contient "transfère"', async () => {
    mockLlmRounds([
      { type: 'tool_call', toolName: 'handoffToManager', args: {} },
      { type: 'text', content: 'Je vous transfère au gérant.' },
    ]);

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    await mgr.processUtterance(session, 'Je veux parler au gérant');

    // handoffToManager retourne un texte fixe, pas d'effet de bord service/DB.
    expect(ReservationService.create).not.toHaveBeenCalled();
    expect(ReservationService.update).not.toHaveBeenCalled();
    expect(ReservationService.availability).not.toHaveBeenCalled();
    expect(db.message.create).not.toHaveBeenCalled();

    // L'historique contient le message assistant avec "transfère".
    const assistantMessages = session.history.filter((m) => m.role === 'assistant');
    const lastAssistant = assistantMessages[assistantMessages.length - 1];
    expect(lastAssistant.content).toContain('transfère');
  });

  // ── Scénario 8 : Prise de message (takeMessage) ─────────────────────────

  it('S8 — takeMessage : enregistre le message en DB avec les bons champs', async () => {
    vi.mocked(db.message.create).mockResolvedValue({ id: 'msg-1' } as unknown as Awaited<
      ReturnType<typeof db.message.create>
    >);

    mockLlmRounds([
      {
        type: 'tool_call',
        toolName: 'takeMessage',
        args: {
          customerName: 'Marie',
          message: 'Rappelez-moi',
          callbackPhone: '+33****0002',
        },
      },
      { type: 'text', content: 'Message bien noté.' },
    ]);

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    await mgr.processUtterance(session, 'Laissez un message pour le gérant');

    expect(db.message.create).toHaveBeenCalledWith({
      data: {
        restaurantId: 'rest-1',
        callId: 'leg-test-1',
        customerName: 'Marie',
        customerPhone: '+33****0002',
        content: 'Rappelez-moi',
        status: 'PENDING',
      },
    });
  });

  // ── Scénario 9 : Validation Zod rejette les args invalides ──────────────

  it('S9 — createReservation : Zod validation rejet (heure invalide) → pas de création', async () => {
    mockLlmRounds([
      {
        type: 'tool_call',
        toolName: 'createReservation',
        args: { date: '2026-07-25', time: '25:00', partySize: 2, customerName: 'Jean Dupont' },
      },
      { type: 'text', content: "Je n'ai pas pu comprendre les informations." },
    ]);

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    await mgr.processUtterance(session, 'Réserver à 25h');

    // Zod validation rejette l'heure 25:00 → createReservation n'est jamais appelé
    expect(ReservationService.create).not.toHaveBeenCalled();
  });

  // ── Scénario 10 : createReservation replay-safe (callId existant) ───────

  it('S10 — createReservation : replay-safe (callId déjà existant) → pas de doublon', async () => {
    // La réservation existe déjà pour ce callLegId → replay-safe retourne l'existante
    vi.mocked(db.reservation.findUnique).mockResolvedValue({
      id: 'res-existing',
      callId: 'leg-test-1',
      restaurantId: 'rest-1',
      customerName: 'Jean Dupont',
      customerPhone: '+33****0001',
      partySize: 2,
      reservedAt: new Date('2026-07-25T19:30:00Z'),
      status: 'CONFIRMED',
    } as unknown as Awaited<ReturnType<typeof db.reservation.findUnique>>);

    mockLlmRounds([
      {
        type: 'tool_call',
        toolName: 'createReservation',
        args: {
          date: '2026-07-25',
          time: '19:30',
          partySize: 2,
          customerName: 'Jean Dupont',
          customerPhone: '+33****0001',
        },
      },
      { type: 'text', content: "Parfait, c'est noté." },
    ]);

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    await mgr.processUtterance(session, 'Réserver pour 2');

    // Le service create a bien été appelé (par executeTool), mais en interne
    // ReservationService.create a trouvé la résa existante via callId et l'a retournée
    // sans créer de doublon. On vérifie que create a été appelé avec le bon callId.
    expect(ReservationService.create).toHaveBeenCalledWith(
      expect.objectContaining({ callId: 'leg-test-1' }),
    );
  });
});
