/**
 * Preuve d'envoi de l'audio de l'agent vers Telnyx.
 * Les étapes de synthèse (TTS) ne prouvent pas que l'appelant a entendu quelque chose :
 * on compte donc les trames réellement écrites sur le WebSocket Telnyx et celles abandonnées.
 * Aucun texte ni numéro dans ces journaux.
 */
import { WebSocket } from 'ws';
import { logger } from '../../../shared/logger/pino';
import type { CallSession } from './types';

export interface OutboundAudioStats {
  frames: number;
  bytes: number;
  dropped: number;
  lastDropReason?: string;
}

function stats(session: CallSession): OutboundAudioStats {
  return (session.audioOut ??= { frames: 0, bytes: 0, dropped: 0 });
}

/** À appeler juste après `telnyxWs.send` d'une trame `media`. */
export function noteAudioFrameSent(session: CallSession, payloadBytes: number): void {
  const s = stats(session);
  s.frames++;
  s.bytes += payloadBytes;
  if (s.frames === 1) {
    logger.info(
      { callId: session.callControlId, codec: session.codec, state: session.state },
      '[audio-out] first frame sent to Telnyx',
    );
  }
}

/** Pourquoi la session n'accepte plus d'audio (mêmes conditions que `isSessionActiveForTts`). */
export function inactiveReason(session: CallSession, generation?: number): string {
  if (session.ended) return 'ended';
  if (session.state !== 'SPEAKING' && session.state !== 'CLOSING') return `state_${session.state}`;
  if (session.telnyxWs.readyState !== WebSocket.OPEN) {
    return `ws_readyState_${session.telnyxWs.readyState}`;
  }
  if (generation !== undefined && (session.ttsGeneration ?? 0) !== generation) {
    return 'tts_generation_changed';
  }
  return 'unknown';
}

/** Audio non envoyé parce que la session est devenue inactive (0 trame = coupé avant le premier octet). */
export function noteAudioDropped(session: CallSession, frames: number, generation?: number): void {
  const s = stats(session);
  s.dropped += frames;
  s.lastDropReason = inactiveReason(session, generation);
  logger.info(
    {
      callId: session.callControlId,
      droppedFrames: frames,
      reason: s.lastDropReason,
      sentSoFar: s.frames,
    },
    '[audio-out] frames dropped before sending',
  );
}

/** Bilan à la fin de l'appel : 0 trame envoyée = l'appelant n'a rien entendu. */
export function logAudioOutSummary(session: CallSession): void {
  const s = stats(session);
  logger.info(
    {
      callId: session.callControlId,
      framesSent: s.frames,
      bytesSent: s.bytes,
      framesDropped: s.dropped,
      lastDropReason: s.lastDropReason,
      wsReadyState: session.telnyxWs.readyState,
      wsBufferedAmount: session.telnyxWs.bufferedAmount,
    },
    '[audio-out] call summary',
  );
}
