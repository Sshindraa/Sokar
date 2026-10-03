/**
 * Integration tests for CallSessionManager — exercises the per-call state machine and barge-in
 * handling without requiring network access.
 *
 * Scopes:
 *  1. Session lifecycle (IDLE → LISTENING → PROCESSING → SPEAKING)
 *  2. State machine: invalid transitions rejected
 *  3. Barge-in during SPEAKING: clears Telnyx buffer, transitions to LISTENING
 *  4. Cleanup clears timers, aborts in-flight requests, closes the STT socket
 *  5. handleBargeIn is a no-op when not SPEAKING
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

    it('cancels the active Cartesia context and invalidates its generation', () => {
      const mgr = CallSessionManager.getInstance();
      const session = makeSession();
      const cancel = vi.fn();
      session.ttsContext = { cancel };
      mgr.transition(session, 'SPEAKING');

      mgr.handleBargeIn(session);

      expect(cancel).toHaveBeenCalledOnce();
      expect(session.ttsContext).toBeNull();
      expect(session.ttsGeneration).toBe(1);
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

    it('closes sttWs if open', () => {
      const mgr = CallSessionManager.getInstance();
      const session = makeSession();
      const dgClose = vi.fn();
      session.sttWs = { readyState: WebSocket.OPEN, close: dgClose } as unknown as WebSocket;

      mgr.cleanup(session);

      expect(dgClose).toHaveBeenCalled();
      expect(session.sttWs).toBeNull();
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
