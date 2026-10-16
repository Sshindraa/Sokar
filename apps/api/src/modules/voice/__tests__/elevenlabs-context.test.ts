import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { createContextTtsTurn } from '../stream/context-tts';
import {
  ElevenLabsContextTurn,
  elevenLabsLanguageCode,
  elevenLabsOutputFormat,
  getElevenLabsTtsVoiceId,
} from '../stream/elevenlabs-context';
import type { CallSession } from '../stream/types';

const ENV_KEYS = [
  'VOICE_TTS_ELEVENLABS_DIALOGUE_ENABLED',
  'VOICE_TTS_ELEVENLABS_DIALOGUE_RESTAURANT_IDS',
  'VOICE_TTS_CONTEXT_V2_ENABLED',
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_TTS_VOICE_ID',
  'ELEVENLABS_PRONUNCIATION_DICTIONARY_ID',
  'ELEVENLABS_PRONUNCIATION_DICTIONARY_VERSION_ID',
  'VOICE_FIRST_AUDIO_SILENCE_MS',
] as const;

const ELEVENLABS_TEST_KEY = ['test', 'elevenlabs', 'api', 'key'].join('-');
const savedEnv = new Map<string, string | undefined>();
const servers: WebSocketServer[] = [];

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  // Sans attente de silence de l'appelant, la réponse part dès qu'elle est prête.
  process.env.VOICE_FIRST_AUDIO_SILENCE_MS = '0';
});

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
  for (const server of servers.splice(0)) {
    for (const client of server.clients) client.terminate();
    server.close();
  }
});

function startServer(
  onMessage: (message: Record<string, unknown>, socket: WebSocket) => void,
): string {
  const server = new WebSocketServer({ port: 0 });
  servers.push(server);
  server.on('connection', (socket) => {
    socket.on('message', (raw: RawData) =>
      onMessage(JSON.parse(raw.toString()) as Record<string, unknown>, socket),
    );
  });
  const { port } = server.address() as AddressInfo;
  return `ws://127.0.0.1:${port}/`;
}

function makeSession(codec: 'PCMA' | 'PCMU' | 'L16' = 'PCMA') {
  const telnyxMessages: Array<{ event: string; media?: { payload: string } }> = [];
  const session = {
    codec,
    ended: false,
    state: 'SPEAKING',
    ttsGeneration: 1,
    telnyxWs: {
      readyState: WebSocket.OPEN,
      send: (payload: string) => telnyxMessages.push(JSON.parse(payload)),
    },
    callControlId: 'call-test',
    callLegId: 'leg-test',
    restaurantId: 'restaurant-test',
  } as unknown as CallSession;
  return { session, telnyxMessages };
}

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition non atteinte');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('ElevenLabs context TTS : format et voix', () => {
  it('demande le format de sortie qui correspond au codec Telnyx', () => {
    expect(elevenLabsOutputFormat('PCMA')).toBe('alaw_8000');
    expect(elevenLabsOutputFormat('PCMU')).toBe('ulaw_8000');
    expect(elevenLabsOutputFormat('L16')).toBe('pcm_16000');
  });

  it('utilise la voix de ELEVENLABS_TTS_VOICE_ID, sinon la voix du banc', () => {
    delete process.env.ELEVENLABS_TTS_VOICE_ID;
    expect(getElevenLabsTtsVoiceId()).toBe('lPojg5cGgbhot31LKO2z');
    process.env.ELEVENLABS_TTS_VOICE_ID = ' voix-restaurant ';
    expect(getElevenLabsTtsVoiceId()).toBe('voix-restaurant');
  });
});

