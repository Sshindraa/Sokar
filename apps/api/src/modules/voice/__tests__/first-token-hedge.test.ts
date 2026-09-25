import { describe, expect, it, vi } from 'vitest';
import { raceFirstTokenResponses } from '../stream/first-token-hedge';

function tokenResponse(token: string): Response {
  const payload = `data: ${JSON.stringify({ choices: [{ delta: { content: token } }] })}\n\n`;
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

function emptyResponse(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }),
    {
      headers: { 'content-type': 'text/event-stream' },
    },
  );
}

function pendingResponse(signal: AbortSignal): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        signal.addEventListener(
          'abort',
          () => controller.error(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

describe('raceFirstTokenResponses', () => {
  it('replays the probed bytes and returns the first provider with a text token', async () => {
    const winner = vi.fn();
    const result = await raceFirstTokenResponses(
      'cerebras',
      async () => tokenResponse('Bonjour'),
      'groq',
      async () => tokenResponse('Salut'),
      { delayMs: 100, timeoutMs: 500, onWinner: winner },
    );

    expect(result.provider).toBe('cerebras');
    expect(await result.response.text()).toContain('Bonjour');
    expect(winner).toHaveBeenCalledWith('cerebras');
  });

  it('starts the backup after the delay and aborts the slower primary', async () => {
    let primarySignal: AbortSignal | undefined;
    const result = await raceFirstTokenResponses(
      'cerebras',
      async (signal) => {
        primarySignal = signal;
        return pendingResponse(signal);
      },
      'groq',
      async () => tokenResponse('Réponse'),
      { delayMs: 5, timeoutMs: 500 },
    );

    expect(result.provider).toBe('groq');
    expect(await result.response.text()).toContain('Réponse');
    expect(primarySignal?.aborted).toBe(true);
  });

  it('uses the backup when the primary ends without a text token', async () => {
    const failed = vi.fn();
    const result = await raceFirstTokenResponses(
      'cerebras',
      async () => emptyResponse(),
      'groq',
      async () => tokenResponse('Réponse'),
      { delayMs: 500, timeoutMs: 1_000, onFailure: failed },
    );

    expect(result.provider).toBe('groq');
    expect(await result.response.text()).toContain('Réponse');
    expect(failed).toHaveBeenCalledWith('cerebras', expect.any(Error), undefined);
  });

  it('starts only the backup when the primary circuit is already open', async () => {
    const primary = vi.fn(async () => tokenResponse('Ne doit pas partir'));
    const result = await raceFirstTokenResponses(
      'cerebras',
      primary,
      'groq',
      async () => tokenResponse('Secours'),
      { delayMs: 1_000, timeoutMs: 1_000, startBackupImmediately: true },
    );

    expect(result.provider).toBe('groq');
    expect(primary).not.toHaveBeenCalled();
    expect(await result.response.text()).toContain('Secours');
  });

  it('propage un barge-in après la victoire au flux retenu', async () => {
    const externalController = new AbortController();
    let selectedSignal: AbortSignal | undefined;
    const result = await raceFirstTokenResponses(
      'cerebras',
      async (signal) => {
        selectedSignal = signal;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              const token = `data: ${JSON.stringify({ choices: [{ delta: { content: 'Bonjour' } }] })}\n\n`;
              controller.enqueue(new TextEncoder().encode(token));
              signal.addEventListener(
                'abort',
                () => controller.error(new DOMException('Aborted', 'AbortError')),
                { once: true },
              );
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      },
      'groq',
      async () => tokenResponse('Secours'),
      { delayMs: 1_000, timeoutMs: 2_000, signal: externalController.signal },
    );

    expect(result.provider).toBe('cerebras');
    expect(selectedSignal?.aborted).toBe(false);
    externalController.abort('barge-in');
    expect(selectedSignal?.aborted).toBe(true);
    await result.response.body?.cancel().catch(() => undefined);
  });

  it('aborts both candidates at the global first-token timeout', async () => {
    const onTimeout = vi.fn();
    await expect(
      raceFirstTokenResponses(
        'cerebras',
        async (signal) => pendingResponse(signal),
        'groq',
        async (signal) => pendingResponse(signal),
        { delayMs: 5, timeoutMs: 15, onTimeout },
      ),
    ).rejects.toThrow('first-token hedge timed out');
    expect(onTimeout).toHaveBeenCalledOnce();
  });
});
