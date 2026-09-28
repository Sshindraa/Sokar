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
    instructions: "Le MESSAGE À ÉVALUER répond-il à la DERNIÈRE QUESTION DE L'AGENT ?",
    present: "Il apporte l'information demandée",
    absent:
      'Il répond à côté, pose une autre question, ou répond « oui »/« non » à une question qui demandait de choisir',
  },
  {
    id: 'corrects_existing_fact',
    instructions:
      "Dans le MESSAGE À ÉVALUER lui-même, le client corrige-t-il une information qu'il avait donnée plus tôt (date, heure, nombre de personnes, nom) ?",
    present:
      'Ce message remplace une valeur déjà donnée (« non, plutôt samedi », « finalement on sera quatre »)',
    absent:
      'Ce message ne corrige rien : une correction faite dans un échange précédent ne compte pas',
  },
  {
    id: 'changes_topic',
    instructions:
      "Le MESSAGE À ÉVALUER quitte-t-il le sujet de la DERNIÈRE QUESTION DE L'AGENT pour une autre demande ou question ?",
    present: 'Il pose une autre question ou fait une autre demande (horaires, terrasse, menu…)',
    absent: 'Il reste sur la question posée',
  },
  {
    id: 'fact_is_tentative',
    instructions:
      'Dans le MESSAGE À ÉVALUER, le client présente-t-il une information comme incertaine (« peut-être », « je ne sais pas encore », « à confirmer ») ?',
    present: "Il exprime un doute sur l'information qu'il donne",
    absent: "Il donne l'information fermement, même avec « vers 19 h » ou « plutôt »",
  },
  {
    id: 'explicitly_confirms_proposal',
    instructions:
      "La DERNIÈRE QUESTION DE L'AGENT contenait-elle une proposition précise que le MESSAGE À ÉVALUER accepte, même familièrement (« ouais », « vas-y », « c'est bon ») ?",
    present: "L'agent proposait quelque chose de précis et le client l'accepte sans réserve",
    absent:
      "L'agent posait une question ouverte, ou le client hésite, refuse ou pose une condition",
  },
  {
    id: 'rejects_proposal',
    instructions:
      "La DERNIÈRE QUESTION DE L'AGENT contenait-elle une proposition précise (récapitulatif, créneau, confirmation) que le MESSAGE À ÉVALUER refuse ou conteste ?",
    present:
      "L'agent proposait quelque chose de précis et le client le refuse ou demande autre chose",
    absent:
      "L'agent posait une question ouverte (jour, heure, nombre…), ou le client accepte ou hésite seulement",
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
    // Jeu figé du 28/09 : rappel au seuil 0,8 de 30 % → 70 %, sans faux positif
    // (l'ancienne question abstraite laissait les hésitations entre 0,4 et 0,76).
    instructions:
      "Après le MESSAGE À ÉVALUER, l'agent doit-il faire préciser avant de pouvoir noter une réponse ?",
    present:
      'Oui : le client hésite, donne plusieurs possibilités sans choisir (« le 14 ou le 15 », « sept ou huit »), dit « je sais pas », « faut voir », « à confirmer », répond « oui » à une question « A ou B ? », ou son message est coupé ou incompréhensible',
    absent:
      "Non : le client donne une réponse que l'agent peut noter telle quelle, ou pose une autre question claire",
  },
] as const satisfies readonly BehaviorSource[];

export const BEHAVIORS = BEHAVIOR_SOURCES.map((behavior) => ({
  ...behavior,
  definition: `${behavior.instructions} Présent si : ${behavior.present}. Absent si : ${behavior.absent}.`,
}));

/**
 * Questions à choix multiple, posées uniquement quand l'interaction active les
 * rend pertinentes. Jev accepte `noul` et `choice` ; Respan n'accepte que `noul`.
 */
const CHOICE_SOURCES = [
  {
    id: 'human_fallback_choice',
    activeInteraction: 'humanFallback',
    instructions: 'Que demande le client dans son dernier message ?',
    criteria: {
      gerant: 'Il demande explicitement à parler au gérant ou à une personne',
      message: 'Il demande explicitement à laisser un message',
      pas_clair: 'Sa réponse ne permet pas de savoir lequel des deux il veut',
    },
  },
  {
    id: 'proposal_response_choice',
    activeInteraction: 'confirmation',
    instructions: "Comment le client répond-il au récapitulatif de l'agent ?",
    criteria: {
      confirme: 'Il accepte, même de façon familière',
      refuse: 'Il refuse, conteste ou veut autre chose',
      hesite: 'Il hésite, ou sa réponse ne permet pas de savoir',
    },
  },
] as const;

export const CHOICE_QUESTIONS = CHOICE_SOURCES;
export const CHOICE_IDS = new Set<string>(CHOICE_SOURCES.map((choice) => choice.id));
/**
 * Options connues par question `choice`. Sert à borner la télémétrie : Jev peut
 * renvoyer une option hors nomenclature, son nom ne doit pas sortir du process.
 */
export const CHOICE_OPTIONS = Object.fromEntries(
  CHOICE_SOURCES.map((choice) => [choice.id, Object.keys(choice.criteria)]),
) as unknown as Record<ChoiceId, readonly string[]>;

export const BEHAVIOR_SET_VERSION = '2026-09-28.4-jev';

export type Behavior = (typeof BEHAVIORS)[number];
export type BehaviorId = Behavior['id'];
export const BEHAVIOR_IDS = new Set<string>(BEHAVIORS.map((behavior) => behavior.id));
export type Choice = (typeof CHOICE_SOURCES)[number];
export type ChoiceId = Choice['id'];
