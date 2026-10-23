import { WebSocket, type RawData } from 'ws';
import { logger } from '../../../shared/logger/pino';
import {
  voiceFirstAudioHoldMs,
  voiceFirstAudioHoldTotal,
} from '../../../shared/observability/metrics';
import { addElevenLabsTtsCharacters } from '../../usage/voice-usage.service';
import {
  TTS_FRAME_DURATION_MS,
  TTS_INITIAL_BUFFER_FRAMES,
  TTS_PACE_PAUSE_MS,
  TTS_UNDERFEED_PAUSE_MS,
} from './constants';
import type { ContextTtsTurn } from './context-tts';
import {
  buildCloseMessage,
  buildElevenLabsDialogueUrl,
  buildKeepAliveMessage,
  buildOpeningMessage,
  buildTextMessage,
  getPronunciationDictionaryLocator,
  parseElevenLabsDialogueMessage,
  type ElevenLabsChunkAlignment,
} from './elevenlabs-dialogue-context';
import { holdFirstAudioForCallerSilence } from './first-audio-hold';
import { waitForVoiceFiller } from './voice-filler';
import type { SpokenAlignment } from './interrupted-reply';
import { effectiveVoiceLanguage, type VoiceLanguageCode } from './voice-language';
import { persistLatencyTrace } from './session-persistence';
import {
  encodeTelnyxFromPcm16,
  padTelnyxFrame,
  telnyxFrameBytes,
  type TelnyxCodec,
} from './telnyx-codec';
import type { CallSession } from './types';
import {
  markVoiceTurnAudioSent,
  markVoiceTurnTtsSynthesisFirstByte,
  recordVoiceTurnEventIfCurrent,
} from './turn-telemetry';

// Même délai que Cartesia : une connexion lente ne retarde pas la réponse au-delà du repli HTTP.
const CONNECT_TIMEOUT_MS = 1_500;
// Le serveur coupe une connexion muette après 20 s.
const KEEP_ALIVE_MS = 10_000;
// Une phrase qui se termine ainsi part aussitôt, sans attendre le tampon serveur (~40 caractères).
const SENTENCE_END = /[.!?…][»"')\]]*\s*$/;
// Voix de la bibliothèque retenue au banc, masculine comme la voix Cartesia de production.
const DEFAULT_ELEVENLABS_TTS_VOICE_ID = 'lPojg5cGgbhot31LKO2z';

export type ElevenLabsOutputFormat = 'alaw_8000' | 'ulaw_8000' | 'pcm_16000';

/** Voix du tour : `ELEVENLABS_TTS_VOICE_ID` si elle est posée, sinon la voix du banc. */
export function getElevenLabsTtsVoiceId(): string {
  return process.env.ELEVENLABS_TTS_VOICE_ID?.trim() || DEFAULT_ELEVENLABS_TTS_VOICE_ID;
}

/**
 * Langue imposée à ElevenLabs : celle de l'appel, évaluée à chaque tour (elle peut changer en cours d'appel).
 * Codes ISO 639-1, sauf le filipino, qu'ElevenLabs attend en ISO 639-3 (`fil`).
 */
export function elevenLabsLanguageCode(language: VoiceLanguageCode): string {
  return language === 'tl' ? 'fil' : language;
}

/** Format ElevenLabs égal au codec Telnyx : le G.711 reste G.711, le L16 reste du PCM 16 kHz. */
export function elevenLabsOutputFormat(codec: TelnyxCodec): ElevenLabsOutputFormat {
  if (codec === 'PCMA') return 'alaw_8000';
  if (codec === 'PCMU') return 'ulaw_8000';
  return 'pcm_16000';
}

/** Entrée gardée tant que le socket s'ouvre : une phrase, ou la fin de la saisie. */
type PendingInput = { kind: 'text'; text: string; flush: boolean } | { kind: 'close' };

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
 * Tour TTS ElevenLabs en contexte, même contrat que `CartesiaContextTurn` (voir `context-tts.ts`).
 * Actif pour tous les restaurants dès que `ELEVENLABS_API_KEY` est présente.
 *
 * Chaque phrase part dans `inputs`. `flush` vaut vrai quand la phrase se termine par une ponctuation
 * forte, ou quand l'appelant le demande (premiers mots d'une phrase), pour qu'elle soit générée tout de suite ; le reste attend la phrase suivante ou `close_socket`,
 * qui vide le tampon. `is_final` marque la fin de la réponse. Le socket s'ouvre pendant la génération
 * du LLM, comme Cartesia.
 */
