import { WebSocket } from 'ws';
import type { SttWord } from './types';
import { decodeTelnyxToPcm16, telnyxBytesPerMs } from './telnyx-codec';

export type SttProviderId = 'deepgram' | 'cartesia';

export type NormalizedSttProviderMessage =
  | { type: 'session_started' }
  | { type: 'partial'; transcript: string; words?: SttWord[]; languageCode?: string }
  /** Tour clos par le fournisseur lui-même (Cartesia Ink-2 : `turn.end`). */
  | { type: 'turn_commit'; transcript: string }
  | {
      type: 'final_segment';
      transcript: string;
      words?: SttWord[];
      languageCode?: string;
      speechFinal: boolean;
      /** Segment produit en réponse à un message `Finalize`. */
      fromFinalize?: boolean;
      speechEndOffsetMs?: number;
      providerResultEndMs?: number;
      providerLastWordEndMs?: number;
    }
  | {
      type: 'utterance_end';
      speechEndOffsetMs?: number;
      providerLastWordEndMs?: number;
    }
  | { type: 'speech_started'; speechStartOffsetMs?: number }
  | { type: 'provider_error'; messageType: string; message: string };

export interface SttProviderConnection {
  url: string;
  headers: Record<string, string>;
  createSocket: (url: string, options: { headers: Record<string, string> }) => WebSocket;
}

export interface SttProviderAdapter {
  readonly id: SttProviderId;
  readonly metricLabel: 'deepgram_stt' | 'cartesia_stt';
  readonly model: string;
  open(connection: SttProviderConnection): WebSocket;
  sendAudio(ws: WebSocket, audio: Buffer, previousText?: string): void;
  finalize(ws: WebSocket): void;
  keepAlive(ws: WebSocket): void;
  close(ws: WebSocket, code: number, reason: string): void;
  toProviderAudio(codec: 'PCMA' | 'PCMU' | 'L16', input: Buffer): Buffer;
  chunkBytesPerMs(codec: 'PCMA' | 'PCMU' | 'L16'): number;
  samplesForAudio(codec: 'PCMA' | 'PCMU' | 'L16', bytes: number): number;
  normalizeMessage(raw: Buffer): NormalizedSttProviderMessage[];
}

export interface SttProviderAdapterOptions {
  model: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeWords(value: unknown): SttWord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const words = value.flatMap((rawWord) => {
    const item = record(rawWord);
    const word =
      (typeof item.word === 'string' && item.word) ||
      (typeof item.text === 'string' && item.text) ||
      (typeof item.punctuated_word === 'string' && item.punctuated_word);
    if (!word) return [];
    const confidence = finiteNumber(item.confidence);
    return [
      {
        word,
        ...(typeof item.punctuated_word === 'string'
          ? { punctuatedWord: item.punctuated_word }
          : {}),
        ...(confidence !== undefined ? { confidence } : {}),
        ...(finiteNumber(item.start) !== undefined ? { start: finiteNumber(item.start) } : {}),
        ...(finiteNumber(item.end) !== undefined ? { end: finiteNumber(item.end) } : {}),
      },
    ];
  });
  return words.length ? words : undefined;
}

function normalizeDeepgramMessage(
  message: Record<string, unknown>,
): NormalizedSttProviderMessage[] {
  const type = typeof message.type === 'string' ? message.type : '';
  if (type === 'SpeechStarted') return [{ type: 'speech_started' }];
  if (type === 'UtteranceEnd') {
    const lastWordEnd = finiteNumber(message.last_word_end);
    return [
      {
        type: 'utterance_end',
        speechEndOffsetMs: lastWordEnd === undefined ? undefined : lastWordEnd * 1000,
        providerLastWordEndMs: lastWordEnd === undefined ? undefined : lastWordEnd * 1000,
      },
    ];
  }
  if (type === 'Error') {
    return [
      {
        type: 'provider_error',
        messageType: String(message.code ?? 'error'),
        message: String(message.description ?? message.message ?? 'Deepgram error'),
      },
    ];
  }
  if (type !== 'Results') return [];

  const channel = record(message.channel);
  const alternatives = Array.isArray(channel.alternatives) ? channel.alternatives : [];
  const alternative = record(alternatives[0]);
  const transcript =
    typeof alternative.transcript === 'string' ? alternative.transcript.trim() : '';
  const words = normalizeWords(alternative.words);
  const language = Array.isArray(alternative.languages) ? alternative.languages[0] : undefined;
  const languageCode = typeof language === 'string' ? language : undefined;
  const start = finiteNumber(message.start) ?? 0;
  const duration = finiteNumber(message.duration);
  const wordEnd = words?.reduce((end, word) => Math.max(end, word.end ?? 0), 0);
  const providerResultEndMs = duration === undefined ? undefined : (start + duration) * 1000;
  const providerLastWordEndMs = wordEnd && wordEnd > 0 ? wordEnd * 1000 : undefined;
  const speechEndOffsetMs = providerLastWordEndMs ?? providerResultEndMs;

  if (message.is_final === true) {
    return [
      {
        type: 'final_segment',
        transcript,
        words,
        languageCode,
        speechFinal: message.speech_final === true,
        fromFinalize: message.from_finalize === true,
        speechEndOffsetMs,
        providerResultEndMs,
        providerLastWordEndMs,
      },
    ];
  }
  return transcript ? [{ type: 'partial', transcript, words, languageCode }] : [];
}

