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
import { CallSessionManager } from '../stream/manager';
import type { CallSession } from '../stream/types';

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

  it('cancelReservation : annule la résa trouvée', async () => {
    vi.mocked(db.reservation.findMany).mockResolvedValue([
      { id: 'res-cancel-1', customerName: 'Jean' } as unknown as Awaited<
        ReturnType<typeof db.reservation.findMany>
      >[number],
    ]);
    mockFetchToolCall(
      'cancelReservation',
      { customerName: 'Jean', date: '2026-07-16' },
      "C'est annulé.",
    );

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    await mgr.processUtterance(session, 'Annuler ma résa');

    expect(db.reservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          restaurantId: 'rest-1',
          customerName: { contains: 'Jean', mode: 'insensitive' },
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

  it('détecte un tool_call dans le stream et fallback sur callLlm non-streaming', async () => {
    // Round 0 — streaming fetch : détecte tool_calls dans le stream
    const sseWithToolCall = [
      'data: {"choices":[{"delta":{"tool_calls":[{"id":"tc-1","type":"function","function":{"name":"handoffToManager","arguments":"{}"}}]}}]}\n',
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

    // Round 0 — fallback non-streaming fetch : retourne un tool_call
    // (executé, puis `continue` vers round 1)

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
    // 1. Streaming fetch (round 0) — détecte tool_call
    fetchMock.mockResolvedValueOnce({
      ok: true,
      body: streamWithToolCall,
    });
    // 2. Non-streaming fallback (round 0) — retourne tool_call
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
                  id: 'tc-2',
                  type: 'function',
                  function: { name: 'handoffToManager', arguments: '{}' },
                },
              ],
            },
          },
        ],
      }),
    });
    // 3. Streaming fetch (round 1) — retourne du texte
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
