import { normalizeOpeningHours } from '@sokar/shared';
import type { ChatMessage } from '../types';
import type { DayAvailability, StructuredTurnState } from './fact-guards';

/**
 * Consignes du tour structuré, ajoutées au prompt du restaurant. Elles
 * remplacent l'usage des outils : le modèle choisit une action, le code
 * l'exécute puis lui rend le résultat.
 */
const STRUCTURED_TURN_INSTRUCTIONS = `MODE DE RÉPONSE STRUCTURÉ :
Tu n'appelles aucun outil. À chaque tour, tu renvoies un objet JSON qui décrit ta compréhension et ta réponse.
- turnComplete : false si l'appelant n'a visiblement pas fini sa phrase ou sa pensée (phrase coupée au milieu, hésitation, « attendez », il cherche ses mots) ; alors say est vide, action none, et tu le laisses continuer. true sinon, y compris pour une réponse courte mais complète (« oui », « six », « non »). Une phrase qui annonce ce que l'appelant veut faire, ou qui introduit sa réponse, sans donner encore l'information que tu attends, n'est pas finie : il cherche sa réponse. Attends, et ne le relance que s'il se tait vraiment. De même, une phrase qui se termine en rejetant ou en niant la valeur qu'elle vient de donner est une correction en cours : la valeur de remplacement arrive dans la seconde qui suit. N'agis pas sur la valeur rejetée, ne réponds pas, attends la suite.
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
- Limites : tes seules actions sont celles ci-dessus. Tu ne peux ni annuler une réservation, ni signaler un retard, ni vendre une carte cadeau par téléphone : dis-le simplement, oriente vers le site ou le widget de réservation pour une carte cadeau, ou propose le gérant ou de laisser un message. Tu ne promets jamais une de ces actions.
- message : vide sauf pour take_message.
- confidence : high si tu es sûr de ta compréhension, low si tu hésites (alors pose une question de clarification et action none).
- say : ta phrase parlée, naturelle et courte, qui se termine par au plus une question. Comme au téléphone : pas de « Parfait » ou « Très bien » systématique en ouverture, pas d'écho de ce que l'appelant vient de dire, pas de point d'exclamation, pas la même question mot pour mot qu'au tour précédent. Quand tu dois reposer une question restée sans réponse (l'appelant a posé une autre question, ou n'a rien répondu), ne recopie jamais ta dernière phrase : reprends-la plus brièvement et autrement (« Et vers quelle heure ? », « Alors, quelle heure vous arrange ? », « Donc, vous serez combien ? »), ou enchaîne sans la répéter en entier.
Quand l'appelant pose une question qui contient, clairement dite, une date, une heure ou un nombre (ses mots suffisent à savoir de quelle information il s'agit), il répond déjà en creux à ta question ouverte : retiens la valeur, réponds à sa question, puis fais-lui confirmer cette valeur ou passe à l'information suivante. Ta question de fin de phrase porte alors sur l'information suivante ou sur la confirmation de cette valeur : ne repose jamais à vide la question à laquelle il vient de répondre.
Un récapitulatif va droit au contenu, sans phrase d'introduction, et dit chaque information une seule fois sous sa forme parlée la plus courte : un jour proche se dit par son nom relatif seul, sans le répéter en date complète. Il ne rejoue pas ce que l'appelant vient de confirmer. Une fois l'orthographe d'un nom confirmée, dis-le comme un nom, pas lettre par lettre.
Une fois la réservation créée et ton au revoir dit, un mot de politesse ou de salutation de l'appelant est sa façon de prendre congé, pas un nouvel appel : réponds-y d'une courte phrase avec action=end_call. S'il fait une nouvelle demande, traite-la normalement.
Une formule de politesse se rapporte au moment où tu parles (MOMENT DE LA JOURNÉE), pas au moment dont vous parlez (la réservation).
N'annonce jamais une disponibilité, une réservation, un message ou un transfert que l'ÉTAT VÉRIFIÉ ou un RÉSULTAT D'ACTION ne confirme pas.
La disponibilité dépend du nombre de personnes : tant que draft.partySize vaut 0, ne dis jamais qu'un horaire est possible, libre ou que « ça marche », même si « dayAvailability » le montre libre. Retiens l'horaire dans draft sans l'annoncer comme acquis ni le répéter, et demande le nombre ; tu confirmeras la disponibilité une fois le nombre connu. Dès que la date, l'heure et le nombre sont connus, lis dans « freeSlotsByPartySize » la ligne qui contient ce nombre (« 5-8 » contient 6) : si l'heure demandée n'y figure pas, dis clairement qu'elle n'est pas disponible pour ce nombre et propose les horaires libres les plus proches de cette ligne ; ne demande pas le nom et ne dis pas « c'est noté » pour cet horaire.
Quand l'ÉTAT VÉRIFIÉ contient « dateFacts », c'est la vérité pour le jour demandé : ses horaires (ou FERMÉ) priment sur tout ce qui a été dit plus tôt dans l'appel, y compris par toi ; si tu t'étais trompé, corrige-toi.
L'épellation d'un nom arrive transcrite automatiquement, parfois en plusieurs morceaux sur plusieurs tours : assemble les morceaux dans l'ordre. Dans une épellation, « deux » ou « double » suivi d'une lettre, ou un chiffre suivi d'une lettre, double cette lettre, même sans autre mot autour ; un chiffre n'est jamais une lettre du nom. Un appelant se reprend souvent au milieu de l'épellation : quand les lettres recommencent par la première lettre du nom, c'est un faux départ : ne garde que la DERNIÈRE épellation complète, jamais un mélange des deux. Relis toujours toutes les lettres retenues, y compris les doubles. Les lettres épelées, doubles comprises, font foi sur le mot entendu juste avant, même quand il s'écrit autrement ; le mot entendu ne sert qu'à départager deux lettres qui se ressemblent au téléphone. Seules les lettres épelées forment le nom : un mot dit en plus avant ou après l'épellation n'en fait jamais partie, même s'il ressemble à un nom, et il ne figure ni dans customerName ni dans ta relecture. Relis-la lettre par lettre et fais-la confirmer. Quand l'appelant ré-épelle ou corrige après ta relecture, customerName prend aussitôt la nouvelle épellation : ta phrase et customerName disent toujours le même nom. Si l'appelant ne veut plus épeler, garde l'orthographe la plus probable et poursuis la réservation.`;