function normalizeFluxMessage(message: Record<string, unknown>): NormalizedSttProviderMessage[] {
  const type = typeof message.type === 'string' ? message.type : '';
  if (type === 'Connected') return [{ type: 'session_started' }];
  if (type === 'Error') {
    return [
      {
        type: 'provider_error',
        messageType: String(message.code ?? 'error'),
        message: String(message.description ?? 'Deepgram Flux error'),
      },
    ];
  }
  if (type !== 'TurnInfo') return [];

  const event = typeof message.event === 'string' ? message.event : '';
  const transcript = typeof message.transcript === 'string' ? message.transcript.trim() : '';
  const words = normalizeWords(message.words);
  const languages = Array.isArray(message.languages) ? message.languages : [];
  const languageCode = typeof languages[0] === 'string' ? languages[0] : undefined;
  const audioWindowEnd = finiteNumber(message.audio_window_end);
  const providerResultEndMs = audioWindowEnd === undefined ? undefined : audioWindowEnd * 1000;
  const lastWordEnd = words?.reduce((end, word) => Math.max(end, word.end ?? 0), 0);
  const providerLastWordEndMs = lastWordEnd && lastWordEnd > 0 ? lastWordEnd * 1000 : undefined;

  if (event === 'StartOfTurn') {
    return [
      {
        type: 'speech_started',
        ...(finiteNumber(message.audio_window_start) !== undefined
          ? { speechStartOffsetMs: finiteNumber(message.audio_window_start)! * 1000 }
          : {}),
      },
      ...(transcript ? [{ type: 'partial' as const, transcript, words, languageCode }] : []),
    ];
  }
  if (event === 'Update' || event === 'EagerEndOfTurn' || event === 'TurnResumed') {
    return transcript ? [{ type: 'partial', transcript, words, languageCode }] : [];
  }
  if (event === 'EndOfTurn') {
    return [
      {
        type: 'final_segment',
        transcript,
        words,
        languageCode,
        speechFinal: true,
        speechEndOffsetMs: providerLastWordEndMs,
        providerResultEndMs,
        providerLastWordEndMs,
      },
    ];
  }
  return [];
}

export function createDeepgramSttAdapter(options: SttProviderAdapterOptions): SttProviderAdapter {
  const flux = options.model.startsWith('flux-');
  return {
    id: 'deepgram',
    metricLabel: 'deepgram_stt',
    model: options.model,
    open(connection) {
      return connection.createSocket(connection.url, { headers: connection.headers });
    },
    sendAudio(ws, audio) {
      ws.send(audio, { binary: true });
    },
    finalize(ws) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: flux ? 'ForceEndTurn' : 'Finalize' }));
      }
    },
    keepAlive(ws) {
      if (!flux && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'KeepAlive' }));
      }
    },
    close(ws, code, reason) {
      if (ws.readyState === WebSocket.OPEN) {
        if (flux) ws.send(JSON.stringify({ type: 'CloseStream' }));
        ws.close(code, reason);
      } else if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
    },
    // A-law et µ-law 8 kHz tels quels (`alaw`, `mulaw`), L16 en PCM16 petit-boutiste 16 kHz.
    toProviderAudio(codec, input) {
      return codec === 'L16' ? decodeTelnyxToPcm16(codec, input) : input;
    },
    chunkBytesPerMs(codec) {
      return telnyxBytesPerMs(codec);
    },
    samplesForAudio(codec, bytes) {
      return codec === 'L16' ? bytes / 2 : bytes;
    },
    normalizeMessage(raw) {
      let message: Record<string, unknown>;
      try {
        message = record(JSON.parse(raw.toString()));
      } catch {
        return [];
      }
      return flux ? normalizeFluxMessage(message) : normalizeDeepgramMessage(message);
    },
  };
}

