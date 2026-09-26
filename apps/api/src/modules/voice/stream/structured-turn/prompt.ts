import type { ChatMessage } from '../types';
import type { StructuredTurnState } from './fact-guards';

/**
 * Consignes du tour structuré, ajoutées au prompt du restaurant. Elles
 * remplacent l'usage des outils : le modèle choisit une action, le code
 * l'exécute puis lui rend le résultat.
 */
const STRUCTURED_TURN_INSTRUCTIONS = `MODE DE RÉPONSE STRUCTURÉ (prioritaire sur la section OUTILS) :
Tu n'appelles aucun outil. À chaque tour, tu renvoies un objet JSON qui décrit ta compréhension et ta réponse.
- interpretation : ce que fait l'appelant dans ce tour. answer = il répond à ta question ; question = il pose une question ; correction = il remplace une valeur déjà donnée ; affirmation = il accepte ce que tu viens de proposer ou de relire ; decline = il refuse ta proposition mais continue l'appel ; new_request = il change de demande ; end_call = il termine l'appel ou renonce à sa démarche ; unclear = tu n'as pas compris.
- draft : l'état complet du brouillon de réservation APRÈS ce tour. date au format AAAA-MM-JJ, time au format HH:MM, partySize entier, customerName avec l'orthographe retenue. Chaîne vide ou 0 si inconnu. Garde les valeurs déjà connues tant que l'appelant ne les change pas.
- awaiting : ce que ta phrase « say » attend de l'appelant (confirmation quand tu relis le récapitulatif complet et demandes son accord ; humanFallback quand tu proposes le gérant ou un message ; open pour une question ouverte ; none si tu n'attends rien).
- action :
  - check_availability dès que la date, l'heure et le nombre sont connus et que l'ÉTAT VÉRIFIÉ ne contient pas déjà la disponibilité de ces valeurs. Laisse « say » vide : le résultat te sera donné, puis tu formuleras la réponse.
  - create_reservation uniquement si l'appelant vient d'accepter le récapitulatif complet (date, heure, nombre, nom) que tu as relu au tour précédent. Laisse « say » vide.
  - take_message quand l'appelant veut laisser un message ou choisit le message : « message » résume sa demande pour le gérant. Laisse « say » vide.
  - transfer quand l'appelant demande le gérant ou choisit le transfert. Laisse « say » vide.
  - end_call quand l'appelant termine ou renonce : « say » est un au revoir court, sans question.
  - none sinon.
- message : vide sauf pour take_message.
- confidence : high si tu es sûr de ta compréhension, low si tu hésites (alors pose une question de clarification et action none).
- say : ta phrase parlée, naturelle et courte, qui se termine par au plus une question.
N'annonce jamais une disponibilité, une réservation, un message ou un transfert que l'ÉTAT VÉRIFIÉ ou un RÉSULTAT D'ACTION ne confirme pas.
L'épellation d'un nom arrive transcrite automatiquement, parfois en plusieurs morceaux sur plusieurs tours : assemble les morceaux dans l'ordre. « deux K », « 2 k » ou « double K » signifient deux lettres K à la suite ; un chiffre n'est jamais une lettre du nom. Rapproche l'épellation du nom prononcé juste avant pour proposer l'orthographe la plus probable, relis-la lettre par lettre et fais-la confirmer. Si l'appelant ne veut plus épeler, garde l'orthographe la plus probable et poursuis la réservation.`;

export function buildStructuredTurnMessages(input: {
  systemPrompt: string;
  history: ChatMessage[];
  transcript: string;
  state: StructuredTurnState;
  actionResult?: string;
}): ChatMessage[] {
  const verified = {
    draft: input.state.draft,
    availability: input.state.availability,
    reservationCreated: input.state.reservationCreated,
    lastAwaiting: input.state.lastAwaiting,
  };
  const system = [
    input.systemPrompt,
    STRUCTURED_TURN_INSTRUCTIONS,
    `ÉTAT VÉRIFIÉ : ${JSON.stringify(verified)}`,
    input.actionResult
      ? `RÉSULTAT D'ACTION (déjà exécutée, ne la redemande pas) : ${input.actionResult}\nFormule maintenant ta réponse dans « say » avec action=none, sauf end_call si l'appelant termine.`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const dialogue = input.history.filter(
    (message) =>
      (message.role === 'user' || message.role === 'assistant') &&
      typeof message.content === 'string' &&
      message.content.trim(),
  );
  return [
    { role: 'system', content: system },
    ...dialogue.map((message) => ({ role: message.role, content: message.content })),
    { role: 'user', content: input.transcript },
  ];
}
