export const BEHAVIOR_SET_VERSION = '2026-09-27.1';

export const BEHAVIORS = [
  {
    id: 'answers_active_question',
    definition:
      "Dans son dernier message, le client répond à la question que l'agent venait de lui poser.",
  },
  {
    id: 'corrects_existing_fact',
    definition:
      "Dans son dernier message, le client corrige ou remplace une information qu'il avait donnée plus tôt (date, heure, nombre de personnes, nom…).",
  },
  {
    id: 'changes_topic',
    definition:
      'Dans son dernier message, le client abandonne le sujet en cours pour une autre demande ou question.',
  },
  {
    id: 'fact_is_tentative',
    definition:
      'Dans son dernier message, le client présente une information comme incertaine ou approximative (« peut-être », « vers », « je crois »).',
  },
  {
    id: 'explicitly_confirms_proposal',
    definition:
      "Dans son dernier message, le client confirme explicitement et sans ambiguïté la proposition précise que l'agent vient de récapituler. Un simple « euh » ou une hésitation n'est pas une confirmation.",
  },
  {
    id: 'rejects_proposal',
    definition:
      "Dans son dernier message, le client refuse ou conteste la proposition que l'agent vient de faire.",
  },
  {
    id: 'explicitly_requests_transfer',
    definition:
      'Dans son dernier message, le client demande explicitement à parler à une personne (gérant, responsable, humain). Un « oui » générique ne suffit pas.',
  },
  {
    id: 'explicitly_requests_message',
    definition: 'Dans son dernier message, le client demande explicitement à laisser un message.',
  },
  {
    id: 'explicitly_requests_cancellation',
    definition:
      "Dans son dernier message, le client demande explicitement d'annuler une réservation.",
  },
  {
    id: 'explicitly_requests_gift_card_purchase',
    definition:
      'Dans son dernier message, le client demande explicitement à acheter une carte cadeau.',
  },
  {
    id: 'needs_clarification',
    definition:
      'Le dernier message du client est trop ambigu, incomplet ou contradictoire pour savoir ce qu’il veut.',
  },
] as const;

export type BehaviorId = (typeof BEHAVIORS)[number]['id'];
export const BEHAVIOR_IDS = new Set<string>(BEHAVIORS.map((behavior) => behavior.id));