describe('ElevenLabs context TTS : fabrique', () => {
  it('ne crée aucun tour de contexte quand aucun drapeau n’est actif', () => {
    delete process.env.VOICE_TTS_ELEVENLABS_DIALOGUE_ENABLED;
    delete process.env.VOICE_TTS_CONTEXT_V2_ENABLED;
    expect(createContextTtsTurn(makeSession().session)).toBeNull();
  });

  it('sans clé d’API, le drapeau ElevenLabs ne crée pas de tour', () => {
    process.env.VOICE_TTS_ELEVENLABS_DIALOGUE_ENABLED = 'true';
    process.env.VOICE_TTS_CONTEXT_V2_ENABLED = 'false';
    delete process.env.ELEVENLABS_API_KEY;
    expect(createContextTtsTurn(makeSession().session)).toBeNull();
  });

  it('la liste de restaurants ne crée pas de tour pour un restaurant absent', () => {
    delete process.env.VOICE_TTS_ELEVENLABS_DIALOGUE_ENABLED;
    process.env.VOICE_TTS_ELEVENLABS_DIALOGUE_RESTAURANT_IDS = 'autre-restaurant';
    process.env.VOICE_TTS_CONTEXT_V2_ENABLED = 'false';
    process.env.ELEVENLABS_API_KEY = ELEVENLABS_TEST_KEY;
    expect(createContextTtsTurn(makeSession().session)).toBeNull();
  });
});

