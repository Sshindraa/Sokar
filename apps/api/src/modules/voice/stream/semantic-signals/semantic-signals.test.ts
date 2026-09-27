import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CallSession } from '../types';
import type { TurnPlan } from '../turn-plan';
import { voiceSemanticStatusTotal } from '../../../../shared/observability/metrics';
import { BEHAVIORS } from './behaviors';
import { scoreSpan } from './client';
import { buildSemanticSpan } from './span-builder';
import { validateSemanticSignals } from './validate';
import { compareSemanticSignals } from './compare';
import { observeSemanticSignalsShadow, type SemanticShadowConfig } from './shadow';
import type { SemanticSignals, SpanRequest } from './types';

const request: SpanRequest = {
  model: 'span-01-pro',
  span: {
    input: [{ role: 'user', content: 'Bonjour' }],
    output: { role: 'assistant', content: 'Bonjour' },
  },
  behaviors: BEHAVIORS.map(({ id, definition }) => ({ id, definition })),
};
const mockApiKey = String(Date.now());
const response = (status: number, body: unknown) =>
  vi.fn<typeof fetch>().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
const resultBody = {
  model: 'span-01-pro',
  results: [
    { id: 'corrects_existing_fact', p_present: 0.73, p_absent: 0.25, p_not_observable: 0.02 },
    { id: 'unknown_behavior', p_present: 1, p_absent: 0, p_not_observable: 0 },
  ],
  usage: { input_tokens: 51 },
};
const score = (fetcher: typeof fetch, signal = new AbortController().signal) =>
  scoreSpan(request, {
    fetcher,
    signal,
    apiKey: mockApiKey,
    baseUrl: 'https://example.test/v1',
  });

describe('Span-01 client', () => {
  it('maps probabilities and ignores unknown IDs', async () => {
    const fetcher = response(200, resultBody);
    const result = await score(fetcher);
    expect(result).toMatchObject({
      status: 'ok',
      inputTokens: 51,
      signals: {
        corrects_existing_fact: { present: 0.73, absent: 0.25, notObservable: 0.02 },
      },
    });
    if (result.status === 'ok') expect(result.signals).not.toHaveProperty('unknown_behavior');
    expect(fetcher.mock.calls[0][0]).toBe('https://example.test/v1/scores');
  });

  it.each([
    [403, 'forbidden'],
    [429, 'rate_limited'],
    [500, 'http_error'],
  ] as const)('maps HTTP %i to %s', async (status, expected) => {
    expect((await score(response(status, {}))).status).toBe(expected);
  });

  it('handles timeout, invalid JSON and network errors', async () => {
    const controller = new AbortController();
    controller.abort();
    const aborted = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    expect((await score(aborted, controller.signal)).status).toBe('timeout');
    expect((await score(response(200, { results: [{ id: 'x' }] }))).status).toBe(
      'invalid_response',
    );
    const malformedJson = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('invalid JSON');
      },
    } as unknown as Response);
    expect((await score(malformedJson)).status).toBe('invalid_response');
    expect(
      (await score(vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')))).status,
    ).toBe('network_error');
  });
});

const session = {
  from: '+33612345678',
  history: [
    { role: 'assistant', content: 'Quelle heure souhaitez-vous ?' },
    { role: 'user', content: 'Vers 20 heures pour Alice Martin, alice@example.com, +33612345678.' },
    { role: 'assistant', content: 'Merci Alice Martin.' },
  ],
  conversation: {
    slots: {
      customerName: 'Alice Martin',
      customerPhone: '+33612345678',
      customerEmail: 'alice@example.com',
    },
  },
} as unknown as CallSession;

