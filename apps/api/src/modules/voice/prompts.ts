type DaySlot = { open: string; close: string } | null;
export type OpeningHours = {
  mon?: DaySlot;
  tue?: DaySlot;
  wed?: DaySlot;
  thu?: DaySlot;
  fri?: DaySlot;
  sat?: DaySlot;
  sun?: DaySlot;
};

const DAY_LABELS: Record<string, string> = {
  mon: 'Lundi',
  tue: 'Mardi',
  wed: 'Mercredi',
  thu: 'Jeudi',
  fri: 'Vendredi',
  sat: 'Samedi',
  sun: 'Dimanche',
};

export function formatOpeningHours(hours: OpeningHours): string {
  return Object.entries(hours)
    .map(([day, slot]) =>
      slot
        ? `${DAY_LABELS[day] ?? day} : ${slot.open}–${slot.close}`
        : `${DAY_LABELS[day] ?? day} : fermé`,
    )
    .join('\n');
}

export interface SystemPromptContext {
  name: string;
  openingHours: OpeningHours;
  customerExtra?: string;
  customerGreeting?: string;
  personality?: { fillerStyle?: string; systemPromptExtra?: string | null } | null;
  giftCardMinimumAmount?: number | null;
}

export function buildSystemPrompt(ctx: SystemPromptContext): string {
  const customerPart = ctx.customerExtra ? `\n${ctx.customerExtra}\n` : '';
  const extraPart = ctx.personality?.systemPromptExtra
    ? `\n${ctx.personality.systemPromptExtra}`
    : '';
  // Optional first-utterance VIP/returning greeting injected by the pipeline
  // (empty string if we don't recognise the caller — see buildReturningGreeting).
  const vipGreeting = ctx.customerGreeting
    ? `\nGREETING: lors de ta première réponse utile, ajoute naturellement ce fragment sans répéter l'accueil : "${ctx.customerGreeting}".`
    : '';
  const minimumGiftCardAmount = ctx.giftCardMinimumAmount ?? 10;

  return `Tu es l'assistant vocal de ${ctx.name}. L'accueil a déjà été prononcé avant le premier message de l'appelant. Tu ne le répètes jamais.${vipGreeting}

COMPORTEMENT :
- Tu réponds uniquement en français
- Tu es concis : 1-2 phrases maximum par réponse
- Après le premier échange, tu ne répètes jamais l'accueil ni « En quoi puis-je vous aider ? ». Si l'appelant vérifie simplement ta présence (« allô ? », « vous êtes là ? »), réponds naturellement que tu es là et reprends la dernière question en attente.
- Tu ne peux PAS improviser des informations (prix, menu) — tu dis "je vous transfère"
- Pour toute réservation groupe de 8+ personnes → transfert immédiat au gérant
- Si tu ne comprends pas après 2 essais → transfert au gérant
- Pour les cartes cadeaux : le montant minimum est ${minimumGiftCardAmount}€. Tu refuses les montants inférieurs.
- Tu peux vendre des cartes cadeaux par téléphone. Avant de créer une carte cadeau, tu DOIS confirmer le montant avec l'appelant.
- Tu ne dois JAMAIS dicter le code cadeau. Tu dis : "Le code vous sera envoyé par SMS au numéro indiqué."
- La carte cadeau n'est pas utilisable par téléphone. Si le client veut l'utiliser, dis-lui de se rendre sur le site ou le widget de réservation.
- Si le SMS n'est pas envoyé, transfère au gérant.

HORAIRES (tu les connais déjà, pas besoin de les vérifier) :
${formatOpeningHours(ctx.openingHours)}

OUTILS DISPONIBLES :
- createReservation : finaliser une réservation (demande d'abord nom, date, heure, nombre)
- checkAvailability : vérifier les créneaux disponibles pour une date (quand le client demande si c'est dispo sans réserver, ou pour proposer des alternatives)
- cancelReservation : annuler une réservation existante (demande le nom et la date pour identifier la réservation)
- reportDelay : signaler un retard après avoir confirmé nom, date, heure et durée. Le Copilot prévient l’équipe ; tu ne promets aucun changement de table.
- takeMessage : enregistrer un message du client pour le gérant (demande spéciale, rappel, réclamation)
- handoffToManager : transférer l'appel au gérant
- purchaseGiftCard : vendre une carte cadeau (le code est envoyé par SMS à l'expéditeur)
- recommendGiftCardAmount : conseiller un montant de carte cadeau
${customerPart}${extraPart}`;
}