export class ElevenLabsContextTurn implements ContextTtsTurn {
  readonly provider = 'elevenlabs' as const;
  private ws: WebSocket | null = null;
  private socketOpen = false;
  private openTimeout: ReturnType<typeof setTimeout> | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private readonly pendingInputs: PendingInput[] = [];
  private readonly audioFrames: Buffer[] = [];
  private remainder = Buffer.alloc(0);
  private playbackPromise: Promise<void> | null = null;
  private finishedInput = false;
  private finishedOutput = false;
  private outputDone = false;
  private cancelled = false;
  private settled = false;
  private firstAudioOutput = false;
  private playbackStarted = false;
  private holdDone = false;
  private paused = false;
  /** Appelé quand l'appelant reprend la parole avant le premier son : la réponse préparée est jetée. */
  onHoldCancelled?: () => void;
  private sentFrames = 0;
  private lastTranscript = '';
  private pushedText = '';
  /** Durée de l'audio reçu, pour placer l'alignement de chaque chunk sur l'axe de lecture. */
  private receivedAudioMs = 0;
  private alignedText = '';
  private readonly alignedStartMs: number[] = [];
  private resolveCompletion!: () => void;
  private rejectCompletion!: (error: Error) => void;
  private readonly completion = new Promise<void>((resolve, reject) => {
    this.resolveCompletion = resolve;
    this.rejectCompletion = reject;
  });
  private readonly turnId: string | undefined;
  private readonly synthesisStartedAt = Date.now();

  constructor(
    private readonly session: CallSession,
    private readonly generation: number,
    private readonly apiKey: string,
    private readonly voiceId: string,
    private readonly url: string,
  ) {
    // Un échec survenu avant `finish()` reste lisible par l'appelant à ce moment-là : sans ce gestionnaire,
    // il serait signalé comme rejet non géré alors que le repli HTTP le traite.
    this.completion.catch(() => undefined);
    this.turnId = session.currentTurn?.id;
    recordVoiceTurnEventIfCurrent(this.session, this.turnId, 'tts_synthesis_started', {
      source: 'elevenlabs_dialogue',
    });
    this.connect();
  }

  /** L'appelant a pris la parole : plus aucune trame n'est envoyée tant que la pause dure. */
  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  get hasAudioOutput(): boolean {
    return this.firstAudioOutput;
  }

  /** Trames de ce contexte envoyées à Telnyx. */
  get framesSent(): number {
    return this.sentFrames;
  }

  /**
   * Texte poussé et audio joué ; la durée totale n'est connue qu'une fois la synthèse terminée. L'alignement
   * (instant de chaque caractère) permet de dire au mot près ce que l'appelant a entendu.
   */
  interruptionSnapshot(): {
    text: string;
    playedMs: number;
    totalMs: number | null;
    alignment?: SpokenAlignment;
  } {
    const queuedFrames = this.audioFrames.length + (this.remainder.length > 0 ? 1 : 0);
    return {
      text: this.pushedText,
      playedMs: this.sentFrames * TTS_FRAME_DURATION_MS,
      totalMs: this.outputDone ? (this.sentFrames + queuedFrames) * TTS_FRAME_DURATION_MS : null,
      ...(this.alignedText
        ? { alignment: { text: this.alignedText, startMs: [...this.alignedStartMs] } }
        : {}),
    };
  }

