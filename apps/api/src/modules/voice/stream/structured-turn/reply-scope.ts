import type { StructuredTurnOutput } from './schema';

export type ReplyScope =
  | 'decline_human_fallback'
  | 'decline_booking'
  | 'correct_name'
  | 'choose_human_fallback';

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[’']/gu, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Seulement les réponses brèves dont la portée dépend entièrement de la question.
 * Toute précision (« non, annulez », « pas besoin de réserver »…) reste au modèle.
 */
export function replyScopeOf(
  awaiting: StructuredTurnOutput['awaiting'],
  transcript: string,
  lastAssistantText = '',
  reservationCreated = false,
): ReplyScope | undefined {
  if (reservationCreated) return undefined;
  const text = normalize(transcript);
  const decline =
    /^(?:non|non merci|non pas besoin|non merci pas besoin|pas besoin|non ca ira|ca ira|non pas la peine|pas la peine|no|no thanks|no need)$/.test(
      text,
    );
  if (decline) {
    if (awaiting === 'humanFallback') return 'decline_human_fallback';
    if (awaiting === 'confirmation' || awaiting === 'confirmationResume') return 'decline_booking';
    if (awaiting === 'customerNameConfirmation') return 'correct_name';
  }
  if (awaiting === 'humanFallback' && /^(?:oui|ouais|d accord|ok|okay|yes|yeah|sure)$/.test(text)) {
    // Un oui ne choisit pas entre deux options. Une seule option clairement proposée reste acceptée.
    // Seule la proposition actuelle compte : « Je ne peux pas prendre de message.
    // Je vous passe le gérant ? » ne propose pas deux options.
    const proposal = normalize(
      lastAssistantText.match(/[^.!?…]+[.!?…]?/gu)?.at(-1) ?? lastAssistantText,
    );
    const transfer =
      /\b(?:transfer\w*|passe\w*|put you through)\b|\b(?:gerant|restaurant|manager) ou\b|\bou (?:le )?(?:gerant|manager)\b/u.test(
        proposal,
      );
    const message = /\b(?:message|rappel|callback)\b/u.test(proposal);
    if (transfer && message && /\b(?:ou|or)\b/u.test(proposal)) return 'choose_human_fallback';
  }
  return undefined;
}

export function replyScopeInstruction(scope: ReplyScope): string {
  switch (scope) {
    case 'decline_human_fallback':
      return "La réponse brève porte sur ta proposition de gérant/transfert/message, pas sur l'abandon de toute la réservation. Ne transfère pas, ne prends pas de message et ne raccroche pas. Garde le brouillon et reprends naturellement la réservation si elle est en cours ; si son intention reste ambiguë, pose une seule question courte pour savoir s'il souhaite continuer. Si canResumeConfirmation=true, les faits ont déjà été entendus et sont inchangés : pose seulement une courte question qui demande explicitement l'accord pour réserver effectivement la table, awaiting=confirmationResume, sans redire le jour, l'heure, le nombre ni le nom. Proposer seulement de reprendre ou poursuivre l'échange ne demande pas cet accord : dans ce cas awaiting=open, jamais confirmationResume. La réservation n'est pas encore créée : ne la présente pas comme déjà faite.";
    case 'decline_booking':
      return "L'appelant refuse la confirmation proposée ; il peut vouloir corriger un détail. Ce refus bref ne précise pas qu'il veut terminer l'appel. Ne réserve pas et ne raccroche pas : demande simplement ce qui ne convient pas, en une seule question. N'efface pas le brouillon et ne le relis pas en entier. S'il exprime ensuite son abandon, respecte-le.";
    case 'correct_name':
      return "L'appelant refuse l'orthographe que tu viens de relire. Ne réserve pas et ne raccroche pas : invite-le à corriger ou à réépeler le nom, sans redemander les autres informations.";
    case 'choose_human_fallback':
      return 'Tu as proposé à la fois le transfert et le message. Ce oui ne choisit pas entre les deux : ne transfère pas, ne prends pas de message et ne raccroche pas. Demande simplement quelle option il préfère.';
  }
}
