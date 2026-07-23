import type { CallSession, ConversationState, VoiceSpeechAct } from './types';

export function createConversationState(): ConversationState {
  return {
    intent: null,
    slots: {},
    toolInFlight: null,
    lastAvailabilityCheck: null,
    pendingQuestion: null,
    lastAssistantQuestion: null,
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

export function classifyVoiceSpeechAct(transcript: string): VoiceSpeechAct {
  const normalized = normalizeTranscript(transcript);

  if (/^(?:allo+|vous etes(?: toujours)? la|vous m entendez|ca a coupe)$/.test(normalized)) {
    return 'liveness';
  }
  if (/^(?:oui|ouais|ok|okay|d accord|dac|hum hum|mh|mhm|bien sur)$/.test(normalized)) {
    return 'backchannel';
  }
  if (
    /^(?:merci[, ]+(?:c est tout|au revoir)|c est tout(?: merci)?|au revoir|bonne (?:journee|soiree)|a bientot)$/.test(
      normalized,
    )
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

  const timeMatch = normalized.match(
    /\b(?:a|vers)?\s*([01]?\d|2[0-3])\s*(?::|h(?:eures?)?\s*)([0-5]\d)?\b/,
  );
  if (timeMatch) {
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2] ?? '0');
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
    return `Désolé, il n'y a plus de créneau disponible ce jour-là pour ${request.partySize} personne${request.partySize > 1 ? 's' : ''}.`;
  }
  if (availableSlots.includes(request.time)) {
    return `Oui, ${time} est disponible pour ${request.partySize} personne${request.partySize > 1 ? 's' : ''}. Quel est votre nom pour la réservation ?`;
  }
  const alternatives = availableSlots
    .slice(0, 2)
    .map((slot) => slot.replace(/^0/, '').replace(':00', ' h').replace(':', ' h '))
    .join(' ou ');
  return `Désolé, ${time} n'est pas disponible. Je peux vous proposer ${alternatives}.`;
}

export function recordUserTurn(
  session: CallSession,
  transcript: string,
  speechAct: VoiceSpeechAct,
  now = new Date(),
): void {
  if (speechAct === 'content' || speechAct === 'correction') {
    session.conversation.closing = false;
    session.conversation.intent = inferIntent(transcript) ?? session.conversation.intent;
    Object.assign(
      session.conversation.slots,
      extractConversationSlots(transcript, session.timezone ?? 'Europe/Paris', now),
    );
  }
}

function pendingQuestionFrom(question: string): ConversationState['pendingQuestion'] {
  const normalized = normalizeTranscript(question);
  if (/\b(?:quelle date|quel jour|quand)/.test(normalized)) return 'date';
  if (/\b(?:quelle heure|a quelle heure|vers quelle heure)/.test(normalized)) return 'time';
  if (/\b(?:combien de personnes|pour combien)/.test(normalized)) return 'partySize';
  if (/\b(?:votre nom|quel est votre nom|au nom de qui)/.test(normalized)) return 'customerName';
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

/** Réponses courtes qui ne nécessitent ni interprétation ni appel LLM. */
export function buildDeterministicTurnResponse(
  session: CallSession,
  speechAct: VoiceSpeechAct,
): string | null {
  if (speechAct === 'closing') {
    session.conversation.closing = true;
    return 'Merci à vous. Bonne soirée !';
  }

  // Deux incompréhensions consécutives constituent un échec de dialogue,
  // pas une invitation à poser une troisième fois la même question.
  if (speechAct === 'content' && session.conversation.misunderstandingCount >= 2) {
    return 'Je vais vous passer le gérant pour vous aider.';
  }

  if (speechAct === 'backchannel' && session.conversation.lastAssistantQuestion) {
    return `D'accord. ${session.conversation.lastAssistantQuestion}`;
  }

  return null;
}