  push(transcript: string, options: { tone?: string; flush?: boolean } = {}): void {
    if (this.finishedInput || this.finishedOutput || this.cancelled || !transcript) return;
    // Les segments se concatènent sans séparateur implicite : on en ajoute un entre deux mots.
    const needsSpace =
      this.lastTranscript && !/\s$/.test(this.lastTranscript) && !/^[,.;:!?]/.test(transcript);
    const joinedTranscript = `${needsSpace ? ' ' : ''}${transcript}`;
    this.lastTranscript = joinedTranscript;
    // La balise ne part qu'à la voix : le texte relevé (interruption, historique) reste celui de say.
    this.pushedText += joinedTranscript;
    const tag = options.tone && /^[a-z]+$/.test(options.tone) ? `[${options.tone}] ` : '';
    this.sendOrQueue({
      kind: 'text',
      text: `${tag}${joinedTranscript}`,
      flush: options.flush === true || SENTENCE_END.test(joinedTranscript),
    });
  }

  async finish(): Promise<void> {
    if (!this.finishedInput && !this.cancelled) {
      this.finishedInput = true;
      // `close_socket` vide le tampon, envoie le reste de l'audio puis `is_final`.
      this.sendOrQueue({ kind: 'close' });
    }
    return this.completion;
  }