describe('span builder', () => {
  it('preserves the latest question and user turn in order, anonymizing every content', () => {
    const built = buildSemanticSpan(session, {
      transcript: 'Alice Martin confirme alice@example.com et +33612345678',
      reply: 'Merci Alice Martin.',
      previousQuestion: 'Quelle heure souhaitez-vous ?',
      model: 'span-01-pro',
      historyTurns: 1,
    });
    expect(built.span.input.at(-1)?.role).toBe('user');
    expect(built.span.input.at(-2)).toEqual({
      role: 'assistant',
      content: 'Quelle heure souhaitez-vous ?',
    });
    const serialized = JSON.stringify(built.span);
    expect(serialized).not.toContain('Alice Martin');
    expect(serialized).not.toContain('alice@example.com');
    expect(serialized).not.toContain('+33612345678');
    expect(serialized).toContain('<CUSTOMER_NAME>');
    expect(serialized).toContain('<EMAIL>');
    expect(serialized).toContain('<PHONE>');
  });

  it.each(['Ali Ben', 'Léa', 'Ana'])('masks %s without changing surrounding words', (name) => {
    const text = `La réalité de cette analyse, une banane. ${name} répond.`;
    const namedSession = {
      ...session,
      history: [],
      conversation: { slots: { customerName: name } },
    } as unknown as CallSession;
    const built = buildSemanticSpan(namedSession, {
      transcript: text,
      reply: `Merci ${name}.`,
      previousQuestion: null,
      model: 'span-01-pro',
      historyTurns: 1,
    });
    expect(built.span.input.at(-1)?.content).toContain('réalité de cette analyse, une banane');
    expect(built.span.input.at(-1)?.content).not.toContain(name);
    expect(built.span.output.content).toBe('Merci <CUSTOMER_NAME>.');
  });

  it('masks Léa independently of case', () => {
    const namedSession = {
      ...session,
      history: [],
      conversation: { slots: { customerName: 'Léa' } },
    } as unknown as CallSession;
    const built = buildSemanticSpan(namedSession, {
      transcript: 'léa et LÉA parlent de la réalité.',
      reply: 'Merci Léa.',
      previousQuestion: null,
      model: 'span-01-pro',
      historyTurns: 1,
    });
    expect(built.span.input.at(-1)?.content).toBe(
      '<CUSTOMER_NAME> et <CUSTOMER_NAME> parlent de la réalité.',
    );
  });
});

const plan = (overrides: Partial<TurnPlan> = {}): TurnPlan => ({
  interpretation: 'answer',
  intent: 'unchanged',
  facts: [],
  slots: {},
  interactionDisposition: 'none',
  confidence: 'high',
  ...overrides,
});
const present = (p: number) => ({ present: p, absent: 1 - p, notObservable: 0 });

describe('validation and comparison', () => {
  it('detects contradictions without flagging a coherent choice', () => {
    expect(
      validateSemanticSignals(
        { explicitly_confirms_proposal: present(0.9), rejects_proposal: present(0.8) },
        'confirmation',
      ).conflicts,
    ).toContain('confirm_and_reject');
    expect(
      validateSemanticSignals(
        { explicitly_requests_transfer: present(0.9), explicitly_requests_message: present(0.9) },
        'humanFallback',
      ).conflicts,
    ).toContain('transfer_and_message');
    expect(
      validateSemanticSignals(
        { explicitly_requests_transfer: present(0.9), explicitly_requests_message: present(0.1) },
        'humanFallback',
      ).consistent,
    ).toBe(true);
  });

  it('compares correction and explicit confirmation, including hesitation', () => {
    expect(
      compareSemanticSignals(
        { corrects_existing_fact: present(0.9) },
        plan({ interpretation: 'correction' }),
        'none',
      ).agreements.corrects_existing_fact,
    ).toBe('agree');
    expect(
      compareSemanticSignals(
        { explicitly_confirms_proposal: present(0.9) },
        plan({ interpretation: 'affirmation' }),
        'confirmation',
      ).agreements.explicitly_confirms_proposal,
    ).toBe('agree');
    const hesitant: SemanticSignals = {
      explicitly_confirms_proposal: { present: 0.1, absent: 0.1, notObservable: 0.8 },
    };
    expect(
      compareSemanticSignals(hesitant, plan({ interpretation: 'affirmation' }), 'confirmation')
        .agreements.explicitly_confirms_proposal,
    ).toBe('span_not_observable');
  });

  it('would clarify generic yes for a human choice', () => {
    const compared = compareSemanticSignals(
      { explicitly_requests_transfer: present(0.1) },
      plan({ interpretation: 'affirmation', interactionDisposition: 'resolve' }),
      'humanFallback',
    );
    expect(compared.wouldClarify).toBe('human_fallback');
    expect(compared.agreements.explicitly_requests_transfer).toBe('not_comparable');
  });

  it('does not mark a name answer as a fresh cancellation or gift card action', () => {
    for (const intent of ['cancel', 'gift_card'] as const) {
      const compared = compareSemanticSignals(
        {
          explicitly_requests_cancellation: present(0.05),
          explicitly_requests_gift_card_purchase: present(0.05),
        },
        plan({ intent, interpretation: 'answer', interactionDisposition: 'resolve' }),
        'customerName',
      );
      expect(compared.wouldClarify).toBeNull();
    }
  });

  it('marks a new cancellation request or resolved cancellation confirmation as sensitive', () => {
    const signals: SemanticSignals = { explicitly_requests_cancellation: present(0.05) };
    expect(
      compareSemanticSignals(
        signals,
        plan({ intent: 'cancel', interpretation: 'new_request' }),
        'none',
      ).wouldClarify,
    ).toBe('cancellation');
    expect(
      compareSemanticSignals(
        signals,
        plan({
          intent: 'cancel',
          interpretation: 'affirmation',
          interactionDisposition: 'resolve',
        }),
        'confirmation',
      ).wouldClarify,
    ).toBe('cancellation');
    expect(
      compareSemanticSignals(
        signals,
        plan({ interpretation: 'affirmation', interactionDisposition: 'resolve' }),
        'confirmation',
        'cancel',
      ).wouldClarify,
    ).toBe('cancellation');
  });

  it('accepts a message choice as clear human fallback evidence', () => {
    const compared = compareSemanticSignals(
      { explicitly_requests_transfer: present(0.05), explicitly_requests_message: present(0.95) },
      plan({ interpretation: 'answer', interactionDisposition: 'resolve' }),
      'humanFallback',
    );
    expect(compared.wouldClarify).toBeNull();
  });

  it('treats gift card purchase as sensitive only on a new request or its resolved confirmation', () => {
    const signals: SemanticSignals = { explicitly_requests_gift_card_purchase: present(0.05) };
    expect(
      compareSemanticSignals(
        signals,
        plan({ intent: 'gift_card', interpretation: 'new_request' }),
        'none',
      ).wouldClarify,
    ).toBe('gift_card');
    expect(
      compareSemanticSignals(
        signals,
        plan({ interpretation: 'affirmation', interactionDisposition: 'resolve' }),
        'confirmation',
        'gift_card',
      ).wouldClarify,
    ).toBe('gift_card');
  });
});