describe('ElevenLabs context TTS : protocole et relais audio', () => {
  it('envoie la voix, puis les phrases avec flush selon leur fin, puis close_socket', async () => {
    const received: Array<Record<string, unknown>> = [];
    const audio = Buffer.alloc(800, 0x2a); // une trame de 100 ms en A-law
    const url = startServer((message, socket) => {
      received.push(message);
      if (message.close_socket === true) {
        socket.send(
          JSON.stringify({ audio: audio.toString('base64'), is_final_audio_for_turn: true }),
        );
        socket.send(JSON.stringify({ is_final: true }));
      }
    });
    const { session, telnyxMessages } = makeSession('PCMA');
    const turn = new ElevenLabsContextTurn(session, 1, 'cle-test', 'voix-test', url);

    turn.push('Bonjour.');
    turn.push('Une table pour deux');
    turn.push('à 20 heures.');
    await turn.finish();

    expect(received[0]).toEqual({ voices: ['voix-test'] });
    expect(received.slice(1, 4)).toEqual([
      { inputs: [{ text: 'Bonjour.', voice_id: 'voix-test', new_turn: false }], flush: true },
      {
        inputs: [{ text: ' Une table pour deux', voice_id: 'voix-test', new_turn: false }],
        flush: false,
      },
      { inputs: [{ text: ' à 20 heures.', voice_id: 'voix-test', new_turn: false }], flush: true },
    ]);
    expect(received[4]).toEqual({ close_socket: true });
    expect(telnyxMessages).toEqual([
      { event: 'media', media: { payload: audio.toString('base64') } },
    ]);
    expect(turn.framesSent).toBe(1);
    expect(turn.hasAudioOutput).toBe(true);
  });

  it('envoie le dictionnaire de prononciation configuré dans le premier message', async () => {
    process.env.ELEVENLABS_PRONUNCIATION_DICTIONARY_ID = 'dico';
    process.env.ELEVENLABS_PRONUNCIATION_DICTIONARY_VERSION_ID = 'v1';
    const received: Array<Record<string, unknown>> = [];
    const url = startServer((message, socket) => {
      received.push(message);
      if (message.close_socket === true) socket.send(JSON.stringify({ is_final: true }));
    });
    const { session } = makeSession('PCMA');
    const turn = new ElevenLabsContextTurn(session, 1, 'cle-test', 'voix-test', url);

    turn.push('Bonjour.');
    await turn.finish();

    expect(received[0]).toEqual({
      voices: ['voix-test'],
      pronunciation_dictionary_locators: [
        { pronunciation_dictionary_id: 'dico', version_id: 'v1' },
      ],
    });
  });

  it('place l’alignement de chaque chunk sur l’axe de lecture', async () => {
    const chunk = Buffer.alloc(800, 0x2a).toString('base64'); // 100 ms en A-law
    const url = startServer((message, socket) => {
      if (message.close_socket === true) {
        socket.send(
          JSON.stringify({
            audio: chunk,
            alignment: { chars: ['B', 'o', 'n'], char_start_times_ms: [0, 30, 60] },
          }),
        );
        socket.send(JSON.stringify({ audio: chunk }));
        socket.send(
          JSON.stringify({
            audio: chunk,
            alignment: {
              chars: ['j', 'o', 'u', 'r', '.'],
              char_start_times_ms: [0, 20, 40, 60, 80],
            },
          }),
        );
        socket.send(JSON.stringify({ is_final: true }));
      }
    });
    const { session } = makeSession('PCMA');
    const turn = new ElevenLabsContextTurn(session, 1, 'cle-test', 'voix-test', url);

    turn.push('Bonjour.');
    await turn.finish();

    expect(turn.interruptionSnapshot().alignment).toEqual({
      text: 'Bonjour.',
      startMs: [0, 30, 60, 200, 220, 240, 260, 280],
    });
  });

  it('passe la langue de l’appel à ElevenLabs, le filipino en ISO 639-3', () => {
    expect(elevenLabsLanguageCode('fr')).toBe('fr');
    expect(elevenLabsLanguageCode('en')).toBe('en');
    expect(elevenLabsLanguageCode('tl')).toBe('fil');
  });

  it('échange les octets du PCM 16 kHz pour le L16 Telnyx, comme Cartesia', async () => {
    const url = startServer((message, socket) => {
      if (message.close_socket === true) {
        socket.send(JSON.stringify({ audio: Buffer.from([0x01, 0x02]).toString('base64') }));
        socket.send(JSON.stringify({ is_final: true }));
      }
    });
    const { session, telnyxMessages } = makeSession('L16');
    const turn = new ElevenLabsContextTurn(session, 1, 'cle-test', 'voix-test', url);

    turn.push('Bonjour.');
    await turn.finish();

    // Le reliquat est complété en silence jusqu'à une trame de 100 ms (3 200 octets).
    const payload = Buffer.from(telnyxMessages[0]?.media?.payload ?? '', 'base64');
    expect(payload.length).toBe(3200);
    expect(payload.subarray(0, 2)).toEqual(Buffer.from([0x02, 0x01]));
  });

  it('une interruption ferme la connexion, résout finish() et ne relaie plus d’audio', async () => {
    const received: Array<Record<string, unknown>> = [];
    const url = startServer((message) => {
      received.push(message);
    });
    const { session, telnyxMessages } = makeSession('PCMA');
    const turn = new ElevenLabsContextTurn(session, 1, 'cle-test', 'voix-test', url);

    turn.push('Bonjour.');
    await waitFor(() => received.length >= 2);
    turn.cancel('barge_in');

    await expect(turn.finish()).resolves.toBeUndefined();
    expect(turn.interruptionSnapshot()).toEqual({
      text: 'Bonjour.',
      playedMs: 0,
      totalMs: null,
    });
    expect(telnyxMessages).toEqual([]);
  });

  it('une erreur du serveur fait rejeter finish(), pour que le repli prenne le relais', async () => {
    const url = startServer((_message, socket) => {
      socket.send(JSON.stringify({ error: 'unsupported_model', message: 'modèle refusé' }));
    });
    const { session } = makeSession('PCMA');
    const turn = new ElevenLabsContextTurn(session, 1, 'cle-test', 'voix-test', url);

    turn.push('Bonjour.');

    await expect(turn.finish()).rejects.toThrow('unsupported_model : modèle refusé');
    expect(turn.hasAudioOutput).toBe(false);
  });

  it('une connexion impossible fait rejeter finish() sans lever d’exception', async () => {
    const { session } = makeSession('PCMA');
    const turn = new ElevenLabsContextTurn(
      session,
      1,
      'cle-test',
      'voix-test',
      'ws://127.0.0.1:1/',
    );

    turn.push('Bonjour.');

    await expect(turn.finish()).rejects.toThrow();
  });
});
