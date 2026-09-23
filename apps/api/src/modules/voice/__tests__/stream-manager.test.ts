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
 *  - cleanup ferme le WS ElevenLabs s'il est OPEN
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import {
  CallSessionManager,
  isSafeVoiceNameMatch,
  _resetCircuitBreakersForTesting,
} from '../stream/manager';
import { voiceConfig, type VoiceConfig } from '../../../env';
import type { CallSession, ChatMessage } from '../stream/types';
import type { getRestaurantTools } from '../tools';
import {
  activatePendingInteraction,
  getReservationConfirmationKey,
} from '../stream/conversation-controller';

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
    call: {
      findUnique: vi.fn().mockResolvedValue({ id: 'call-record-1', restaurantId: 'rest-1' }),
    },
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

const { mockTelnyxFetch } = vi.hoisted(() => ({
  mockTelnyxFetch: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('../../../shared/telnyx/http-agent', () => ({ telnyxFetch: mockTelnyxFetch }));

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
import { telnyxFetch } from '../../../shared/telnyx/http-agent';
import { logger } from '../../../shared/logger/pino';

// ── Helpers ────────────────────────────────────────────────────────────────

const GROQ_TEST_KEY = ['test', 'groq', 'api', 'key'].join('-');

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
    managerPhone: overrides.managerPhone,
    systemPrompt: "Tu es l'assistant vocal de Test Resto.",
    isVip: false,
    telnyxWs: overrides.telnyxWs ?? makeTelnyxWs(),
    callLegId: 'leg-test-1',
    codec: 'PCMA',
    giftCardMinimumAmount: overrides.giftCardMinimumAmount,
    personality: overrides.personality,
  });
}

function authorizeReservation(
  session: CallSession,
  date: string,
  time: string,
  partySize: number,
  customerName: string,
): void {
  session.conversation.intent = 'reservation';
  session.conversation.slots = { date, time, partySize, customerName };
  session.conversation.nameCollection.state = 'confirmed';
  session.conversation.nameCollection.confirmedName = customerName;
  session.conversation.lastAvailabilityResult = {
    key: `${date}:${time}:${partySize}`,
    date,
    time,
    partySize,
    slots: [time],
  };
  session.conversation.pendingReservationConfirmationKey = getReservationConfirmationKey(session);
  session.conversation.confirmedReservationKey = getReservationConfirmationKey(session);
}

type VoiceConfigSnapshot = Pick<
  VoiceConfig,
  'VOICE_LLM_MODEL' | 'VOICE_LLM_TIMEOUT_MS' | 'GROQ_BASE_URL' | 'GROQ_API_KEY'
>;

function snapshotVoiceConfig(): VoiceConfigSnapshot {
  return {
    VOICE_LLM_MODEL: voiceConfig.VOICE_LLM_MODEL,
    VOICE_LLM_TIMEOUT_MS: voiceConfig.VOICE_LLM_TIMEOUT_MS,
    GROQ_BASE_URL: voiceConfig.GROQ_BASE_URL,
    GROQ_API_KEY: voiceConfig.GROQ_API_KEY,
  };
}

