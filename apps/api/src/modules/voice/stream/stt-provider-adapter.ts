import { WebSocket } from 'ws';
import type { SttWord } from './types';
import { decodeTelnyxToPcm16, telnyxBytesPerMs } from './telnyx-codec';

export type SttProviderId = 'scribe' | 'deepgram';

export type NormalizedSttProviderMessage =
  | { type: 'session_started' }
  | { type: 'partial'; transcript: string; words?: SttWord[]; languageCode?: string }
  | {
      type: 'plain_commit' | 'timestamped_commit';
      transcript: string;
      words?: SttWord[];
      languageCode?: string;
      speechEndOffsetMs?: number;
    }
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
  | { type: 'warning'; message: string }
  | { type: 'entities'; count: number }
  | { type: 'provider_error'; messageType: string; message: string };

export interface SttProviderConnection {
  url: string;
  headers: Record<string, string>;
  createSocket: (url: string, options: { headers: Record<string, string> }) => WebSocket;
}

export interface SttProviderAdapter {
  readonly id: SttProviderId;
  readonly metricLabel: 'elevenlabs_stt' | 'deepgram_stt';
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

const SCRIBE_ERROR_TYPES = new Set([
  'auth_error',
  'quota_exceeded',
  'transcriber_error',
  'input_error',
  'invalid_request',
  'error',
  'commit_throttled',
  'unaccepted_terms',
  'rate_limited',
  'queue_overflow',
  'resource_exhausted',
  'session_time_limit_exceeded',
  'chunk_size_exceeded',
  'insufficient_audio_activity',
  'scribe_error',
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeWords(value: unknown, scribe = false): SttWord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const words = value.flatMap((rawWord) => {
    const item = record(rawWord);
    const word =
      (typeof item.word === 'string' && item.word) ||
      (typeof item.text === 'string' && item.text) ||
      (typeof item.punctuated_word === 'string' && item.punctuated_word);
    if (!word) return [];
    const confidence = finiteNumber(item.confidence);
    const logprob = finiteNumber(item.logprob);
    return [
      {
        word,
        ...(typeof item.punctuated_word === 'string'
          ? { punctuatedWord: item.punctuated_word }
          : {}),
        ...(confidence !== undefined
          ? { confidence }
          : scribe && logprob !== undefined
            ? { confidence: Math.min(1, Math.max(0, Math.exp(logprob))) }
            : {}),
        ...(finiteNumber(item.start) !== undefined ? { start: finiteNumber(item.start) } : {}),
        ...(finiteNumber(item.end) !== undefined ? { end: finiteNumber(item.end) } : {}),
      },
    ];
  });
  return words.length ? words : undefined;
}

function normalizeScribeMessage(message: Record<string, unknown>): NormalizedSttProviderMessage[] {
  const messageType = typeof message.message_type === 'string' ? message.message_type : '';
  const transcript = typeof message.text === 'string' ? message.text.trim() : '';
  const words = normalizeWords(message.words, true);
  const languageCode =
    typeof message.language_code === 'string' ? message.language_code : undefined;
  const speechEndOffsetMs = words?.reduce((end, word) => Math.max(end, (word.end ?? 0) * 1000), 0);
  switch (messageType) {
    case 'session_started':
      return [{ type: 'session_started' }];
    case 'partial_transcript':
      return transcript ? [{ type: 'partial', transcript, words, languageCode }] : [];
    case 'committed_transcript':
      return [{ type: 'plain_commit', transcript, words, languageCode }];
    case 'committed_transcript_with_timestamps':
      return [{ type: 'timestamped_commit', transcript, words, languageCode, speechEndOffsetMs }];
    case 'committed_transcript_entities':
      return [
        {
          type: 'entities',
          count: Array.isArray(message.entities) ? message.entities.length : 0,
        },
      ];
    case 'warning':
      return [
        {
          type: 'warning',
          message:
            (typeof message.warning === 'string' && message.warning) ||
            (typeof message.message === 'string' && message.message) ||
            'Scribe warning',
        },
      ];
    default:
      if (SCRIBE_ERROR_TYPES.has(messageType) || /error$/iu.test(messageType)) {
        return [
          {
            type: 'provider_error',
            messageType,
            message:
              (typeof message.error === 'string' && message.error) ||
              (typeof message.message === 'string' && message.message) ||
              'Scribe error',
          },
        ];
      }
      return [];
  }
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

function makeAdapter(id: SttProviderId, options: SttProviderAdapterOptions): SttProviderAdapter {
  const deepgram = id === 'deepgram';
  const flux = deepgram && options.model.startsWith('flux-');
  const adapter: SttProviderAdapter = {
    id,
    metricLabel: deepgram ? 'deepgram_stt' : 'elevenlabs_stt',
    model: options.model,
    open(connection) {
      return connection.createSocket(connection.url, { headers: connection.headers });
    },
    sendAudio(ws, audio, previousText) {
      if (deepgram) {
        ws.send(audio, { binary: true });
      } else {
        ws.send(
          JSON.stringify({
            message_type: 'input_audio_chunk',
            audio_base_64: audio.toString('base64'),
            ...(previousText ? { previous_text: previousText } : {}),
          }),
        );
      }
    },
    finalize(ws) {
      if (deepgram && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: flux ? 'ForceEndTurn' : 'Finalize' }));
      }
    },
    keepAlive(ws) {
      if (deepgram && !flux && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'KeepAlive' }));
      }
    },
    close(ws, code, reason) {
      if (ws.readyState === WebSocket.OPEN) {
        if (flux) ws.send(JSON.stringify({ type: 'CloseStream' }));
        ws.close(code, reason);
      } else if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
    },
    toProviderAudio(codec, input) {
      return deepgram && codec !== 'L16' ? input : decodeTelnyxToPcm16(codec, input);
    },
    chunkBytesPerMs(codec) {
      const bytesPerMs = telnyxBytesPerMs(codec);
      return !deepgram && codec === 'PCMA' ? bytesPerMs * 2 : bytesPerMs;
    },
    samplesForAudio(codec, bytes) {
      const isPcm16 = codec === 'L16' || (!deepgram && codec === 'PCMA');
      return bytes / (isPcm16 ? 2 : 1);
    },
    normalizeMessage(raw) {
      let message: Record<string, unknown>;
      try {
        message = record(JSON.parse(raw.toString()));
      } catch {
        return [];
      }
      return deepgram
        ? flux
          ? normalizeFluxMessage(message)
          : normalizeDeepgramMessage(message)
        : normalizeScribeMessage(message);
    },
  };
  return adapter;
}

export function createScribeSttAdapter(options: SttProviderAdapterOptions): SttProviderAdapter {
  return makeAdapter('scribe', options);
}

export function createDeepgramSttAdapter(options: SttProviderAdapterOptions): SttProviderAdapter {
  return makeAdapter('deepgram', options);
}
