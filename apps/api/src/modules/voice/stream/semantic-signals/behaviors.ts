export const BEHAVIOR_SET_VERSION = '2026-09-27.2';

export const BEHAVIORS = [
  {
    id: 'answers_active_question',
    definition:
      "Le client répond vraiment à la question que l'agent vient de poser. Présent si : sa réponse apporte l'information demandée. Absent si : il répond à côté, change de sujet, ou répond « oui »/« non » à une question qui demandait de choisir entre plusieurs options.",
  },
  {
    id: 'corrects_existing_fact',
    definition:
      "Le client corrige ou remplace une information qu'il avait donnée plus tôt (date, heure, nombre de personnes, nom…). Présent si : il annonce une valeur différente de celle déjà notée. Absent si : il répète la même information ou ne corrige rien.",
  },
  {
    id: 'changes_topic',
    definition:
      'Le client abandonne le sujet en cours pour une autre demande ou question. Présent si : sa demande porte sur autre chose que le sujet en cours. Absent si : il reste sur le sujet en cours.',
  },
  {
    id: 'fact_is_tentative',
    definition:
      "Le client présente une information comme incertaine ou approximative (« peut-être », « vers », « je crois »). Présent si : il marque lui-même le doute ou l'approximation. Absent si : il donne l'information comme certaine et précise.",
  },
  {
    id: 'explicitly_confirms_proposal',
    definition:
      "Le client accepte la proposition que l'agent vient de récapituler, même de façon familière (« ouais », « vas-y », « c'est bon », « parfait »). Présent si : il accepte sans réserve. Absent si : il hésite, refuse, pose une condition ou dit « oui mais… » suivi d'autre chose.",
  },
  {
    id: 'rejects_proposal',
    definition:
      'Le client refuse la proposition ou veut autre chose que ce qui est proposé, y compris sous la forme « oui mais en fait… », « plutôt… », « finalement… ». Présent si : il refuse ou demande un changement. Absent si : il accepte ou hésite seulement.',
  },
  {
    id: 'explicitly_requests_transfer',
    definition:
      "Le client demande explicitement à parler au gérant, à un responsable ou à une personne. Présent si : il le formule clairement (« passez-moi le gérant », « je veux parler à quelqu'un »). Absent si : il dit seulement « oui » ou ne le demande pas.",
  },
  {
    id: 'explicitly_requests_message',
    definition:
      "Le client demande explicitement à laisser un message à quelqu'un. Présent si : il le formule clairement (« je peux laisser un message ? », « dites-lui de me rappeler »). Absent si : il dit seulement « oui » ou ne le demande pas.",
  },
  {
    id: 'explicitly_requests_cancellation',
    definition:
      "Le client demande explicitement d'annuler une réservation. Présent si : il formule l'annulation (« je veux annuler »). Absent si : il ne demande pas d'annulation (par exemple il demande seulement à décaler).",
  },
  {
    id: 'explicitly_requests_gift_card_purchase',
    definition:
      "Le client demande explicitement à acheter une carte cadeau. Présent si : il formule l'achat d'une carte cadeau. Absent si : il ne parle pas de carte cadeau.",
  },
  {
    id: 'needs_clarification',
    definition:
      "On ne peut pas savoir ce que veut le client à partir de son dernier message. Présent si : sa réponse ne permet pas de choisir entre les options proposées par l'agent (par exemple « oui » à une question « A ou B ? »), ou si elle est inaudible, hésitante ou contradictoire. Absent si : on sait ce qu'il veut.",
  },
] as const;

export type BehaviorId = (typeof BEHAVIORS)[number]['id'];
export const BEHAVIOR_IDS = new Set<string>(BEHAVIORS.map((behavior) => behavior.id));
