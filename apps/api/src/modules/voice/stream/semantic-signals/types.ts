import type { BehaviorId, ChoiceId } from './behaviors';

export interface SemanticProbability {
  present: number;
  absent: number;
  notObservable: number;
}

export type SemanticSignals = Partial<Record<BehaviorId, SemanticProbability>>;

/**
 * Question à choix multiple (`choice`) : l'API renvoie une distribution sur des
 * options nommées, ce qu'une question `noul` ne permet pas.
 */
export interface SemanticChoice {
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export type SemanticChoices = Partial<Record<ChoiceId, SemanticChoice>>;
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
      choices?: SemanticChoices;
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

export type NoulQuestion = {
  type: 'noul';
  instructions: string;
  criteria: { true: string; false: string };
};

export type ChoiceQuestion = {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
};

/** Texte libre envoyé à `POST /alpha/decisions` (OpenRouter). */
export interface DecisionRequest {
  model: string;
  state: string;
  questions: Record<string, NoulQuestion | ChoiceQuestion>;
}
