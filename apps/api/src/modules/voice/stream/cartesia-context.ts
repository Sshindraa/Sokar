import { randomUUID } from 'node:crypto';
import { WebSocket, type RawData } from 'ws';
import type { CallSession } from './types';
import {
  TTS_FRAME_BYTES,
  TTS_INITIAL_BUFFER_FRAMES,
  TTS_PACE_PAUSE_MS,
  TTS_UNDERFEED_PAUSE_MS,
} from './constants';
import { logger } from '../../../shared/logger/pino';
import { persistLatencyTrace } from './session-persistence';
import { recordVoiceTurnEvent } from './turn-telemetry';

const CARTESIA_WEBSOCKET_URL = 'wss://api.cartesia.ai/tts/websocket';
const CARTESIA_VERSION = '2026-03-01';
const CARTESIA_CONTEXT_OPEN_TIMEOUT_MS = 3_000;

export interface CartesiaContextRequest {
  model_id: 'sonic-3.5';
  transcript: string;
  voice: { mode: 'id'; id: string };
  language: 'fr';
  context_id: string;
  output_format: {
    container: 'raw';
    encoding: 'pcm_alaw' | 'pcm_mulaw';
    sample_rate: 8000;
  };
  continue: boolean;
}

interface CartesiaContextMessage {
  type?: 'chunk' | 'done' | 'error';
  context_id?: string;
  data?: string;
  message?: string;
}

/** Le flag est volontairement opt-in : le chemin HTTP reste la référence. */
export function isCartesiaContextV2Enabled(): boolean {
  return process.env.VOICE_TTS_CONTEXT_V2_ENABLED === 'true';
}

export function buildCartesiaWebSocketUrl(): string {
  const url = new URL(CARTESIA_WEBSOCKET_URL);
  url.searchParams.set('cartesia_version', CARTESIA_VERSION);
  return url.toString();
}

export function buildCartesiaContextRequest(
  session: CallSession,
  voiceId: string,
  contextId: string,
  transcript: string,
  shouldContinue: boolean,
): CartesiaContextRequest {
  return {
    model_id: 'sonic-3.5',
    transcript,
    voice: { mode: 'id', id: voiceId },
    language: 'fr',
    context_id: contextId,
    output_format: {
      container: 'raw',
      encoding: session.codec === 'PCMA' ? 'pcm_alaw' : 'pcm_mulaw',
      sample_rate: 8000,
    },
    continue: shouldContinue,
  };
}

