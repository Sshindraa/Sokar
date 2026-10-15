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
  isElevenLabsDialogueEnabled,
  isElevenLabsDialogueEnabledFor,
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

  it('enregistre une seule voix au premier message', () => {
    expect(buildOpeningMessage('voix-test')).toEqual({ voices: ['voix-test'] });
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
  const previous = process.env.VOICE_TTS_ELEVENLABS_DIALOGUE_ENABLED;
  afterEach(() => {
    if (previous === undefined) delete process.env.VOICE_TTS_ELEVENLABS_DIALOGUE_ENABLED;
    else process.env.VOICE_TTS_ELEVENLABS_DIALOGUE_ENABLED = previous;
  });

  it('est désactivé par défaut et ne s’active qu’avec la valeur « true »', () => {
    delete process.env.VOICE_TTS_ELEVENLABS_DIALOGUE_ENABLED;
    expect(isElevenLabsDialogueEnabled()).toBe(false);
    process.env.VOICE_TTS_ELEVENLABS_DIALOGUE_ENABLED = 'true';
    expect(isElevenLabsDialogueEnabled()).toBe(true);
    process.env.VOICE_TTS_ELEVENLABS_DIALOGUE_ENABLED = '1';
    expect(isElevenLabsDialogueEnabled()).toBe(false);
  });
});

describe('elevenlabs-dialogue-context : restaurants listés', () => {
  const listed = {
    VOICE_TTS_ELEVENLABS_DIALOGUE_ENABLED: 'true',
    VOICE_TTS_ELEVENLABS_DIALOGUE_RESTAURANT_IDS: 'resto-a, resto-b',
  };

  it('reste inactif sans liste de restaurants, même avec le drapeau global', () => {
    expect(
      isElevenLabsDialogueEnabledFor('resto-a', { VOICE_TTS_ELEVENLABS_DIALOGUE_ENABLED: 'true' }),
    ).toBe(false);
  });

  it('n’active que les restaurants listés, espaces compris', () => {
    expect(isElevenLabsDialogueEnabledFor('resto-a', listed)).toBe(true);
    expect(isElevenLabsDialogueEnabledFor('resto-b', listed)).toBe(true);
    expect(isElevenLabsDialogueEnabledFor('resto-c', listed)).toBe(false);
  });

  it('reste inactif si le drapeau global est coupé, même pour un restaurant listé', () => {
    expect(
      isElevenLabsDialogueEnabledFor('resto-a', {
        ...listed,
        VOICE_TTS_ELEVENLABS_DIALOGUE_ENABLED: 'false',
      }),
    ).toBe(false);
  });

  it('reste inactif sans identifiant de restaurant', () => {
    expect(isElevenLabsDialogueEnabledFor(undefined, listed)).toBe(false);
    expect(isElevenLabsDialogueEnabledFor('', listed)).toBe(false);
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