/**
 * Cartesia Ink-2 en mode tours (`/stt/turns/websocket`), STT principal par défaut : Ink-2 décide
 * lui-même de la fin de phrase (`turn.end`), rendue comme une phrase validée (`turn_commit`). Plus lent que
 * Deepgram pour clore une phrase (banc du 22/10/2026 : médiane 0,5 s, p90 1,6 s avec
 * `turn_end_timeout_ms=1500`), mais un appel continue au lieu d'être coupé.
 */
export function normalizeCartesiaTurnsMessage(
  message: Record<string, unknown>,
): NormalizedSttProviderMessage[] {
  const type = typeof message.type === 'string' ? message.type : '';
  const transcript = typeof message.transcript === 'string' ? message.transcript.trim() : '';
  switch (type) {
    case 'connected':
      return [{ type: 'session_started' }];
    case 'turn.start':
      return [
        { type: 'speech_started' },
        ...(transcript ? [{ type: 'partial' as const, transcript }] : []),
      ];
    case 'turn.update':
    case 'turn.eager_end':
      return transcript ? [{ type: 'partial', transcript }] : [];
    case 'turn.end':
      return transcript ? [{ type: 'turn_commit', transcript }] : [];
    case 'error':
      return [
        {
          type: 'provider_error',
          messageType: String(message.error_code ?? message.status_code ?? 'error'),
          message: String(message.message ?? 'Cartesia error'),
        },
      ];
    default:
      return [];
  }
}

export function createCartesiaTurnsSttAdapter(
  options: SttProviderAdapterOptions,
): SttProviderAdapter {
  return {
    id: 'cartesia',
    metricLabel: 'cartesia_stt',
    model: options.model,
    open(connection) {
      return connection.createSocket(connection.url, { headers: connection.headers });
    },
    sendAudio(ws, audio) {
      ws.send(audio, { binary: true });
    },
    // Ink-2 clôt les tours lui-même : pas de commande de fin par phrase ni de maintien de connexion.
    finalize() {},
    keepAlive() {},
    close(ws, code, reason) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'close' }));
        ws.close(code, reason);
      } else if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
    },
    // A-law et µ-law 8 kHz tels quels (`pcm_alaw`, `pcm_mulaw`), L16 en PCM16 petit-boutiste 16 kHz.
    toProviderAudio(codec, input) {
      return codec === 'L16' ? decodeTelnyxToPcm16(codec, input) : input;
    },
    chunkBytesPerMs(codec) {
      return telnyxBytesPerMs(codec);
    },
    samplesForAudio(codec, bytes) {
      return codec === 'L16' ? bytes / 2 : bytes;
    },
    normalizeMessage(raw) {
      try {
        return normalizeCartesiaTurnsMessage(record(JSON.parse(raw.toString())));
      } catch {
        return [];
      }
    },
  };
}

/** Délai maximal avant qu'Ink-2 clôture un tour : 1,5 s (5,6 s par défaut chez Cartesia). */
export const CARTESIA_FALLBACK_TURN_END_TIMEOUT_MS = 1_500;

export function buildCartesiaTurnsUrl(
  codec: 'PCMA' | 'PCMU' | 'L16',
  restaurantName?: string | null,
): string {
  const format =
    codec === 'PCMA'
      ? { encoding: 'pcm_alaw', sampleRate: 8000 }
      : codec === 'PCMU'
        ? { encoding: 'pcm_mulaw', sampleRate: 8000 }
        : { encoding: 'pcm_s16le', sampleRate: 16_000 };
  const params = new URLSearchParams({
    model: 'ink-2',
    language: 'fr',
    encoding: format.encoding,
    sample_rate: String(format.sampleRate),
    turn_end_timeout_ms: String(CARTESIA_FALLBACK_TURN_END_TIMEOUT_MS),
  });
  const name = restaurantName?.trim();
  if (name && name.length <= 80) params.append('keyterm', name);
  return `wss://api.cartesia.ai/stt/turns/websocket?${params}`;
}
