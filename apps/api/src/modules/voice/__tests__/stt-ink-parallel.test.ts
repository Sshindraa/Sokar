import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../shared/redis/client', () => ({ redisCache: {} }));
vi.unmock('../stream/stt-ink-parallel');

import {
  closeInkParallel,
  inkAudioFormat,
  openInkParallel,
  resolveInkTranscript,
  sendInkAudio,
  type InkSocket,
} from '../stream/stt-ink-parallel';
import type { CallSession } from '../stream/types';

class FakeSocket implements InkSocket {
  readyState = 1;
  sent: Array<Buffer | string> = [];
  closed = false;
  private listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  constructor(
    readonly url: string,
    readonly headers: Record<string, string>,
  ) {}
  on(event: string, listener: (...args: unknown[]) => void) {
    (this.listeners[event] ??= []).push(listener);
    return this;
  }
  emit(event: string, ...args: unknown[]) {
    for (const listener of this.listeners[event] ?? []) listener(...args);
  }
  final(text: string) {
    this.emit('message', Buffer.from(JSON.stringify({ type: 'transcript', is_final: true, text })));
  }
  send(data: Buffer | string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
}

const env = {
  CARTESIA_API_KEY: 'k',
  VOICE_STT_INK_RESTAURANT_IDS: 'r1',
  VOICE_STT_INK_REPLACE_RESTAURANT_IDS: 'r1',
};

function store(used = 0) {
  return {
    get: vi.fn(async () => String(used)),
    incrby: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
  };
}

async function openSession(overrides: Partial<CallSession> = {}, deps = {}) {
  const session = {
    callControlId: 'call-1',
    restaurantId: 'r1',
    codec: 'PCMA',
    // L'appelant parle : la détection locale de voix vient de l'entendre.
    callerVoice: { noiseFloor: 0, voiceRun: 0, lastVoiceAt: Date.now() },
    ...overrides,
  } as CallSession;
  let socket: FakeSocket | undefined;
  await openInkParallel(session, {
    env,
    spend: store(),
    createSocket: (url, headers) => (socket = new FakeSocket(url, headers)),
    ...deps,
  });
  socket?.emit('open');
  return { session, socket };
}

describe('format', () => {
  it('envoie le flux Telnyx sans conversion en A-law et µ-law, en PCM16 16 kHz pour L16', () => {
    expect(inkAudioFormat('PCMA')).toEqual({ encoding: 'pcm_alaw', sampleRate: 8000 });
    expect(inkAudioFormat('PCMU')).toEqual({ encoding: 'pcm_mulaw', sampleRate: 8000 });
    expect(inkAudioFormat('L16')).toEqual({ encoding: 'pcm_s16le', sampleRate: 16000 });
  });
});

describe('ouverture', () => {
  it('ne contacte pas Ink avec une clé seule, un autre restaurant ou une liste vide', async () => {
    for (const ids of [undefined, '', 'r2']) {
      const createSocket = vi.fn();
      await openSession(
        {},
        { env: { CARTESIA_API_KEY: 'k', VOICE_STT_INK_RESTAURANT_IDS: ids }, createSocket },
      );
      expect(createSocket).not.toHaveBeenCalled();
    }
  });
  it('ouvre /stt/websocket en ink-2, français, A-law 8 kHz', async () => {
    const { session, socket } = await openSession();
    const url = new URL(socket!.url);
    expect(url.pathname).toBe('/stt/websocket');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      model: 'ink-2',
      language: 'fr',
      encoding: 'pcm_alaw',
      sample_rate: '8000',
    });
    expect(socket!.headers['X-API-Key']).toBe('k');
    expect(session.sttInk?.ready).toBe(true);
  });

