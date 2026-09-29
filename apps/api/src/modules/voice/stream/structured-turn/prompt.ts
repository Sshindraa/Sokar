import { normalizeOpeningHours } from '@sokar/shared';
import type { ChatMessage } from '../types';
import type { DayAvailability, StructuredTurnState } from './fact-guards';

/**
 * Consignes du tour structuré, ajoutées au prompt du restaurant. Elles
 * remplacent l'usage des outils : le modèle choisit une action, le code
 * l'exécute puis lui rend le résultat.
 */
const STRUCTURED_TURN_INSTRUCTIONS = `MODE DE RÉPONSE STRUCTURÉ (prioritaire sur la section OUTILS) :
Tu n'appelles aucun outil. À chaque tour, tu renvoies un objet JSON qui décrit ta compréhension et ta réponse.
- turnComplete : false si l'appelant n'a visiblement pas fini sa phrase ou sa pensée (phrase coupée au milieu, hésitation, « attendez », il cherche ses mots) ; alors say est vide, action none, et tu le laisses continuer. true sinon, y compris pour une réponse courte mais complète (« oui », « six », « non »).
- interpretation : ce que fait l'appelant dans ce tour. answer = il répond à ta question ; question = il pose une question ; correction = il remplace une valeur déjà donnée ; affirmation = il accepte ce que tu viens de proposer ou de relire ; decline = il refuse ta proposition mais continue l'appel ; new_request = il change de demande ; end_call = il termine l'appel ou renonce à sa démarche ; unclear = tu n'as pas compris.
- draft : l'état complet du brouillon de réservation APRÈS ce tour. date au format AAAA-MM-JJ, time au format HH:MM, partySize entier, customerName avec l'orthographe retenue. Chaîne vide ou 0 si inconnu. Garde les valeurs déjà connues tant que l'appelant ne les change pas.
- awaiting : ce que ta phrase « say » attend de l'appelant. customerName quand tu demandes le nom ou de l'épeler ; customerNameConfirmation quand tu relis seulement l'orthographe du nom ; confirmation UNIQUEMENT quand ta phrase relit le récapitulatif complet (date, heure, nombre ET nom) et demande l'accord pour réserver ; humanFallback quand tu proposes le gérant ou un message ; open pour une question ouverte ; none si tu n'attends rien.
- action :
  - check_availability dès que la date, l'heure et le nombre sont connus et que l'ÉTAT VÉRIFIÉ ne contient ni « availability » pour ces valeurs, ni « dayAvailability » couvrant cette date et ce nombre. Laisse « say » vide : le résultat te sera donné, puis tu formuleras la réponse.
  - Si « dayAvailability » couvre la date et le nombre avec au moins un créneau, ces créneaux sont réels : réponds directement (action none), sans check_availability. Une plage « 19:00→21:30 » contient chaque demi-heure de 19:00 à 21:30 incluses. Ne propose que ces horaires. Si le nombre n'y a aucun créneau (« aucun »), utilise check_availability.
  - create_reservation uniquement si l'appelant vient d'accepter le récapitulatif complet (date, heure, nombre, nom) que tu as relu au tour précédent avec awaiting=confirmation. Une orthographe confirmée ne suffit pas : relis alors le récapitulatif complet. Laisse « say » vide.
  - take_message quand l'appelant veut laisser un message ou choisit le message : « message » résume sa demande pour le gérant. Laisse « say » vide.
  - transfer quand l'appelant demande le gérant ou choisit le transfert. Laisse « say » vide.
  - end_call quand l'appelant termine ou renonce : « say » est un au revoir court, sans question.
  - none sinon.
- message : vide sauf pour take_message.
- confidence : high si tu es sûr de ta compréhension, low si tu hésites (alors pose une question de clarification et action none).
- say : ta phrase parlée, naturelle et courte, qui se termine par au plus une question. Comme au téléphone : pas de « Parfait » ou « Très bien » systématique en ouverture, pas d'écho de ce que l'appelant vient de dire, pas de point d'exclamation, pas la même question mot pour mot qu'au tour précédent. Quand tu dois reposer une question restée sans réponse (l'appelant a posé une autre question, ou n'a rien répondu), ne recopie jamais ta dernière phrase : reprends-la plus brièvement et autrement (« Et vers quelle heure ? », « Alors, quelle heure vous arrange ? », « Donc, vous serez combien ? »), ou enchaîne sans la répéter en entier.
N'annonce jamais une disponibilité, une réservation, un message ou un transfert que l'ÉTAT VÉRIFIÉ ou un RÉSULTAT D'ACTION ne confirme pas.
La disponibilité dépend du nombre de personnes : tant que draft.partySize vaut 0, ne dis jamais qu'un horaire est possible, libre ou que « ça marche », même si « dayAvailability » le montre libre. Note l'horaire (« 18 heures, c'est noté ») et demande le nombre ; tu confirmeras la disponibilité une fois le nombre connu. Dès que la date, l'heure et le nombre sont connus, lis dans « freeSlotsByPartySize » la ligne qui contient ce nombre (« 5-8 » contient 6) : si l'heure demandée n'y figure pas, dis clairement qu'elle n'est pas disponible pour ce nombre et propose les horaires libres les plus proches de cette ligne ; ne demande pas le nom et ne dis pas « c'est noté » pour cet horaire.
Quand l'ÉTAT VÉRIFIÉ contient « dateFacts », c'est la vérité pour le jour demandé : ses horaires (ou FERMÉ) priment sur tout ce qui a été dit plus tôt dans l'appel, y compris par toi ; si tu t'étais trompé, corrige-toi.
L'épellation d'un nom arrive transcrite automatiquement, parfois en plusieurs morceaux sur plusieurs tours : assemble les morceaux dans l'ordre. « deux K », « 2 k » ou « double K » signifient deux lettres K à la suite ; un chiffre n'est jamais une lettre du nom. Un appelant se reprend souvent au milieu de l'épellation : quand les lettres recommencent par la première lettre du nom (ex. « a k f a 2 k i f » = faux départ « a k f » puis « A, 2 K, I, F »), ne garde que la DERNIÈRE épellation complète, ici A K K I F, jamais un mélange des deux. Relis toujours toutes les lettres retenues, y compris les doubles (« A, deux K, I, F »). Rapproche l'épellation du nom prononcé juste avant pour proposer l'orthographe la plus probable, relis-la lettre par lettre et fais-la confirmer. Si l'appelant ne veut plus épeler, garde l'orthographe la plus probable et poursuis la réservation.`;