const config: SemanticShadowConfig = {
  enabled: true,
  sampleRate: 1,
  model: 'span-01-pro',
  timeoutMs: 2000,
  historyTurns: 6,
  baseUrl: 'https://example.test/v1',
  apiKey: mockApiKey,
};

describe('shadow boundary', () => {
  it('does not fetch or count disabled when the flag is off', () => {
    const increment = vi.spyOn(voiceSemanticStatusTotal, 'inc');
    const fetcher = response(200, resultBody);
    observeSemanticSignalsShadow(
      session,
      {
        transcript: 'Bonjour',
        reply: 'Bonjour',
        previousQuestion: null,
        activeInteraction: 'none',
      },
      { config: { ...config, enabled: false }, fetcher },
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(increment).not.toHaveBeenCalled();
    increment.mockRestore();
  });

  it('counts missing_key only when enabled without a key', () => {
    const increment = vi.spyOn(voiceSemanticStatusTotal, 'inc');
    const fetcher = response(200, resultBody);
    observeSemanticSignalsShadow(
      session,
      {
        transcript: 'Bonjour',
        reply: 'Bonjour',
        previousQuestion: null,
        activeInteraction: 'none',
      },
      { config: { ...config, apiKey: '' }, fetcher },
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(increment).toHaveBeenCalledWith({ status: 'missing_key' });
    increment.mockRestore();
  });

  it('returns synchronously while a failed request remains pending', async () => {
    let reject!: (error: Error) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((_, failure) => {
          reject = failure;
        }),
    );
    const returned = observeSemanticSignalsShadow(
      session,
      {
        transcript: 'Bonjour',
        reply: 'Bonjour',
        previousQuestion: null,
        activeInteraction: 'none',
      },
      { config, fetcher },
    );
    expect(returned).toBeUndefined();
    expect(fetcher).toHaveBeenCalledOnce();
    reject(new Error('offline'));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('keeps the semantic module outside state and tool decision imports', () => {
    const root = path.resolve(__dirname, '..');
    for (const file of [
      'turn-policy.ts',
      'turn-plan-authority.ts',
      '../tools.ts',
      'llm-handler.ts',
      'manager.ts',
      'structured-turn/engine.ts',
    ]) {
      const source = readFileSync(path.join(root, file), 'utf8');
      expect(source).not.toMatch(/from\s+['"][^'"]*semantic-signals/);
    }
  });
});