  /** `unused` : contexte ouvert d'avance mais aucune phrase à dire (pas une interruption). */
  cancel(reason: 'barge_in' | 'unused' = 'barge_in'): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.finishedInput = true;
    this.finishedOutput = true;
    this.pendingInputs.length = 0;
    this.audioFrames.length = 0;
    this.remainder = Buffer.alloc(0);
    if (reason === 'barge_in') {
      recordVoiceTurnEventIfCurrent(this.session, this.turnId, 'tts_interrupted', {
        reason,
        ttsPath: 'elevenlabs_dialogue',
      });
    }
    this.stopTimers();
    this.closeSocket();
    this.settle();
  }

  private connect(): void {
    try {
      this.ws = new WebSocket(this.url, { headers: { 'xi-api-key': this.apiKey } });
      this.openTimeout = setTimeout(() => {
        this.fail(new Error('ElevenLabs dialogue WebSocket connection timed out'));
      }, CONNECT_TIMEOUT_MS);
      this.ws.on('open', () => {
        if (this.openTimeout) clearTimeout(this.openTimeout);
        if (this.cancelled) return;
        this.socketOpen = true;
        this.sendRaw(buildOpeningMessage(this.voiceId, getPronunciationDictionaryLocator()));
        for (const input of this.pendingInputs.splice(0)) this.sendInput(input);
        this.keepAliveTimer = setInterval(
          () => this.sendRaw(buildKeepAliveMessage()),
          KEEP_ALIVE_MS,
        );
      });
      this.ws.on('message', (raw: RawData) => this.handleMessage(raw.toString()));
      this.ws.on('unexpected-response', (_request, response) => {
        this.fail(
          new Error(`ElevenLabs dialogue WebSocket : HTTP ${response.statusCode} à l'ouverture`),
        );
      });
      this.ws.on('error', (err: Error) => this.fail(err));
      this.ws.on('close', () => {
        this.stopTimers();
        if (!this.cancelled && !this.finishedOutput) {
          this.fail(new Error('ElevenLabs dialogue WebSocket closed before completion'));
        }
      });
    } catch (err) {
      this.fail(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private sendOrQueue(input: PendingInput): void {
    if (this.socketOpen) this.sendInput(input);
    else this.pendingInputs.push(input);
  }

  private sendInput(input: PendingInput): void {
    if (input.kind === 'close') {
      this.sendRaw(buildCloseMessage());
      return;
    }
    // Compté seulement une fois envoyé : un tour annulé avant l'ouverture ne facture rien.
    if (this.sendRaw(buildTextMessage(this.voiceId, input.text, { flush: input.flush }))) {
      addElevenLabsTtsCharacters(this.session, input.text.length);
    }
  }

  private sendRaw(message: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.cancelled) return false;
    this.ws.send(JSON.stringify(message));
    return true;
  }

  private stopTimers(): void {
    if (this.openTimeout) clearTimeout(this.openTimeout);
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.openTimeout = null;
    this.keepAliveTimer = null;
  }

  /** Ferme le socket sans lever d'exception ; une connexion encore en cours d'ouverture est abandonnée. */
  private closeSocket(): void {
    const ws = this.ws;
    if (!ws) return;
    try {
      if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
      else if (ws.readyState === WebSocket.OPEN) ws.close();
    } catch {
      // La session Telnyx est déjà interrompue : ne pas faire échouer le tour.
    }
  }

  private handleMessage(raw: string): void {
    const event = parseElevenLabsDialogueMessage(raw);
    if (event.kind === 'audio') {
      this.recordAlignment(event.pcm.length, event.alignment);
      this.enqueueAudio(event.pcm);
    } else if (event.kind === 'error') {
      this.fail(new Error(event.message));
    } else if (event.kind === 'final') {
      this.finishedOutput = true;
      this.outputDone = true;
      this.completeAfterPlayback().catch((err: unknown) =>
        this.fail(err instanceof Error ? err : new Error(String(err))),
      );
    }
  }

  /** Place les caractères du chunk sur l'axe de lecture : début du chunk + décalage donné par ElevenLabs. */
  private recordAlignment(
    chunkBytes: number,
    alignment: ElevenLabsChunkAlignment | undefined,
  ): void {
    const chunkStartMs = this.receivedAudioMs;
    const bytesPerMs = telnyxFrameBytes(this.session.codec) / TTS_FRAME_DURATION_MS;
    this.receivedAudioMs += chunkBytes / bytesPerMs;
    if (!alignment) return;
    this.alignedText += alignment.chars.join('');
    for (const offset of alignment.startMs) this.alignedStartMs.push(chunkStartMs + offset);
  }

  private enqueueAudio(chunk: Buffer): void {
    if (this.cancelled || !chunk.length) return;
    if (!this.firstAudioOutput) {
      this.firstAudioOutput = true;
      markVoiceTurnTtsSynthesisFirstByte(this.session, 'elevenlabs_dialogue', this.turnId);
    }
    const bytes = Buffer.concat([this.remainder, chunk]);
    const frameBytes = telnyxFrameBytes(this.session.codec);
    let offset = 0;
    while (offset + frameBytes <= bytes.length) {
      this.audioFrames.push(bytes.subarray(offset, offset + frameBytes));
      offset += frameBytes;
    }
    this.remainder = bytes.subarray(offset);
    if (!this.playbackPromise) this.playbackPromise = this.playAudio();
  }

  private async playAudio(): Promise<void> {
    while (!this.cancelled) {
      if (!isActive(this.session, this.generation)) {
        this.cancel('unused');
        return;
      }
      if (
        !this.playbackStarted &&
        !this.finishedOutput &&
        this.audioFrames.length < TTS_INITIAL_BUFFER_FRAMES
      ) {
        await wait(TTS_UNDERFEED_PAUSE_MS);
        continue;
      }
      if (!this.holdDone) {
        this.holdDone = true;
        // Un son d'attente est en cours : la réponse part après lui, jamais par-dessus.
        await waitForVoiceFiller(this.session);
        if (this.cancelled) return;
        // La réponse est prête ; elle ne part qu'après un vrai silence de l'appelant.
        const hold = await holdFirstAudioForCallerSilence(
          this.session,
          () => !this.cancelled && isActive(this.session, this.generation),
        );
        voiceFirstAudioHoldTotal.inc({ outcome: hold.outcome });
        if (hold.heldMs > 0) voiceFirstAudioHoldMs.observe(hold.heldMs);
        if (hold.outcome === 'cancelled_voice_resumed') {
          recordVoiceTurnEventIfCurrent(this.session, this.turnId, 'first_audio_hold', {
            outcome: hold.outcome,
            heldMs: hold.heldMs,
          });
          if (this.onHoldCancelled) this.onHoldCancelled();
          else this.cancel();
          return;
        }
        if (hold.outcome === 'aborted') {
          this.cancel('unused');
          return;
        }
      }
      if (this.paused) {
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
        JSON.stringify({
          event: 'media',
          media: { payload: encodeTelnyxFromPcm16(this.session.codec, frame).toString('base64') },
        }),
      );
      this.sentFrames++;
      const hadAudioSent = this.session.latencyTrace?.totalE2eMs !== undefined;
      markVoiceTurnAudioSent(
        this.session,
        { ttsPath: 'elevenlabs_dialogue', isFiller: false },
        this.turnId,
      );
      if (!hadAudioSent && this.session.latencyTrace?.totalE2eMs !== undefined) {
        persistLatencyTrace(this.session).catch((err) =>
          logger.error(
            { err, callId: this.session.callControlId },
            '[elevenlabs-context] persist latency failed',
          ),
        );
      }
      await wait(TTS_PACE_PAUSE_MS);
    }
  }

  private async completeAfterPlayback(): Promise<void> {
    if (this.remainder.length > 0) {
      this.audioFrames.push(
        padTelnyxFrame(this.session.codec, this.remainder, telnyxFrameBytes(this.session.codec)),
      );
      this.remainder = Buffer.alloc(0);
    }
    if (!this.playbackPromise && this.audioFrames.length > 0) {
      this.playbackPromise = this.playAudio();
    }
    await this.playbackPromise;
    // Annulé ou échoué pendant la lecture : rien à enregistrer comme synthèse terminée.
    if (this.settled) return;
    recordVoiceTurnEventIfCurrent(this.session, this.turnId, 'tts_synthesis_completed', {
      source: 'elevenlabs_dialogue',
      durationMs: Date.now() - this.synthesisStartedAt,
    });
    recordVoiceTurnEventIfCurrent(this.session, this.turnId, 'tts_completed', {
      source: 'elevenlabs_dialogue',
      durationMs: Date.now() - this.synthesisStartedAt,
    });
    this.stopTimers();
    this.settle();
    this.closeSocket();
  }

  /** Clôt le tour une seule fois : `finish()` se résout ou rejette à cet instant. */
  private settle(error?: Error): void {
    if (this.settled) return;
    this.settled = true;
    if (error) this.rejectCompletion(error);
    else this.resolveCompletion();
  }

  /**
   * Échec réseau ou erreur serveur. Le contrôle passe par `settled` et non par `finishedOutput` : une erreur
   * pendant la lecture finale doit encore rejeter `finish()`, sinon le tour resterait bloqué.
   */
  private fail(error: Error): void {
    if (this.settled || this.cancelled) return;
    this.finishedOutput = true;
    this.stopTimers();
    this.audioFrames.length = 0;
    this.closeSocket();
    recordVoiceTurnEventIfCurrent(this.session, this.turnId, 'tts_interrupted', {
      reason: 'error',
      ttsPath: 'elevenlabs_dialogue',
    });
    this.settle(error);
  }
}

/**
 * Crée un tour ElevenLabs si la clé d'API est présente. Sinon `null` : le fournisseur de repli
 * (Cartesia en contexte, ou le chemin HTTP) prend le relais.
 */
export function createElevenLabsContextTurn(session: CallSession): ElevenLabsContextTurn | null {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) return null;
  return new ElevenLabsContextTurn(
    session,
    session.ttsGeneration,
    apiKey,
    getElevenLabsTtsVoiceId(),
    buildElevenLabsDialogueUrl({
      outputFormat: elevenLabsOutputFormat(session.codec),
      languageCode: elevenLabsLanguageCode(effectiveVoiceLanguage(session)),
      syncAlignment: true,
    }),
  );
}
