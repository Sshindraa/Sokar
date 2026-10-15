import { WebSocket, type RawData } from 'ws';
import { parseRestaurantIdList } from './feature-flags';

/**
 * Client WebSocket ElevenLabs Text to Dialogue, utilisé par `elevenlabs-context.ts` pour le tour de parole.
 * Actif seulement si `isElevenLabsDialogueEnabled(restaurantId)` (faux par défaut).
 *
 * Protocole vérifié en banc (14/10/2026) : la voix est enregistrée dans le premier message, le texte passe dans
 * `inputs` avec `flush: true`, puis `close_socket` termine la session. Le serveur envoie des chunks `audio` en
 * base64, puis `is_final_audio_for_turn` et `is_final`. Le serveur coupe après 20 s sans message : `keep_alive`
 * remet le compteur à zéro. Le texte est mis en tampon jusqu'à environ 40 caractères et 8 mots, d'où `flush`.
 */

export const ELEVENLABS_DIALOGUE_WS_URL =
  'wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input';
export const ELEVENLABS_DIALOGUE_MODEL = 'eleven_v4_turbo';
const KEEP_ALIVE_MS = 10_000;
const CONNECT_TIMEOUT_MS = 5_000;

/**
 * Drapeau d'activation. `VOICE_TTS_ELEVENLABS_DIALOGUE_ENABLED=true` l'active pour tous les restaurants ;
 * sinon seulement pour ceux de `VOICE_TTS_ELEVENLABS_DIALOGUE_RESTAURANT_IDS`. Vide = aucun.
 */
export function isElevenLabsDialogueEnabled(
  restaurantId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.VOICE_TTS_ELEVENLABS_DIALOGUE_ENABLED === 'true') return true;
  return Boolean(
    restaurantId &&
    parseRestaurantIdList(env.VOICE_TTS_ELEVENLABS_DIALOGUE_RESTAURANT_IDS).includes(restaurantId),
  );
}

export interface ElevenLabsDialogueUrlOptions {
  model?: string;
  /** Format de sortie. `pcm_16000` par défaut ; les formats téléphoniques (`ulaw_8000`, `alaw_8000`) sont à valider. */
  outputFormat?: string;
}

export function buildElevenLabsDialogueUrl(options: ElevenLabsDialogueUrlOptions = {}): string {
  const url = new URL(ELEVENLABS_DIALOGUE_WS_URL);
  url.searchParams.set('model_id', options.model ?? ELEVENLABS_DIALOGUE_MODEL);
  url.searchParams.set('output_format', options.outputFormat ?? 'pcm_16000');
  return url.toString();
}

/** Premier message : enregistre la voix. v4 Turbo accepte une seule voix par connexion. */
export function buildOpeningMessage(voiceId: string): { voices: string[] } {
  return { voices: [voiceId] };
}

/** Message de texte. `flush` force la génération sans attendre le seuil de tampon (texte court). */
export function buildTextMessage(
  voiceId: string,
  text: string,
  options: { flush?: boolean } = {},
): { inputs: Array<{ text: string; voice_id: string; new_turn: boolean }>; flush: boolean } {
  return {
    inputs: [{ text, voice_id: voiceId, new_turn: false }],
    flush: options.flush ?? true,
  };
}

export function buildCloseMessage(): { close_socket: true } {
  return { close_socket: true };
}

export function buildKeepAliveMessage(): { keep_alive: true } {
  return { keep_alive: true };
}

export type ElevenLabsDialogueEvent =
  | { kind: 'audio'; pcm: Buffer }
  | { kind: 'turn_end' }
  | { kind: 'final' }
  | { kind: 'error'; message: string }
  | { kind: 'ignored' };

interface ServerMessage {
  audio?: string | null;
  is_final_audio_for_turn?: boolean;
  is_final?: boolean;
  error?: string;
  message?: string;
}

/** Lit un message serveur. Tout ce qui n'est pas reconnu est ignoré, sans exception. */
export function parseElevenLabsDialogueMessage(raw: string): ElevenLabsDialogueEvent {
  let msg: ServerMessage;
  try {
    msg = JSON.parse(raw) as ServerMessage;
  } catch {
    return { kind: 'ignored' };
  }
  if (msg.error) {
    return { kind: 'error', message: msg.message ? `${msg.error} : ${msg.message}` : msg.error };
  }
  if (typeof msg.audio === 'string' && msg.audio.length > 0) {
    return { kind: 'audio', pcm: Buffer.from(msg.audio, 'base64') };
  }
  if (msg.is_final_audio_for_turn === true) return { kind: 'turn_end' };
  if (msg.is_final === true) return { kind: 'final' };
  return { kind: 'ignored' };
}

export interface ElevenLabsDialogueSessionOptions {
  apiKey: string;
  voiceId: string;
  outputFormat?: string;
  /** Surcharge de l'URL, réservée aux tests (serveur local). */
  url?: string;
  onAudio: (pcm: Buffer) => void;
  onError: (message: string) => void;
  onFinal: () => void;
}

/**
 * Une session WebSocket par tour de parole, comme `CartesiaContextTurn`. Le cycle : `connect()`, `sendText()`
 * pour chaque morceau, `finish()` pour fermer proprement, puis `onFinal` quand le serveur a tout envoyé.
 */
export class ElevenLabsDialogueSession {
  private ws: WebSocket | null = null;
  private keepAliveTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(private readonly options: ElevenLabsDialogueSessionOptions) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url =
        this.options.url ?? buildElevenLabsDialogueUrl({ outputFormat: this.options.outputFormat });
      const ws = new WebSocket(url, { headers: { 'xi-api-key': this.options.apiKey } });
      this.ws = ws;
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error('ElevenLabs dialogue : connexion trop lente'));
      }, CONNECT_TIMEOUT_MS);

      ws.once('open', () => {
        clearTimeout(timer);
        this.send(buildOpeningMessage(this.options.voiceId));
        this.keepAliveTimer = setInterval(() => this.send(buildKeepAliveMessage()), KEEP_ALIVE_MS);
        resolve();
      });
      ws.on('message', (raw: RawData) => this.handle(raw.toString()));
      ws.on('unexpected-response', (_request, response) => {
        clearTimeout(timer);
        const error = new Error(`ElevenLabs dialogue : HTTP ${response.statusCode} à l'ouverture`);
        this.fail(error.message);
        reject(error);
      });
      ws.on('error', (error) => {
        clearTimeout(timer);
        this.fail(error.message);
        reject(error);
      });
      ws.on('close', () => this.end());
    });
  }

  /** Envoie un morceau de texte. `flush` vaut vrai par défaut pour ne pas attendre le seuil de tampon. */
  sendText(text: string, flush = true): void {
    this.send(buildTextMessage(this.options.voiceId, text, { flush }));
  }

  /** Demande la fin de session : le serveur envoie l'audio restant, puis `is_final`. */
  finish(): void {
    this.send(buildCloseMessage());
  }

  close(): void {
    this.end();
    this.ws?.close();
  }

  private send(message: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private handle(raw: string): void {
    const event = parseElevenLabsDialogueMessage(raw);
    switch (event.kind) {
      case 'audio':
        this.options.onAudio(event.pcm);
        break;
      case 'error':
        this.fail(event.message);
        break;
      case 'final':
        this.options.onFinal();
        this.close();
        break;
      default:
        break;
    }
  }

  private fail(message: string): void {
    if (this.closed) return;
    this.options.onError(message);
    this.close();
  }

  private end(): void {
    this.closed = true;
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = null;
  }
}