function restoreVoiceConfig(snapshot: VoiceConfigSnapshot): void {
  Object.assign(voiceConfig, snapshot);
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
    vi.mocked(db.call.findUnique).mockReset();
    mockTelnyxFetch.mockResolvedValue({ ok: true });
    vi.mocked(db.call.findUnique).mockResolvedValue({
      id: 'call-record-1',
      restaurantId: 'rest-1',
    } as unknown as Awaited<ReturnType<typeof db.call.findUnique>>);
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
    authorizeReservation(session, '2026-07-16', '19:30', 2, 'Jean');
    const reply = await mgr.processUtterance(session, 'Je voudrais réserver');

    expect(ReservationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: 'rest-1',
        callId: 'call-record-1',
        partySize: 2,
        customerName: 'Jean',
        customerPhone: '+33****0001',
      }),
    );
    expect(reply).toContain('Réservation confirmée pour Jean');
  });

  it('createReservation : conserve le nom épelé après confirmation', async () => {
    vi.mocked(ReservationService.create).mockResolvedValue({
      id: 'res-spelled',
    } as unknown as Awaited<ReturnType<typeof ReservationService.create>>);
    mockFetchToolCall(
      'createReservation',
      {
        date: '2026-07-16',
        time: '19:30',
        partySize: 2,
        // Le provider pourrait encore normaliser K-I-F en « Kif » : le slot
        // confirmé doit rester la source de vérité.
        customerName: 'Kif',
      },
      'C’est confirmé.',
    );

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    session.conversation.slots.customerName = 'KIF';
    authorizeReservation(session, '2026-07-16', '19:30', 2, 'KIF');
    const reply = await mgr.processUtterance(session, 'Oui, c’est bien ça');

    expect(ReservationService.create).toHaveBeenCalledWith(
      expect.objectContaining({ customerName: 'KIF' }),
    );
    expect(reply).toContain('Réservation confirmée pour KIF');
  });

  it('createReservation : bloque une épellation encore non confirmée', async () => {
    mockFetchToolCall(
      'createReservation',
      {
        date: '2026-07-16',
        time: '19:30',
        partySize: 2,
        customerName: 'Kif',
      },
      'Je vais d’abord vérifier le nom.',
    );

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    session.conversation.spellingCandidate = 'KIF';
    const reply = await mgr.processUtterance(session, 'Au nom de K I F');

    expect(ReservationService.create).not.toHaveBeenCalled();
    expect(reply).toContain("Je dois d'abord confirmer l'orthographe de votre nom.");
  });

  it.each(['collecting', 'clarifying', 'confirming'] as const)(
    'createReservation : bloque l’état de nom %s même sans candidat complet',
    async (state) => {
      mockFetchToolCall(
        'createReservation',
        {
          date: '2026-07-16',
          time: '19:30',
          partySize: 2,
          customerName: 'Kif',
        },
        'Le nom doit encore être confirmé.',
      );

      const mgr = CallSessionManager.getInstance();
      const session = makeSession();
      session.conversation.nameCollection.state = state;
      session.conversation.nameCollection.partialCandidate = 'A?';
      session.conversation.spellingCandidate = null;

      await mgr.processUtterance(session, 'Réserver maintenant');

      expect(ReservationService.create).not.toHaveBeenCalled();
    },
  );

  it('createReservation : reste bloquée après une prise de message de secours', async () => {
    mockFetchToolCall(
      'createReservation',
      {
        date: '2026-07-16',
        time: '19:30',
        partySize: 2,
        customerName: 'Kif',
      },
      'Le nom doit encore être traité par le gérant.',
    );

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    session.conversation.nameCollection.fallbackRecorded = true;

    await mgr.processUtterance(session, 'Réserver maintenant');

    expect(ReservationService.create).not.toHaveBeenCalled();
  });

  it('createReservation : utilise le nom confirmé même si le LLM en fournit un autre', async () => {
    vi.mocked(ReservationService.create).mockResolvedValue({
      id: 'res-confirmed',
    } as unknown as Awaited<ReturnType<typeof ReservationService.create>>);
    mockFetchToolCall(
      'createReservation',
      {
        date: '2026-07-16',
        time: '19:30',
        partySize: 2,
        customerName: 'Kif',
      },
      'Réservation enregistrée.',
    );

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    session.conversation.nameCollection.state = 'confirmed';
    session.conversation.nameCollection.confirmedName = 'A-K-I-F';
    authorizeReservation(session, '2026-07-16', '19:30', 2, 'A-K-I-F');

    await mgr.processUtterance(session, 'Réserver');

    expect(ReservationService.create).toHaveBeenCalledWith(
      expect.objectContaining({ customerName: 'A-K-I-F' }),
    );
  });

  it('recordNameSpellingFallback : persiste réellement un message après deux échecs', async () => {
    vi.mocked(db.message.create).mockResolvedValue({ id: 'msg-spelling' } as unknown as Awaited<
      ReturnType<typeof db.message.create>
    >);

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    session.conversation.nameCollection.state = 'clarifying';
    session.conversation.nameCollection.clarificationCount = 2;

    const reply = await mgr.recordNameSpellingFallback(session);

    expect(db.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        restaurantId: 'rest-1',
        callId: 'call-record-1',
        customerName: 'Client',
        customerPhone: '+33****0001',
        content: expect.stringContaining('orthographe de son nom'),
        status: 'PENDING',
      }),
    });
    expect(reply).toContain("J'ai bien noté votre message");
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
    authorizeReservation(session, '2026-07-16', '12:00', 4, 'Marie');
    const reply = await mgr.processUtterance(session, 'Réserver pour 4');

    // La réponse vocale annonce le résultat confirmé par le service métier.
    expect(reply).toContain("ce créneau horaire n'est pas disponible");
    expect(ReservationService.create).toHaveBeenCalled();
  });

  it('createReservation : propose un repli si le call Telnyx ne possède pas de ligne interne', async () => {
    vi.mocked(db.call.findUnique).mockResolvedValueOnce(null);
    mockFetchToolCall(
      'createReservation',
      { date: '2026-07-16', time: '19:30', partySize: 2, customerName: 'Jean' },
      'Je ne peux pas enregistrer cette demande. Souhaitez-vous que je vous passe le gérant ?',
    );

    const mgr = CallSessionManager.getInstance();
    const session = makeSession({ managerPhone: '+33612345678' });
    authorizeReservation(session, '2026-07-16', '19:30', 2, 'Jean');
    const reply = await mgr.processUtterance(session, 'Je voudrais réserver');

    expect(ReservationService.create).not.toHaveBeenCalled();
    expect(reply).toContain('Souhaitez-vous que je vous passe le gérant ?');
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

  it('createReservationFromConversation : utilise le créneau vérifié et le nom confirmé', async () => {
    vi.mocked(ReservationService.create).mockResolvedValue({
      id: 'res-direct-1',
    } as unknown as Awaited<ReturnType<typeof ReservationService.create>>);

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    session.conversation.slots = {
      date: '2026-07-16',
      time: '12:00',
      partySize: 4,
      customerName: 'AKKIF',
    };
    session.conversation.nameCollection.state = 'confirmed';
    session.conversation.nameCollection.confirmedName = 'AKKIF';
    session.conversation.lastAvailabilityResult = {
      key: '2026-07-16:12:00:4',
      date: '2026-07-16',
      time: '12:00',
      partySize: 4,
      slots: ['12:00', '12:30'],
    };
    session.conversation.pendingReservationConfirmationKey = getReservationConfirmationKey(session);
    session.conversation.confirmedReservationKey = getReservationConfirmationKey(session);

    const reply = await mgr.createReservationFromConversation(session);

    expect(reply).toContain('Réservation confirmée');
    expect(ReservationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: 'rest-1',
        callId: 'call-record-1',
        partySize: 4,
        customerName: 'AKKIF',
        customerPhone: '+33****0001',
      }),
    );
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
          state: { in: ['PENDING', 'CONFIRMED'] },
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

  it('cancelReservation : ne choisit pas une réservation quand le résultat reste ambigu', async () => {
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

    // Ambiguïté non résolue → PAS d'annulation.
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

  it('cancelReservation : garde toutes les réservations si plusieurs correspondent à l’heure', async () => {
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
        callId: 'call-record-1',
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

  it('handoffToManager : déclenche le transfert Telnyx quand le numéro du gérant est connu', async () => {
    mockFetchToolCall('handoffToManager', {}, 'Je vous transfère.');
    const mgr = CallSessionManager.getInstance();
    const session = makeSession({ managerPhone: '+33612345678' });
    await mgr.processUtterance(session, 'Parler au gérant');
    expect(telnyxFetch).toHaveBeenCalledWith(
      `/v2/calls/${session.callControlId}/actions/transfer`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ to: '+33612345678' }),
      }),
    );
    expect(session.handoffInProgress).toBe(true);
    expect(session.history.length).toBeGreaterThan(2);
  });

  it('refuse le tool de transfert sur un « oui » ambigu et remplace la réponse du LLM', async () => {
    mockFetchToolCall('handoffToManager', {}, 'Le transfert est lancé.');
    const mgr = CallSessionManager.getInstance();
    const session = makeSession({ managerPhone: '+33612345678' });
    activatePendingInteraction(
      session,
      'humanFallback',
      'Souhaitez-vous un transfert ou un message ?',
      { fallbackMode: 'choice' },
    );

    const reply = await mgr.processUtterance(session, 'Oui');

    expect(telnyxFetch).not.toHaveBeenCalled();
    expect(reply).toContain("Je n'ai pas lancé le transfert.");
    expect(reply).not.toContain('Le transfert est lancé.');
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
    // processUtterance tests the manager below the handler's deterministic
    // intent classifier, so set the already-authorized business context.
    session.conversation.intent = 'gift_card';
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
    expect(sendSms).toHaveBeenCalledWith(
      '+33612345678',
      expect.stringContaining('SKR-ABC123'),
      expect.objectContaining({
        restaurantId: 'rest-1',
        sourceId: 'gc-1',
        sourceType: 'gift_card_voice_delivery',
      }),
    );
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
  let savedVoiceConfig: VoiceConfigSnapshot;

  beforeEach(() => {
    (CallSessionManager as unknown as { instance: CallSessionManager }).instance =
      new CallSessionManager();
    delete process.env.SOKAR_SIMULATE_MOCK_LLM;
    originalFetch = globalThis.fetch;
    savedVoiceConfig = snapshotVoiceConfig();
    vi.mocked(telnyxFetch).mockClear();
    vi.mocked(logger.warn).mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreVoiceConfig(savedVoiceConfig);
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

  it.each([false, true])(
    'coupe après la question et ignore toute confirmation ou outil du même tour (fragmenté=%s)',
    async (fragmented) => {
      const text =
        'D’accord, je note A, K, I, F. Est-ce correct ? C’est noté. Votre réservation est confirmée.';
      const tool = {
        index: 0,
        id: 'premature',
        type: 'function',
        function: {
          name: 'createReservation',
          arguments: JSON.stringify({
            date: '2026-09-05',
            time: '19:30',
            partySize: 4,
            customerName: 'Akif',
          }),
        },
      };
      const deltas = fragmented
        ? [{ tool_calls: [tool] }, ...Array.from(text, (content) => ({ content }))]
        : [{ content: text, tool_calls: [tool] }];
      const stream = new ReadableStream({
        start(controller) {
          for (const delta of deltas)
            controller.enqueue(
              new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta }] })}\n`),
            );
          controller.close();
        },
      });
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, body: stream });
      const mgr = CallSessionManager.getInstance();
      const session = makeSession();
      const phrases: string[] = [];
      const create = vi.mocked(ReservationService.create);
      create.mockClear();
      const response = await mgr.processUtteranceStreaming(session, 'Akif', (phrase) => {
        phrases.push(phrase);
      });
      expect(response).toBe('D’accord, je note A, K, I, F. Est-ce correct ?');
      expect(phrases.join(' ')).toBe(response);
      expect(create).not.toHaveBeenCalled();
      expect(session.history.at(-1)).toEqual({ role: 'assistant', content: response });
      expect(globalThis.fetch).toHaveBeenCalledOnce();
    },
  );

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
    const session = makeSession({ managerPhone: '+33612345678' });
    const phrases: string[] = [];

    const fullText = await mgr.processUtteranceStreaming(session, 'Parler au gérant', (phrase) => {
      phrases.push(phrase);
    });

    expect(fullText).toBe(
      'Le gérant a accepté le transfert. Je vous mets en relation, un instant.',
    );
    // Le résultat Telnyx vérifié termine le tour sans laisser le LLM l'inventer.
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('interrompt le stream si la policy refuse un tool de transfert sur « oui »', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tc-1","type":"function","function":{"name":"handoffToManager","arguments":"{}"}}]}}]}\n',
      'data: [DONE]\n',
    ];
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: stream });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const mgr = CallSessionManager.getInstance();
    const session = makeSession({ managerPhone: '+33612345678' });
    activatePendingInteraction(
      session,
      'humanFallback',
      'Souhaitez-vous un transfert ou un message ?',
      { fallbackMode: 'choice' },
    );
    expect(session.conversation.pendingInteractions).toContainEqual(
      expect.objectContaining({
        kind: 'humanFallback',
        status: 'active',
        fallbackMode: 'choice',
      }),
    );
    const phrases: string[] = [];
    const fullText = await mgr.processUtteranceStreaming(session, 'Oui', (phrase) => {
      phrases.push(phrase);
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'explicit_transfer_required' }),
      '[tool] Policy denied voice tool execution',
    );
    expect(telnyxFetch).not.toHaveBeenCalled();
    expect(fullText).toContain("Je n'ai pas lancé le transfert.");
    expect(phrases).toEqual([fullText]);
    expect(fetchMock).toHaveBeenCalledOnce();
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
    authorizeReservation(session, '2026-07-16', '19:30', 2, 'Jean Dupont');
    const phrases: string[] = [];

    const fullText = await mgr.processUtteranceStreaming(
      session,
      'Réserver pour demain',
      (phrase) => {
        phrases.push(phrase);
      },
    );

    expect(fullText).toContain('Réservation confirmée pour Jean Dupont');
    expect(ReservationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: 'rest-1',
        callId: 'call-record-1',
        partySize: 2,
        customerName: 'Jean Dupont',
        customerPhone: '+33****0001',
      }),
    );
    // Le tour se termine directement sur le résultat de la création.
    expect(fetchMock).toHaveBeenCalledOnce();
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
    const session = makeSession({ managerPhone: '+33612345678' });
    const phrases: string[] = [];

    const fullText = await mgr.processUtteranceStreaming(session, 'Parler au gérant', (phrase) => {
      phrases.push(phrase);
    });

    // L'outil retourne l'état Telnyx observé ; aucun texte final LLM ne le remplace.
    expect(fullText).toBe(
      'Le gérant a accepté le transfert. Je vous mets en relation, un instant.',
    );

    // Le texte du round 0 (avant et après le tool_call) est dans l'historique
    // comme contenu du message assistant avec tool_calls.
    const assistantWithToolCalls = session.history.find(
      (m) => m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0,
    );
    expect(assistantWithToolCalls).toBeDefined();
    expect(assistantWithToolCalls!.content).toContain('Je vais vérifier');
    expect(assistantWithToolCalls!.content).toContain('Un instant');

    // Aucun second tour LLM n'est demandé après un transfert accepté.
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  // ── Timeout mid-stream ─────────────────────────────────────────────────────

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

  it('mid-stream timeout sans audio : dégrade au lieu de rejouer', async () => {
    // Un seul provider : il n'y a plus de repli possible. Sans audio envoyé,
    // la seule issue honnête est de propager l'erreur pour que l'appelant
    // prononce le message d'excuse, plutôt que de retourner une réponse vide.
    voiceConfig.GROQ_API_KEY = GROQ_TEST_KEY;
    _resetCircuitBreakersForTesting();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: makeStreamThatAbortsAfter([]),
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    const phrases: string[] = [];

    await expect(
      mgr.processUtteranceStreaming(session, 'Salut', (phrase) => {
        phrases.push(phrase);
      }),
    ).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(phrases).toHaveLength(0);
  });

  it('mid-stream timeout après audio : retourne le partiel sans rejouer', async () => {
    voiceConfig.GROQ_API_KEY = GROQ_TEST_KEY;
    _resetCircuitBreakersForTesting();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: makeStreamThatAbortsAfter(['data: {"choices":[{"delta":{"content":"Bonjour."}}]}\n']),
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    const phrases: string[] = [];

    const fullText = await mgr.processUtteranceStreaming(session, 'Salut', (phrase) => {
      phrases.push(phrase);
    });

    expect(fullText).toContain('Bonjour');
    expect(phrases).toContain('Bonjour.');
    // Aucun second appel : rejouer ferait entendre un doublon à l'utilisateur.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('mid-stream timeout : pas de tool call incomplet exécuté', async () => {
    voiceConfig.GROQ_API_KEY = GROQ_TEST_KEY;
    _resetCircuitBreakersForTesting();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: makeStreamThatAbortsAfter([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"create_reservation","arguments":"{\\"par"}}]}}]}\n',
      ]),
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    const executeToolSpy = vi.spyOn(
      mgr as unknown as { executeTool: (...args: unknown[]) => Promise<string> },
      'executeTool',
    );

    await mgr.processUtteranceStreaming(session, 'Salut', () => {}).catch(() => undefined);

    // Un tool_call tronqué ne doit jamais déclencher d'opération métier.
    expect(executeToolSpy).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('mid-stream session abort : pas de rejeu (raccroché)', async () => {
    voiceConfig.GROQ_API_KEY = GROQ_TEST_KEY;
    _resetCircuitBreakersForTesting();

    const abortController = new AbortController();
    const abortingStream = new ReadableStream<Uint8Array>({
      pull() {
        abortController.abort();
        const err = new Error('Aborted');
        err.name = 'AbortError';
        throw err;
      },
    });

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, body: abortingStream });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    session.abortController = abortController;

    await expect(mgr.processUtteranceStreaming(session, 'Salut', () => {})).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('CallSessionManager — TurnPlan shadow in-band', () => {
  let originalFetch: typeof globalThis.fetch;
  let savedVoiceConfig: VoiceConfigSnapshot;

  function makeShadowStream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
  }

  beforeEach(() => {
    (CallSessionManager as unknown as { instance: CallSessionManager }).instance =
      new CallSessionManager();
    originalFetch = globalThis.fetch;
    savedVoiceConfig = snapshotVoiceConfig();
    voiceConfig.GROQ_API_KEY = GROQ_TEST_KEY;
    _resetCircuitBreakersForTesting();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreVoiceConfig(savedVoiceConfig);
  });

  it('reçoit le TurnPlan avec la réponse parlée et ne l’exécute jamais comme un outil métier', async () => {
    const proposal = {
      interpretation: 'answer',
      intent: 'unchanged',
      slots: {},
      interactionDisposition: 'keep',
      confidence: 'medium',
      assistantInteraction: 'partySize',
    };
    const sse = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Pour combien de personnes ?' } }] })}\n`,
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'shadow-1',
                  type: 'function',
                  function: { name: 'proposeTurnPlanShadow', arguments: JSON.stringify(proposal) },
                },
                {
                  index: 1,
                  id: 'late-action',
                  type: 'function',
                  function: { name: 'handoffToManager', arguments: '{}' },
                },
              ],
            },
          },
        ],
      })}\n`,
      'data: [DONE]\n',
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: makeShadowStream(sse),
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    const onTurnPlanShadowResult = vi.fn();
    const executeTool = vi.spyOn(
      mgr as unknown as { executeTool: (...args: unknown[]) => Promise<string> },
      'executeTool',
    );
    const context = {
      transcript: 'quatre',
      language: 'fr',
      timezone: 'Europe/Paris',
      referenceTime: '2026-09-23T10:00:00.000Z',
      intent: 'reservation',
      pendingInteraction: { kind: 'partySize' },
      slots: {},
      hasConfirmedName: false,
    } as const;
    const response = await mgr.processUtteranceStreaming(
      session,
      'Combien de personnes ?',
      () => {},
      {
        turnPlanShadowContext: context,
        onTurnPlanShadowResult,
      },
    );

    expect(response).toBe('Pour combien de personnes ?');
    expect(onTurnPlanShadowResult).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'valid', plan: proposal }),
    );
    expect(executeTool).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(
      requestBody.tools.map((tool: { function: { name: string } }) => tool.function.name),
    ).toContain('proposeTurnPlanShadow');
    expect(JSON.stringify(requestBody.messages)).toContain('referenceTime');
    expect(session.history.at(-1)).toEqual({ role: 'assistant', content: response });
  });

  it('filtre le tool shadow quand il accompagne un véritable outil métier', async () => {
    const proposal = {
      interpretation: 'answer',
      intent: 'unchanged',
      slots: {},
      interactionDisposition: 'keep',
      confidence: 'medium',
      assistantInteraction: 'none',
    };
    const firstRound = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Je vérifie.' } }] })}\n`,
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'shadow-1',
                  type: 'function',
                  function: { name: 'proposeTurnPlanShadow', arguments: JSON.stringify(proposal) },
                },
                {
                  index: 1,
                  id: 'business-1',
                  type: 'function',
                  function: {
                    name: 'recommendGiftCardAmount',
                    arguments: JSON.stringify({ occasion: 'anniversaire', partySize: 4 }),
                  },
                },
              ],
            },
          },
        ],
      })}\n`,
      'data: [DONE]\n',
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: makeShadowStream(firstRound),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: makeShadowStream([
          `data: ${JSON.stringify({ choices: [{ delta: { content: 'Je vous conseille cinquante euros.' } }] })}\n`,
          'data: [DONE]\n',
        ]),
      });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    const executeTool = vi
      .spyOn(
        mgr as unknown as { executeTool: (...args: unknown[]) => Promise<string> },
        'executeTool',
      )
      .mockResolvedValue('Suggestion calculée.');

    const response = await mgr.processUtteranceStreaming(session, 'Quel montant ?', () => {}, {
      turnPlanShadowContext: {
        transcript: 'Quel montant ?',
        language: 'fr',
        timezone: 'Europe/Paris',
        referenceTime: '2026-09-23T10:00:00.000Z',
        intent: 'gift_card',
        pendingInteraction: null,
        slots: {},
        hasConfirmedName: false,
      },
    });

    expect(response).toBe('Je vous conseille cinquante euros.');
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool.mock.calls[0][1]).toBe('recommendGiftCardAmount');
    expect(executeTool.mock.calls.some((call) => call[1] === 'proposeTurnPlanShadow')).toBe(false);
  });

  it('récupère une réponse parlée si le modèle choisit le tool shadow seul', async () => {
    const planOnly = {
      interpretation: 'answer',
      intent: 'unchanged',
      slots: {},
      interactionDisposition: 'keep',
      confidence: 'low',
      assistantInteraction: 'none',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: makeShadowStream([
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'shadow-only',
                      type: 'function',
                      function: {
                        name: 'proposeTurnPlanShadow',
                        arguments: JSON.stringify(planOnly),
                      },
                    },
                  ],
                },
              },
            ],
          })}\n`,
          'data: [DONE]\n',
        ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: makeShadowStream([
          `data: ${JSON.stringify({ choices: [{ delta: { content: 'Je vous écoute.' } }] })}\n`,
          'data: [DONE]\n',
        ]),
      });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    const onTurnPlanShadowResult = vi.fn();
    const executeTool = vi.spyOn(
      mgr as unknown as { executeTool: (...args: unknown[]) => Promise<string> },
      'executeTool',
    );

    const response = await mgr.processUtteranceStreaming(session, 'Oui', () => {}, {
      turnPlanShadowContext: {
        transcript: 'Oui',
        language: 'fr',
        timezone: 'Europe/Paris',
        referenceTime: '2026-09-23T10:00:00.000Z',
        intent: null,
        pendingInteraction: null,
        slots: {},
        hasConfirmedName: false,
      },
      onTurnPlanShadowResult,
    });

    expect(response).toBe('Je vous écoute.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(executeTool).not.toHaveBeenCalled();
    expect(onTurnPlanShadowResult).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'speech_missing' }),
    );
    expect(session.history.some((message) => message.content.includes('shadow-only'))).toBe(false);
  });
});

