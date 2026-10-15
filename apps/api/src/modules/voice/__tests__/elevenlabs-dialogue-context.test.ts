import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type RawData } from 'ws';
import {
  buildCloseMessage,
  buildElevenLabsDialogueUrl,
  buildKeepAliveMessage,
  buildOpeningMessage,
  buildTextMessage,
  ELEVENLABS_DIALOGUE_MODEL,
  ElevenLabsDialogueSession,
  getPronunciationDictionaryLocator,
  isElevenLabsDialogueEnabled,
  parseElevenLabsDialogueMessage,
} from '../stream/elevenlabs-dialogue-context';

// Valeur générée à chaque exécution : le test vérifie seulement que la clé passée part dans l'en-tête.
const TEST_API_KEY = `test-${Date.now()}`;

describe('elevenlabs-dialogue-context : URL et messages', () => {
  it('construit l’URL du WebSocket Text to Dialogue avec le modèle et le format', () => {
    const url = new URL(buildElevenLabsDialogueUrl());
    expect(url.host).toBe('api.elevenlabs.io');
    expect(url.pathname).toBe('/v1/text-to-dialogue/stream-input');
    expect(url.searchParams.get('model_id')).toBe(ELEVENLABS_DIALOGUE_MODEL);
    expect(url.searchParams.get('output_format')).toBe('pcm_16000');
    expect(
      new URL(buildElevenLabsDialogueUrl({ outputFormat: 'ulaw_8000' })).searchParams.get(
        'output_format',
      ),
    ).toBe('ulaw_8000');
  });

  it('ajoute la langue et l’alignement seulement quand ils sont demandés', () => {
    const plain = new URL(buildElevenLabsDialogueUrl());
    expect(plain.searchParams.has('language_code')).toBe(false);
    expect(plain.searchParams.has('sync_alignment')).toBe(false);
    const full = new URL(buildElevenLabsDialogueUrl({ languageCode: 'fr', syncAlignment: true }));
    expect(full.searchParams.get('language_code')).toBe('fr');
    expect(full.searchParams.get('sync_alignment')).toBe('true');
  });

  it('enregistre une seule voix au premier message', () => {
    expect(buildOpeningMessage('voix-test')).toEqual({ voices: ['voix-test'] });
  });

  it('ajoute le dictionnaire de prononciation au premier message quand il est configuré', () => {
    const dictionary = { pronunciation_dictionary_id: 'dico', version_id: 'v1' };
    expect(buildOpeningMessage('voix-test', dictionary)).toEqual({
      voices: ['voix-test'],
      pronunciation_dictionary_locators: [dictionary],
    });
  });

  it('ne lit le dictionnaire que si l’identifiant et la version sont présents', () => {
    expect(getPronunciationDictionaryLocator({})).toBeNull();
    expect(
      getPronunciationDictionaryLocator({ ELEVENLABS_PRONUNCIATION_DICTIONARY_ID: 'dico' }),
    ).toBeNull();
    expect(
      getPronunciationDictionaryLocator({
        ELEVENLABS_PRONUNCIATION_DICTIONARY_ID: ' dico ',
        ELEVENLABS_PRONUNCIATION_DICTIONARY_VERSION_ID: ' v1 ',
      }),
    ).toEqual({ pronunciation_dictionary_id: 'dico', version_id: 'v1' });
  });

  it('envoie le texte dans inputs, avec flush par défaut', () => {
    expect(buildTextMessage('voix-test', 'Bonjour.')).toEqual({
      inputs: [{ text: 'Bonjour.', voice_id: 'voix-test', new_turn: false }],
      flush: true,
    });
    expect(buildTextMessage('voix-test', 'Bonjour.', { flush: false }).flush).toBe(false);
  });

  it('expose les messages de fin et de maintien en vie', () => {
    expect(buildCloseMessage()).toEqual({ close_socket: true });
    expect(buildKeepAliveMessage()).toEqual({ keep_alive: true });
  });
});

describe('elevenlabs-dialogue-context : lecture des messages serveur', () => {
  it('décode l’audio base64 en octets', () => {
    const event = parseElevenLabsDialogueMessage(
      JSON.stringify({ audio: Buffer.from([1, 2, 3]).toString('base64') }),
    );
    expect(event).toEqual({ kind: 'audio', pcm: Buffer.from([1, 2, 3]) });
  });

  it('lit l’alignement d’un chunk audio, et l’ignore s’il est incohérent', () => {
    const audio = Buffer.from([1, 2]).toString('base64');
    expect(
      parseElevenLabsDialogueMessage(
        JSON.stringify({ audio, alignment: { chars: ['B', 'o'], char_start_times_ms: [0, 40] } }),
      ),
    ).toEqual({
      kind: 'audio',
      pcm: Buffer.from([1, 2]),
      alignment: { chars: ['B', 'o'], startMs: [0, 40] },
    });
    for (const alignment of [
      null,
      { chars: ['B'], char_start_times_ms: [0, 40] },
      { chars: [], char_start_times_ms: [] },
      { chars: [1], char_start_times_ms: [0] },
    ]) {
      expect(parseElevenLabsDialogueMessage(JSON.stringify({ audio, alignment }))).toEqual({
        kind: 'audio',
        pcm: Buffer.from([1, 2]),
      });
    }
  });

  it('reconnaît la fin de tour et la fin de session', () => {
    expect(
      parseElevenLabsDialogueMessage(JSON.stringify({ is_final_audio_for_turn: true })),
    ).toEqual({ kind: 'turn_end' });
    expect(parseElevenLabsDialogueMessage(JSON.stringify({ is_final: true }))).toEqual({
      kind: 'final',
    });
  });

  it('remonte les erreurs avec leur message', () => {
    expect(
      parseElevenLabsDialogueMessage(
        JSON.stringify({ error: 'authentication_required', message: 'clé absente' }),
      ),
    ).toEqual({
      kind: 'error',
      message: 'authentication_required : clé absente',
    });
  });

  it('ignore les messages vides, inconnus ou mal formés', () => {
    expect(parseElevenLabsDialogueMessage(JSON.stringify({ audio: '' }))).toEqual({
      kind: 'ignored',
    });
    expect(parseElevenLabsDialogueMessage(JSON.stringify({ autre: true }))).toEqual({
      kind: 'ignored',
    });
    expect(parseElevenLabsDialogueMessage('pas du json')).toEqual({ kind: 'ignored' });
  });
});