/**
 * Jour de la semaine et horaires de la date du brouillon, calculés par le code.
 * Le modèle (sans raisonnement) convertissait bien « demain » en « lundi » mais
 * annonçait ensuite les horaires d'un jour ouvert (appel 0d49230d).
 */
export function describeDate(
  date: string,
  openingHours: unknown,
): { date: string; weekday: string; hours: string } | null {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return null;
  const utc = new Date(Date.UTC(year, month - 1, day));
  const weekday = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', timeZone: 'UTC' }).format(
    utc,
  );
  const days = normalizeOpeningHours(openingHours);
  if (!days.length) return { date, weekday, hours: 'horaires non renseignés' };
  const slot = days.find((entry) => entry.dayIndex === utc.getUTCDay());
  return {
    date,
    weekday,
    hours: slot ? `ouvert ${slot.open}–${slot.close}` : 'FERMÉ ce jour-là',
  };
}

/** Jours couverts par le calendrier calculé donné au modèle. */
export const CALENDAR_DAYS = 14;

/**
 * Calendrier des prochains jours avec leurs horaires, calculé par le code et
 * toujours présent : le modèle n'a plus à convertir « demain » ou « samedi »
 * en jour de semaine puis en horaires (appel 88921164 : « on est ouvert
 * demain, lundi » alors que le lundi est fermé, avant même toute réservation).
 */
