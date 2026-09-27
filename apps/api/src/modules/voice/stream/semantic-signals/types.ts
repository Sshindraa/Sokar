import type { BehaviorId } from './behaviors';

export interface SemanticProbability {
  present: number;
  absent: number;
  notObservable: number;
}

export type SemanticSignals = Partial<Record<BehaviorId, SemanticProbability>>;
export type SemanticScoreStatus =
  | 'ok'
  | 'disabled'
  | 'missing_key'
  | 'timeout'
  | 'invalid_request'
  | 'forbidden'
  | 'payment_required'
  | 'rate_limited'
  | 'http_error'
  | 'invalid_response'
  | 'network_error';

export type SemanticScoreResult =
  | {
      status: 'ok';
      signals: SemanticSignals;
      durationMs: number;
      inputTokens: number;
      supportsNotObservable: boolean;
    }
  | { status: Exclude<SemanticScoreStatus, 'ok'>; durationMs: number; inputTokens?: number };

export interface SpanMessage {
  role: 'user' | 'assistant';
  content: string;
}
export interface SpanRequest {
  model: string;
  span: { input: SpanMessage[]; output: SpanMessage };
  behaviors: Array<{ id: BehaviorId; definition: string }>;
}

export type SemanticProvider = 'openrouter' | 'respan';

/** Texte libre envoyé à `POST /alpha/decisions` (OpenRouter). */
export interface DecisionRequest {
  model: string;
  state: string;
  questions: Record<
    string,
    {
      type: 'noul';
      instructions: string;
      criteria: { true: string; false: string };
    }
  >;
}
