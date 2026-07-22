/**
 * Integration tests for the Telnyx voice webhook pipeline.
 *
 * Covers:
 *  - call.initiated
 *      • happy path: loadContext, checkMarginHealth, isVoicePipelineEnabled,
 *        CustomerService.lookupOrCreate, db.call.create, CallSessionManager.create,
 *        queues.telnyxWebhooks.add
 *      • guard rails: circuit breaker, feature-flag kill switch, restaurant not found,
 *        VIP push
 *  - call.hangup: duration update, incrementVisit only when a reservation was made
 *  - /voice/telnyx/end: upsert with the detected outcome
 *  - default branch: returns { result: 'ignored' }
 *
 * The preHandler (telnyx.guard) is mocked so tests don't have to forge an Ed25519
 * signature. The real guard is unit-tested in telnyx.guard.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// ── Module mocks (must come before importing the app) ──────────────────────

// Skip the Ed25519 signature guard — it's covered in telnyx.guard.test.ts.
vi.mock('../telnyx.guard', () => ({
  telnyxWebhookGuard: vi.fn(async (_req: FastifyRequest, _reply: FastifyReply) => undefined),
}));

vi.mock('../../restaurants/restaurant.service', () => ({
  RestaurantService: {
    loadContext: vi.fn(),
    checkMarginHealth: vi.fn(),
  },
}));

vi.mock('../../customers/customer.service', () => ({
  CustomerService: {
    lookupOrCreate: vi.fn(),
    buildVipPromptExtra: vi.fn(),
    buildReturningGreeting: vi.fn(() => 'Bonjour'),
    recordCallActivity: vi.fn(() => Promise.resolve()),
    incrementVisit: vi.fn(),
  },
}));

vi.mock('../../../shared/configcat', () => ({
  isVoicePipelineEnabled: vi.fn(),
  FLAGS: {
    VOICE_PIPELINE_ENABLED: 'voice_pipeline_enabled',
    SPECULATIVE_LLM: 'speculative_llm',
    RESTAURANT_PLAN: 'restaurant_plan',
  },
}));

// ── Imports under test (must come AFTER the vi.mock calls) ─────────────────

import { getApp, closeApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';
import { queues } from '../../../shared/queue/queues';
import { RestaurantService } from '../../restaurants/restaurant.service';
import { CustomerService } from '../../customers/customer.service';
import { isVoicePipelineEnabled } from '../../../shared/configcat';
import { CallSessionManager } from '../stream/manager';

const mockLoadContext = vi.mocked(RestaurantService.loadContext);
const mockCheckMarginHealth = vi.mocked(RestaurantService.checkMarginHealth);
const mockLookupOrCreate = vi.mocked(CustomerService.lookupOrCreate);
const mockBuildVipPromptExtra = vi.mocked(CustomerService.buildVipPromptExtra);
const mockIncrementVisit = vi.mocked(CustomerService.incrementVisit);
const mockIsVoicePipelineEnabled = vi.mocked(isVoicePipelineEnabled);

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRestaurantCtx(
  overrides: Partial<{
    id: string;
    name: string;
    openingHours: unknown;
    personality: unknown;
  }> = {},
): Awaited<ReturnType<typeof RestaurantService.loadContext>> {
  return {
    id: 'rest-1',
    name: 'Le Bistrot',
    openingHours: { mon: { open: '12:00', close: '14:30' } },
    personality: null,
    ...overrides,
  } as unknown as Awaited<ReturnType<typeof RestaurantService.loadContext>>;
}

function makeInitiatedPayload(
  overrides: Partial<{
    call_control_id: string;
    call_leg_id: string;
    from: string;
    to: string;
  }> = {},
) {
  return {
    data: {
      event_type: 'call.initiated',
      payload: {
        call_control_id: 'cc-1',
        call_leg_id: 'leg-1',
        from: '+33****0001',
        to: '+33****0000',
        direction: 'incoming',
        ...overrides,
      },
    },
  };
}

function makeHangupPayload(
  overrides: Partial<{
    call_control_id: string;
    call_leg_id: string;
    from: string;
    to: string;
    duration_sec: number;
  }> = {},
) {
  return {
    data: {
      event_type: 'call.hangup',
      payload: {
        call_control_id: 'cc-1',
        call_leg_id: 'leg-1',
        from: '+33****0001',
        to: '+33****0000',
        direction: 'incoming',
        duration_sec: 42,
        ...overrides,
      },
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('POST /voice/telnyx — call.initiated', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    delete process.env.VIP_PUSH_ENABLED;
    // Each test gets a fresh CallSessionManager singleton
    (CallSessionManager as unknown as { instance: CallSessionManager }).instance =
      new CallSessionManager();
    app = await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  it('happy path: pre-creates the session and enqueues the answer job', async () => {
    mockLoadContext.mockResolvedValue(makeRestaurantCtx());
    mockCheckMarginHealth.mockResolvedValue(true);
    mockIsVoicePipelineEnabled.mockResolvedValue(true);
    mockLookupOrCreate.mockResolvedValue({
      id: 'cust-1',
      name: 'Jean',
      visitCount: 0,
      isVip: false,
      specialOccasion: null,
      notes: null,
      lastCallAt: null,
      partySizeTypical: null,
    });
    mockBuildVipPromptExtra.mockReturnValue('');

    const res = await app.inject({
      method: 'POST',
      url: '/voice/telnyx',
      payload: makeInitiatedPayload(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: 'ok' });

    expect(mockLoadContext).toHaveBeenCalledWith('+33****0000');
    expect(mockCheckMarginHealth).toHaveBeenCalledWith('rest-1');
    expect(mockIsVoicePipelineEnabled).toHaveBeenCalledWith('rest-1');
    expect(mockLookupOrCreate).toHaveBeenCalledWith('rest-1', '+33****0001');

    expect(db.call.create).toHaveBeenCalledWith({
      data: {
        callSid: 'leg-1',
        restaurantId: 'rest-1',
        carrier: 'telnyx',
      },
    });

    // Session was pre-created so the WS start event can find it.
    const mgr = CallSessionManager.getInstance();
    const session = mgr.get('cc-1');
    expect(session).toBeDefined();
    expect(session!.restaurantId).toBe('rest-1');
    expect(session!.callLegId).toBe('leg-1');
    expect(session!.state).toBe('IDLE');
    expect(session!.codec).toBe('PCMA');
    expect(session!.isVip).toBe(false);

    // Answer job was enqueued
    expect(queues.telnyxWebhooks.add).toHaveBeenCalledWith(
      'answer-call',
      expect.objectContaining({
        callControlId: 'cc-1',
        callLegId: 'leg-1',
        codec: 'PCMA',
        streamUrl: expect.stringMatching(/^wss:\/\/.*\/voice\/stream\/cc-1$/),
        idempotencyKey: expect.any(String),
      }),
      { jobId: expect.any(String) },
    );
  });

  it('returns 200 and does nothing when loadContext throws (unknown phone number)', async () => {
    mockLoadContext.mockRejectedValue(new Error('Restaurant not found'));

    const res = await app.inject({
      method: 'POST',
      url: '/voice/telnyx',
      payload: makeInitiatedPayload({ to: '+33****9999' }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: 'ok' });
    expect(mockCheckMarginHealth).not.toHaveBeenCalled();
    expect(queues.telnyxWebhooks.add).not.toHaveBeenCalled();
    expect(CallSessionManager.getInstance().get('cc-1')).toBeUndefined();
  });

  it('drops the call when margin health (circuit breaker) is unsafe', async () => {
    mockLoadContext.mockResolvedValue(makeRestaurantCtx());
    mockCheckMarginHealth.mockResolvedValue(false);

    const res = await app.inject({
      method: 'POST',
      url: '/voice/telnyx',
      payload: makeInitiatedPayload(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: 'ok' });
    expect(mockIsVoicePipelineEnabled).not.toHaveBeenCalled();
    expect(queues.telnyxWebhooks.add).not.toHaveBeenCalled();
    expect(CallSessionManager.getInstance().get('cc-1')).toBeUndefined();
  });

  it('drops the call when the voice pipeline feature flag is off (kill switch)', async () => {
    mockLoadContext.mockResolvedValue(makeRestaurantCtx());
    mockCheckMarginHealth.mockResolvedValue(true);
    mockIsVoicePipelineEnabled.mockResolvedValue(false);

    const res = await app.inject({
      method: 'POST',
      url: '/voice/telnyx',
      payload: makeInitiatedPayload(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: 'ok' });
    expect(mockLookupOrCreate).not.toHaveBeenCalled();
    expect(queues.telnyxWebhooks.add).not.toHaveBeenCalled();
    expect(CallSessionManager.getInstance().get('cc-1')).toBeUndefined();
  });

  it('sends a VIP push notification when the caller is VIP and VIP_PUSH_ENABLED=true', async () => {
    process.env.VIP_PUSH_ENABLED = 'true';
    mockLoadContext.mockResolvedValue(makeRestaurantCtx());
    mockCheckMarginHealth.mockResolvedValue(true);
    mockIsVoicePipelineEnabled.mockResolvedValue(true);
    mockLookupOrCreate.mockResolvedValue({
      id: 'cust-vip',
      name: 'Mme Dupont',
      visitCount: 12,
      isVip: true,
      specialOccasion: null,
      notes: null,
      lastCallAt: null,
      partySizeTypical: null,
    });
    mockBuildVipPromptExtra.mockReturnValue('⭐ VIP — Mme Dupont, 12 visites.');

    const res = await app.inject({
      method: 'POST',
      url: '/voice/telnyx',
      payload: makeInitiatedPayload(),
    });

    expect(res.statusCode).toBe(200);
    expect(queues.smsManager.add).toHaveBeenCalledWith(
      'vip-alert',
      expect.objectContaining({
        restaurantId: 'rest-1',
        message: '⭐ VIP en ligne : Mme Dupont — appel entrant',
      }),
      { jobId: expect.any(String) },
    );
  });

  it('does NOT send a VIP push when VIP_PUSH_ENABLED is unset (default off)', async () => {
    // process.env.VIP_PUSH_ENABLED is deleted in beforeEach
    mockLoadContext.mockResolvedValue(makeRestaurantCtx());
    mockCheckMarginHealth.mockResolvedValue(true);
    mockIsVoicePipelineEnabled.mockResolvedValue(true);
    mockLookupOrCreate.mockResolvedValue({
      id: 'cust-vip',
      name: 'Mme Dupont',
      visitCount: 12,
      isVip: true,
      specialOccasion: null,
      notes: null,
      lastCallAt: null,
      partySizeTypical: null,
    });
    mockBuildVipPromptExtra.mockReturnValue('');

    const res = await app.inject({
      method: 'POST',
      url: '/voice/telnyx',
      payload: makeInitiatedPayload(),
    });

    expect(res.statusCode).toBe(200);
    expect(queues.smsManager.add).not.toHaveBeenCalled();
  });

  it('handles missing caller (payload.from absent) without throwing', async () => {
    mockLoadContext.mockResolvedValue(makeRestaurantCtx());
    mockCheckMarginHealth.mockResolvedValue(true);
    mockIsVoicePipelineEnabled.mockResolvedValue(true);
    mockBuildVipPromptExtra.mockReturnValue('');

    const payload = makeInitiatedPayload();
    delete (payload.data.payload as Record<string, unknown>).from;

    const res = await app.inject({
      method: 'POST',
      url: '/voice/telnyx',
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(mockLookupOrCreate).not.toHaveBeenCalled();
    const session = CallSessionManager.getInstance().get('cc-1');
    expect(session).toBeDefined();
    expect(session!.isVip).toBe(false);
  });

  it('swallows Prisma P2002 (duplicate call record) silently on retry', async () => {
    mockLoadContext.mockResolvedValue(makeRestaurantCtx());
    mockCheckMarginHealth.mockResolvedValue(true);
    mockIsVoicePipelineEnabled.mockResolvedValue(true);
    mockLookupOrCreate.mockResolvedValue({
      id: 'cust-1',
      name: null,
      visitCount: 0,
      isVip: false,
      specialOccasion: null,
      notes: null,
      lastCallAt: null,
      partySizeTypical: null,
    });
    mockBuildVipPromptExtra.mockReturnValue('');

    const dupError = new Error('Unique constraint failed') as Error & { code: string };
    dupError.code = 'P2002';
    vi.mocked(db.call.create).mockRejectedValueOnce(dupError);

    const res = await app.inject({
      method: 'POST',
      url: '/voice/telnyx',
      payload: makeInitiatedPayload(),
    });

    // The .catch() on db.call.create must swallow P2002.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: 'ok' });
  });
});

describe('POST /voice/telnyx — call.hangup', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    (CallSessionManager as unknown as { instance: CallSessionManager }).instance =
      new CallSessionManager();
    app = await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  it('updates the call duration in seconds (rounded)', async () => {
    vi.mocked(db.call.findUnique).mockResolvedValue({ reservation: null } as unknown as Awaited<
      ReturnType<typeof db.call.findUnique>
    >);

    const res = await app.inject({
      method: 'POST',
      url: '/voice/telnyx',
      payload: makeHangupPayload({ duration_sec: 42.7 }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: 'ok' });
    expect(db.call.update).toHaveBeenCalledWith({
      where: { callSid: 'leg-1' },
      data: { durationSec: 43 },
    });
  });

  it('skips the duration update when duration_sec is missing', async () => {
    vi.mocked(db.call.findUnique).mockResolvedValue({ reservation: null } as unknown as Awaited<
      ReturnType<typeof db.call.findUnique>
    >);
    const payload = makeHangupPayload();
    delete (payload.data.payload as Record<string, unknown>).duration_sec;

    const res = await app.inject({
      method: 'POST',
      url: '/voice/telnyx',
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(db.call.update).not.toHaveBeenCalled();
  });

  it('increments the customer visit count when the call produced a reservation', async () => {
    vi.mocked(db.call.findUnique).mockResolvedValue({
      reservation: { id: 'res-1' },
    } as unknown as Awaited<ReturnType<typeof db.call.findUnique>>);
    mockLoadContext.mockResolvedValue(makeRestaurantCtx());

    const res = await app.inject({
      method: 'POST',
      url: '/voice/telnyx',
      payload: makeHangupPayload(),
    });

    expect(res.statusCode).toBe(200);
    expect(mockLoadContext).toHaveBeenCalledWith('+33****0000');
    expect(mockIncrementVisit).toHaveBeenCalledWith('rest-1', '+33****0001');
  });

  it('does NOT increment visits when the call had no reservation', async () => {
    vi.mocked(db.call.findUnique).mockResolvedValue({ reservation: null } as unknown as Awaited<
      ReturnType<typeof db.call.findUnique>
    >);

    const res = await app.inject({
      method: 'POST',
      url: '/voice/telnyx',
      payload: makeHangupPayload(),
    });

    expect(res.statusCode).toBe(200);
    expect(mockIncrementVisit).not.toHaveBeenCalled();
  });
});

describe('POST /voice/telnyx — unhandled event types', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  it('returns { result: "ignored" } for unknown event types (no side effects)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/voice/telnyx',
      payload: {
        data: {
          event_type: 'call.something.weird',
          payload: {
            call_control_id: 'cc-x',
            call_leg_id: 'leg-x',
            from: '+33****0001',
            to: '+33****0000',
            direction: 'incoming',
          },
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: 'ignored' });
    expect(mockLoadContext).not.toHaveBeenCalled();
    expect(queues.telnyxWebhooks.add).not.toHaveBeenCalled();
  });
});

describe('POST /voice/telnyx — call.recording.saved', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.CALL_RECORDING_ENABLED = 'true';
    app = await getApp();
  });

  afterAll(async () => {
    delete process.env.CALL_RECORDING_ENABLED;
    await closeApp();
  });

  it('enqueues immediate private storage of the MP3', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/voice/telnyx',
      payload: {
        data: {
          event_type: 'call.recording.saved',
          payload: {
            call_control_id: 'cc-1',
            call_leg_id: 'leg-1',
            from: '+33****0001',
            to: '+33****0000',
            direction: 'incoming',
            recording_id: 'rec-1',
            recording_urls: { mp3: 'https://recordings.telnyx.com/signed.mp3' },
            started_at: '2026-07-22T10:00:00.000Z',
            ended_at: '2026-07-22T10:01:00.000Z',
          },
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(queues.telnyxWebhooks.add).toHaveBeenCalledWith(
      'store-recording',
      expect.objectContaining({
        callLegId: 'leg-1',
        recordingId: 'rec-1',
        downloadUrl: 'https://recordings.telnyx.com/signed.mp3',
      }),
      { jobId: expect.any(String) },
    );
  });
});

// ─── /voice/telnyx/end — restaurantId resolution regression suite ──────────
//
// Background: the guard (telnyxWebhookGuard) only verifies the Ed25519
// signature; it does NOT populate `req.restaurantId`. Pre-fix, the /end route
// used `req.restaurantId ?? ''` as the fallback in db.call.upsert({create}),
// which silently created orphan Call rows (Prisma FK violation, masked by the
// upsert error path). The fix resolves restaurantId from (1) an authMiddleware
// attribute, then (2) RestaurantService.loadContext(req.body.to), and refuses
// with 400 if neither is available.

describe('POST /voice/telnyx/end — restaurantId resolution', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    (CallSessionManager as unknown as { instance: CallSessionManager }).instance =
      new CallSessionManager();
    app = await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  function makeEndPayload(overrides: Record<string, unknown> = {}) {
    return {
      call_leg_id: 'leg-end-1',
      transcript: null,
      ended_reason: null,
      started_at: null,
      ended_at: null,
      stt_provider: null,
      llm_provider: null,
      tts_provider: null,
      from: '+33****0001',
      to: '+33****0000',
      ...overrides,
    };
  }

  it('resolves restaurantId via loadContext(to) when req.restaurantId is unset', async () => {
    mockLoadContext.mockResolvedValue(makeRestaurantCtx());
    vi.mocked(db.call.upsert).mockResolvedValue({ id: 'call-1' } as unknown as Awaited<
      ReturnType<typeof db.call.upsert>
    >);

    const res = await app.inject({
      method: 'POST',
      url: '/voice/telnyx/end',
      payload: makeEndPayload(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });
    expect(mockLoadContext).toHaveBeenCalledWith('+33****0000');
    expect(db.call.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          callSid: 'leg-end-1',
          restaurantId: 'rest-1',
        }),
      }),
    );
  });

  it('returns 400 when neither req.restaurantId nor `to` can resolve a restaurant', async () => {
    // No `to` in payload, no req.restaurantId
    const res = await app.inject({
      method: 'POST',
      url: '/voice/telnyx/end',
      payload: { call_leg_id: 'leg-orphan' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'restaurantId is required' });
    expect(db.call.upsert).not.toHaveBeenCalled();
  });

  it('returns 400 when `to` is present but loadContext cannot find a restaurant', async () => {
    mockLoadContext.mockRejectedValue(new Error('Restaurant not found'));

    const res = await app.inject({
      method: 'POST',
      url: '/voice/telnyx/end',
      payload: makeEndPayload({ to: '+33****9999' }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'restaurantId is required' });
    expect(db.call.upsert).not.toHaveBeenCalled();
  });
});

// ─── /voice/telnyx — call.initiated — non-P2002 Prisma errors must throw ──
//
// Background: pre-fix, the .catch on db.call.create logged non-P2002 errors
// and then silently continued, leaving the system in a DB-inconsistent state
// (call record missing, session created, answer job enqueued, audio flowing).
// The fix narrows the catch to P2002 only and re-throws everything else so
// Fastify returns 500 and the webhook is retried by Telnyx.

describe('POST /voice/telnyx — call.initiated — non-P2002 Prisma error handling', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    (CallSessionManager as unknown as { instance: CallSessionManager }).instance =
      new CallSessionManager();
    app = await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  it('rethrows a non-P2002 Prisma error from db.call.create (returns 500)', async () => {
    mockLoadContext.mockResolvedValue(makeRestaurantCtx());
    mockCheckMarginHealth.mockResolvedValue(true);
    mockIsVoicePipelineEnabled.mockResolvedValue(true);
    mockLookupOrCreate.mockResolvedValue({
      id: 'cust-1',
      name: null,
      visitCount: 0,
      isVip: false,
      specialOccasion: null,
      notes: null,
      lastCallAt: null,
      partySizeTypical: null,
    });
    mockBuildVipPromptExtra.mockReturnValue('');

    const fkError = new Error('Foreign key constraint failed') as Error & { code: string };
    fkError.code = 'P2003';
    vi.mocked(db.call.create).mockRejectedValueOnce(fkError);

    const res = await app.inject({
      method: 'POST',
      url: '/voice/telnyx',
      payload: makeInitiatedPayload(),
    });

    // P2003 is not a benign race — the row genuinely failed to write.
    // The handler must surface the failure (5xx) so the webhook is retried.
    expect(res.statusCode).toBeGreaterThanOrEqual(500);

    // Session must NOT have been pre-created: we abort before any side effects.
    const session = CallSessionManager.getInstance().get('cc-1');
    expect(session).toBeUndefined();
    expect(queues.telnyxWebhooks.add).not.toHaveBeenCalled();
  });
});
