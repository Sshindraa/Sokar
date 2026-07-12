import type { LLMAdapter, LLMChatOptions, LLMResponse, Message, ToolCall } from '../types.js';

export type MockStepContext = {
  messages: Message[];
  tools: unknown[];
};

export type MockStepResult = { message: string; done: true } | { toolCalls: ToolCall[] };

export type MockStep = (ctx: MockStepContext) => MockStepResult | Promise<MockStepResult>;

/**
 * Adapter mock pour tests et démos.
 *
 * Chaque étape est une fonction qui reçoit l'historique de la conversation
 * et peut décider d'appeler un outil ou de répondre définitivement.
 * Idéal pour valider la boucle de conversation sans clé LLM.
 */
export class MockAdapter implements LLMAdapter {
  readonly provider = 'mock';
  private turn = 0;

  constructor(private readonly steps: MockStep[]) {}

  async chat(
    messages: Message[],
    tools: unknown[],
    _options?: LLMChatOptions,
  ): Promise<LLMResponse> {
    const step = this.steps[this.turn];
    this.turn++;

    if (!step) {
      return { message: 'Done', done: true, toolCalls: [] };
    }

    const result = await step({ messages, tools });

    if ('done' in result) {
      return { message: result.message, done: true, toolCalls: [] };
    }

    return { message: '', done: false, toolCalls: result.toolCalls };
  }

  /** Réinitialise l'index de tour (utile pour réutiliser l'instance). */
  reset() {
    this.turn = 0;
  }
}

/** Helper : parse le contenu JSON d'un message tool. */
export function parseToolResult(message: Message): unknown {
  return JSON.parse(message.content ?? '{}') as unknown;
}

/** Helper : trouve le dernier résultat d'un tool donné dans l'historique. */
export function findToolResult(messages: Message[], name: string): Message | undefined {
  return messages
    .slice()
    .reverse()
    .find((m) => m.role === 'tool' && m.name === name);
}