  it("n'ouvre rien sans clé ni restaurant, et ne retente pas", async () => {
    const create = vi.fn();
    const base = { callControlId: 'c', restaurantId: 'r1', codec: 'PCMA' } as CallSession;
    await openInkParallel(
      { ...base },
      { env: { CARTESIA_API_KEY: '' }, createSocket: create, spend: store() },
    );
    await openInkParallel(
      { ...base, restaurantId: '' },
      { env, createSocket: create, spend: store() },
    );
    const once = { ...base };
    await openInkParallel(once, { env: {}, createSocket: create, spend: store() });
    await openInkParallel(once, { env, createSocket: create, spend: store() });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('audio', () => {
  it("transmet l'audio Telnyx tel quel une fois la socket prête", async () => {
    const { session, socket } = await openSession();
    sendInkAudio(session, Buffer.alloc(160, 0xd5));
    expect(socket!.sent[0]).toEqual(Buffer.alloc(160, 0xd5));
    expect(session.voiceUsage).toMatchObject({
      sttAudioSamples: 160,
      sttAudioSamplesByProvider: { cartesia: 160 },
    });
  });

  it("n'envoie rien avant l'ouverture", async () => {
    const session = { callControlId: 'c', restaurantId: 'r1', codec: 'PCMA' } as CallSession;
    let socket: FakeSocket | undefined;
    await openInkParallel(session, {
      env,
      spend: store(),
      createSocket: (u, h) => (socket = new FakeSocket(u, h)),
    });
    sendInkAudio(session, Buffer.alloc(160));
    expect(socket!.sent).toHaveLength(0);
  });
});

describe("seule la voix de l'appelant part chez Cartesia", () => {
  it("n'envoie pas le silence, puis envoie les 0,5 s qui précèdent la voix", async () => {
    const t0 = 1_000_000;
    const { session, socket } = await openSession({
      callerVoice: { noiseFloor: 0, voiceRun: 0 },
    } as Partial<CallSession>);
    // 2 s de silence : rien n'est envoyé, seules les 0,5 s les plus récentes sont gardées.
    for (let i = 0; i < 100; i++) sendInkAudio(session, Buffer.alloc(160, i % 256), t0 + i * 20);
    expect(socket!.sent).toHaveLength(0);
    // La voix arrive : les 0,5 s gardées partent avec le morceau courant.
    session.callerVoice!.lastVoiceAt = t0 + 2000;
    sendInkAudio(session, Buffer.alloc(160, 0xaa), t0 + 2000);
    const first = socket!.sent[0] as Buffer;
    expect(first.length).toBe(4000 + 160);
    expect(first.subarray(-160)).toEqual(Buffer.alloc(160, 0xaa));
  });

  it("continue 1 s après la dernière voix, puis s'arrête", async () => {
    const t0 = 2_000_000;
    const { session, socket } = await openSession({
      callerVoice: { noiseFloor: 0, voiceRun: 0, lastVoiceAt: t0 },
    } as Partial<CallSession>);
    sendInkAudio(session, Buffer.alloc(160), t0 + 900);
    expect(socket!.sent).toHaveLength(1);
    sendInkAudio(session, Buffer.alloc(160), t0 + 1100);
    expect(socket!.sent).toHaveLength(1);
    expect(session.sttInk!.bytesSent).toBe(160);
  });
});

describe('fin de phrase', () => {
  it('garde Deepgram et rend les deux hypothèses en comparaison sans opt-in de remplacement', async () => {
    const { session, socket } = await openSession();
    const pending = resolveInkTranscript(session, 'je voudrais réserver demain', {
      env: { ...env, VOICE_STT_INK_REPLACE_RESTAURANT_IDS: '' },
    });
    socket!.final('je suis en vacances');
    await expect(pending).resolves.toMatchObject({
      transcript: 'je voudrais réserver demain',
      source: 'deepgram',
      inkTranscript: 'je suis en vacances',
    });
  });

  it('ne permet pas à un autre restaurant de remplacer le texte', async () => {
    const { session, socket } = await openSession();
    const pending = resolveInkTranscript(session, 'je voudrais réserver demain', {
      env: { ...env, VOICE_STT_INK_REPLACE_RESTAURANT_IDS: 'r2' },
    });
    socket!.final('je suis en vacances');
    expect((await pending).source).toBe('deepgram');
  });
  it("remplace le texte Deepgram par celui d'Ink-2 arrivé après finalize", async () => {
    const { session, socket } = await openSession();
    const pending = resolveInkTranscript(session, 'je vous permets de toute façon', { env });
    expect(socket!.sent.at(-1)).toBe('finalize');
    socket!.final('je voudrais faire une réservation');
    await expect(pending).resolves.toEqual(
      expect.objectContaining({ transcript: 'je voudrais faire une réservation', source: 'ink' }),
    );
  });

  it('garde Deepgram si Ink-2 ne répond pas dans le délai', async () => {
    const { session } = await openSession();
    const result = await resolveInkTranscript(session, 'pour six personnes demain', {
      env: { ...env, VOICE_STT_INK_WAIT_MS: '50' },
    });
    expect(result.source).toBe('deepgram');
    expect(result.transcript).toBe('pour six personnes demain');
  });

  it('un mot isolé reste à Deepgram sans attendre, et sa version Ink-2 ne fuit pas dans la phrase suivante', async () => {
    const { session, socket } = await openSession();
    const isolated = await resolveInkTranscript(session, 'Vingt', { env });
    expect(isolated).toEqual({ transcript: 'Vingt', source: 'deepgram', waitedMs: 0 });
    expect(socket!.sent.at(-1)).toBe('finalize');
    socket!.final('vin');
    const next = resolveInkTranscript(session, 'au nom de Akif', { env });
    socket!.final('au nom de Akif A D K I F');
    await expect(next).resolves.toEqual(
      expect.objectContaining({ transcript: 'au nom de Akif A D K I F' }),
    );
  });

  it('socket fermée ou en erreur : Deepgram seul', async () => {
    const { session, socket } = await openSession();
    socket!.emit('error', new Error('boom'));
    await expect(
      resolveInkTranscript(session, 'pour six personnes demain', { env }),
    ).resolves.toEqual(expect.objectContaining({ source: 'deepgram' }));
  });
});

describe('fin d’appel', () => {
  it('ferme la socket et ajoute les secondes envoyées au compteur du jour', async () => {
    const spend = store();
    const { session, socket } = await openSession({}, { spend });
    for (let i = 0; i < 100; i++) sendInkAudio(session, Buffer.alloc(160)); // 2 s d'A-law
    await closeInkParallel(session, { spend, now: () => Date.parse('2026-10-22T10:00:00Z') });
    expect(socket!.sent.at(-1)).toBe('close');
    expect(socket!.closed).toBe(true);
    expect(spend.incrby).toHaveBeenCalledWith('stt-ink:seconds:2026-10-22', 2);
    expect(session.sttInk).toBeUndefined();
  });
});