describe('CallSessionManager — cleanup avancé', () => {
  beforeEach(() => {
    (CallSessionManager as unknown as { instance: CallSessionManager }).instance =
      new CallSessionManager();
  });

  it("ferme le WS ElevenLabs s'il est OPEN", () => {
    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    const sttWs = { readyState: WebSocket.OPEN, close: vi.fn() } as unknown as WebSocket;
    session.sttWs = sttWs;

    mgr.cleanup(session);

    expect(sttWs.close).toHaveBeenCalled();
    expect(session.sttWs).toBeNull();
  });

  it("ne ferme pas le WS ElevenLabs s'il n'est pas OPEN", () => {
    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    const sttWs = { readyState: WebSocket.CLOSED, close: vi.fn() } as unknown as WebSocket;
    session.sttWs = sttWs;

    mgr.cleanup(session);

    expect(sttWs.close).not.toHaveBeenCalled();
    expect(session.sttWs).toBeNull();
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

// ── Circuit breaker + timeout ──────────────────────────────────────────────

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

/** Accès au fetchLlmStreaming privé pour vérifier le chemin SSE Groq. */
function callFetchLlmStreaming(
  mgr: CallSessionManager,
  messages: ChatMessage[],
  opts: LlmOpts,
): Promise<{ response: Response; provider: string }> {
  return (
    mgr as unknown as {
      fetchLlmStreaming: (
        m: ChatMessage[],
        o: LlmOpts,
      ) => Promise<{ response: Response; provider: string }>;
    }
  ).fetchLlmStreaming(messages, opts);
}

/**
 * Hôte réellement appelé. On compare l'hôte exact plutôt qu'une sous-chaîne :
 * `api.groq.com.evil.test` contient `api.groq.com`, ce que CodeQL signale à
 * juste titre (js/incomplete-url-substring-sanitization).
 */
function requestHost(input: unknown): string {
  return new URL(String(input)).host;
}

/** Mock fetch qui répond 503 (provider indisponible). */
function mockFetchGroqFail() {
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

/** Mock fetch qui throw une TypeError (erreur réseau). */
function mockFetchGroqNetworkError() {
  const fetchMock = vi.fn().mockImplementation(() => Promise.reject(new TypeError('fetch failed')));
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

describe('CallSessionManager — provider LLM unique, circuit breaker et timeout', () => {
  let originalFetch: typeof globalThis.fetch;
  let savedVoiceConfig: VoiceConfigSnapshot;

  beforeEach(() => {
    (CallSessionManager as unknown as { instance: CallSessionManager }).instance =
      new CallSessionManager();
    originalFetch = globalThis.fetch;
    savedVoiceConfig = snapshotVoiceConfig();
    _resetCircuitBreakersForTesting();
    voiceConfig.GROQ_API_KEY = GROQ_TEST_KEY;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetCircuitBreakersForTesting();
    restoreVoiceConfig(savedVoiceConfig);
    vi.useRealTimers();
  });

  it('Groq utilise Qwen 3.8 en mode instruct avec tool use', async () => {
    voiceConfig.VOICE_LLM_MODEL = 'qwen/qwen3.8-27b';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(''),
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { role: 'assistant', content: 'Bonjour' } }],
      }),
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const mgr = CallSessionManager.getInstance();
    const messages: ChatMessage[] = [{ role: 'user', content: 'test' }];
    const opts: LlmOpts = { maxTokens: 100, temperature: 0.7 };

    const res = await callFetchLlmCompletion(mgr, messages, opts);
    expect(res.ok).toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestHost(url)).toBe('api.groq.com');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${GROQ_TEST_KEY}`);
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('qwen/qwen3.8-27b');
    expect(body.reasoning_effort).toBe('none');
  });

  it('Groq ne bascule plus sur un autre provider : la réponse d’erreur remonte', async () => {
    // Une erreur fournisseur doit remonter à l'appelant, qui dégrade l'appel.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 402,
      text: vi.fn().mockResolvedValue('Payment Required'),
      json: vi.fn().mockResolvedValue({}),
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const mgr = CallSessionManager.getInstance();
    const messages: ChatMessage[] = [{ role: 'user', content: 'test' }];
    const opts: LlmOpts = { maxTokens: 100, temperature: 0.7 };

    const res = await callFetchLlmCompletion(mgr, messages, opts);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(402);
    // Un seul appel : aucun second provider n'est sollicité.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.every((u) => requestHost(u) === 'api.groq.com')).toBe(true);
  });

  it('Groq expose le chemin streaming et le provider utilisé', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, body: null });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const mgr = CallSessionManager.getInstance();
    const messages: ChatMessage[] = [{ role: 'user', content: 'test' }];
    const opts: LlmOpts = { maxTokens: 100, temperature: 0.7 };

    const { provider } = await callFetchLlmStreaming(mgr, messages, opts);
    expect(provider).toBe('groq');
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(requestHost(url)).toBe('api.groq.com');
  });

  it('circuit breaker : court-circuite Groq après 3 échecs consécutifs', async () => {
    const fetchMock = mockFetchGroqFail();
    const mgr = CallSessionManager.getInstance();
    const messages: ChatMessage[] = [{ role: 'user', content: 'test' }];
    const opts: LlmOpts = { maxTokens: 100, temperature: 0.7 };

    for (let i = 0; i < 3; i++) {
      const res = await callFetchLlmCompletion(mgr, messages, opts);
      expect(res.ok).toBe(false);
    }

    // 4e appel : le breaker est open, aucune requête ne part.
    fetchMock.mockClear();
    await expect(callFetchLlmCompletion(mgr, messages, opts)).rejects.toThrow(/circuit open/);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('circuit breaker : se réinitialise après le cooldown', async () => {
    vi.useFakeTimers();
    const fetchMock = mockFetchGroqFail();
    const mgr = CallSessionManager.getInstance();
    const messages: ChatMessage[] = [{ role: 'user', content: 'test' }];
    const opts: LlmOpts = { maxTokens: 100, temperature: 0.7 };

    for (let i = 0; i < 3; i++) {
      await callFetchLlmCompletion(mgr, messages, opts);
    }

    vi.advanceTimersByTime(31_000);

    // Half-open : une requête de sonde repart.
    fetchMock.mockClear();
    await callFetchLlmCompletion(mgr, messages, opts);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('circuit breaker : un échec half-open redémarre le cooldown', async () => {
    vi.useFakeTimers();
    const fetchMock = mockFetchGroqFail();
    const mgr = CallSessionManager.getInstance();
    const messages: ChatMessage[] = [{ role: 'user', content: 'test' }];
    const opts: LlmOpts = { maxTokens: 100, temperature: 0.7 };

    for (let i = 0; i < 3; i++) {
      await callFetchLlmCompletion(mgr, messages, opts);
    }
    vi.advanceTimersByTime(31_000);

    // Sonde half-open : elle échoue, le cooldown repart pour 30 s.
    await callFetchLlmCompletion(mgr, messages, opts);
    vi.advanceTimersByTime(29_000);

    fetchMock.mockClear();
    await expect(callFetchLlmCompletion(mgr, messages, opts)).rejects.toThrow(/circuit open/);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('timeout : abort la requête après VOICE_LLM_TIMEOUT_MS', async () => {
    voiceConfig.VOICE_LLM_TIMEOUT_MS = 100;
    mockFetchHanging();
    const mgr = CallSessionManager.getInstance();
    const messages: ChatMessage[] = [{ role: 'user', content: 'test' }];
    const opts: LlmOpts = { maxTokens: 100, temperature: 0.7 };

    await expect(callFetchLlmCompletion(mgr, messages, opts)).rejects.toThrow();
  });

  it('erreur réseau : remonte à l’appelant sans repli', async () => {
    const fetchMock = mockFetchGroqNetworkError();
    const mgr = CallSessionManager.getInstance();
    const messages: ChatMessage[] = [{ role: 'user', content: 'test' }];
    const opts: LlmOpts = { maxTokens: 100, temperature: 0.7 };

    await expect(callFetchLlmCompletion(mgr, messages, opts)).rejects.toThrow(/fetch failed/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