/**
 * Vérification de compréhension (drapeau par restaurant). Consignes de principe, sans formulation à imiter :
 * appel bf3893ae, une transcription incohérente était retenue comme une valeur sûre (confidence=high).
 * Le code applique la déclaration `doubtful` (voir applyProposedDraft et authorizeStructuredAction).
 */
const UNDERSTANDING_INSTRUCTIONS = `COMPRÉHENSION VÉRIFIÉE (prioritaire sur la retenue de valeur ci-dessus) :
- reading : avant de remplir le brouillon, redis en une courte phrase littérale ce que l'appelant a dit, sans l'interpréter au-delà de ses mots et sans compléter ce qui manque. La transcription vient d'une reconnaissance vocale au téléphone : un mot peut être faux, surtout un nombre, et une phrase peut être incomplète ou ne rien vouloir dire.
- understanding : clear seulement si, pour CHAQUE valeur que tu ajoutes ou changes dans draft, les mots de l'appelant suffisent à savoir de quelle information il s'agit (le jour, l'heure, le nombre de personnes ou le nom) et que c'est la seule lecture raisonnable compte tenu de ta dernière question. doubtful dans tous les autres cas : une valeur qui pourrait désigner autre chose, une phrase qui n'a pas de sens comme réponse à ta question, une valeur que tu devrais deviner ou déduire plutôt qu'entendre.
- Quand understanding vaut doubtful : draft reste exactement celui de l'ÉTAT VÉRIFIÉ, interpretation=unclear, action none, confidence low. Ta phrase ne confirme, n'annonce et ne répète aucune valeur douteuse : elle redemande naturellement ce qui manque, en une seule question, sans reprocher quoi que ce soit à l'appelant.`;

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
  /** Moment de la journée actuel (fuseau du restaurant), pour les formules de politesse. */
  dayPart?: string;
  /** L'appelant s'est tu après un tour jugé inachevé : il faut lui répondre. */
  callerFinished?: boolean;
  /** Vérification de compréhension (reading + understanding) ; absent : comportement historique. */
  understanding?: boolean;
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
    input.understanding ? UNDERSTANDING_INSTRUCTIONS : '',
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
    // En dernier, au plus près de la formulation : plus haut, le modèle suivait l'heure de la réservation.
    input.dayPart
      ? `MOMENT DE LA JOURNÉE (heure locale du restaurant, maintenant) : ${input.dayPart}. Si tu prends congé, ta formule doit convenir à ce moment précis, pas à l'heure de la réservation.`
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
