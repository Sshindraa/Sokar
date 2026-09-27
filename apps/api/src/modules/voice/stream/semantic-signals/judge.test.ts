import { describe, expect, it, vi } from 'vitest';
import { BEHAVIORS } from './behaviors';
import { judgeAnnotation, parseJudgeOutput } from './judge';

const example = {
  input: [{ role: 'user' as const, content: 'Je voudrais annuler.' }],
  output: { role: 'assistant' as const, content: 'Je peux vous aider.' },
};

function completion(content: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as Response;
}

describe('Jev model judge', () => {
  it('uses a structured schema with all behavior ids and temperature zero', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        completion(JSON.stringify({ reasoning: 'Message explicite.', labels: {} })),
      );

    const result = await judgeAnnotation(example, {
      apiKey: 'test-key',
      baseUrl: 'https://openrouter.ai/api/v1/',
      model: 'anthropic/claude-sonnet-5-20260630',
      fetcher,
    });

    expect(result.status).toBe('ok');
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(String(init.body));
    expect(body.temperature).toBe(0);
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(
      Object.keys(body.response_format.json_schema.schema.properties.labels.properties),
    ).toEqual(BEHAVIORS.map(({ id }) => id));
    expect(body.messages[0].content).toContain('Évaluez uniquement le dernier message du client');
    expect(body.messages[1].content).not.toContain('Je peux vous aider.');
  });

  it('remplit les comportements absents avec not_observable', () => {
    const output = parseJudgeOutput({
      reasoning: 'Repère clair.',
      labels: { answers_active_question: true, explicitly_requests_cancellation: false },
    });

    expect(output?.labels.answers_active_question).toBe(true);
    expect(output?.labels.explicitly_requests_cancellation).toBe(false);
    expect(output?.labels.rejects_proposal).toBe('not_observable');
  });

  it('retourne error pour un JSON invalide sans exposer son contenu', async () => {
    const result = await judgeAnnotation(example, {
      apiKey: 'test-key',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'judge-model',
      fetcher: vi.fn().mockResolvedValue(completion('{bad json')),
    });

    expect(result).toEqual({ status: 'error', reason: 'invalid_response' });
  });

  it('retourne error quand le délai de 60 secondes expire', async () => {
    const fetcher: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('timeout', 'AbortError')),
        );
      });

    const result = await judgeAnnotation(example, {
      apiKey: 'test-key',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'judge-model',
      timeoutMs: 1,
      fetcher,
    });

    expect(result).toEqual({ status: 'error', reason: 'timeout' });
  });
});
