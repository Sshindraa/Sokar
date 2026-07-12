import { randomUUID } from 'node:crypto';
import type { SokarAgentClient } from './sokar-client.js';
import type { AgentRunnerOptions, AgentRunnerResult, Message, ToolName } from './types.js';

function parseToolContent(message: Message): Record<string, unknown> | undefined {
  if (!message.content) return undefined;
  try {
    return JSON.parse(message.content) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function chooseToolChoice(messages: Message[]): 'auto' | 'any' {
  const last = messages[messages.length - 1];
  if (!last) return 'any';

  if (last.role === 'user') return 'any';

  if (last.role === 'tool') {
    const result = parseToolContent(last);
    const reservationId = result?.reservationId ?? result?.id;
    const available = result?.available === true;

    switch (last.name) {
      case 'search_restaurants':
      case 'get_restaurant_details':
        return 'any';
      case 'check_availability':
        return available ? 'any' : 'auto';
      case 'create_reservation':
        return reservationId ? 'auto' : 'any';
      case 'cancel_reservation':
        return 'auto';
      default:
        return 'auto';
    }
  }

  return 'auto';
}

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
    const { llm, userMessage, systemMessage, history = [], maxToolTurns = 10 } = options;
    const tools = await this.client.getTools();

    const defaultSystemMessage =
      "Tu es un assistant de réservation restaurant. Tu DOIS utiliser les outils disponibles pour aider l'utilisateur. " +
      'Flow attendu : search_restaurants -> get_restaurant_details (optionnel) -> check_availability -> create_reservation. ' +
      "Si une information est manquante (nom, téléphone), demande-la à l'utilisateur. " +
      'Réponds en français, de manière concise et professionnelle.';

    const messages: Message[] = [
      { role: 'system', content: systemMessage ?? defaultSystemMessage },
      ...history,
      { role: 'user', content: userMessage },
    ];
    let toolCallsCount = 0;

    for (let turn = 0; turn < maxToolTurns; turn++) {
      const toolChoice = chooseToolChoice(messages);
      const response = await llm.chat(messages, tools, { toolChoice });

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
        let args = call.arguments;
        if (call.name === 'create_reservation') {
          args = { ...args, idempotencyKey: randomUUID() };
        }
        const result = await this.client.executeTool(call.name as ToolName, args);
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
