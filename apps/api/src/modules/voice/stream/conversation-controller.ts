import type { CallSession, ConversationState, VoiceSpeechAct } from './types';

export function createConversationState(): ConversationState {
  return {
    intent: null,
    slots: {},
    toolInFlight: null,
    lastAvailabilityCheck: null,
    lastAvailabilityResult: null,
    pendingQuestion: null,
    lastAssistantQuestion: null,
    spellingCandidate: null,
    misunderstandingCount: 0,
    closing: false,
  };
}

function normalizeTranscript(value: string): string {
  return value
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}:\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tokens que Flux peut produire quand l'appelant épelle un nom en français.
 * Le but n'est pas de remplacer le STT, mais de conserver la granularité des
 * lettres avant que le LLM ne les normalise en un mot (« K I F » → « Kif »).
 */
const SPOKEN_LETTER_TOKENS: Record<string, string> = {
  a: 'A',
  be: 'B',
  ce: 'C',
  de: 'D',
  e: 'E',
  efe: 'F',
  eff: 'F',
  effe: 'F',
  ge: 'G',
  ache: 'H',
  i: 'I',
  ji: 'J',
  dji: 'J',
  ka: 'K',
  elle: 'L',
  emme: 'M',
  enne: 'N',
  o: 'O',
  pe: 'P',
  ku: 'Q',
  erre: 'R',
  esse: 'S',
  te: 'T',
  u: 'U',
  ve: 'V',
  ix: 'X',
  zede: 'Z',
  tiret: '-',
  apostrophe: "'",
};

const SPELLING_FILLER_TOKENS = new Set([
  'et',
  'puis',
  'ensuite',
  'par',
  'lettre',
  'lettres',
  'euh',
  'heu',
]);

const NAME_INTRODUCTION_PATTERN =
  /\b(?:au\s+nom\s+de|nom\s+de|mon\s+nom\s+est|mon\s+nom|je\s+m\s+appelle|je\s+suis)\b/u;
const SPELLING_INTRODUCTION_PATTERN =
  /\b(?:epel(?:er|e|ez)?|epell(?:e|er|ez)?|lettres?(?:\s+par\s+lettre)?|alphabet)\b/u;

export interface SpelledNameCandidate {
  /** Lettres normalisées, par exemple `KIF` ou `DUPONT`. */
  value: string;
  /** Vrai lorsque chaque token utile est une lettre sans bruit inconnu. */
  confident: boolean;
}

function tokenToSpokenLetter(token: string): string | null {
  if (/^[a-z]$/u.test(token)) return token.toUpperCase();
  return SPOKEN_LETTER_TOKENS[token] ?? null;
}

/**
 * Extrait une séquence de lettres d'un transcript déjà produit par le STT.
 * Retourne null pour un nom normal (« Jean Dupont »), afin de ne pas bloquer
 * le flux habituel. Les phrases explicitement épelées peuvent contenir des
 * mots de comparaison ou des artefacts STT : elles sont alors marquées
 * `confident: false` et doivent être répétées, jamais devinées.
 */
