/**
 * Logique TTS (Text-to-Speech) — Cartesia + fallback Telnyx native.
 *
 * Extrait de handler.ts. Ces fonctions prennent une CallSession en
 * paramètre et lisent son état (state, ended, telnyxWs, codec,
 * latencyTrace) mais ne mutent que latencyTrace (pour la télémétrie).
 */

import { WebSocket } from 'ws';
import type { CallSession } from './types';
import { getTtsCached, setTtsCached } from '../tts-cache';
import { logger } from '../../../shared/logger/pino';
import { captureException } from '../../../shared/sentry/client';
import { writeDebugLog } from './debug-log';
import { persistLatencyTrace } from './session-persistence';
import {
  CARTESIA_RETRY_DELAY_MS,
  CARTESIA_TTS_MAX_ATTEMPTS,
  TTS_FRAME_BYTES,
  TTS_INITIAL_BUFFER_FRAMES,
  TTS_UNDERFEED_PAUSE_MS,
  TTS_PACE_PAUSE_MS,
} from './constants';
import { splitTelnyxAudioFrames } from './audio-frames';

export function isSessionActiveForTts(
  session: CallSession,
  expectedResponseGeneration?: number,
): boolean {
  return (
    !session.ended &&
    session.state === 'SPEAKING' &&
    session.telnyxWs.readyState === WebSocket.OPEN &&
    (expectedResponseGeneration === undefined ||
      session.responseGeneration === expectedResponseGeneration)
  );
}

function persistFirstAudioFrame(session: CallSession): void {
  if (!session.latencyTrace || session.latencyTrace.totalE2eMs) return;

  session.latencyTrace.totalE2eMs = Date.now() - session.latencyTrace.startTime;
  persistLatencyTrace(session).catch((err) =>
    logger.error(
      { err, callId: session.callControlId },
      '[speakTtsStreamed] persistLatencyTrace failed',
    ),
  );
}

async function sendPacedAudioFrames(
  session: CallSession,
  audio: Buffer,
  expectedResponseGeneration?: number,
): Promise<number> {
  const frames = splitTelnyxAudioFrames(audio, session.codec);
  let framesSent = 0;

  for (const frame of frames) {
    if (!isSessionActiveForTts(session, expectedResponseGeneration)) break;
    session.telnyxWs.send(
      JSON.stringify({
        event: 'media',
        media: { payload: frame.toString('base64') },
      }),
    );
    framesSent++;
    persistFirstAudioFrame(session);
    await new Promise((resolve) => setTimeout(resolve, TTS_PACE_PAUSE_MS));
  }

  return framesSent;
}

/**
 * Ajoute des pauses naturelles dans le texte en forçant la ponctuation.
 * Cartesia sonic-3.5 marque une pause sur les virgules et points.
 */
export function addNaturalPauses(text: string): string {
  let result = text
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Forcer un point à la fin si absent
  if (!/[.!?]$/.test(result)) result += '.';

  return result;
}

export function cleanTextForTts(text: string): string {
  let cleaned = text;

  // 1. Remove emojis
  cleaned = cleaned.replace(
    /[\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/gu,
    '',
  );

  // 2. Remove Markdown bold/italic
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
  cleaned = cleaned.replace(/\*([^*]+)\*/g, '$1');
  cleaned = cleaned.replace(/__([^_]+)__/g, '$1');
  cleaned = cleaned.replace(/_([^_]+)_/g, '$1');

  // 3. Normalise time patterns (e.g. 19h -> 19 heures)
  cleaned = cleaned.replace(/\b(\d+)\s*h\b/g, '$1 heures');

  // 4. Space out alphanumeric codes (e.g. BB344719 -> B. B. 3. 4. 4. 7. 1. 9.)
  cleaned = cleaned.replace(/\b([A-Z0-9]{5,})\b/g, (match) => {
    if (/\d/.test(match)) {
      return match.split('').join('. ');
    }
    return match;
  });

  return cleaned.trim();
}

export async function speakTelnyxNative(session: CallSession, text: string): Promise<void> {
  writeDebugLog(`[speakTelnyxNative] Sending native Telnyx TTS speak command for: "${text}"`);
  try {
    const res = await fetch(
      `https://api.telnyx.com/v2/calls/${session.callControlId}/actions/speak`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
        },
        body: JSON.stringify({
          payload: text,
          voice: 'female',
          language: 'fr-FR',
          payload_type: 'text',
        }),
      },
    );
    if (!res.ok) {
      const errText = await res.text();
      writeDebugLog(`[speakTelnyxNative] Telnyx native speak failed: ${res.status} ${errText}`);
    } else {
      writeDebugLog(`[speakTelnyxNative] Telnyx native speak command sent successfully`);
    }
  } catch (err: unknown) {
    writeDebugLog(`[speakTelnyxNative] Error in Telnyx native speak`, err);
  }
}