describe('elevenlabs-dialogue-context : drapeau', () => {
  it('est désactivé par défaut et ne s’active globalement qu’avec la valeur « true »', () => {
    expect(isElevenLabsDialogueEnabled('resto-a', {})).toBe(false);
    expect(
      isElevenLabsDialogueEnabled('resto-a', { VOICE_TTS_ELEVENLABS_DIALOGUE_ENABLED: 'true' }),
    ).toBe(true);
    expect(
      isElevenLabsDialogueEnabled('resto-a', { VOICE_TTS_ELEVENLABS_DIALOGUE_ENABLED: '1' }),
    ).toBe(false);
  });

  it('s’active seulement pour les restaurants listés', () => {
    const env = { VOICE_TTS_ELEVENLABS_DIALOGUE_RESTAURANT_IDS: ' resto-a , resto-b ' };
    expect(isElevenLabsDialogueEnabled('resto-a', env)).toBe(true);
    expect(isElevenLabsDialogueEnabled('resto-b', env)).toBe(true);
    expect(isElevenLabsDialogueEnabled('resto-c', env)).toBe(false);
    expect(isElevenLabsDialogueEnabled(undefined, env)).toBe(false);
  });
});

describe('elevenlabs-dialogue-context : session avec serveur local', () => {
  let server: WebSocketServer | null = null;
  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
      server = null;
    });
  });

  function listen(
    onMessage: (message: Record<string, unknown>, socket: import('ws').WebSocket) => void,
    onHeaders: (key: string | undefined) => void,
  ) {
    server = new WebSocketServer({ port: 0 });
    server.on('connection', (socket, request) => {
      onHeaders(request.headers['xi-api-key'] as string | undefined);
      socket.on('message', (raw: RawData) =>
        onMessage(JSON.parse(raw.toString()) as Record<string, unknown>, socket),
      );
    });
    const { port } = server.address() as AddressInfo;
    return `ws://127.0.0.1:${port}/`;
  }

  it('suit le protocole : clé d’API, voix, texte avec flush, fin, puis audio et fin de session', async () => {
    const received: Array<Record<string, unknown>> = [];
    let apiKey: string | undefined;
    const url = listen(
      (message, socket) => {
        received.push(message);
        if (message.close_socket === true) {
          socket.send(
            JSON.stringify({
              audio: Buffer.from([9, 8, 7, 6]).toString('base64'),
              is_final_audio_for_turn: true,
            }),
          );
          socket.send(JSON.stringify({ is_final: true }));
        }
      },
      (key) => {
        apiKey = key;
      },
    );

    const audio: Buffer[] = [];
    let finalResolve!: () => void;
    const finished = new Promise<void>((resolve) => {
      finalResolve = resolve;
    });
    const session = new ElevenLabsDialogueSession({
      apiKey: TEST_API_KEY,
      voiceId: 'voix-test',
      url,
      onAudio: (pcm) => audio.push(pcm),
      onError: (message) => {
        throw new Error(`erreur inattendue : ${message}`);
      },
      onFinal: () => finalResolve(),
    });

    await session.connect();
    session.sendText('Bonjour.');
    session.finish();
    await finished;

    expect(apiKey).toBe(TEST_API_KEY);
    expect(received[0]).toEqual({ voices: ['voix-test'] });
    expect(received[1]).toEqual({
      inputs: [{ text: 'Bonjour.', voice_id: 'voix-test', new_turn: false }],
      flush: true,
    });
    expect(received[2]).toEqual({ close_socket: true });
    expect(Buffer.concat(audio)).toEqual(Buffer.from([9, 8, 7, 6]));
    session.close();
  });

  it('remonte une erreur du serveur sans lever d’exception', async () => {
    const url = listen(
      (_message, socket) => {
        socket.send(JSON.stringify({ error: 'unsupported_model', message: 'modèle refusé' }));
      },
      () => undefined,
    );

    const errors: string[] = [];
    const session = new ElevenLabsDialogueSession({
      apiKey: TEST_API_KEY,
      voiceId: 'voix-test',
      url,
      onAudio: () => undefined,
      onError: (message) => errors.push(message),
      onFinal: () => undefined,
    });

    await session.connect();
    session.sendText('Bonjour.');
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(errors).toEqual(['unsupported_model : modèle refusé']);
    session.close();
  });
});
