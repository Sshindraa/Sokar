import type { SokarAgentClient } from './sokar-client.js';
import type { AgentRunnerOptions, AgentRunnerResult, Message, ToolName } from './types.js';

export class SokarAgentRunner {
  constructor(private readonly client: SokarAgentClient) {}

  /**
   * Lance une conversation multi-tours.
   *
   * 1. Récupère les tools Sokar au format attendu par le LLM.
   * 2. Envoie le message utilisateur.
   * 3. Tant que le LLM appelle des tools, ils sont exécutés sur Sokar et le
   *    résultat est renvoyé au LLM.
   * 4. Retourne le message final quand le LLM répond sans appeler d'outil.
   */
  async run(options: AgentRunnerOptions): Promise<AgentRunnerResult> {
    const { llm, userMessage, history = [], maxToolTurns = 10 } = options;
    const tools = await this.client.getTools();

    const messages: Message[] = [...history, { role: 'user', content: userMessage }];
    let toolCallsCount = 0;

    for (let turn = 0; turn < maxToolTurns; turn++) {
      const response = await llm.chat(messages, tools);

      if (response.done) {
        messages.push({ role: 'assistant', content: response.message });
        return {
          finalMessage: response.message,
          history: messages,
          toolCallsCount,
        };
      }

      messages.push({
        role: 'assistant',
        content: response.message,
        toolCalls: response.toolCalls,
      });

      for (const call of response.toolCalls) {
        toolCallsCount++;
        const result = await this.client.executeTool(call.name as ToolName, call.arguments);
        const resultJson = JSON.stringify(result);

        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: resultJson,
        });
      }
    }

    throw new Error(`SokarAgentRunner: max tool turns reached (${maxToolTurns})`);
  }
}
