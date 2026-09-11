import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import type { CallSession } from './types';
import type { CallSessionManager } from './manager';
import { speakTtsStreamed } from './tts-handler';
import { cancelScheduledFiller } from './filler-scheduler';
import { telnyxFetch } from '../../../shared/telnyx/http-agent';
import { logger } from '../../../shared/logger/pino';

/** A thank-you alone never authorizes hanging up during a reservation. */
export function isExplicitCallEnd(transcript: string): boolean {
  const normalized = transcript
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(?:(?:oui|non|merci|ok|d accord|tres bien|allez|thanks?|thank you|yes|no|okay)\s+)*(?:au revoir|bonne journee|bonne soiree|a bientot|a demain|c est tout|je raccroche|on arrete|laissez tomber|goodbye|bye|see you|that s all|hang up|have a good day|have a great day|have a good evening|have a great evening)(?:\s+(?:merci|au revoir|bonne journee|bonne soiree|a demain|thanks?|thank you))*$/.test(
    normalized,
  );
}

export function acknowledgeCallEnding(
  session: CallSession,
  name: string,
  source: 'media' | 'native' = 'media',
): void {
  if (!session.ending || session.ending.markName !== name || session.ended) return;
  if (source === 'media') session.ending.mediaCompleted = true;
  else session.ending.nativeCompleted = true;
  session.ending.playbackCompleted = Boolean(
    session.ending.mediaCompleted &&
    (!session.ending.nativePlayback || session.ending.nativeCompleted),
  );
  if (session.ending.playbackCompleted) session.ending.complete?.();
}

/** Stop accepting turns only after the caller explicitly ends the conversation. */
export async function finishCall(
  session: CallSession,
  mgr: CallSessionManager,
  goodbye: string,
): Promise<void> {
  if (session.ended || session.ending) return;
  session.abortController?.abort();
  session.abortController = null;
  session.speculativeLlm = null;
  session.speculativeResult = null;
  session.speculativeTranscript = '';
  session.responseGeneration++;
  session.ttsGeneration++;
  cancelScheduledFiller(session);
  session.ttsContext?.cancel();
  session.ttsContext = null;
  // Flush stale audio before installing our own mark; clear also acknowledges old marks.
  if (session.telnyxWs.readyState === WebSocket.OPEN) {
    session.telnyxWs.send(JSON.stringify({ event: 'clear' }));
  }
  const ending = {
    markName: `goodbye-${randomUUID()}`,
    nativePlayback: false,
    playbackCompleted: false,
  } as NonNullable<CallSession['ending']>;
  session.ending = ending;
  mgr.transition(session, 'CLOSING');
  session.conversation.closing = true;
  try {
    await speakTtsStreamed(session, goodbye);
    if (session.ended) return;
    await new Promise<void>((resolve) => {
      ending.complete = resolve;
      if (ending.playbackCompleted) return resolve();
      // Safety bound if a provider drops the mark/webhook. The short goodbye has
      // already been sent; never cut it on an immediate empty-queue native mark.
      ending.timer = setTimeout(() => {
        logger.warn(
          { callId: session.callControlId },
          '[voice-ending] Playback acknowledgement timed out',
        );
        resolve();
      }, 15_000);
      if (session.telnyxWs.readyState === WebSocket.OPEN) {
        session.telnyxWs.send(JSON.stringify({ event: 'mark', mark: { name: ending.markName } }));
      }
    });
  } catch (err) {
    logger.error({ err, callId: session.callControlId }, '[voice-ending] Goodbye playback failed');
  } finally {
    if (ending.timer) clearTimeout(ending.timer);
    ending.complete = undefined;
  }
  if (session.ended) return;
  // Reuse one command id for the bounded retry: a network timeout must not issue
  // a logically different hangup command. Normal stream-stop/webhook does cleanup.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await telnyxFetch(`/v2/calls/${session.callControlId}/actions/hangup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
        },
        body: JSON.stringify({ command_id: ending.markName }),
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) {
        mgr.cleanup(session);
        return;
      }
      logger.warn(
        { status: response.status, callId: session.callControlId },
        '[voice-ending] Hangup rejected',
      );
      if (response.status < 500 && response.status !== 429) break;
    } catch (err) {
      logger.warn({ err, callId: session.callControlId }, '[voice-ending] Hangup failed');
    }
    if (session.ended) return;
  }
  // Remain terminal even when Telnyx rejects hangup, until the caller disconnects.
  logger.error({ callId: session.callControlId }, '[voice-ending] Could not hang up call');
}