export function describeCalendar(today: string, openingHours: unknown): string {
  const [year, month, day] = today.split('-').map(Number);
  if (!year || !month || !day) return '';
  const lines: string[] = [];
  for (let offset = 0; offset < CALENDAR_DAYS; offset++) {
    const date = new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
    const facts = describeDate(date, openingHours);
    if (!facts) continue;
    const label =
      offset === 0 ? "aujourd'hui" : offset === 1 ? 'demain' : offset === 2 ? 'après-demain' : '';
    lines.push(`${date} ${facts.weekday}${label ? ` (${label})` : ''} : ${facts.hours}`);
  }
  return lines.join('\n');
}

function minutes(time: string): number {
  const [hours, mins] = time.split(':').map(Number);
  return hours * 60 + mins;
}

/** « 12:00→14:30, 19:00 » : demi-heures consécutives regroupées en plages. */
export function compactSlots(slots: string[]): string {
  const ranges: string[] = [];
  let start = '';
  let previous = '';
  for (const slot of [...slots].sort()) {
    if (start && minutes(slot) - minutes(previous) === 30) {
      previous = slot;
      continue;
    }
    if (start) ranges.push(start === previous ? start : `${start}→${previous}`);
    start = slot;
    previous = slot;
  }
  if (start) ranges.push(start === previous ? start : `${start}→${previous}`);
  return ranges.join(', ') || 'aucun';
}

/** Tailles consécutives aux mêmes créneaux regroupées : « 1-4 », « 5-7 ». */
function describeDayAvailability(day: DayAvailability) {
  if (day.closed) return { date: day.date, closed: true };
  const sizes = Object.keys(day.slotsBySize)
    .map(Number)
    .sort((a, b) => a - b);
  const freeSlotsByPartySize: Record<string, string> = {};
  let groupStart = sizes[0];
  sizes.forEach((size, index) => {
    const next = sizes[index + 1];
    const text = compactSlots(day.slotsBySize[size]);
    if (next !== undefined && compactSlots(day.slotsBySize[next]) === text) return;
    freeSlotsByPartySize[groupStart === size ? String(size) : `${groupStart}-${size}`] = text;
    groupStart = next;
  });
  return { date: day.date, closed: false, freeSlotsByPartySize };
}

export function buildStructuredTurnMessages(input: {
  systemPrompt: string;
  history: ChatMessage[];
  transcript: string;
  state: StructuredTurnState;
  actionResult?: string;
  /** Horaires du restaurant : les faits du jour réservé sont calculés ici, pas par le modèle. */
  openingHours?: unknown;
  /** Date du jour (AAAA-MM-JJ, fuseau du restaurant), point de départ du calendrier. */
  today?: string;
  /** L'appelant s'est tu après un tour jugé inachevé : il faut lui répondre. */
  callerFinished?: boolean;
}): ChatMessage[] {
  const verified = {
    draft: input.state.draft,
    availability: input.state.availability,
    reservationCreated: input.state.reservationCreated,
    lastAwaiting: input.state.lastAwaiting,
    ...(input.state.draft.date
      ? { dateFacts: describeDate(input.state.draft.date, input.openingHours) }
      : {}),
    ...(input.state.dayAvailability
      ? { dayAvailability: describeDayAvailability(input.state.dayAvailability) }
      : {}),
  };
  const calendar = input.today ? describeCalendar(input.today, input.openingHours) : '';
  const system = [
    input.systemPrompt,
    STRUCTURED_TURN_INSTRUCTIONS,
    calendar
      ? `CALENDRIER (calculé, fait foi pour tout jour, date ou horaire ; ne le recalcule jamais toi-même) :\n${calendar}`
      : '',
    `ÉTAT VÉRIFIÉ : ${JSON.stringify(verified)}`,
    input.actionResult
      ? `RÉSULTAT D'ACTION (déjà exécutée, ne la redemande pas) : ${input.actionResult}\nFormule maintenant ta réponse dans « say » avec action=none, sauf end_call si l'appelant termine. « say » ne doit JAMAIS être vide ici : la consigne « laisse say vide » ne vaut que pour demander une action. Annonce le résultat, sans dire que tu vas vérifier.`
      : '',
    input.callerFinished
      ? "L'appelant s'est tu : son tour est terminé. turnComplete=true ; réponds à ce qu'il a dit, ou demande-lui gentiment de préciser."
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
