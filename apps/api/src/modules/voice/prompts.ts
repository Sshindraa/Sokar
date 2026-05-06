type DaySlot = { open: string; close: string } | null;
export type OpeningHours = {
  mon?: DaySlot; tue?: DaySlot; wed?: DaySlot; thu?: DaySlot;
  fri?: DaySlot; sat?: DaySlot; sun?: DaySlot;
};

const DAY_LABELS: Record<string, string> = {
  mon: 'Lundi', tue: 'Mardi', wed: 'Mercredi', thu: 'Jeudi',
  fri: 'Vendredi', sat: 'Samedi', sun: 'Dimanche',
};

export function formatOpeningHours(hours: OpeningHours): string {
  return Object.entries(hours)
    .map(([day, slot]) =>
      slot
        ? `${DAY_LABELS[day] ?? day} : ${slot.open}–${slot.close}`
        : `${DAY_LABELS[day] ?? day} : fermé`
    )
    .join('\n');
}

export function buildSystemPrompt(ctx: any): string {
  return `Tu es l'assistant vocal de ${ctx.name}.

RÈGLE ABSOLUE : Au tout début de chaque appel, tu DOIS dire :
"Bonjour, ${ctx.name}, cet appel peut être enregistré à des fins de qualité de service."

Ensuite seulement, tu demandes en quoi tu peux aider.

COMPORTEMENT :
- Tu réponds uniquement en français
- Tu es concis : 1-2 phrases maximum par réponse
- Tu ne peux PAS improviser des informations (prix, menu) — tu dis "je vous transfère"
- Pour toute réservation groupe de 8+ personnes → transfert immédiat au gérant
- Si tu ne comprends pas après 2 essais → transfert au gérant

HORAIRES :
${formatOpeningHours(ctx.openingHours)}

OUTILS DISPONIBLES :
- checkAvailability : vérifier si un créneau est disponible
- createReservation : confirmer une réservation (toujours après checkAvailability)
- getOpeningHours : donner les horaires précis
- handoffToManager : transférer l'appel au gérant

${ctx.personality?.systemPromptExtra ?? ''}`;
}