export function parseSpelledNameTranscript(transcript: string): SpelledNameCandidate | null {
  const normalized = normalizeTranscript(transcript);
  if (!normalized) return null;

  const nameIntro = normalized.match(NAME_INTRODUCTION_PATTERN);
  const spellingIntroMatch = normalized.match(SPELLING_INTRODUCTION_PATTERN);
  const spellingIntro = Boolean(spellingIntroMatch);
  // Quand le locuteur dit « je vais épeler mon nom : ... », on conserve le
  // dernier marqueur rencontré (ici « mon nom ») pour ignorer les mots de
  // liaison et analyser uniquement les caractères qui suivent.
  const markers = [nameIntro, spellingIntroMatch].filter(
    (marker): marker is RegExpMatchArray => Boolean(marker),
  );
  const marker = markers.sort(
    (left, right) => (right.index ?? 0) + right[0].length - ((left.index ?? 0) + left[0].length),
  )[0];
  const tail = marker
    ? normalized.slice((marker.index ?? 0) + marker[0].length).trim()
    : normalized;
  const tokens = tail.split(/\s+/u).filter(Boolean);
  const expandedTokens: string[] = [];

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const next = tokens[index + 1];
    if (token === 'double' && next === 've') {
      expandedTokens.push('double ve');
      index++;
    } else if (token === 'i' && next === 'grec') {
      expandedTokens.push('i grec');
      index++;
    } else {
      expandedTokens.push(token);
    }
  }

  const letters: string[] = [];
  let unknownTokenCount = 0;
  for (const token of expandedTokens) {
    if (SPELLING_FILLER_TOKENS.has(token)) continue;
    if (token === 'double ve') {
      letters.push('W');
      continue;
    }
    if (token === 'i grec') {
      letters.push('Y');
      continue;
    }
    const letter = tokenToSpokenLetter(token);
    if (letter) {
      letters.push(letter);
    } else {
      unknownTokenCount++;
    }
  }

  // Deux lettres suffisent quand la personne a explicitement dit « épeler »;
  // sans marqueur, trois lettres évitent de prendre un article isolé pour un
  // début d'épellation.
  const minimumLetters = spellingIntro ? 2 : 3;
  if (letters.filter((letter) => /[A-Z]/u.test(letter)).length < minimumLetters) {
    return null;
  }

  // Un transcript long avec quelques lettres fortuites n'est pas une
  // épellation. Une introduction de nom ou le motif « épeler » est requis,
  // sauf pour une courte suite de trois lettres prononcées seules.
  const shortLetterSequence = expandedTokens.length <= letters.length + 1;
  if (!nameIntro && !spellingIntro && !shortLetterSequence) return null;

  const value = letters.join('');
  if (value.length > 32 || !/[A-Z]{2,}/u.test(value)) return null;

  return { value, confident: unknownTokenCount === 0 };
}

function formatSpelledName(value: string): string {
  return value
    .split('')
    .map((letter) => (letter === '-' ? 'tiret' : letter === "'" ? 'apostrophe' : letter))
    .join(', ');
}

function isNameConfirmation(transcript: string): boolean {
  const normalized = normalizeTranscript(transcript);
  return /^(?:oui|ouais|ok(?:ay)?|d accord|bien sur|exactement|tout a fait|c est ca|c est bien ca|voila)(?:\s+(?:c est ca|c est bien ca|exactement|voila))?$/u.test(
    normalized,
  );
}

function isNameRejection(transcript: string): boolean {
  const normalized = normalizeTranscript(transcript);
  return /^(?:non|pas du tout|ce n est pas ca|ce n est pas le bon nom|j ai dit non)$/u.test(
    normalized,
  );
}

export interface CustomerNameTurnResult {
  /** Réponse déterministe à prononcer, ou null pour laisser le LLM continuer. */
  response: string | null;
  /** Nom confirmé à injecter explicitement dans le tour LLM suivant. */
  confirmedName: string | null;
}

/**
 * Protège la collecte du nom avec le STT courant. Une séquence de lettres ne
 * part plus directement vers Qwen : elle est répétée puis confirmée. Le nom
 * n'est copié dans les slots qu'après un « oui » explicite.
 */
