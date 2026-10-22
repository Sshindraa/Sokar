import { WebSocket, type RawData } from 'ws';

/**
 * Client WebSocket ElevenLabs Text to Dialogue, utilisé par `elevenlabs-context.ts` pour le tour de parole.
 * Actif pour tous les restaurants dès que `ELEVENLABS_API_KEY` est présente.
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

/** Chemin WebSocket pour tous les restaurants, dès que la clé ElevenLabs est présente. */
export function isElevenLabsDialogueEnabledFor(
  restaurantId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(restaurantId && env.ELEVENLABS_API_KEY?.trim());
}

export interface ElevenLabsDialogueUrlOptions {
  model?: string;
  /** Format de sortie. `pcm_16000` par défaut ; `ulaw_8000` et `alaw_8000` vérifiés en banc (16/10/2026). */
  outputFormat?: string;
  /** Langue imposée (ISO 639-1), sans détection automatique. Absente : le modèle détecte. */
  languageCode?: string;
  /** `sync_alignment` : chaque chunk audio porte l'instant de chaque caractère prononcé. */
  syncAlignment?: boolean;
}

export function buildElevenLabsDialogueUrl(options: ElevenLabsDialogueUrlOptions = {}): string {
  const url = new URL(ELEVENLABS_DIALOGUE_WS_URL);
  url.searchParams.set('model_id', options.model ?? ELEVENLABS_DIALOGUE_MODEL);
  url.searchParams.set('output_format', options.outputFormat ?? 'pcm_16000');
  if (options.languageCode) url.searchParams.set('language_code', options.languageCode);
  if (options.syncAlignment) url.searchParams.set('sync_alignment', 'true');
  return url.toString();
}

export interface PronunciationDictionaryLocator {
  pronunciation_dictionary_id: string;
  version_id: string;
}

/**
 * Dictionnaire de prononciation ElevenLabs (`ELEVENLABS_PRONUNCIATION_DICTIONARY_ID` et `_VERSION_ID`), ou `null`.
 * Les deux sont requis : un identifiant inconnu fait fermer la connexion par le serveur (code 1008).
 */
export function getPronunciationDictionaryLocator(
  env: NodeJS.ProcessEnv = process.env,
): PronunciationDictionaryLocator | null {
  const id = env.ELEVENLABS_PRONUNCIATION_DICTIONARY_ID?.trim();
  const version = env.ELEVENLABS_PRONUNCIATION_DICTIONARY_VERSION_ID?.trim();
  if (!id || !version) return null;
  return { pronunciation_dictionary_id: id, version_id: version };
}

/** Premier message : enregistre la voix (v4 Turbo en accepte une seule par connexion) et le dictionnaire éventuel. */
export function buildOpeningMessage(
  voiceId: string,
  dictionary: PronunciationDictionaryLocator | null = null,
): { voices: string[]; pronunciation_dictionary_locators?: PronunciationDictionaryLocator[] } {
  return dictionary
    ? { voices: [voiceId], pronunciation_dictionary_locators: [dictionary] }
    : { voices: [voiceId] };
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

/** Alignement d'un chunk : caractères prononcés et leur début, en ms depuis le début du chunk. */
export interface ElevenLabsChunkAlignment {
  chars: string[];
  startMs: number[];
}

export type ElevenLabsDialogueEvent =
  | { kind: 'audio'; pcm: Buffer; alignment?: ElevenLabsChunkAlignment }
  | { kind: 'turn_end' }
  | { kind: 'final' }
  | { kind: 'error'; message: string }
  | { kind: 'ignored' };

interface ServerMessage {
  audio?: string | null;
  alignment?: { chars?: unknown; char_start_times_ms?: unknown } | null;
  is_final_audio_for_turn?: boolean;
  is_final?: boolean;
  error?: string;
  message?: string;
}

function parseAlignment(raw: ServerMessage['alignment']): ElevenLabsChunkAlignment | null {
  if (!raw || !Array.isArray(raw.chars) || !Array.isArray(raw.char_start_times_ms)) return null;
  const chars = raw.chars;
  const startMs = raw.char_start_times_ms;
  if (chars.length === 0 || chars.length !== startMs.length) return null;
  if (!chars.every((c) => typeof c === 'string') || !startMs.every((t) => typeof t === 'number')) {
    return null;
  }
  return { chars: chars as string[], startMs: startMs as number[] };
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
    const pcm = Buffer.from(msg.audio, 'base64');
    const alignment = parseAlignment(msg.alignment);
    return alignment ? { kind: 'audio', pcm, alignment } : { kind: 'audio', pcm };
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
