import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALAW_SILENCE, encodeAlaw } from './alaw';
import { LiveCallError, LiveCallSession, isLiveCallSupported } from './live-call-session';

// ─── Doublures minimales du navigateur ─────────────────────────

class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  open() {
    this.readyState = 1;
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

class FakeSource {
  start = vi.fn();
  stop = vi.fn();
  connect = vi.fn();
  onended: (() => void) | null = null;
  buffer: { duration: number } | null = null;
}

class FakeWorkletNode {
  static last: FakeWorkletNode | null = null;
  port: { onmessage: ((e: { data: Float32Array }) => void) | null } = { onmessage: null };
  connect = vi.fn();
  disconnect = vi.fn();
  constructor() {
    FakeWorkletNode.last = this;
  }
}

class FakeAudioContext {
  static last: FakeAudioContext | null = null;
  sampleRate = 48000;
  currentTime = 10;
  state = 'running';
  destination = {};
  sources: FakeSource[] = [];
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
  createScriptProcessor?: () => unknown;
  resume = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockResolvedValue(undefined);
  constructor() {
    FakeAudioContext.last = this;
  }
  createMediaStreamSource = () => ({ connect: vi.fn() });
  createAnalyser = () => ({
    fftSize: 0,
    connect: vi.fn(),
    getFloatTimeDomainData: vi.fn(),
  });
  createGain = () => ({ gain: { value: 1 }, connect: vi.fn() });
  createBuffer = (_channels: number, length: number, rate: number) => ({
    duration: length / rate,
    copyToChannel: vi.fn(),
  });
  createBufferSource = () => {
    const source = new FakeSource();
    source.buffer = null;
    this.sources.push(source);
    return source;
  };
}

function fakeStream() {
  const track = { enabled: true, stop: vi.fn() };
  return { track, stream: { getAudioTracks: () => [track], getTracks: () => [track] } };
}

const frame100ms = () => Buffer.from(new Uint8Array(800).fill(ALAW_SILENCE)).toString('base64');

async function startedCall(
  handlers: Partial<ConstructorParameters<typeof LiveCallSession>[0]> = {},
) {
  const onEnded = vi.fn();
  const session = new LiveCallSession({ onEnded, ...handlers });
  session.prepare();
  await session.acquireMicrophone();
  const connecting = session.connect('wss://api.test/voice/demo-stream/t');
  const socket = FakeSocket.instances[0];
  socket.open();
  socket.receive({ event: 'ready', maxDurationSec: 120 });
  const ready = await connecting;
  return { session, socket, onEnded, ready, context: FakeAudioContext.last! };
}

let media: ReturnType<typeof fakeStream>;

beforeEach(() => {
  FakeSocket.instances = [];
  FakeWorkletNode.last = null;
  media = fakeStream();
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
  Object.defineProperty(window, 'AudioContext', { value: FakeAudioContext, configurable: true });
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn().mockResolvedValue(media.stream) },
    configurable: true,
  });
  URL.createObjectURL = vi.fn(() => 'blob:worklet');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('LiveCallSession', () => {
  it('établit l’appel : attend ready, envoie start, puis le micro en trames A-law de 20 ms', async () => {
    const { socket, ready } = await startedCall();

    expect(ready.maxDurationSec).toBe(120);
    expect(socket.url).toBe('wss://api.test/voice/demo-stream/t');
    expect(socket.sent[0]).toEqual({ event: 'start' });

    // 48 kHz : 960 échantillons = 20 ms = une trame de 160 octets A-law.
    FakeWorkletNode.last!.port.onmessage!({ data: new Float32Array(960).fill(0.5) });
    const mediaMessage = socket.sent.find((m) => m.event === 'media') as {
      media: { payload: string };
    };
    const bytes = Buffer.from(mediaMessage.media.payload, 'base64');
    expect(bytes).toHaveLength(160);
    expect(bytes[0]).toBe(encodeAlaw(Float32Array.from([0.5]))[0]);
  });

  it('demande le micro avec annulation d’écho, réduction de bruit et gain automatique', async () => {
    await startedCall();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  });

  it('micro coupé : envoie du silence A-law plutôt que la voix', async () => {
    const { session, socket } = await startedCall();
    session.setMuted(true);

    FakeWorkletNode.last!.port.onmessage!({ data: new Float32Array(960).fill(0.9) });

    const payload = (socket.sent.find((m) => m.event === 'media') as { media: { payload: string } })
      .media.payload;
    expect(Array.from(Buffer.from(payload, 'base64')).every((b) => b === ALAW_SILENCE)).toBe(true);
    expect(media.track.enabled).toBe(false);
  });

  it('joue l’audio de l’assistant sans trou et signale le premier son une seule fois', async () => {
    const onAgentAudio = vi.fn();
    const { socket, context } = await startedCall({ onAgentAudio });

    socket.receive({ event: 'media', media: { payload: frame100ms() } });
    socket.receive({ event: 'media', media: { payload: frame100ms() } });

    const [first, second] = context.sources;
    const firstStart = first.start.mock.calls[0][0];
    expect(firstStart).toBeGreaterThan(context.currentTime); // avance de lecture
    expect(second.start.mock.calls[0][0]).toBeCloseTo(firstStart + 0.1, 5); // bout à bout
    expect(onAgentAudio).toHaveBeenCalledTimes(1);
  });

  it('clear (barge-in) coupe la voix et acquitte aussitôt les marks en attente', async () => {
    const { socket, context } = await startedCall();
    socket.receive({ event: 'media', media: { payload: frame100ms() } });
    socket.receive({ event: 'mark', mark: { name: 'goodbye-1' } });

    socket.receive({ event: 'clear' });

    expect(context.sources[0].stop).toHaveBeenCalled();
    expect(socket.sent).toContainEqual({ event: 'mark', mark: { name: 'goodbye-1' } });
  });

  it('acquitte une mark seulement une fois l’audio planifié entièrement joué', async () => {
    vi.useFakeTimers();
    const { socket } = await startedCall();
    socket.receive({ event: 'media', media: { payload: frame100ms() } });
    socket.receive({ event: 'mark', mark: { name: 'goodbye-2' } });

    const acked = () => socket.sent.some((m) => m.event === 'mark');
    expect(acked()).toBe(false);
    vi.advanceTimersByTime(500);
    expect(acked()).toBe(true);
  });

  it('raccrochage de l’assistant : notifie la fin et libère micro, socket et audio', async () => {
    const { socket, onEnded, context } = await startedCall();

    socket.receive({ event: 'ended', reason: 'agent_hangup' });

    expect(onEnded).toHaveBeenCalledWith('agent_hangup');
    expect(media.track.stop).toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalled();
    expect(context.close).toHaveBeenCalled();
  });

  it('hangup : prévient le serveur, libère tout et ne notifie qu’une fois', async () => {
    const { session, socket, onEnded } = await startedCall();

    session.hangup();
    session.hangup();

    expect(socket.sent).toContainEqual({ event: 'stop' });
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(onEnded).toHaveBeenCalledWith('hangup');
    expect(media.track.stop).toHaveBeenCalledTimes(1);
  });

  it('perte de connexion en cours d’appel : fin « network »', async () => {
    const { socket, onEnded } = await startedCall();
    socket.onclose!({ code: 1006 });
    expect(onEnded).toHaveBeenCalledWith('network');
  });

  it.each([
    [4409, 'busy'],
    [4401, 'invalid_ticket'],
    [4503, 'unavailable'],
  ])('refus du serveur (code %i) : connect rejette avec « %s »', async (code, expected) => {
    const session = new LiveCallSession({ onEnded: vi.fn() });
    session.prepare();
    await session.acquireMicrophone();
    const connecting = session.connect('wss://api.test/x');
    FakeSocket.instances[0].onclose!({ code });

    await expect(connecting).rejects.toMatchObject({ code: expected });
  });

  it.each([
    ['NotAllowedError', 'mic_denied'],
    ['NotFoundError', 'mic_missing'],
    ['AbortError', 'mic_failed'],
  ])('micro : %s → %s', async (name, code) => {
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(
      Object.assign(new Error('x'), { name }),
    );
    const session = new LiveCallSession({ onEnded: vi.fn() });
    session.prepare();

    const error = await session.acquireMicrophone().catch((e) => e);

    expect(error).toBeInstanceOf(LiveCallError);
    expect(error.code).toBe(code);
  });

  it('repli sur ScriptProcessor quand AudioWorklet est indisponible', async () => {
    const processor = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null as unknown };
    const onEnded = vi.fn();
    const session = new LiveCallSession({ onEnded });
    session.prepare();
    FakeAudioContext.last!.audioWorklet.addModule.mockRejectedValue(new Error('CSP'));
    FakeAudioContext.last!.createScriptProcessor = () => processor;
    await session.acquireMicrophone();
    const connecting = session.connect('wss://api.test/x');
    FakeSocket.instances[0].open();
    FakeSocket.instances[0].receive({ event: 'ready' });
    await connecting;

    expect(processor.onaudioprocess).toBeTypeOf('function');
    (processor.onaudioprocess as (e: unknown) => void)({
      inputBuffer: { getChannelData: () => new Float32Array(960) },
    });
    expect(FakeSocket.instances[0].sent.some((m) => m.event === 'media')).toBe(true);
  });
});

describe('isLiveCallSupported', () => {
  it('est faux sans API micro (jsdom, navigateurs anciens)', () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    expect(isLiveCallSupported()).toBe(false);
  });
});
