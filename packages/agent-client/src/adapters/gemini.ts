import type { LLMAdapter, LLMChatOptions, LLMResponse, Message, ToolCall } from '../types.js';

export type GeminiAdapterConfig = {
  apiKey: string;
  model?: string;
  /** timeout en ms (default 30000) */
  timeoutMs?: number;
};

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: unknown } };

type GeminiContent = {
  role: 'user' | 'model';
  parts: GeminiPart[];
};

/**
 * Adapter natif pour l'API Gemini (Google Generative Language).
 *
 * Gère le format `function_declarations` et les tours de `functionCall` /
 * `functionResponse`.
 */
export class GeminiAdapter implements LLMAdapter {
  readonly provider = 'gemini';

  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(config: GeminiAdapterConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'gemini-2.0-flash';
    this.timeoutMs = config.timeoutMs ?? 30000;
  }

  async chat(
    messages: Message[],
    tools: unknown[],
    _options?: LLMChatOptions,
  ): Promise<LLMResponse> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const body = {
      contents: this.toGeminiContents(messages),
      tools,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`Gemini chat failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as {
      candidates: Array<{ content: GeminiContent; finishReason: string }>;
    };

    const candidate = data.candidates?.[0];
    if (!candidate) {
      throw new Error('Gemini chat returned no candidates');
    }

    const toolCalls: ToolCall[] = [];
    let text = '';

    for (const part of candidate.content.parts) {
      if ('text' in part) {
        text += part.text;
      } else if ('functionCall' in part) {
        toolCalls.push({
          id: `${this.provider}-${toolCalls.length}`,
          name: part.functionCall.name,
          arguments: part.functionCall.args,
        });
      }
    }

    return {
      message: text,
      toolCalls,
      done: toolCalls.length === 0,
    };
  }

  private toGeminiContents(messages: Message[]): GeminiContent[] {
    return messages.map((m) => {
      let role: GeminiContent['role'] = m.role === 'user' ? 'user' : 'model';
      if (m.role === 'system') {
        role = 'user';
      }
      const parts: GeminiPart[] = [];

      if (m.content) {
        parts.push({ text: m.content });
      }

      if (m.toolCalls && m.toolCalls.length > 0) {
        for (const tc of m.toolCalls) {
          parts.push({
            functionCall: {
              name: tc.name,
              args: tc.arguments,
            },
          });
        }
      }

      if (m.role === 'tool' && m.toolCallId !== undefined) {
        return {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: m.name ?? m.toolCallId,
                response: JSON.parse(m.content ?? '{}') as unknown,
              },
            },
          ],
        };
      }

      return { role, parts };
    });
  }
}