export function handleCustomerNameTurn(
  session: CallSession,
  transcript: string,
): CustomerNameTurnResult {
  if (session.conversation.pendingQuestion !== 'customerName') {
    return { response: null, confirmedName: null };
  }

  const candidate = parseSpelledNameTranscript(transcript);
  if (candidate) {
    if (!candidate.confident) {
      session.conversation.spellingCandidate = null;
      return {
        response:
          "J'ai entendu une suite de lettres, mais je ne suis pas sûr de l'orthographe. Pouvez-vous me redonner votre nom, lettre par lettre, lentement ?",
        confirmedName: null,
      };
    }

    session.conversation.spellingCandidate = candidate.value;
    return {
      response: `J'ai noté : ${formatSpelledName(candidate.value)}. C'est bien votre nom ?`,
      confirmedName: null,
    };
  }

  const pendingCandidate = session.conversation.spellingCandidate;
  if (pendingCandidate && isNameConfirmation(transcript)) {
    session.conversation.slots.customerName = pendingCandidate;
    session.conversation.spellingCandidate = null;
    session.conversation.pendingQuestion = null;
    session.conversation.lastAssistantQuestion = null;
    return { response: null, confirmedName: pendingCandidate };
  }

  if (pendingCandidate && isNameRejection(transcript)) {
    session.conversation.spellingCandidate = null;
    return {
      response: "D'accord. Pouvez-vous me redonner votre nom, lettre par lettre, lentement ?",
      confirmedName: null,
    };
  }

  // L'appelant peut abandonner l'épellation et donner directement un nom
  // normal (« non, Dupont »). On laisse alors le LLM reprendre ce cas.
  session.conversation.spellingCandidate = null;
  return { response: null, confirmedName: null };
}

export function classifyVoiceSpeechAct(transcript: string): VoiceSpeechAct {
  const normalized = normalizeTranscript(transcript);

  if (/^(?:allo+|vous etes(?: toujours)? la|vous m entendez|ca a coupe)$/.test(normalized)) {
    return 'liveness';
  }
  if (/^(?:oui|ouais|ok|okay|d accord|dac|hum hum|mh|mhm|bien sur)$/.test(normalized)) {
    return 'backchannel';
  }
  if (
    /^(?:(?:non\s+){1,2})?(?:merci(?:\s+(?:c est tout|au revoir))?|c est tout(?:\s+merci)?|au revoir|bonne (?:journee|soiree)|a bientot)$/.test(
      normalized,
    )
  ) {
    return 'closing';
  }
  // Decline / fin de conversation : "non ça ira", "c'est bon", "ça va aller",
  // "pas besoin", "non merci", "c'est parfait merci", "non c'est bon merci"
  if (
    /^(?:non\s+)?(?:c est bon(?:\s+merci)?|ca ira(?:\s+merci)?|ca va aller|pas (?:besoin|la peine)|c est parfait(?:\s+merci)?|non merci|c est tout bon|laissez tomber|non c est bon)$/.test(
      normalized,
    )
  ) {
    return 'closing';
  }
  // Phrases contenant un pattern de clôture + texte supplémentaire :
  // "C'est bon, allez on arrête", "ça ira laissez tomber", "non c'est bon je raccroche"
  if (
    /\b(?:c est bon|ca ira|ca va aller|laissez tomber|on arrete|je raccroche|pas la peine|pas besoin)\b/.test(
      normalized,
    ) &&
    !/\b(?:reserv|table|heure|personne|demain|aujourd|soir|midi|annul)\b/.test(normalized)
  ) {
    return 'closing';
  }
  if (/^(?:non\b|plutot\b|en fait\b|j ai dit\b|je voulais dire\b)/.test(normalized)) {
    return 'correction';
  }
  return 'content';
}

function inferIntent(transcript: string): ConversationState['intent'] {
  const normalized = normalizeTranscript(transcript);
  if (/\b(?:annul|supprim)/.test(normalized)) return 'cancel';
  if (/\b(?:retard|en retard)/.test(normalized)) return 'delay';
  if (/\b(?:carte cadeau|bon cadeau)/.test(normalized)) return 'gift_card';
  if (/\b(?:message|rappeler|reclamation)/.test(normalized)) return 'message';
  if (/\b(?:reserv|table|place)/.test(normalized)) return 'reservation';
  if (/\b(?:disponib|possible|creneau)/.test(normalized)) return 'availability';
  return null;
}

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function localDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function nextWeekday(date: string, targetDay: number): string {
  const currentDay = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return addDays(date, (targetDay - currentDay + 7) % 7);
}

