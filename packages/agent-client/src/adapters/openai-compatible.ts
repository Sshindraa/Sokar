import type { LLMAdapter, LLMResponse, Message, ToolCall } from '../types.js';

type OpenAIFunction = {
  name: string;
  arguments: string;
};

type OpenAIToolCall = {
  id: string;
  type: 'function';
  function: OpenAIFunction;
};

type OpenAIChatMessage = {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
};

export type OpenAIAdapterConfig = {
  apiKey: string;
  baseUrl?: string;
  model: string;
  /** provider pour le header et les logs */
  provider?: 'openai' | 'mistral';
  /** timeout en ms (default 30000) */
  timeoutMs?: number;
};

/**
 * Adapter OpenAI-compatible.
 * Fonctionne avec OpenAI et Mistral (les deux partagent le même schéma
 * de chat completions avec `tools`/`tool_choice`).
 */
export class OpenAICompatibleAdapter implements LLMAdapter {
  readonly provider: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(config: OpenAIAdapterConfig) {
    this.provider = config.provider ?? 'openai';
    this.apiKey = config.apiKey;
    this.baseUrl = (
      config.baseUrl ??
      (this.provider === 'mistral' ? 'https://api.mistral.ai/v1' : 'https://api.openai.com/v1')
    ).replace(/\/$/, '');
    this.model = config.model;
    this.timeoutMs = config.timeoutMs ?? 30000;
  }

  async chat(messages: Message[], tools: unknown[]): Promise<LLMResponse> {
    const body = {
      model: this.model,
      messages: this.toOpenAIMessages(messages),
      tools,
      tool_choice: 'auto' as const,
    };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`${this.provider} chat failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as {
      choices: Array<{
        message: OpenAIChatMessage;
        finish_reason: string;
      }>;
    };

    const choice = data.choices[0];
    if (!choice) {
      throw new Error(`${this.provider} chat returned no choices`);
    }

    const toolCalls: ToolCall[] =
      choice.message.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
      })) ?? [];

    return {
      message: choice.message.content ?? '',
      toolCalls,
      done: toolCalls.length === 0 && choice.finish_reason !== 'tool_calls',
    };
  }

  private toOpenAIMessages(messages: Message[]): OpenAIChatMessage[] {
    return messages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool',
          content: m.content ?? JSON.stringify(m.content ?? ''),
          tool_call_id: m.toolCallId,
        };
      }
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: 'assistant',
          content: m.content ?? null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        };
      }
      return {
        role: m.role === 'model' ? 'assistant' : m.role,
        content: m.content,
      };
    });
  }
}
