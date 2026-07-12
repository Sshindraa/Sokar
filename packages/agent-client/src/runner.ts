import { randomUUID } from 'node:crypto';
import type { SokarAgentClient } from './sokar-client.js';
import type { AgentRunnerOptions, AgentRunnerResult, Message, ToolName } from './types.js';

function chooseToolChoice(_messages: Message[]): 'auto' | 'any' {
  // Mode conversationnel "humain" : on laisse le LLM décider quand appeler un outil.
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
      'Vous êtes un assistant de réservation restaurant. Vous aidez un client humain à trouver un restaurant et à réserver une table. ' +
      "N'utilisez les outils que lorsque toutes les informations nécessaires sont disponibles. " +
      'Informations nécessaires : ville, date, heure, nombre de personnes, nom et téléphone. ' +
      "Le type de cuisine est optionnel : ne le demandez pas. Si l'utilisateur ne le précise pas, lancez la recherche avec cuisineType absent. " +
      "Si une information manque, posez une question simple et concise avant d'appeler un outil. " +
      "Quand toutes les informations sont réunies, utilisez les outils dans l'ordre : search_restaurants → check_availability → create_reservation. " +
      'Répondez en français, de manière concise et professionnelle, en le vouvoyant ("vous").';

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