export function extractConversationSlots(
  transcript: string,
  timezone: string,
  now = new Date(),
): ConversationState['slots'] {
  const normalized = normalizeTranscript(transcript);
  const slots: ConversationState['slots'] = {};

  const isoDate = normalized.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (isoDate) {
    slots.date = isoDate;
  } else if (/\b(?:aujourd hui|ce jour|ce soir)\b/.test(normalized)) {
    slots.date = localDate(now, timezone);
  } else if (/\bdemain\b/.test(normalized)) {
    slots.date = addDays(localDate(now, timezone), 1);
  } else {
    const weekday = normalized.match(
      /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/,
    )?.[1];
    const weekdayIndex: Record<string, number> = {
      dimanche: 0,
      lundi: 1,
      mardi: 2,
      mercredi: 3,
      jeudi: 4,
      vendredi: 5,
      samedi: 6,
    };
    if (weekday) {
      slots.date = nextWeekday(localDate(now, timezone), weekdayIndex[weekday]);
    }
  }

  // Deepgram transcrit parfois « 19 30 » sans séparateur. On accepte cette
  // forme en plus de « 19:30 », « 19h30 » et « 19 heures 30 », tout en
  // conservant l'heure seule uniquement lorsqu'elle est explicitement suivie
  // de h/heures (pour ne pas confondre « 2 personnes » avec une heure).
  const timeMatch = normalized.match(
    /\b(?:a|vers)?\s*([01]?\d|2[0-3])(?:(?:\s*(?::|h(?:eures?)?)\s*)([0-5]\d)?|\s+([0-5]\d))\b/,
  );
  if (timeMatch) {
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2] ?? timeMatch[3] ?? '0');
    slots.time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  const partyMatch = normalized.match(
    /\b(?:pour|de)?\s*(\d+|un|une|deux|trois|quatre|cinq|six|sept)\s+personnes?\b/,
  );
  if (partyMatch) {
    const words: Record<string, number> = {
      un: 1,
      une: 1,
      deux: 2,
      trois: 3,
      quatre: 4,
      cinq: 5,
      six: 6,
      sept: 7,
    };
    const partySize = words[partyMatch[1]] ?? Number(partyMatch[1]);
    if (partySize >= 1 && partySize <= 7) slots.partySize = partySize;
  }

  return slots;
}

export function getReadyAvailabilityRequest(session: CallSession): {
  date: string;
  time: string;
  partySize: number;
  key: string;
} | null {
  const { intent, slots, toolInFlight, lastAvailabilityCheck } = session.conversation;
  if ((intent !== 'reservation' && intent !== 'availability') || toolInFlight) return null;
  if (!slots.date || !slots.time || !slots.partySize) return null;

  const key = `${slots.date}:${slots.time}:${slots.partySize}`;
  if (lastAvailabilityCheck === key) return null;
  return { date: slots.date, time: slots.time, partySize: slots.partySize, key };
}

export function buildAvailabilityReply(
  request: { date: string; time: string; partySize: number },
  availableSlots: string[],
): string {
  const time = request.time.replace(/^0/, '').replace(':00', ' h').replace(':', ' h ');
  if (availableSlots.length === 0) {
    return `Ah, malheureusement on est complets ce jour-là pour ${request.partySize} personne${request.partySize > 1 ? 's' : ''}. Vous voulez que je regarde un autre jour ?`;
  }
  if (availableSlots.includes(request.time)) {
    return `Parfait, ${time} c'est noté pour ${request.partySize} personne${request.partySize > 1 ? 's' : ''}. À quel nom je réserve ?`;
  }
  const alternatives = selectClosestAvailabilitySlots(request.time, availableSlots)
    .map((slot) => slot.replace(/^0/, '').replace(':00', ' h').replace(':', ' h '))
    .join(' ou ');
  return `Alors ${time} c'est complet, par contre j'ai ${alternatives}. Ça vous irait ?`;
}

