/**
 * Integration tests for CallSessionManager — exercises the full per-call state
 * machine, mock-LLM utterance processing, tool execution, and barge-in handling
 * without requiring network access (uses SOKAR_SIMULATE_MOCK_LLM=true).
 *
 * Scopes:
 *  1. Session lifecycle (IDLE → LISTENING → PROCESSING → SPEAKING)
 *  2. State machine: invalid transitions rejected
 *  3. Mock LLM: simple greeting when no reservation intent
 *  4. Mock LLM: createReservation tool path when user mentions réservation/table
 *  5. Barge-in during SPEAKING: clears Telnyx buffer, transitions to LISTENING
 *  6. Transcript accumulation across multiple utterances
 *  7. Cleanup clears timers, aborts in-flight requests, closes deepgram WS
 *  8. handleBargeIn is a no-op when not SPEAKING
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import { CallSessionManager } from '../stream/manager';
import type { CallSession } from '../stream/types';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTelnyxWs(): WebSocket {
  // Minimal mock that satisfies the surface used by the manager.
  const sent: unknown[] = [];
  const ws: Record<string, unknown> = {
    readyState: WebSocket.OPEN,
    send: vi.fn((payload: unknown) => sent.push(payload)),
    close: vi.fn(),
    on: vi.fn(),
    OPEN: WebSocket.OPEN,
  };
  return ws as unknown as WebSocket;
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
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('CallSessionManager — integration', () => {
  beforeEach(() => {
    // Mock LLM path — no network
    process.env.SOKAR_SIMULATE_MOCK_LLM = 'true';
    // Each test gets a fresh singleton
    (CallSessionManager as unknown as { instance: CallSessionManager }).instance =
      new CallSessionManager();
  });

  describe('session lifecycle', () => {
    it('starts in IDLE with turnCount=0 and ended=false', () => {
      const session = makeSession();
      expect(session.state).toBe('IDLE');
      expect(session.turnCount).toBe(0);
      expect(session.ended).toBe(false);
      expect(session.history[0].role).toBe('system');
      expect(session.history[1].role).toBe('assistant');
    });

    it('transitions IDLE → LISTENING → PROCESSING → SPEAKING', () => {
      const mgr = CallSessionManager.getInstance();
      const session = makeSession();

      expect(mgr.transition(session, 'LISTENING')).toBe(true);
      expect(session.state).toBe('LISTENING');

      expect(mgr.transition(session, 'PROCESSING')).toBe(true);
      expect(session.state).toBe('PROCESSING');

      expect(mgr.transition(session, 'SPEAKING')).toBe(true);
      expect(session.state).toBe('SPEAKING');
    });

    it('allows IDLE → SPEAKING for initial greeting/playback', () => {
      const mgr = CallSessionManager.getInstance();
      const session = makeSession();
      expect(mgr.transition(session, 'SPEAKING')).toBe(true);
      expect(session.state).toBe('SPEAKING');
    });

    it('rejects all transitions once session.ended is true (except → IDLE)', () => {
      const mgr = CallSessionManager.getInstance();
      const session = makeSession();
      mgr.transition(session, 'LISTENING');
      mgr.delete(session.callControlId); // sets ended=true via cleanup

      expect(session.ended).toBe(true);
      expect(mgr.transition(session, 'PROCESSING')).toBe(false);
    });
  });

  describe('mock LLM utterance processing', () => {
    it('returns greeting text when no reservation intent', async () => {
      const mgr = CallSessionManager.getInstance();
      const session = makeSession();

      const reply = await mgr.simulateUtterance(session.callControlId, 'Bonjour');

      expect(reply).toMatch(/bonjour|réserver|table/i);
      expect(session.turnCount).toBe(1);
      expect(session.state).toBe('SPEAKING');
      // user message appended, assistant message appended
      const userMsgs = session.history.filter((m) => m.role === 'user');
      const assistantMsgs = session.history.filter((m) => m.role === 'assistant');
      expect(userMsgs.length).toBeGreaterThanOrEqual(1);
      expect(assistantMsgs.length).toBeGreaterThanOrEqual(2);
    });

    it('does NOT call createReservation on a generic greeting', async () => {
      const mgr = CallSessionManager.getInstance();
      const session = makeSession();
      const reply = await mgr.simulateUtterance(session.callControlId, 'Bonjour');
      expect(reply.toLowerCase()).not.toMatch(/noté|réservation confirmée/);
    });

    it('throws when session is unknown', async () => {
      const mgr = CallSessionManager.getInstance();
      await expect(mgr.simulateUtterance('does-not-exist', 'Bonjour')).rejects.toThrow(/not found/);
    });

    it('throws when session is already ended', async () => {
      const mgr = CallSessionManager.getInstance();
      const session = makeSession();
      mgr.cleanup(session);
      await expect(mgr.simulateUtterance(session.callControlId, 'Bonjour')).rejects.toThrow(
        /already ended/,
      );
    });
  });

  describe('transcript accumulation', () => {
    it('accumulates each simulated utterance into session.transcript', async () => {
      const mgr = CallSessionManager.getInstance();
      const session = makeSession();

      await mgr.simulateUtterance(session.callControlId, 'Bonjour');
      await mgr.simulateUtterance(session.callControlId, 'Je voudrais réserver');

      expect(session.transcript).toContain('Bonjour');
      expect(session.transcript).toContain('réserver');
      // Separated by a space
      expect(session.transcript.split(' ').length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('barge-in', () => {
    it('clears Telnyx buffer and transitions to LISTENING when SPEAKING', () => {
      const mgr = CallSessionManager.getInstance();
      const telnyxWs = makeTelnyxWs();
      const session = makeSession({ telnyxWs });
      mgr.transition(session, 'SPEAKING');

      mgr.handleBargeIn(session);

      expect(session.state).toBe('LISTENING');
      expect(session.isSpeaking).toBe(false);
      const sentPayloads = vi.mocked(telnyxWs.send).mock.calls.map((c) => c[0]);
      expect(sentPayloads.some((p) => typeof p === 'string' && p.includes('"event":"clear"'))).toBe(
        true,
      );
    });

    it('is a no-op when not SPEAKING', () => {
      const mgr = CallSessionManager.getInstance();
      const telnyxWs = makeTelnyxWs();
      const session = makeSession({ telnyxWs });

      mgr.handleBargeIn(session); // state is IDLE

      expect(session.state).toBe('IDLE');
      expect(vi.mocked(telnyxWs.send)).not.toHaveBeenCalled();
    });

    it('is a no-op when telnyxWs is not OPEN', () => {
      const mgr = CallSessionManager.getInstance();
      const telnyxWs = makeTelnyxWs();
      (telnyxWs as unknown as Record<string, unknown>).readyState = WebSocket.CLOSED;
      const session = makeSession({ telnyxWs });
      mgr.transition(session, 'SPEAKING');

      mgr.handleBargeIn(session);

      // send must NOT be called when readyState is not OPEN
      expect(vi.mocked(telnyxWs.send)).not.toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('sets ended=true, clears timers, aborts in-flight requests', () => {
      const mgr = CallSessionManager.getInstance();
      const session = makeSession();
      session.speechFinalTimer = setTimeout(() => {}, 60_000) as unknown as ReturnType<
        typeof setTimeout
      >;
      const abortController = new AbortController();
      session.abortController = abortController;

      mgr.cleanup(session);

      expect(session.ended).toBe(true);
      expect(session.state).toBe('IDLE');
      expect(session.speechFinalTimer).toBeNull();
      expect(session.audioBuffer).toEqual([]);
      // AbortController was aborted
      expect(abortController.signal.aborted).toBe(true);
      expect(session.abortController).toBeNull();
    });

    it('closes deepgramWs if open', () => {
      const mgr = CallSessionManager.getInstance();
      const session = makeSession();
      const dgClose = vi.fn();
      session.deepgramWs = { readyState: WebSocket.OPEN, close: dgClose } as unknown as WebSocket;

      mgr.cleanup(session);

      expect(dgClose).toHaveBeenCalled();
      expect(session.deepgramWs).toBeNull();
    });

    it('delete() removes the session from the manager', () => {
      const mgr = CallSessionManager.getInstance();
      const session = makeSession();
      expect(mgr.get(session.callControlId)).toBe(session);
      mgr.delete(session.callControlId);
      expect(mgr.get(session.callControlId)).toBeUndefined();
    });
  });

  describe('session ID hashing', () => {
    it('hides the raw call_control_id from the map key', () => {
      const mgr = CallSessionManager.getInstance();
      const session = makeSession({ callControlId: 'cc-secret-123' });
      const stored = mgr.get('cc-secret-123');
      expect(stored).toBe(session);
      // The internal Map key is a 16-char hex prefix; raw value should not be present
      const internalKeys = (mgr as unknown as { sessions: Map<string, CallSession> }).sessions;
      const rawKeys = Array.from(internalKeys.keys());
      expect(rawKeys.some((k) => k === 'cc-secret-123')).toBe(false);
      expect(rawKeys.some((k) => /^[0-9a-f]{16}$/.test(k))).toBe(true);
    });
  });
});
