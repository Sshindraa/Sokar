/**
 * Types du SDK @sokar/agent-client.
 *
 * Le SDK est transport-agnostique : le SokarAgentClient ne fait que du HTTP
 * REST. Les adapters LLM (OpenAI-compatible, Gemini) implémentent l'interface
 * `LLMAdapter` et gèrent le format natif de chaque provider.
 */

export type ReservationChannel = 'API' | 'MCP' | 'PHONE' | 'WIDGET';

export type ToolName =
  | 'search_restaurants'
  | 'get_restaurant_details'
  | 'check_availability'
  | 'create_reservation'
  | 'cancel_reservation'
  | 'get_reservation_status';

export type ToolListFormat = 'mcp' | 'openai' | 'mistral' | 'gemini';

export type SokarAgentClientConfig = {
  /** Base URL de l'API Sokar (ex: https://api-staging.sokar.tech) */
  baseUrl: string;
  /** Clé API Bearer (format sk_sokar_agent_...) */
  apiKey: string;
  /** Format de tools retourné par GET /v1/agents/tools */
  toolFormat?: ToolListFormat;
  /** Timeout en ms (default 30000) */
  timeoutMs?: number;
};

export type ToolCall = {
  id: string;
  name: ToolName | string;
  arguments: Record<string, unknown>;
};

export type ToolResult = {
  ok: boolean;
  result?: unknown;
  error?: string;
  code?: string;
};

export type Message = {
  role: 'user' | 'assistant' | 'tool' | 'model';
  content?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
};

export type LLMResponse = {
  message: string;
  toolCalls: ToolCall[];
  /** true si le LLM n'a pas appelé d'outil et a répondu directement */
  done: boolean;
};

export interface LLMAdapter {
  chat(messages: Message[], tools: unknown[]): Promise<LLMResponse>;
  /** Nom affiché du provider (openai, mistral, gemini) */
  readonly provider: string;
}

export type AgentRunnerOptions = {
  /** Adapter LLM à utiliser */
  llm: LLMAdapter;
  /** Message utilisateur initial */
  userMessage: string;
  /** Historique optionnel */
  history?: Message[];
  /** Nombre max de tours d'outils (default 10) */
  maxToolTurns?: number;
};

export type AgentRunnerResult = {
  /** Texte final du LLM */
  finalMessage: string;
  /** Historique complet de la conversation */
  history: Message[];
  /** Nombre d'appels d'outils exécutés */
  toolCallsCount: number;
};

// ─── Inputs des tools Sokar ──────────────────────────────────────────

export type SearchRestaurantsInput = {
  city: string;
  partySize: number;
  slotStart: string;
  slotEnd: string;
  cuisineType?: string[];
  maxResults?: number;
  cursor?: string;
};

export type GetRestaurantDetailsInput = {
  restaurantId: string;
};

export type CheckAvailabilityInput = {
  restaurantId: string;
  partySize: number;
  slotStart: string;
  slotEnd: string;
};

export type CreateReservationInput = {
  restaurantId: string;
  partySize: number;
  startsAt: string;
  endsAt: string;
  customerName: string;
  customerPhone: string;
  specialRequests?: string;
  holdToken?: string;
  idempotencyKey?: string;
  consents: {
    reservationProcessing: true;
    transactionalSms?: boolean;
    transactionalEmail?: boolean;
    marketingOptIn?: boolean;
  };
};

export type CancelReservationInput = {
  reservationId: string;
  reason?: string;
};

export type GetReservationStatusInput = {
  reservationId: string;
};
