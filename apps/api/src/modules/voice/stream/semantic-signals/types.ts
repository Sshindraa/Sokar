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
  | 'timeout'
  | 'forbidden'
  | 'payment_required'
  | 'rate_limited'
  | 'http_error'
  | 'invalid_response'
  | 'network_error';

export type SemanticScoreResult =
  | { status: 'ok'; signals: SemanticSignals; durationMs: number; inputTokens: number }
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