/**
 * Découpe le texte en phrases pour un streaming progressif.
 * Envoie chaque phrase séparément à Cartesia avec un délai inter-phrase
 * pour un rendu plus naturel.
 * Consomme le stream HTTP de Cartesia au fil de l'eau.
 */
export async function speakTtsStreamed(
  session: CallSession,
  text: string,
  expectedResponseGeneration?: number,
): Promise<void> {
  const cleanedText = cleanTextForTts(text);
  if (!cleanedText) return;
  if (!isSessionActiveForTts(session, expectedResponseGeneration)) {
    writeDebugLog(
      `[speakTtsStreamed] Session inactive, state=${session.state}, ended=${session.ended}, skipping synthesis`,
    );
    return;
  }

  writeDebugLog(
    `[speakTtsStreamed] Starting synthesis for text: "${cleanedText}" (original: "${text}")`,
  );

  const isAlaw = session.codec === 'PCMA';
  const textWithPauses = addNaturalPauses(cleanedText);
  const sentences = textWithPauses.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);

  writeDebugLog(`[speakTtsStreamed] Split into ${sentences.length} sentences`);

  const apiKey = process.env.CARTESIA_API_KEY;
  const voiceId = process.env.CARTESIA_VOICE_ID;
  if (!apiKey || !voiceId) {
    await speakTelnyxNative(
      session,
      'Désolé, je rencontre une petite difficulté technique. Pouvez-vous répéter ?',
    );
    return;
  }

  // Clé de cache distincte par codec Telnyx (PCMA vs PCMU) — un buffer 24k pcm
  // n'est PAS réutilisable en 8k alaw. Inclure le format garantit l'invalidation
  // des anciens caches après migration 24k→8k.
  const cacheVoiceId = `${voiceId}|sonic-3.5|${isAlaw ? 'alaw8k' : 'mulaw8k'}`;

  // ─── Traitement séquentiel avec pause inter-phrase ──────────────────
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    if (!isSessionActiveForTts(session, expectedResponseGeneration)) {
      writeDebugLog(`[speakTtsStreamed] Session inactive before sentence ${i}, stopping`);
      break;
    }

    // Pause inter-phrase (sauf pour la première)
    // 80ms : pause naturelle suffisante entre phrases, sans ajouter de latence perçue.
    // (précédemment 150ms — réduit pour améliorer la réactivité perçue)
    if (i > 0) {
      writeDebugLog(`[speakTtsStreamed] Inter-sentence pause of 80ms...`);
      await new Promise((r) => setTimeout(r, 80));
      if (!isSessionActiveForTts(session, expectedResponseGeneration)) {
        writeDebugLog(`[speakTtsStreamed] Session inactive after pause, breaking loop`);
        break;
      }
    }

    // 1. Tenter le cache
    let cachedBuffer: Buffer | null = null;
    try {
      cachedBuffer = await getTtsCached(trimmed, cacheVoiceId);
    } catch (err: unknown) {
      writeDebugLog(`[speakTtsStreamed] TTS cache read failed`, err);
    }

    if (cachedBuffer) {
      writeDebugLog(`[speakTtsStreamed] Cache HIT for sentence: "${trimmed}"`);
      if (session.latencyTrace && !session.latencyTrace.ttsFirstByteMs) {
        session.latencyTrace.ttsFirstByteMs = Date.now() - session.latencyTrace.startTime;
      }

      const framesSent = await sendPacedAudioFrames(
        session,
        cachedBuffer,
        expectedResponseGeneration,
      );
      writeDebugLog(
        `[speakTtsStreamed] Sent ${framesSent} cached audio frames to Telnyx for sentence ${i}`,
      );
      continue;
    }

    // 2. Cache MISS ➔ Requête de streaming à Cartesia (avec 1 retry)
    writeDebugLog(
      `[speakTtsStreamed] Cache MISS. Streaming from Cartesia for sentence: "${trimmed}"`,
    );
    try {
      // Demander directement à Cartesia le format compatible Telnyx Media Stream
      // (G.711 alaw/mulaw 8kHz) → supprime le downsampling applicatif 24k→8k
      // et économise ~30% CPU sur le VPS.
      const cartesiaBody = JSON.stringify({
        model_id: 'sonic-3.5',
        transcript: trimmed,
        voice: { mode: 'id', id: voiceId },
        output_format: {
          container: 'raw',
          encoding: isAlaw ? 'pcm_alaw' : 'pcm_mulaw',
          sample_rate: 8000,
        },
      });

      let response: Response | null = null;
      for (let attempt = 0; attempt < CARTESIA_TTS_MAX_ATTEMPTS; attempt++) {
        response = await fetch('https://api.cartesia.ai/tts/bytes', {
          method: 'POST',
          headers: {
            'Cartesia-Version': '2026-03-01',
            'X-API-Key': apiKey,
            'Content-Type': 'application/json',
          },
          body: cartesiaBody,
        });
        if (response.ok) break;
        if (attempt === 0 && (response.status >= 500 || response.status === 429)) {
          writeDebugLog(
            `[speakTtsStreamed] Cartesia ${response.status}, retrying in ${CARTESIA_RETRY_DELAY_MS}ms...`,
          );
          await new Promise((r) => setTimeout(r, CARTESIA_RETRY_DELAY_MS));
          continue;
        }
        break; // 4xx non-retryable ou 2e échec
      }

      if (!response || !response.ok) {
        const status = response?.status ?? 0;
        writeDebugLog(`[speakTtsStreamed] Cartesia stream failed after retry: ${status}`);
        logger.error(
          { callId: session.callControlId, status },
          '[speakTtsStreamed] Cartesia stream failed after retry',
        );
        const err = new Error(`Cartesia stream failed with status ${status}`);
        captureException(err, {
          tags: { service: 'handler', action: 'speakTtsStreamed', type: 'http-status' },
          extra: { callId: session.callControlId, status, sentence: trimmed },
        });
        await speakTelnyxNative(
          session,
          'Désolé, je rencontre une petite difficulté technique. Pouvez-vous répéter ?',
        );
        continue;
      }

      if (!response.body) {
        writeDebugLog(`[speakTtsStreamed] Cartesia stream body is null`);
        continue;
      }

      const reader = response.body.getReader();
      const playbackQueue: Buffer[] = [];
      let streamFinished = false;
      let firstByteReceived = false;

      // Background playback loop (Consumer). It waits for a 200 ms jitter
      // buffer, then sends 100 ms G.711 frames at real time. This protects the
      // call from short Cartesia/network bursts without creating a long queue.
      const playPromise = (async () => {
        let framesSent = 0;
        let playbackStarted = false;
        while (true) {
          if (!isSessionActiveForTts(session, expectedResponseGeneration)) {
            writeDebugLog(`[speakTtsStreamed] Session inactive during stream playback, stopping`);
            break;
          }

          if (
            !playbackStarted &&
            !streamFinished &&
            playbackQueue.length < TTS_INITIAL_BUFFER_FRAMES
          ) {
            await new Promise((r) => setTimeout(r, TTS_UNDERFEED_PAUSE_MS));
            continue;
          }
          playbackStarted = true;

          if (playbackQueue.length === 0) {
            if (streamFinished) {
              break; // Tout est lu
            }
            await new Promise((r) => setTimeout(r, TTS_UNDERFEED_PAUSE_MS)); // Sous-alimentation temporaire, attendre
            continue;
          }

          const frame = playbackQueue.shift()!;
          session.telnyxWs.send(
            JSON.stringify({
              event: 'media',
              media: { payload: frame.toString('base64') },
            }),
          );
          framesSent++;
          persistFirstAudioFrame(session);

          await new Promise((r) => setTimeout(r, TTS_PACE_PAUSE_MS));
        }
        writeDebugLog(
          `[speakTtsStreamed] Paced player sent ${framesSent} audio frames for sentence ${i}`,
        );
      })();

      // Streaming bytes reader (Producer) — audio G.711 8kHz, 1 byte = 1 sample.
      // 160 bytes = 20ms d'audio.
      let remainingBytes = Buffer.alloc(0);
      const accumulatedChunks: Buffer[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          streamFinished = true;
          break;
        }

        if (!firstByteReceived) {
          firstByteReceived = true;
          writeDebugLog(`[speakTtsStreamed] First Cartesia byte received for sentence ${i}`);
          if (session.latencyTrace && !session.latencyTrace.ttsFirstByteMs) {
            session.latencyTrace.ttsFirstByteMs = Date.now() - session.latencyTrace.startTime;
          }
        }

        const rawChunk = Buffer.from(value);
        accumulatedChunks.push(rawChunk);

        const fullBytes = Buffer.concat([remainingBytes, rawChunk]);

        // Découpe en trames de 800 bytes (100ms @ 8kHz 8-bit).
        let offset = 0;
        while (offset + TTS_FRAME_BYTES <= fullBytes.length) {
          playbackQueue.push(fullBytes.slice(offset, offset + TTS_FRAME_BYTES));
          offset += TTS_FRAME_BYTES;
        }
        remainingBytes = fullBytes.slice(offset);
      }

      // Flush final — pad avec du silence pour garder une trame RTP de 100 ms.
      if (remainingBytes.length > 0) {
        if (remainingBytes.length < TTS_FRAME_BYTES) {
          const padded = Buffer.concat([
            remainingBytes,
            Buffer.alloc(
              TTS_FRAME_BYTES - remainingBytes.length,
              session.codec === 'PCMA' ? 0xd5 : 0xff,
            ),
          ]);
          playbackQueue.push(padded);
        } else {
          playbackQueue.push(remainingBytes);
        }
      }

      streamFinished = true;
      await playPromise; // Attendre la fin de la lecture progressive

      // 3. Mettre en cache Redis le buffer G.711 8kHz complet
      const codec8kFull = Buffer.concat(accumulatedChunks);
      try {
        await setTtsCached(trimmed, cacheVoiceId, codec8kFull);
      } catch (err: unknown) {
        writeDebugLog(`[speakTtsStreamed] TTS cache write failed`, err);
      }
    } catch (err: unknown) {
      writeDebugLog(
        `[speakTtsStreamed] Cartesia stream process error for sentence: "${trimmed}"`,
        err,
      );
      logger.error(
        { err, callId: session.callControlId },
        `[speakTtsStreamed] Cartesia stream process error: ${err instanceof Error ? err.message : String(err)}`,
      );
      captureException(err, {
        tags: { service: 'handler', action: 'speakTtsStreamed', type: 'exception' },
        extra: { callId: session.callControlId, sentence: trimmed },
      });
      await speakTelnyxNative(
        session,
        'Désolé, je rencontre une petite difficulté technique. Pouvez-vous répéter ?',
      );
    }
  }
}
