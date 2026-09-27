/**
 * Définitions v2 des comportements Span-01.
 *
 * Chaque comportement expose la même source sous deux formes : `instructions`
 * + `present`/`absent` pour OpenRouter, et `definition` pour le client Respan
 * direct, qui n'accepte qu'une chaîne libre.
 */

interface BehaviorSource {
  id: string;
  instructions: string;
  present: string;
  absent: string;
}

const BEHAVIOR_SOURCES = [
  {
    id: 'answers_active_question',
    instructions: "Le client répond-il vraiment à la question que l'agent vient de poser ?",
    present: "Sa réponse apporte l'information demandée",
    absent:
      'Il répond à côté, change de sujet, ou répond « oui »/« non » à une question qui demandait de choisir',
  },
  {
    id: 'corrects_existing_fact',
    instructions:
      "Le client corrige-t-il ou remplace-t-il une information qu'il avait donnée plus tôt (date, heure, nombre de personnes, nom…) ?",
    present: 'Il annonce une valeur différente de celle déjà notée',
    absent: 'Il répète la même information ou ne corrige rien',
  },
  {
    id: 'changes_topic',
    instructions: 'Le client abandonne-t-il le sujet en cours pour une autre demande ou question ?',
    present: 'Sa demande porte sur autre chose que le sujet en cours',
    absent: 'Il reste sur le sujet en cours',
  },
  {
    id: 'fact_is_tentative',
    instructions:
      'Le client présente-t-il une information comme incertaine ou approximative (« peut-être », « vers », « je crois ») ?',
    present: "Il marque lui-même le doute ou l'approximation",
    absent: "Il donne l'information comme certaine et précise",
  },
  {
    id: 'explicitly_confirms_proposal',
    instructions:
      "Le client accepte-t-il la proposition que l'agent vient de récapituler, même de façon familière (« ouais », « vas-y », « c'est bon ») ?",
    present: 'Il accepte sans réserve',
    absent: "Il hésite, refuse, pose une condition ou dit « oui mais… » suivi d'autre chose",
  },
  {
    id: 'rejects_proposal',
    instructions:
      'Le client refuse-t-il la proposition ou veut-il autre chose, y compris sous la forme « oui mais en fait… », « plutôt… », « finalement… » ?',
    present: 'Il refuse ou demande un changement',
    absent: 'Il accepte ou hésite seulement',
  },
  {
    id: 'explicitly_requests_transfer',
    instructions:
      'Le client demande-t-il explicitement à parler au gérant, à un responsable ou à une personne ?',
    present: 'Il le formule clairement',
    absent: 'Il dit seulement « oui » ou ne le demande pas',
  },
  {
    id: 'explicitly_requests_message',
    instructions: "Le client demande-t-il explicitement à laisser un message à quelqu'un ?",
    present: 'Il le formule clairement',
    absent: 'Il dit seulement « oui » ou ne le demande pas',
  },
  {
    id: 'explicitly_requests_cancellation',
    instructions: "Le client demande-t-il explicitement d'annuler une réservation ?",
    present: "Il formule l'annulation (« je veux annuler »)",
    absent: "Il ne demande pas d'annulation (par exemple il demande seulement à décaler)",
  },
  {
    id: 'explicitly_requests_gift_card_purchase',
    instructions: 'Le client demande-t-il explicitement à acheter une carte cadeau ?',
    present: "Il formule l'achat d'une carte cadeau",
    absent: 'Il ne parle pas de carte cadeau',
  },
  {
    id: 'needs_clarification',
    instructions:
      'Est-il impossible de savoir ce que veut le client à partir de son dernier message ?',
    present:
      'Sa réponse ne permet pas de choisir entre les options proposées (par exemple « oui » à « A ou B ? »), ou elle est hésitante, inaudible ou contradictoire',
    absent: "On sait ce qu'il veut",
  },
] as const satisfies readonly BehaviorSource[];

export const BEHAVIORS = BEHAVIOR_SOURCES.map((behavior) => ({
  ...behavior,
  definition: `${behavior.instructions} Présent si : ${behavior.present}. Absent si : ${behavior.absent}.`,
}));

export const BEHAVIOR_SET_VERSION = '2026-09-27.2';

export type Behavior = (typeof BEHAVIORS)[number];
export type BehaviorId = Behavior['id'];
export const BEHAVIOR_IDS = new Set<string>(BEHAVIORS.map((behavior) => behavior.id));