export function recordUserTurn(
  session: CallSession,
  transcript: string,
  speechAct: VoiceSpeechAct,
  now = new Date(),
): void {
  if (speechAct === 'closing') {
    session.conversation.closing = true;
    return;
  }

  if (speechAct === 'content' || speechAct === 'correction') {
    session.conversation.closing = false;
    session.conversation.intent = inferIntent(transcript) ?? session.conversation.intent;
    const extracted = extractConversationSlots(transcript, session.timezone ?? 'Europe/Paris', now);
    const current = session.conversation.slots;
    if (
      (extracted.date && extracted.date !== current.date) ||
      (extracted.partySize && extracted.partySize !== current.partySize)
    ) {
      session.conversation.lastAvailabilityResult = null;
    }
    Object.assign(current, extracted);
  }
}

function asksForAvailabilityAlternative(transcript: string): boolean {
  const normalized = normalizeTranscript(transcript);
  return /\b(?:que|qu est ce que) (?:vous|tu) propose(?:z)?(?: quoi)?\b|\b(?:vous|tu) propose(?:z)? quoi\b|\b(?:je|on) (?:lui )?propose quoi\b|\bquelles? (?:sont les )?alternatives?\b|\bautres? (?:heure|horaire|creneau)\b|\b(?:sinon|une autre heure)\b/.test(
    normalized,
  );
}

function formatAvailabilitySlot(slot: string): string {
  return slot.replace(/^0/, '').replace(':00', ' h').replace(':', ' h ');
}

function timeToMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

export function selectClosestAvailabilitySlots(
  requestedTime: string,
  availableSlots: string[],
  limit = 2,
): string[] {
  const requestedMinutes = timeToMinutes(requestedTime);
  return [...availableSlots]
    .sort((left, right) => {
      const distance =
        Math.abs(timeToMinutes(left) - requestedMinutes) -
        Math.abs(timeToMinutes(right) - requestedMinutes);
      return distance || left.localeCompare(right);
    })
    .slice(0, limit);
}

export function buildAvailabilityFollowupResponse(
  session: CallSession,
  transcript: string,
): string | null {
  if (!asksForAvailabilityAlternative(transcript)) return null;
  const result = session.conversation.lastAvailabilityResult;
  if (!result) return null;

  if (result.slots.length === 0) {
    return "Je n'ai aucun autre créneau vérifié ce jour-là. Je peux vous passer le gérant ou prendre un message.";
  }

  const alternatives = selectClosestAvailabilitySlots(result.time, result.slots)
    .map(formatAvailabilitySlot)
    .join(' ou ');
  return `Je peux vous proposer ${alternatives}. Lequel vous convient ?`;
}

export function buildReservationProgressResponse(
  session: CallSession,
  transcript = '',
): string | null {
  const { intent, slots } = session.conversation;
  if (intent !== 'reservation' && intent !== 'availability') return null;

  // Ne pas répondre déterministiquement si le transcript de l'utilisateur
  // n'est pas pertinent pour la réservation (plainte, question, frustration,
  // phrase longue ou complexe). Dans ce cas, laisser le LLM gérer.
  if (transcript) {
    const normalized = normalizeTranscript(transcript);
    // Mots qui indiquent que l'utilisateur ne répond pas à la question en attente
    if (
      /\b(?:pourquoi|comment|arrete|raccroche|laissez tomber|c est bon|allez|genant|bizarre|probleme|marche pas|entends pas|comprends pas)\b/.test(
        normalized,
      )
    ) {
      return null;
    }
    // Si le transcript est long (> 60 chars) et ne contient aucune info de slot,
    // c'est probablement une phrase complexe → LLM
    const extracted = extractConversationSlots(transcript, session.timezone ?? 'Europe/Paris');
    const hasSlotInfo = Boolean(extracted.date || extracted.time || extracted.partySize);
    if (normalized.length > 60 && !hasSlotInfo) {
      return null;
    }
  }

  if (!slots.date) return 'Pour quel jour ?';
  if (!slots.partySize) return 'Vous serez combien ?';
  if (!slots.time) return 'Vous voulez venir vers quelle heure ?';
  return null;
}