function isActive(session: CallSession, generation: number): boolean {
  return (
    !session.ended &&
    session.state === 'SPEAKING' &&
    session.telnyxWs.readyState === WebSocket.OPEN &&
    session.ttsGeneration === generation
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Une réponse LLM utilise un seul contexte Cartesia. Les entrées partielles
 * restent donc dans la même intention prosodique, sans régression du chemin
 * HTTP qui demeure actif tant que le flag est absent.
 */
export class CartesiaContextTurn {
  private readonly contextId = randomUUID();
  private readonly pendingInputs: Array<{ transcript: string; shouldContinue: boolean }> = [];
  private readonly audioFrames: Buffer[] = [];
  private remainder = Buffer.alloc(0);
  private ws: WebSocket | null = null;
  private socketOpen = false;
  private finishedInput = false;
  private finishedOutput = false;
  private cancelled = false;
  private firstAudioOutput = false;
  private playbackStarted = false;
  private playbackPromise: Promise<void> | null = null;
  private openTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastTranscript = '';
  private resolveCompletion!: () => void;
  private rejectCompletion!: (error: Error) => void;
  private readonly completion = new Promise<void>((resolve, reject) => {
    this.resolveCompletion = resolve;
    this.rejectCompletion = reject;
  });

  constructor(
    private readonly session: CallSession,
    private readonly generation: number,
    private readonly apiKey: string,
    private readonly voiceId: string,
  ) {
    this.connect();
  }

  get hasAudioOutput(): boolean {
    return this.firstAudioOutput;
  }

  push(transcript: string): void {
    if (this.finishedInput || this.cancelled || !transcript) return;

    // Cartesia concatène les segments sans séparateur implicite.
    const needsSpace =
      this.lastTranscript && !/\s$/.test(this.lastTranscript) && !/^[,.;:!?]/.test(transcript);
    const joinedTranscript = `${needsSpace ? ' ' : ''}${transcript}`;
    this.lastTranscript = joinedTranscript;
    this.sendOrQueue(joinedTranscript, true);
  }

  async finish(): Promise<void> {
    if (!this.finishedInput && !this.cancelled) {
      this.finishedInput = true;
      // Le dernier fragment est inconnu tant que le LLM stream n'est pas clos.
      // Un segment vide clôt explicitement le contexte conformément à l'API.
      this.sendOrQueue('', false);
    }
    return this.completion;
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.finishedInput = true;
    this.finishedOutput = true;
    this.audioFrames.length = 0;
    this.remainder = Buffer.alloc(0);
    if (this.openTimeout) clearTimeout(this.openTimeout);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ context_id: this.contextId, cancel: true }));
        this.ws.close();
      } catch {
        // La session Telnyx est déjà interrompue : ne pas faire échouer le tour.
      }
    }
    this.resolveCompletion();
  }

  private connect(): void {
    try {
      this.ws = new WebSocket(buildCartesiaWebSocketUrl(), {
        headers: { 'X-API-Key': this.apiKey },
      });
      this.openTimeout = setTimeout(() => {
        this.fail(new Error('Cartesia context WebSocket connection timed out'));
      }, CARTESIA_CONTEXT_OPEN_TIMEOUT_MS);
      this.ws.on('open', () => {
        if (this.openTimeout) clearTimeout(this.openTimeout);
        this.socketOpen = true;
        for (const input of this.pendingInputs.splice(0)) {
          this.send(input.transcript, input.shouldContinue);
        }
      });
      this.ws.on('message', (raw: RawData) => this.handleMessage(raw));
      this.ws.on('error', (err: Error) => this.fail(err));
      this.ws.on('close', () => {
        if (!this.cancelled && !this.finishedOutput) {
          this.fail(new Error('Cartesia context WebSocket closed before completion'));
        }
      });
    } catch (err) {
      this.fail(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private sendOrQueue(transcript: string, shouldContinue: boolean): void {
    if (this.socketOpen) {
      this.send(transcript, shouldContinue);
    } else {
      this.pendingInputs.push({ transcript, shouldContinue });
    }
  }

  private send(transcript: string, shouldContinue: boolean): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.cancelled) return;
    const request = buildCartesiaContextRequest(
      this.session,
      this.voiceId,
      this.contextId,
      transcript,
      shouldContinue,
    );
    this.ws.send(JSON.stringify(request));
  }

  private handleMessage(raw: RawData): void {
    let message: CartesiaContextMessage;
    try {
      const json =
        typeof raw === 'string'
          ? raw
          : Array.isArray(raw)
            ? Buffer.concat(raw).toString()
            : raw instanceof ArrayBuffer
              ? Buffer.from(raw).toString()
              : raw.toString();
      message = JSON.parse(json) as CartesiaContextMessage;
    } catch {
      this.fail(new Error('Cartesia context returned invalid JSON'));
      return;
    }
    if (message.context_id && message.context_id !== this.contextId) return;
    if (message.type === 'error') {
      this.fail(new Error(message.message ?? 'Cartesia context returned an error'));
      return;
    }
    if (message.type === 'chunk' && message.data) {
      this.enqueueAudio(Buffer.from(message.data, 'base64'));
      return;
    }
    if (message.type === 'done') {
      this.finishedOutput = true;
      this.completeAfterPlayback().catch((err: unknown) =>
        this.fail(err instanceof Error ? err : new Error(String(err))),
      );
    }
  }

  private enqueueAudio(chunk: Buffer): void {
    if (this.cancelled || !chunk.length) return;
    if (!this.firstAudioOutput) {
      this.firstAudioOutput = true;
      if (this.session.latencyTrace && !this.session.latencyTrace.ttsFirstByteMs) {
        this.session.latencyTrace.ttsFirstByteMs = Date.now() - this.session.latencyTrace.startTime;
      }
    }
    const bytes = Buffer.concat([this.remainder, chunk]);
    let offset = 0;
    while (offset + TTS_FRAME_BYTES <= bytes.length) {
      this.audioFrames.push(bytes.subarray(offset, offset + TTS_FRAME_BYTES));
      offset += TTS_FRAME_BYTES;
    }
    this.remainder = bytes.subarray(offset);
    if (!this.playbackPromise) this.playbackPromise = this.playAudio();
  }

  private async playAudio(): Promise<void> {
    while (!this.cancelled) {
      if (!isActive(this.session, this.generation)) return;
      if (
        !this.playbackStarted &&
        !this.finishedOutput &&
        this.audioFrames.length < TTS_INITIAL_BUFFER_FRAMES
      ) {
        await wait(TTS_UNDERFEED_PAUSE_MS);
        continue;
      }
      this.playbackStarted = true;
      const frame = this.audioFrames.shift();
      if (!frame) {
        if (this.finishedOutput) return;
        await wait(TTS_UNDERFEED_PAUSE_MS);
        continue;
      }
      this.session.telnyxWs.send(
        JSON.stringify({ event: 'media', media: { payload: frame.toString('base64') } }),
      );
      if (this.session.latencyTrace && !this.session.latencyTrace.totalE2eMs) {
        this.session.latencyTrace.totalE2eMs = Date.now() - this.session.latencyTrace.startTime;
        recordVoiceTurnEvent(this.session, 'tts_first_audio', {
          ttsFirstByteMs: this.session.latencyTrace.ttsFirstByteMs ?? null,
          totalE2eMs: this.session.latencyTrace.totalE2eMs,
        });
        persistLatencyTrace(this.session).catch((err) =>
          logger.error(
            { err, callId: this.session.callControlId },
            '[cartesia-context] persist latency failed',
          ),
        );
      }
      await wait(TTS_PACE_PAUSE_MS);
    }
  }

  private async completeAfterPlayback(): Promise<void> {
    if (this.remainder.length > 0) {
      const silenceByte = this.session.codec === 'PCMA' ? 0xd5 : 0xff;
      this.audioFrames.push(
        Buffer.concat([
          this.remainder,
          Buffer.alloc(TTS_FRAME_BYTES - this.remainder.length, silenceByte),
        ]),
      );
      this.remainder = Buffer.alloc(0);
    }
    if (!this.playbackPromise && this.audioFrames.length > 0)
      this.playbackPromise = this.playAudio();
    await this.playbackPromise;
    this.resolveCompletion();
    this.ws?.close();
  }

  private fail(error: Error): void {
    if (this.cancelled || this.finishedOutput) return;
    this.finishedOutput = true;
    if (this.openTimeout) clearTimeout(this.openTimeout);
    this.audioFrames.length = 0;
    this.ws?.close();
    this.rejectCompletion(error);
  }
}

export function createCartesiaContextTurn(
  session: CallSession,
  canaryEnabled = isCartesiaContextV2Enabled(),
): CartesiaContextTurn | null {
  if (!canaryEnabled) return null;
  const apiKey = process.env.CARTESIA_API_KEY;
  const voiceId = process.env.CARTESIA_VOICE_ID;
  if (!apiKey || !voiceId) return null;
  return new CartesiaContextTurn(session, session.ttsGeneration, apiKey, voiceId);
}
