/**
 * Repli OpenRouter du modèle vocal (appel 1b3f85e9 / panne de quota du 29/09) : le tour structuré
 * ET le chemin à outils des autres restaurants basculent quand Cerebras échoue avant le premier
 * fragment ; un premier fragment trop lent bascule aussi.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { CallSessionManager, _resetCircuitBreakersForTesting } from '../stream/manager';
import { voiceConfig, type VoiceConfig } from '../../../env';
import type { CallSession } from '../stream/types';
import { voiceLlmFallbackTotal, voiceLlmHedgeTotal } from '../../../shared/observability/metrics';

vi.mock('../../reservations/reservation.service', () => ({
  ReservationService: { create: vi.fn(), update: vi.fn(), availability: vi.fn() },
}));
vi.mock('../../../shared/db/client', () => ({
  db: {
    call: {
      findUnique: vi.fn().mockResolvedValue({ id: 'call-record-1', restaurantId: 'rest-1' }),
    },
    restaurant: { findUnique: vi.fn().mockResolvedValue({ timezone: 'Europe/Paris' }) },
    reservation: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    reservationAuditLog: { create: vi.fn() },
    message: { create: vi.fn() },
  },
}));
vi.mock('../../../shared/telnyx/http-agent', () => ({
  telnyxFetch: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('../../../shared/logger/pino', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));

const PRIMARY_KEY = ['test', 'cerebras', 'key'].join('-');
const FALLBACK_KEY = ['test', 'openrouter', 'key'].join('-');

const sse = (chunks: string[]): Response => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`,
          ),
        );
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
};

const neverEmits = (): Response =>
  new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200 });

function makeSession(): CallSession {
  return CallSessionManager.getInstance().create({
    callControlId: 'cc-fallback',
    callSessionId: 'cs-fallback',
    from: '+33****0001',
    to: '+33****0000',
    restaurantId: 'rest-1',
    restaurantName: 'Test Resto',
    systemPrompt: "Tu es l'assistant vocal de Test Resto.",
    isVip: false,
    telnyxWs: { readyState: WebSocket.OPEN, send: vi.fn(), close: vi.fn(), on: vi.fn() } as never,
    callLegId: 'leg-fallback',
    codec: 'PCMA',
  });
}

const format = {
  type: 'json_schema',
  json_schema: { name: 'voice_turn', strict: true, schema: {} },
};
const messages = [
  { role: 'system' as const, content: 'Consignes' },
  { role: 'user' as const, content: 'bonjour' },
];

let saved: Partial<VoiceConfig>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  saved = {
    CEREBRAS_API_KEY: voiceConfig.CEREBRAS_API_KEY,
    OPENROUTER_API_KEY: voiceConfig.OPENROUTER_API_KEY,
    VOICE_LLM_FIRST_CHUNK_TIMEOUT_MS: voiceConfig.VOICE_LLM_FIRST_CHUNK_TIMEOUT_MS,
    VOICE_LLM_HEDGE_MS: voiceConfig.VOICE_LLM_HEDGE_MS,
    VOICE_STRUCTURED_FALLBACK_PROVIDER_ORDER: voiceConfig.VOICE_STRUCTURED_FALLBACK_PROVIDER_ORDER,
  };
  Object.assign(voiceConfig, {
    CEREBRAS_API_KEY: PRIMARY_KEY,
    OPENROUTER_API_KEY: FALLBACK_KEY,
    VOICE_LLM_FIRST_CHUNK_TIMEOUT_MS: 60,
    VOICE_LLM_HEDGE_MS: 0,
  });
  (CallSessionManager as unknown as { instance: CallSessionManager }).instance =
    new CallSessionManager();
  _resetCircuitBreakersForTesting();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  Object.assign(voiceConfig, saved);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const urlOf = (call: unknown[]): string => String(call[0]);
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as { body: string }).body));

describe('repli du tour structuré', () => {
  it('bascule sur OpenRouter quand le quota est épuisé (402) et renvoie la réponse du repli', async () => {
    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    fetchMock
      .mockResolvedValueOnce(new Response('{"code":"payment_required"}', { status: 402 }))
      .mockResolvedValueOnce(sse(['{"turnComplete":true,', '"say":"Bonjour."}']));
    const deltas: string[] = [];

    const text = await mgr.streamStructuredCompletion(session, messages, format as never, {
      onDelta: (delta) => deltas.push(delta),
    });

    expect(text).toBe('{"turnComplete":true,"say":"Bonjour."}');
    expect(deltas.join('')).toBe(text);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(urlOf(fetchMock.mock.calls[1])).toContain('openrouter');
    expect(bodyOf(fetchMock.mock.calls[1])).toMatchObject({
      model: voiceConfig.VOICE_STRUCTURED_FALLBACK_MODEL,
      response_format: format,
      provider: {
        require_parameters: true,
        order: voiceConfig.VOICE_STRUCTURED_FALLBACK_PROVIDER_ORDER.split(',').map((n) => n.trim()),
        allow_fallbacks: true,
      },
    });
    const counter = await voiceLlmFallbackTotal.get();
    expect(counter.values).toContainEqual(
      expect.objectContaining({
        value: 1,
        labels: { path: 'structured', outcome: 'used', reason: 'quota' },
      }),
    );
  });

  it("impose l'ordre d'hébergeurs configuré, ou retombe sur le tri par latence quand il est vide", async () => {
    const mgr = CallSessionManager.getInstance();
    Object.assign(voiceConfig, { VOICE_STRUCTURED_FALLBACK_PROVIDER_ORDER: ' Cohere , Wafer ,' });
    fetchMock
      .mockResolvedValueOnce(new Response('quota', { status: 402 }))
      .mockResolvedValueOnce(sse(['{"turnComplete":true,"say":"Ok."}']));
    await mgr.streamStructuredCompletion(makeSession(), messages, format as never, {
      onDelta: () => undefined,
    });
    expect(bodyOf(fetchMock.mock.calls[1]).provider).toEqual({
      require_parameters: true,
      order: ['Cohere', 'Wafer'],
      allow_fallbacks: true,
    });

    fetchMock.mockClear();
    Object.assign(voiceConfig, { VOICE_STRUCTURED_FALLBACK_PROVIDER_ORDER: '' });
    fetchMock
      .mockResolvedValueOnce(new Response('quota', { status: 402 }))
      .mockResolvedValueOnce(sse(['{"turnComplete":true,"say":"Ok."}']));
    await mgr.streamStructuredCompletion(makeSession(), messages, format as never, {
      onDelta: () => undefined,
    });
    expect(bodyOf(fetchMock.mock.calls[1]).provider).toEqual({
      require_parameters: true,
      sort: 'latency',
    });
  });

  it('bascule aussi quand le premier fragment tarde (modèle principal lent)', async () => {
    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    fetchMock
      .mockResolvedValueOnce(neverEmits())
      .mockResolvedValueOnce(sse(['{"turnComplete":true,"say":"Oui."}']));

    const text = await mgr.streamStructuredCompletion(session, messages, format as never, {
      onDelta: () => undefined,
    });

    expect(text).toBe('{"turnComplete":true,"say":"Oui."}');
    expect(urlOf(fetchMock.mock.calls[1])).toContain('openrouter');
    const counter = await voiceLlmFallbackTotal.get();
    expect(counter.values).toContainEqual(
      expect.objectContaining({
        labels: { path: 'structured', outcome: 'used', reason: 'first_chunk_timeout' },
      }),
    );
  });

  it('ne bascule pas quand le modèle principal répond à temps', async () => {
    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    fetchMock.mockResolvedValueOnce(sse(['{"turnComplete":true,"say":"Ok."}']));

    const text = await mgr.streamStructuredCompletion(session, messages, format as never, {
      onDelta: () => undefined,
    });

    expect(text).toBe('{"turnComplete":true,"say":"Ok."}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('échoue proprement quand les deux fournisseurs échouent', async () => {
    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    fetchMock
      .mockResolvedValueOnce(new Response('quota', { status: 402 }))
      .mockResolvedValueOnce(new Response('down', { status: 503 }));

    await expect(
      mgr.streamStructuredCompletion(session, messages, format as never, {
        onDelta: () => undefined,
      }),
    ).rejects.toThrow();
    const counter = await voiceLlmFallbackTotal.get();
    expect(counter.values).toContainEqual(
      expect.objectContaining({
        labels: { path: 'structured', outcome: 'failed', reason: 'quota' },
      }),
    );
  });

  it("sans clé de repli, l'erreur du principal remonte et l'absence de clé est comptée", async () => {
    Object.assign(voiceConfig, { OPENROUTER_API_KEY: undefined });
    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    fetchMock.mockResolvedValueOnce(new Response('quota', { status: 402 }));

    await expect(
      mgr.streamStructuredCompletion(session, messages, format as never, {
        onDelta: () => undefined,
      }),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const counter = await voiceLlmFallbackTotal.get();
    expect(counter.values).toContainEqual(
      expect.objectContaining({
        labels: { path: 'structured', outcome: 'no_key', reason: 'quota' },
      }),
    );
  });
});

describe('repli du chemin à outils (restaurants hors tour structuré)', () => {
  const tools = [{ type: 'function', function: { name: 'check_availability' } }];
  const call = (mgr: CallSessionManager, session: CallSession) =>
    (
      mgr as unknown as {
        fetchLlmStreaming: (
          s: CallSession,
          m: typeof messages,
          o: { tools: unknown; maxTokens: number; temperature: number },
        ) => Promise<{ response: Response; provider: string }>;
      }
    ).fetchLlmStreaming(session, messages, { tools, maxTokens: 200, temperature: 0.7 });

  it("garde le comportement historique si le repli échoue aussi : la réponse d'erreur du principal est rendue", async () => {
    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    fetchMock
      .mockResolvedValueOnce(new Response('quota épuisé', { status: 402 }))
      .mockResolvedValueOnce(new Response('down', { status: 500 }));

    const { response, provider } = await call(mgr, session);

    expect(provider).not.toBe('openrouter');
    expect(response.status).toBe(402);
    expect(await response.text()).toBe('quota épuisé');
  });

  it('ne touche pas au repli quand le principal répond', async () => {
    const mgr = CallSessionManager.getInstance();
    const session = makeSession();
    fetchMock.mockResolvedValueOnce(sse(['Bonjour.']));

    const { provider } = await call(mgr, session);

    expect(provider).not.toBe('openrouter');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('hedging du tour structuré (requête de doublon quand le principal tarde)', () => {
  const answer = (say: string) => `{"turnComplete":true,"say":"${say}"}`;
  const delayedSse = (delayMs: number, chunks: string[]): Response => {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          setTimeout(() => {
            for (const chunk of chunks) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`,
                ),
              );
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          }, delayMs);
        },
      }),
      { status: 200 },
    );
  };
  const signalOf = (index: number) =>
    (fetchMock.mock.calls[index][1] as { signal: AbortSignal }).signal;
  const run = (mgr: CallSessionManager) =>
    mgr.streamStructuredCompletion(makeSession(), messages, format as never, {
      onDelta: () => undefined,
    });
  const hedgeCount = async (outcome: string) =>
    (await voiceLlmHedgeTotal.get()).values.find((v) => v.labels.outcome === outcome)?.value ?? 0;

  beforeEach(() => {
    Object.assign(voiceConfig, { VOICE_LLM_HEDGE_MS: 30, VOICE_LLM_FIRST_CHUNK_TIMEOUT_MS: 400 });
    voiceLlmHedgeTotal.reset();
    voiceLlmFallbackTotal.reset();
  });

  it('le doublon gagne quand le principal est bloqué : le secours répond, le principal est annulé', async () => {
    fetchMock.mockResolvedValueOnce(neverEmits()).mockResolvedValueOnce(sse([answer('Oui.')]));

    const text = await run(CallSessionManager.getInstance());

    expect(text).toBe(answer('Oui.'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(urlOf(fetchMock.mock.calls[1])).toContain('openrouter');
    expect(signalOf(0).aborted).toBe(true);
    expect(await hedgeCount('hedge_won')).toBe(1);
    // Un doublon n'est pas un repli : pas de série « used » pour la raison hedge.
    expect(
      (await voiceLlmFallbackTotal.get()).values.some((v) => v.labels.reason === 'hedge'),
    ).toBe(false);
  });

  it('le principal gagne quand il finit par répondre avant le secours : le doublon est annulé', async () => {
    fetchMock
      .mockResolvedValueOnce(delayedSse(80, [answer('Bonjour.')]))
      .mockResolvedValueOnce(neverEmits());

    const text = await run(CallSessionManager.getInstance());

    expect(text).toBe(answer('Bonjour.'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signalOf(1).aborted).toBe(true);
    expect(signalOf(0).aborted).toBe(false);
    expect(await hedgeCount('primary_won')).toBe(1);
  });

  it('ne lance aucun doublon quand le principal répond avant le délai', async () => {
    fetchMock.mockResolvedValueOnce(sse([answer('Ok.')]));

    const text = await run(CallSessionManager.getInstance());

    expect(text).toBe(answer('Ok.'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await hedgeCount('hedge_won')).toBe(0);
  });

  it("garde le repli immédiat d'un échec net du principal, sans doublon supplémentaire", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('quota', { status: 402 }))
      .mockResolvedValueOnce(delayedSse(80, [answer('Repli.')]));

    const text = await run(CallSessionManager.getInstance());

    expect(text).toBe(answer('Repli.'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await hedgeCount('hedge_won')).toBe(0);
  });

  it('échoue quand le principal est bloqué et que le doublon échoue aussi', async () => {
    fetchMock
      .mockResolvedValueOnce(neverEmits())
      .mockResolvedValueOnce(new Response('down', { status: 503 }));

    await expect(run(CallSessionManager.getInstance())).rejects.toThrow();
    expect(await hedgeCount('both_failed')).toBe(1);
  });

  it('ouvre le disjoncteur quand le doublon gagne trois tours de suite : le principal est ensuite ignoré', async () => {
    const mgr = CallSessionManager.getInstance();
    for (let i = 0; i < 3; i++) {
      fetchMock.mockResolvedValueOnce(neverEmits()).mockResolvedValueOnce(sse([answer('Oui.')]));
      await run(mgr);
    }
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(sse([answer('Direct.')]));

    const text = await run(mgr);

    expect(text).toBe(answer('Direct.'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urlOf(fetchMock.mock.calls[0])).toContain('openrouter');
  });

  it('un tour gagné par le principal remet le compte du disjoncteur à zéro', async () => {
    const mgr = CallSessionManager.getInstance();
    for (let i = 0; i < 2; i++) {
      fetchMock.mockResolvedValueOnce(neverEmits()).mockResolvedValueOnce(sse([answer('Oui.')]));
      await run(mgr);
    }
    fetchMock.mockResolvedValueOnce(sse([answer('Principal.')]));
    await run(mgr);
    fetchMock.mockResolvedValueOnce(neverEmits()).mockResolvedValueOnce(sse([answer('Oui.')]));
    await run(mgr);
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(sse([answer('Encore le principal.')]));

    await run(mgr);

    expect(urlOf(fetchMock.mock.calls[0])).not.toContain('openrouter');
  });

  it('est désactivé avec VOICE_LLM_HEDGE_MS=0 : repli séquentiel après le délai maximal', async () => {
    Object.assign(voiceConfig, { VOICE_LLM_HEDGE_MS: 0, VOICE_LLM_FIRST_CHUNK_TIMEOUT_MS: 60 });
    fetchMock.mockResolvedValueOnce(neverEmits()).mockResolvedValueOnce(sse([answer('Oui.')]));

    const text = await run(CallSessionManager.getInstance());

    expect(text).toBe(answer('Oui.'));
    expect(await hedgeCount('hedge_won')).toBe(0);
    expect(
      (await voiceLlmFallbackTotal.get()).values.some(
        (v) => v.labels.reason === 'first_chunk_timeout' && v.labels.outcome === 'used',
      ),
    ).toBe(true);
  });
});