function isAmbiguousPartySizeReply(session: CallSession, transcript: string): boolean {
  if (session.conversation.pendingQuestion !== 'partySize') return false;
  if (extractConversationSlots(transcript, session.timezone ?? 'Europe/Paris').partySize)
    return false;

  const normalized = normalizeTranscript(transcript);
  return /\b(?:personne|personnes|on sera|nous serons|combien)\b/.test(normalized);
}

function pendingQuestionFrom(question: string): ConversationState['pendingQuestion'] {
  const normalized = normalizeTranscript(question);
  if (/\b(?:quelle date|quel jour|quand)/.test(normalized)) return 'date';
  if (/\b(?:quelle heure|a quelle heure|vers quelle heure)/.test(normalized)) return 'time';
  if (/\b(?:combien de personnes|pour combien|vous serez combien)/.test(normalized)) {
    return 'partySize';
  }
  if (
    /\b(?:votre nom|quel est votre nom|au nom de qui|a quel nom|quel nom|nom pour la reservation)\b/.test(
      normalized,
    )
  )
    return 'customerName';
  if (/\b(?:telephone|numero)/.test(normalized)) return 'customerPhone';
  return null;
}

export function recordAssistantReply(session: CallSession, reply: string): void {
  const lastQuestion = reply.match(/(?:^|[.!]\s*)([^.?!]+\?)\s*$/u)?.[1]?.trim() ?? null;
  session.conversation.lastAssistantQuestion = lastQuestion;
  session.conversation.pendingQuestion = lastQuestion ? pendingQuestionFrom(lastQuestion) : null;

  if (/je n'ai pas (?:bien )?compris|pouvez-vous repeter/i.test(reply)) {
    session.conversation.misunderstandingCount++;
  } else {
    // Une réponse métier cohérente confirme que le tour courant a été
    // compris : ne pas cumuler des incompréhensions anciennes.
    session.conversation.misunderstandingCount = 0;
  }
}

/** Réponses courtes qui ne nécessitent ni interprétation ni appel LLM.
 *
 * Volontairement minimal : on laisse le LLM gérer le flux conversationnel
 * (demander date/heure/nombre, répondre aux questions, gérer les corrections)
 * pour des réponses naturelles et variées. Le déterministe ne garde que :
 * - handoff après 2 incompréhensions (sécurité)
 * - backchannel simple (l'utilisateur dit "oui" → reposer la dernière question)
 * - clarification nombre de personnes ambigu
 * - followup de disponibilité (alternatives proposées par l'outil)
 */
export function buildDeterministicTurnResponse(
  session: CallSession,
  speechAct: VoiceSpeechAct,
  transcript = '',
): string | null {
  // Deux incompréhensions consécutives constituent un échec de dialogue,
  // pas une invitation à poser une troisième fois la même question.
  if (speechAct === 'content' && session.conversation.misunderstandingCount >= 2) {
    return 'Je vais vous passer le gérant pour vous aider.';
  }

  if (speechAct === 'backchannel' && session.conversation.lastAssistantQuestion) {
    return `D'accord. ${session.conversation.lastAssistantQuestion}`;
  }

  if (speechAct === 'content' || speechAct === 'correction') {
    if (isAmbiguousPartySizeReply(session, transcript)) {
      return "Je n'ai pas bien compris le nombre de personnes. Vous serez combien ?";
    }
    // Followup de disponibilité : alternatives proposées par l'outil
    // (ces réponses dépendent du résultat de checkAvailability, pas du LLM)
    return buildAvailabilityFollowupResponse(session, transcript);
  }

  return null;
}
