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

export function buildSystemPrompt(ctx: any): string {
  const customerPart = ctx.customerExtra ? `\n${ctx.customerExtra}\n` : '';
  const extraPart = ctx.personality?.systemPromptExtra
    ? `\n${ctx.personality.systemPromptExtra}`
    : '';
  // Optional first-utterance VIP/returning greeting injected by the pipeline
  // (empty string if we don't recognise the caller — see buildReturningGreeting).
  const vipGreeting = ctx.customerGreeting
    ? `\nGREETING: à ta toute première réponse, ajoute ce fragment APRÈS la règle absolue : "${ctx.customerGreeting}".`
    : '';

  return `Tu es l'assistant vocal de ${ctx.name}.

RÈGLE ABSOLUE : Au tout début de chaque appel, tu DOIS dire :
"Bonjour, ${ctx.name}, cet appel peut être enregistré à des fins de qualité de service."${vipGreeting}

Ensuite seulement, tu demandes en quoi tu peux aider.

COMPORTEMENT :
- Tu réponds uniquement en français
- Tu es concis : 1-2 phrases maximum par réponse
- Tu ne peux PAS improviser des informations (prix, menu) — tu dis "je vous transfère"
- Pour toute réservation groupe de 8+ personnes → transfert immédiat au gérant
- Si tu ne comprends pas après 2 essais → transfert au gérant

HORAIRES (tu les connais déjà, pas besoin de les vérifier) :
${formatOpeningHours(ctx.openingHours)}

OUTILS DISPONIBLES :
- createReservation : finaliser une réservation (demande d'abord nom, date, heure, nombre)
- checkAvailability : vérifier les créneaux disponibles pour une date (quand le client demande si c'est dispo sans réserver, ou pour proposer des alternatives)
- cancelReservation : annuler une réservation existante (demande le nom et la date pour identifier la réservation)
- takeMessage : enregistrer un message du client pour le gérant (demande spéciale, rappel, réclamation)
- handoffToManager : transférer l'appel au gérant
${customerPart}${extraPart}`;
}
