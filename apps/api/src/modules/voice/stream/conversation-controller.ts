import type {
  CallSession,
  ConversationState,
  DayPeriod,
  DialogueStallLevel,
  HumanFallbackMode,
  PendingInteraction,
  PendingInteractionKind,
  PendingInteractionStatus,
  NameCollection,
  PendingQuestion,
  SpellingToken,
  VoiceSpeechAct,
} from './types';
import { DEFAULT_MAX_PARTY_SIZE } from '@sokar/config';
import {
  EXPECTED_ANSWER_THRESHOLDS,
  rankExpectedAnswers,
  resolveExpectedAnswer,
} from './expected-answer';
import {
  confusableNeighbours,
  decideSlotConfidence,
  unstableAlternatives,
  valueConfidence,
  type ConfidenceSlotKind,
} from './slot-confidence';
import { effectiveVoiceLanguage, type VoiceLanguageCode } from './voice-language';
import {
  observeVoiceReadbackResponse,
  recordVoiceChoiceResponse,
  recordVoiceQuestionForTurn,
  recordVoiceReadbackForTurn,
} from './voice-quality';
import type { VoiceQualityKind } from '../../../shared/observability/metrics';
import {
  decideAssistantInteractionPolicy,
  decideTurnPolicy,
  type AssistantInteractionPolicyDecision,
  type AssistantInteractionProposal,
  type PartySizeEvidence,
} from './turn-policy';

export interface AssistantReplyEmissionPlan {
  reply: string;
  proposal: AssistantInteractionProposal;
}

export function createNameCollection(): NameCollection {
  return {
    state: 'idle',
    partialCandidate: '',
    tokens: [],
    ambiguousPositions: [],
    clarificationCount: 0,
    awaitingCorrection: false,
    presentedCandidate: null,
    confirmedName: null,
    fallbackRecorded: false,
  };
}

export function createConversationState(): ConversationState {
  return {
    intent: null,
    slots: {},
    toolInFlight: null,
    lastAvailabilityCheck: null,
    lastAvailabilityResult: null,
    pendingQuestion: null,
    lastAssistantQuestion: null,
    pendingInteractions: [],
    nextPendingInteractionId: 1,
    pendingReservationConfirmationKey: null,
    confirmedReservationKey: null,
    spellingCandidate: null,
    nameCollection: createNameCollection(),
    misunderstandingCount: 0,
    stalledTurns: 0,
    stallSignature: null,
    humanFallbackOffered: false,
    humanFallbackMode: null,
    lastDialogueGuard: null,
    closing: false,
  };
}

function interactionDomain(kind: PendingInteractionKind): PendingInteractionKind {
  return kind === 'partySizeConfirmation' ? 'partySize' : kind;
}

export function getActivePendingInteraction(
  session: Pick<CallSession, 'conversation'>,
): PendingInteraction | null {
  return (
    [...(session.conversation.pendingInteractions ?? [])]
      .reverse()
      .find((interaction) => interaction.status === 'active') ?? null
  );
}

function syncPendingInteractionProjection(session: Pick<CallSession, 'conversation'>): void {
  const interaction = getActivePendingInteraction(session);
  session.conversation.pendingQuestion =
    interaction && interaction.kind !== 'open' ? interaction.kind : null;
  session.conversation.lastAssistantQuestion = interaction?.prompt ?? null;
  session.conversation.humanFallbackOffered = interaction?.kind === 'humanFallback';
  session.conversation.humanFallbackMode =
    interaction?.kind === 'humanFallback' ? (interaction.fallbackMode ?? null) : null;
}

/** Ouvre ou actualise une interaction en conservant l'historique de son cycle de vie. */
export function activatePendingInteraction(
  session: CallSession,
  kind: PendingInteractionKind,
  prompt: string,
  details: { fallbackMode?: Exclude<HumanFallbackMode, null>; candidatePartySize?: number } = {},
): PendingInteraction {
  const { pendingInteractions } = session.conversation;
  const active = getActivePendingInteraction(session);
  const qualityKind = voiceQualityKindForInteraction(kind);
  if (qualityKind) {
    const repeated = voiceQualityKindForInteraction(active?.kind) === qualityKind;
    recordVoiceQuestionForTurn(
      session,
      qualityKind,
      isExpectedAnswerEnabled(session) ? 'flag_on' : 'flag_off',
      repeated,
    );
  }
  if (active?.kind === kind) {
    active.prompt = prompt;
    active.resumePolicy = null;
    active.intentContext = session.conversation.intent;
    active.fallbackMode = details.fallbackMode;
    active.candidatePartySize = details.candidatePartySize;
    syncPendingInteractionProjection(session);
    return active;
  }
  if (active) active.status = 'cancelled';

  const resumable = [...pendingInteractions]
    .reverse()
    .find(
      (interaction) =>
        interaction.status === 'suspended' &&
        interaction.resumePolicy === 'resume_after_child' &&
        interaction.kind === kind,
    );
  if (resumable) {
    resumable.status = 'active';
    resumable.prompt = prompt;
    resumable.resumePolicy = null;
    resumable.fallbackMode = details.fallbackMode;
    resumable.candidatePartySize = details.candidatePartySize;
    for (const interaction of pendingInteractions) {
      if (
        interaction !== resumable &&
        interaction.status === 'suspended' &&
        interaction.resumePolicy === 'discard_on_detour'
      ) {
        interaction.status = 'cancelled';
      }
    }
    syncPendingInteractionProjection(session);
    return resumable;
  }

  for (const interaction of pendingInteractions) {
    if (interaction.status !== 'suspended') continue;
    if (
      interaction.resumePolicy === 'discard_on_detour' ||
      interactionDomain(interaction.kind) === interactionDomain(kind)
    ) {
      interaction.status = 'cancelled';
    }
  }

  const interaction: PendingInteraction = {
    id: session.conversation.nextPendingInteractionId++,
    kind,
    prompt,
    status: 'active',
    resumePolicy: null,
    intentContext: session.conversation.intent,
    ...details,
  };
  pendingInteractions.push(interaction);
  // Keep a bounded per-call trace while retaining recent terminal states.
  if (pendingInteractions.length > 64)
    pendingInteractions.splice(0, pendingInteractions.length - 64);
  syncPendingInteractionProjection(session);
  return interaction;
}

function voiceQualityKindForInteraction(
  kind: PendingInteractionKind | null | undefined,
): VoiceQualityKind | null {
  if (kind === 'partySize' || kind === 'partySizeConfirmation') return 'party_size';
  if (kind === 'date') return 'date';
  if (kind === 'time' || kind === 'timeChoice') return 'time';
  return null;
}

/** Suspend une question pendant une digression, en définissant si elle peut reprendre. */
export function suspendPendingInteractionForDetour(
  session: CallSession,
  transcript: string,
): boolean {
  const interaction = getActivePendingInteraction(session);
  if (!interaction || !isExploratoryUtterance(transcript)) return false;
  if (
    interaction.kind === 'humanFallback' &&
    (isAffirmativeShortResponse(transcript) ||
      isNegativeShortResponse(transcript) ||
      isHumanFallbackDecline(transcript) ||
      explicitlySelectsTransfer(transcript) ||
      explicitlySelectsMessage(transcript))
  ) {
    return false;
  }
  if (
    (interaction.kind === 'partySize' &&
      (extractConversationSlots(transcript, session.timezone ?? 'Europe/Paris').partySize !==
        undefined ||
        extractContextualPartySize(transcript) !== null)) ||
    (interaction.kind === 'partySizeConfirmation' &&
      (isAffirmativeShortResponse(transcript) || extractContextualPartySize(transcript) !== null))
  ) {
    return false;
  }

  interaction.status = 'suspended';
  interaction.resumePolicy =
    interaction.kind === 'humanFallback' ? 'discard_on_detour' : 'resume_after_child';
  syncPendingInteractionProjection(session);
  return true;
}

/** Termine l'interaction active et reprend, si possible, une interaction suspendue. */
export function finishActivePendingInteraction(
  session: Pick<CallSession, 'conversation'>,
  status: Extract<PendingInteractionStatus, 'resolved' | 'cancelled'>,
  fulfilledDomain?: PendingInteractionKind,
): void {
  const active = getActivePendingInteraction(session);
  if (active) active.status = status;
  if (fulfilledDomain) {
    for (const interaction of session.conversation.pendingInteractions) {
      if (
        interaction.status === 'suspended' &&
        interactionDomain(interaction.kind) === interactionDomain(fulfilledDomain)
      ) {
        interaction.status = 'cancelled';
      }
    }
  }
  if (status === 'resolved') {
    const resumable = [...session.conversation.pendingInteractions]
      .reverse()
      .find(
        (interaction) =>
          interaction.status === 'suspended' && interaction.resumePolicy === 'resume_after_child',
      );
    if (resumable) {
      resumable.status = 'active';
      resumable.resumePolicy = null;
    }
  }
  syncPendingInteractionProjection(session);
}

function cancelAllPendingInteractions(session: CallSession): void {
  for (const interaction of session.conversation.pendingInteractions) {
    if (interaction.status === 'active' || interaction.status === 'suspended') {
      interaction.status = 'cancelled';
    }
  }
  syncPendingInteractionProjection(session);
}

function cancelPendingInteractionsByKind(session: CallSession, kind: PendingInteractionKind): void {
  const active = getActivePendingInteraction(session);
  for (const interaction of session.conversation.pendingInteractions) {
    if (
      interaction.kind === kind &&
      (interaction.status === 'active' || interaction.status === 'suspended')
    ) {
      interaction.status = 'cancelled';
    }
  }
  if (active?.kind === kind) resumeSuspendedPendingInteraction(session);
  else syncPendingInteractionProjection(session);
}

function resumeSuspendedPendingInteraction(session: CallSession): void {
  if (getActivePendingInteraction(session)) return;
  const resumable = [...session.conversation.pendingInteractions]
    .reverse()
    .find(
      (interaction) =>
        interaction.status === 'suspended' && interaction.resumePolicy === 'resume_after_child',
    );
  for (const interaction of session.conversation.pendingInteractions) {
    if (interaction.status === 'suspended' && interaction.resumePolicy === 'discard_on_detour') {
      interaction.status = 'cancelled';
    }
  }
  if (resumable) {
    resumable.status = 'active';
    resumable.resumePolicy = null;
  }
  syncPendingInteractionProjection(session);
}

function normalizeTranscript(value: string): string {
  return value
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[’']/gu, ' ')
    .replace(/[^\p{L}\p{N}:\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Identifiant stable du brouillon de réservation actuellement en mémoire.
 * L'accord de l'appelant est lié à toutes les valeurs du récapitulatif,
 * y compris le nom : une correction rend donc automatiquement l'accord
 * précédent inutilisable.
 */
export function getReservationConfirmationKey(
  session: Pick<CallSession, 'conversation'>,
): string | null {
  const { slots, nameCollection } = session.conversation;
  const customerName = nameCollection?.confirmedName ?? slots.customerName;
  if (!slots.date || !slots.time || !slots.partySize || !customerName) return null;

  const normalizedName = normalizeTranscript(customerName);
  if (!normalizedName) return null;
  return `${slots.date}:${slots.time}:${slots.partySize}:${normalizedName}`;
}

/** Invalide l'accord de réservation dès que le brouillon n'est plus identique. */
export function clearReservationConfirmation(session: Pick<CallSession, 'conversation'>): void {
  session.conversation.pendingReservationConfirmationKey = null;
  session.conversation.confirmedReservationKey = null;
  if (session.conversation.pendingQuestion === 'confirmation') {
    finishActivePendingInteraction(session, 'cancelled');
  }
}

/**
 * Transforme un « oui » donné au dernier récapitulatif en autorisation
 * consommable par le manager. Aucun autre « oui » ne peut créer la réservation.
 */
export function confirmReservationDraft(session: Pick<CallSession, 'conversation'>): boolean {
  const currentKey = getReservationConfirmationKey(session);
  if (!currentKey || session.conversation.pendingReservationConfirmationKey !== currentKey) {
    clearReservationConfirmation(session);
    return false;
  }

  session.conversation.confirmedReservationKey = currentKey;
  session.conversation.pendingReservationConfirmationKey = null;
  const confirmation = getActivePendingInteraction(session);
  if (confirmation?.kind === 'confirmation') confirmation.status = 'resolved';
  for (const interaction of session.conversation.pendingInteractions) {
    if (interaction.status === 'suspended') interaction.status = 'cancelled';
  }
  syncPendingInteractionProjection(session);
  return true;
}

/**
 * Marqueurs utilisés par l'appelant pour remplacer une valeur déjà énoncée.
 * Le dernier marqueur gagne : « 19 h 30, non plutôt 20 h 30 » doit donc être
 * analysé à partir de « 20 h 30 », jamais à partir de la première heure.
 */
const CORRECTION_MARKER_PATTERN =
  /\b(?:non(?:\s+plutot)?|plutot|en fait|je voulais dire|je prefere|finalement)\b/gu;

function extractCorrectionTail(normalized: string): string {
  let lastMatch: RegExpMatchArray | null = null;
  for (const match of normalized.matchAll(CORRECTION_MARKER_PATTERN)) lastMatch = match;
  if (!lastMatch || lastMatch.index === undefined) return normalized;

  const tail = normalized.slice(lastMatch.index + lastMatch[0].length).trim();
  return tail || normalized;
}

function containsCorrectionMarker(normalized: string): boolean {
  return extractCorrectionTail(normalized) !== normalized;
}

interface LexicalToken {
  text: string;
  punctuation: boolean;
}

function tokenizeSpellingTranscript(value: string): LexicalToken[] {
  return (value.match(/\p{L}+|\p{N}+|[-,:;.!?]/gu) ?? []).map((text) => ({
    text,
    punctuation: /^[\-,:;.!?]$/u.test(text),
  }));
}

/**
 * Tokens que Scribe peut produire quand l'appelant épelle un nom en français.
 * Les mots phonétiques ne sont interprétés comme des lettres que dans un
 * contexte qui ressemble réellement à une épellation.
 */
const SPOKEN_LETTER_TOKENS: Record<string, string> = {
  a: 'A',
  be: 'B',
  b: 'B',
  ce: 'C',
  c: 'C',
  de: 'D',
  d: 'D',
  e: 'E',
  f: 'F',
  efe: 'F',
  ef: 'F',
  eff: 'F',
  effe: 'F',
  ge: 'G',
  g: 'G',
  ache: 'H',
  h: 'H',
  i: 'I',
  j: 'J',
  ji: 'J',
  dji: 'J',
  ka: 'K',
  k: 'K',
  elle: 'L',
  l: 'L',
  emme: 'M',
  m: 'M',
  enne: 'N',
  n: 'N',
  o: 'O',
  p: 'P',
  pe: 'P',
  ku: 'Q',
  q: 'Q',
  erre: 'R',
  r: 'R',
  esse: 'S',
  s: 'S',
  te: 'T',
  t: 'T',
  u: 'U',
  ve: 'V',
  v: 'V',
  w: 'W',
  x: 'X',
  ix: 'X',
  y: 'Y',
  zede: 'Z',
  z: 'Z',
  // Prononciations anglaises fréquemment produites par Scribe.
  ay: 'A',
  bee: 'B',
  see: 'C',
  dee: 'D',
  ee: 'E',
  gee: 'G',
  aitch: 'H',
  eye: 'I',
  jay: 'J',
  kay: 'K',
  ell: 'L',
  el: 'L',
  em: 'M',
  en: 'N',
  oh: 'O',
  owe: 'O',
  pee: 'P',
  cue: 'Q',
  ar: 'R',
  are: 'R',
  ess: 'S',
  tee: 'T',
  you: 'U',
  vee: 'V',
  doubleyou: 'W',
  ex: 'X',
  why: 'Y',
  zee: 'Z',
  zed: 'Z',
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
  'comme',
  'and',
  'then',
  'next',
  'please',
  'uh',
  'um',
  'oui',
  'alors',
  'voila',
  'ben',
  'hein',
  'bon',
  'ok',
  'donc',
]);

const NAME_INTRODUCTION_PATTERN =
  /\b(?:au nom de|un nom de|(?:en|un) nombre de actifs?|nom de|mon nom est|mon nom|je m appelle|je suis|my name is|the name is|under the name of|this is)\b/u;
const SPELLING_INTRODUCTION_PATTERN =
  /\b(?:epel(?:er|e|ez|ant)?|epell(?:er|e|ez|ant)?|lettres?(?: par lettre)?|alphabet|spell(?:ing|ed)?|letter by letter)\b/u;
const FULL_RESTART_MARKER_PATTERN =
  /\b(?:je recommence|je reprends|je vous redonne|je vais vous redonner|let me start again|i will spell it again|my name is|under the name of)\b/u;
const CONTINUATION_MARKER_PATTERN =
  /\b(?:la suite|le reste|continue(?:r|z)?|the rest|continuing|next)\b/u;
/**
 * Scribe peut placer « non » ou « pardon » devant une nouvelle épellation.
 * Retirer uniquement ce préfixe permet de reconnaître la correction sans
 * transformer une phrase ordinaire contenant « non » en suite de lettres.
 */
const SPELLING_CORRECTION_PREFIX_PATTERN =
  /^(?:non|pardon|excusez|en fait|je me suis trompe|je voulais dire|j ai dit|no|sorry|actually|i meant|i said)\s+/u;

export interface SpelledNameCandidate {
  /** Lettres normalisées, par exemple `KIF` ou `DUPONT`. */
  value: string;
  /** Vrai lorsque chaque token utile est une lettre sans bruit inconnu. */
  confident: boolean;
}

export interface DetailedSpelledNameCandidate extends SpelledNameCandidate {
  /** Candidat avec des `?` aux positions que le transcript ne permet pas d'identifier. */
  partialCandidate: string;
  tokens: SpellingToken[];
  ambiguousPositions: number[];
  hasExplicitSpellingCue: boolean;
  hasNameIntroduction: boolean;
  /** Un court segment de lettres sans marqueur, susceptible d'être continué. */
  isFragment: boolean;
}

function tokenToSpokenLetter(token: string, allowPhoneticWords = true): string | null {
  if (/^[a-z]$/u.test(token)) return SPOKEN_LETTER_TOKENS[token] ?? token.toUpperCase();
  return allowPhoneticWords ? (SPOKEN_LETTER_TOKENS[token] ?? null) : null;
}

function isSpokenSeparator(token: string): string | null {
  if (token === 'tiret') return '-';
  if (token === 'apostrophe') return "'";
  if (token === 'espace') return ' ';
  return null;
}

function isSpellingFiller(token: string): boolean {
  return SPELLING_FILLER_TOKENS.has(token);
}

function parseLetterAt(
  tokens: LexicalToken[],
  index: number,
  allowPhoneticWords: boolean,
): { value: string; nextIndex: number } | null {
  const token = tokens[index]?.text;
  if (!token || tokens[index]?.punctuation) return null;

  if (token === 'i' && tokens[index + 1]?.text === 'grec') {
    return { value: 'Y', nextIndex: index + 2 };
  }

  const value = tokenToSpokenLetter(token, allowPhoneticWords);
  return value ? { value, nextIndex: index + 1 } : null;
}

function parseSeparatorAt(
  tokens: LexicalToken[],
  index: number,
): { value: string; nextIndex: number } | null {
  const token = tokens[index]?.text;
  if (!token || tokens[index]?.punctuation) return null;

  if (token === 'trait' && tokens[index + 1]?.text === 'd' && tokens[index + 2]?.text === 'union') {
    return { value: '-', nextIndex: index + 3 };
  }
  if (token === 'trait' && tokens[index + 1]?.text === 'union') {
    return { value: '-', nextIndex: index + 2 };
  }

  const value = isSpokenSeparator(token);
  return value === null ? null : { value, nextIndex: index + 1 };
}

function hasWord(tokens: LexicalToken[], word: string): boolean {
  return tokens.some((token) => !token.punctuation && token.text === word);
}

function countLikelyLetters(tokens: LexicalToken[], allowPhoneticWords: boolean): number {
  let count = 0;
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].punctuation) continue;
    if (parseLetterAt(tokens, index, allowPhoneticWords)) count++;
    else if (parseSeparatorAt(tokens, index)) count++;
  }
  return count;
}

function isBareSpellingSequence(tokens: LexicalToken[]): boolean {
  const words = tokens.filter((token) => !token.punctuation);
  if (words.length < 2 || words.length > 14) return false;

  return words.every((token, index) => {
    if (isSpellingFiller(token.text) || token.text === 'grec') return true;
    if (/^[a-z]$/u.test(token.text)) return true;
    if (token.text === 'double' || token.text === 'deux' || token.text === '2') {
      return Boolean(words[index + 1]) && !words[index + 1].punctuation;
    }
    return Boolean(SPOKEN_LETTER_TOKENS[token.text] || isSpokenSeparator(token.text));
  });
}

function lastMarkerEnd(normalized: string, markers: Array<RegExpMatchArray | null>): number {
  return markers
    .filter((marker): marker is RegExpMatchArray => Boolean(marker))
    .reduce((end, marker) => Math.max(end, (marker.index ?? 0) + marker[0].length), 0);
}

function addSpellingToken(
  output: SpellingToken[],
  parts: string[],
  raw: string,
  value: string | null,
  kind: SpellingToken['kind'],
  letterPosition: { value: number },
): void {
  const position = letterPosition.value;
  output.push({ position, raw, value, kind });
  if (kind === 'letter') {
    parts.push(value ?? '?');
    letterPosition.value++;
  } else if (kind === 'separator') {
    parts.push(value ?? '');
  } else {
    parts.push('?');
    letterPosition.value++;
  }
}

function findNextComparatorStart(
  tokens: LexicalToken[],
  start: number,
  allowPhoneticWords: boolean,
): number {
  let seenExampleToken = false;
  for (let index = start; index < tokens.length; index++) {
    if (tokens[index].punctuation) return index + 1;
    const letter = parseLetterAt(tokens, index, allowPhoneticWords);
    if (letter && (tokens[letter.nextIndex]?.text === 'comme' || seenExampleToken)) {
      return index;
    }
    seenExampleToken = true;
  }
  return tokens.length;
}

/**
 * Parse une épellation sans utiliser de correction orthographique ou de nom
 * probable. La forme détaillée conserve chaque zone inconnue et sa position ;
 * le wrapper historique garde uniquement `value` et `confident`.
 */
export function parseSpelledNameTranscriptDetailed(
  transcript: string,
): DetailedSpelledNameCandidate | null {
  const normalized = normalizeTranscript(transcript);
  if (!normalized) return null;

  // Une correction courte (« Non, A D K I F ») reste une épellation. Le
  // préfixe est ignoré uniquement en tête ; « je ne sais pas, non… » reste
  // donc une phrase ordinaire et ne passe pas dans ce parseur.
  const spellingInput = normalized.replace(SPELLING_CORRECTION_PREFIX_PATTERN, '');
  const nameIntroductionMatch = spellingInput.match(NAME_INTRODUCTION_PATTERN);
  const spellingIntroductionMatch = spellingInput.match(SPELLING_INTRODUCTION_PATTERN);
  const fullRestartMarkerMatch = spellingInput.match(FULL_RESTART_MARKER_PATTERN);
  const continuationMarkerMatch = spellingInput.match(CONTINUATION_MARKER_PATTERN);
  const hasNameIntroduction = Boolean(nameIntroductionMatch);
  const lexicalTranscript = tokenizeSpellingTranscript(spellingInput);
  const hasExplicitSpellingCue =
    Boolean(spellingIntroductionMatch) ||
    hasWord(lexicalTranscript, 'comme') ||
    hasWord(lexicalTranscript, 'tiret') ||
    hasWord(lexicalTranscript, 'apostrophe') ||
    hasWord(lexicalTranscript, 'espace') ||
    hasWord(lexicalTranscript, 'trait');

  const markerEnd = lastMarkerEnd(spellingInput, [
    nameIntroductionMatch,
    spellingIntroductionMatch,
    fullRestartMarkerMatch,
    continuationMarkerMatch,
  ]);
  const tail = markerEnd > 0 ? spellingInput.slice(markerEnd).trim() : spellingInput;
  const tokens = tokenizeSpellingTranscript(tail);
  if (!tokens.length) return null;

  const comparatorCue = hasWord(tokens, 'comme');
  const likelyBareSequence = isBareSpellingSequence(tokens);
  const allowPhoneticWords =
    hasExplicitSpellingCue ||
    likelyBareSequence ||
    (hasNameIntroduction && countLikelyLetters(tokens, true) >= 2);

  const output: SpellingToken[] = [];
  const parts: string[] = [];
  let unknownTokenCount = 0;
  let knownLetterCount = 0;
  const letterPosition = { value: 0 };

  for (let index = 0; index < tokens.length; ) {
    const lexical = tokens[index];
    if (lexical.punctuation || isSpellingFiller(lexical.text)) {
      index++;
      continue;
    }

    if (lexical.text === 'i' && tokens[index + 1]?.text === 'grec') {
      addSpellingToken(output, parts, 'i grec', 'Y', 'letter', letterPosition);
      knownLetterCount++;
      index += 2;
      continue;
    }

    if (
      (lexical.text === 'double' || lexical.text === 'deux' || lexical.text === '2') &&
      !tokens[index + 1]?.punctuation
    ) {
      const doubled = parseLetterAt(tokens, index + 1, allowPhoneticWords);
      if (doubled) {
        const raw = lexical.text + ' ' + tokens[index + 1].text;
        if (
          (doubled.value === 'V' &&
            (tokens[index + 1].text === 've' || tokens[index + 1].text === 'v')) ||
          (doubled.value === 'U' && tokens[index + 1].text === 'u')
        ) {
          addSpellingToken(output, parts, raw, 'W', 'letter', letterPosition);
          knownLetterCount++;
        } else {
          const overlapsPreviousLetter =
            output.at(-1)?.kind === 'letter' && output.at(-1)?.value === doubled.value;
          if (overlapsPreviousLetter) {
            addSpellingToken(output, parts, raw, doubled.value, 'letter', letterPosition);
            knownLetterCount++;
          } else {
            addSpellingToken(output, parts, raw, doubled.value, 'letter', letterPosition);
            addSpellingToken(output, parts, raw, doubled.value, 'letter', letterPosition);
            knownLetterCount += 2;
          }
        }
        index = doubled.nextIndex;
        continue;
      }
      unknownTokenCount++;
      addSpellingToken(output, parts, lexical.text, null, 'ambiguous', letterPosition);
      index++;
      continue;
    }

    const separator = parseSeparatorAt(tokens, index);
    if (separator) {
      addSpellingToken(output, parts, lexical.text, separator.value, 'separator', letterPosition);
      index = separator.nextIndex;
      continue;
    }

    const letter = parseLetterAt(tokens, index, allowPhoneticWords);
    if (letter) {
      addSpellingToken(output, parts, lexical.text, letter.value, 'letter', letterPosition);
      knownLetterCount++;

      if (tokens[letter.nextIndex]?.text === 'comme') {
        index = findNextComparatorStart(tokens, letter.nextIndex + 1, allowPhoneticWords);
      } else {
        index = letter.nextIndex;
      }
      continue;
    }

    if (lexical.text === 'grec') {
      index++;
      continue;
    }

    unknownTokenCount++;
    addSpellingToken(output, parts, lexical.text, null, 'ambiguous', letterPosition);
    index++;
  }

  const value = output
    .filter((token) => token.kind !== 'ambiguous')
    .map((token) => token.value ?? '')
    .join('');
  const partialCandidate = parts.join('');
  const ambiguousPositions = output
    .filter((token) => token.kind === 'ambiguous')
    .map((token) => token.position);
  const meaningfulTokenCount = output.length;
  const minimumLetters = spellingIntroductionMatch || comparatorCue ? 1 : 2;

  if (knownLetterCount < minimumLetters || value.length > 64) return null;

  const hasNoUnknowns = unknownTokenCount === 0;
  const shortLetterSequence =
    !hasNameIntroduction &&
    !spellingIntroductionMatch &&
    !comparatorCue &&
    hasNoUnknowns &&
    meaningfulTokenCount <= knownLetterCount + 2;

  if (
    !hasNameIntroduction &&
    !spellingIntroductionMatch &&
    !comparatorCue &&
    !shortLetterSequence
  ) {
    return null;
  }

  // Un mot ordinaire avec un seul artefact reconnu n'est pas une épellation.
  // Une introduction de nom n'autorise le bruit que s'il reste plusieurs lettres
  // réellement comprises ; le bruit est conservé, jamais corrigé par hypothèse.
  if (
    unknownTokenCount > 0 &&
    !spellingIntroductionMatch &&
    !comparatorCue &&
    (!hasNameIntroduction || knownLetterCount < 3)
  ) {
    return null;
  }

  if (unknownTokenCount > 0 && knownLetterCount < 3) return null;

  return {
    value,
    confident: hasNoUnknowns,
    partialCandidate,
    tokens: output,
    ambiguousPositions,
    hasExplicitSpellingCue,
    hasNameIntroduction,
    isFragment:
      !hasNameIntroduction &&
      !spellingIntroductionMatch &&
      !comparatorCue &&
      knownLetterCount <= 2 &&
      hasNoUnknowns,
  };
}

/** Wrapper de compatibilité avec la PR #116. */
export function parseSpelledNameTranscript(transcript: string): SpelledNameCandidate | null {
  const parsed = parseSpelledNameTranscriptDetailed(transcript);
  if (!parsed) return null;
  return { value: parsed.value, confident: parsed.confident };
}

/**
 * Scribe peut conserver des mots de reprise avant la vraie épellation :
 * « Non, non, attendez… A deux K I F ». Le parseur principal reste strict
 * pour ne pas transformer une phrase ordinaire en nom ; dans un contexte de
 * collecte de nom, on essaie donc uniquement les suffixes qui forment une
 * épellation complète et sans ambiguïté.
 */
function parseTrailingSpellingTranscript(
  transcript: string,
  allowAsrNoisePrefix = false,
): DetailedSpelledNameCandidate | null {
  const normalized = normalizeTranscript(transcript);
  const words = normalized.split(/\s+/u).filter(Boolean);
  if (words.length < 3) return null;

  for (let start = 0; start <= words.length - 2; start++) {
    const suffix = words.slice(start).join(' ');
    const parsed = parseSpelledNameTranscriptDetailed(suffix);
    if (!parsed || !parsed.confident || parsed.value.length < 2) continue;

    // Un suffixe est accepté seulement si le préfixe ressemble à une reprise
    // ou à une correction. Cela évite de lire « à la carte » comme « A-K ».
    const prefix = words.slice(0, start).join(' ');
    const prefixWords = prefix.split(/\s+/u).filter(Boolean);
    const isKnownRestartPrefix =
      !prefix ||
      /\b(?:non|pardon|excusez|attends?|attendez|reprends?|recommence|redonne|en fait|je voulais dire|j ai dit|lettres?|epelle)/u.test(
        prefix,
      );
    // Après une première clarification, Scribe peut laisser un seul mot
    // parasite devant la reprise (« Attif, A B K I F »). On ne l'ignore que
    // dans ce contexte dédié, avec au moins trois lettres fiables, afin de ne
    // pas transformer une phrase ordinaire en épellation.
    const isShortAsrNoisePrefix =
      allowAsrNoisePrefix &&
      prefixWords.length === 1 &&
      parsed.value.length >= 3 &&
      !/^(?:je|vous|pour|nom|mon|le|la|un|une|de|au|est|suis|c est)$/u.test(prefix);
    if (prefix && !isKnownRestartPrefix && !isShortAsrNoisePrefix) {
      continue;
    }
    return parsed;
  }

  return null;
}

function createTokensFromValue(value: string): SpellingToken[] {
  const tokens: SpellingToken[] = [];
  let position = 0;
  for (const character of Array.from(value)) {
    const isLetter = /^[A-Z]$/u.test(character);
    tokens.push({
      position,
      raw: character,
      value: character,
      kind: isLetter ? 'letter' : 'separator',
    });
    if (isLetter) position++;
  }
  return tokens;
}

function ensureNameCollection(session: CallSession): NameCollection {
  const conversation = session.conversation;
  if (!conversation.nameCollection) conversation.nameCollection = createNameCollection();

  const collection = conversation.nameCollection;
  if (conversation.spellingCandidate && collection.state === 'idle') {
    collection.state = 'confirming';
    collection.presentedCandidate = conversation.spellingCandidate;
    collection.partialCandidate = conversation.spellingCandidate;
    collection.tokens = createTokensFromValue(conversation.spellingCandidate);
  }
  collection.awaitingCorrection ??= false;
  collection.fallbackRecorded ??= false;
  return collection;
}

function rebuildNameCollection(collection: NameCollection): void {
  collection.partialCandidate = collection.tokens
    .map((token) => (token.kind === 'ambiguous' ? '?' : (token.value ?? '')))
    .join('');
  collection.ambiguousPositions = collection.tokens
    .filter((token) => token.kind === 'ambiguous')
    .map((token) => token.position);
}

function knownCandidate(collection: NameCollection): string {
  return collection.tokens
    .filter((token) => token.kind !== 'ambiguous')
    .map((token) => token.value ?? '')
    .join('');
}

function syncLegacySpellingCandidate(session: CallSession): void {
  const collection = ensureNameCollection(session);
  session.conversation.spellingCandidate =
    collection.state === 'confirming' ? collection.presentedCandidate : null;
}

export function isNameCollectionBlocking(session: CallSession): boolean {
  const collection = session.conversation?.nameCollection;
  if (
    collection &&
    (collection.state === 'collecting' ||
      collection.state === 'clarifying' ||
      collection.state === 'confirming')
  ) {
    return true;
  }
  return Boolean(session.conversation?.spellingCandidate);
}

export function isNameCollectionActive(session: CallSession): boolean {
  const collection = session.conversation?.nameCollection;
  return Boolean(
    session.conversation?.spellingCandidate || (collection && collection.state !== 'idle'),
  );
}

/** Termine la collecte après le fallback humain sans laisser une question de nom pendante. */
export function resetNameCollectionAfterFallback(session: CallSession): void {
  const collection = ensureNameCollection(session);
  collection.state = 'idle';
  collection.partialCandidate = '';
  collection.tokens = [];
  collection.ambiguousPositions = [];
  collection.clarificationCount = 0;
  collection.awaitingCorrection = false;
  collection.presentedCandidate = null;
  collection.confirmedName = null;
  collection.fallbackRecorded = true;
  session.conversation.spellingCandidate = null;
  cancelPendingInteractionsByKind(session, 'customerName');
  session.conversation.slots.customerName = undefined;
}

function nameQuestionContext(session: CallSession): boolean {
  const { conversation } = session;
  return (
    conversation.pendingQuestion === 'customerName' ||
    isNameCollectionBlocking(session) ||
    ((conversation.intent === 'reservation' || conversation.intent === 'availability') &&
      !conversation.slots.customerName &&
      Boolean(conversation.slots.date || conversation.slots.time || conversation.slots.partySize))
  );
}

function normalizeForDecision(value: string): string {
  return normalizeTranscript(value)
    .replace(/[-,:;.!?]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatCandidateForSpeech(value: string): string {
  return Array.from(value)
    .map((character) => {
      if (character === '?') return '?';
      if (character === '-') return 'tiret';
      if (character === "'") return 'apostrophe';
      if (character === ' ') return 'espace';
      return character;
    })
    .join('-');
}

function ordinalLabel(position: number, language: VoiceLanguageCode = 'fr'): string {
  if (language === 'en') {
    if (position === 0) return 'first';
    if (position === 1) return 'second';
    if (position === 2) return 'third';
    if (position === 3) return 'fourth';
    if (position === 4) return 'fifth';
    if (position === 5) return 'sixth';
    return `${position + 1}th`;
  }
  if (position === 0) return 'première';
  if (position === 1) return 'deuxième';
  if (position === 2) return 'troisième';
  if (position === 3) return 'quatrième';
  return position + 1 + 'e';
}

function ambiguityQuestion(collection: NameCollection, language: VoiceLanguageCode = 'fr'): string {
  const position = collection.ambiguousPositions[0] ?? 0;
  const partial = formatCandidateForSpeech(collection.partialCandidate);
  // Ne jamais vocaliser un « ? » ou une suite de lettres fabriquée à partir
  // d'un mot ASR inconnu (« Aikif »). Demander une reprise claire est plus
  // naturel et évite d'orienter l'appelant vers une fausse orthographe.
  if (collection.partialCandidate.includes('?')) {
    return language === 'en'
      ? "I didn't quite catch the spelling. Could you spell the name again, please?"
      : "Je n'ai pas bien saisi l'orthographe. Pouvez-vous me redonner le nom lettre par lettre, s'il vous plaît ?";
  }
  if (language === 'en') {
    return `I heard ${partial}. What is the ${ordinalLabel(position, language)} letter, please?`;
  }
  return (
    "J'ai compris " +
    partial +
    '. Quelle est la ' +
    ordinalLabel(position) +
    " lettre, s'il vous plaît ?"
  );
}

function completeCandidateResponse(
  collection: NameCollection,
  language: VoiceLanguageCode = 'fr',
): string {
  const candidate = formatCandidateForSpeech(knownCandidate(collection));
  return language === 'en' ? `${candidate}, is that correct?` : `${candidate}, c'est bien cela ?`;
}

function partialCandidateResponse(
  collection: NameCollection,
  language: VoiceLanguageCode = 'fr',
): string {
  if (language === 'en') {
    return `I have ${formatCandidateForSpeech(collection.partialCandidate)} so far. You can continue, or tell me if that is the full name.`;
  }
  return (
    "J'ai noté " +
    formatCandidateForSpeech(collection.partialCandidate) +
    " pour l'instant. Vous pouvez continuer, ou me dire si c'est tout le nom."
  );
}

function isNameConfirmation(transcript: string): boolean {
  const normalized = normalizeForDecision(transcript);
  return /^(?:oui|ouais|ok(?:ay)?|d accord|bien sur|exactement|tout a fait|c est ca|c est bien ca|voila|yes|yeah|yep|that is correct|that s right|correct|right)(?: (?:c est ca|c est bien ca|exactement|voila|that s right))?$/u.test(
    normalized,
  );
}

function isNameRejection(transcript: string): boolean {
  const normalized = normalizeForDecision(transcript);
  return /^(?:non|pas du tout|ce n est pas ca|ce n est pas le bon nom|j ai dit non|no|not at all|that s not right|that is not correct|wrong)$/u.test(
    normalized,
  );
}

function hasFullRestartCue(transcript: string): boolean {
  const normalized = normalizeForDecision(transcript);
  return /\b(?:je recommence|je vous redonne|je vais vous redonner|je reprends|mon nom est|au nom de|je m appelle|j ai dit|let me start again|i will spell it again|my name is|under the name of|i said)\b/u.test(
    normalized,
  );
}

function hasContinuationCue(transcript: string): boolean {
  const normalized = normalizeForDecision(transcript);
  return /\b(?:puis|ensuite|la suite|et apres|continue|continuer|le reste|apres|the rest|continuing|next|then)\b/u.test(
    normalized,
  );
}

function correctionOrdinal(transcript: string): number | null {
  const normalized = normalizeForDecision(transcript);
  const ordinals: Array<[RegExp, number]> = [
    [/\b(?:premiere|1ere|1re|1e)\b/u, 0],
    [/\b(?:deuxieme|2e|2eme)\b/u, 1],
    [/\b(?:troisieme|3e|3eme)\b/u, 2],
    [/\b(?:quatrieme|4e|4eme)\b/u, 3],
    [/\b(?:cinquieme|5e|5eme)\b/u, 4],
    [/\b(?:sixieme|6e|6eme)\b/u, 5],
  ];
  const match = ordinals.find(([pattern]) => pattern.test(normalized));
  if (!match || !/\b(?:lettre|letter)\b/u.test(normalized)) return null;
  return match[1];
}

function extractSingleSpokenLetter(transcript: string): string | null {
  const tokens = tokenizeSpellingTranscript(normalizeTranscript(transcript));
  const ignored = new Set([
    'non',
    'la',
    'le',
    'les',
    'lettre',
    'lettres',
    'est',
    'ce',
    'un',
    'une',
    'la',
    'bonne',
    'correcte',
    'correct',
    'sera',
    'the',
    'is',
    'correct',
    'right',
  ]);
  const values: string[] = [];
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].punctuation || ignored.has(tokens[index].text)) continue;
    if (tokens[index].text === 'c' && /^(?:est|etait|sera)$/u.test(tokens[index + 1]?.text ?? '')) {
      continue;
    }
    if (tokens[index].text === 'i' && tokens[index + 1]?.text === 'grec') {
      values.push('Y');
      index++;
      continue;
    }
    const parsed = parseLetterAt(tokens, index, true);
    if (parsed) {
      values.push(parsed.value);
      index = parsed.nextIndex - 1;
    }
  }
  return values.length === 1 ? values[0] : null;
}

/**
 * Vérifie que le transcript est réellement une lettre isolée, éventuellement
 * précédée de « la lettre ». `extractSingleSpokenLetter` reste volontairement
 * permissif pour les clarifications, mais cette forme stricte évite qu'un mot
 * reconnu au milieu d'une phrase ordinaire prolonge le nom.
 */
function isStandaloneSpokenLetter(transcript: string): boolean {
  const tokens = tokenizeSpellingTranscript(normalizeTranscript(transcript));
  const ignored = new Set([
    'non',
    'la',
    'le',
    'les',
    'lettre',
    'lettres',
    'est',
    'ce',
    'un',
    'une',
    'bonne',
    'correcte',
    'correct',
    'sera',
    'the',
    'is',
    'correct',
    'right',
  ]);
  const meaningful = tokens.filter((token) => !token.punctuation && !ignored.has(token.text));
  if (meaningful.length === 1) {
    return Boolean(tokenToSpokenLetter(meaningful[0].text));
  }
  return meaningful.length === 2 && meaningful[0].text === 'i' && meaningful[1].text === 'grec';
}

function resetNameCollectionAfterClosing(session: CallSession, collection: NameCollection): void {
  const confirmedName = collection.state === 'confirmed' ? collection.confirmedName : null;
  collection.state = confirmedName ? 'confirmed' : 'idle';
  collection.partialCandidate = confirmedName ? collection.partialCandidate : '';
  collection.tokens = confirmedName ? collection.tokens : [];
  collection.ambiguousPositions = confirmedName ? collection.ambiguousPositions : [];
  collection.clarificationCount = 0;
  collection.awaitingCorrection = false;
  collection.presentedCandidate = null;
  collection.confirmedName = confirmedName;
  session.conversation.spellingCandidate = null;
  cancelPendingInteractionsByKind(session, 'customerName');
  if (!confirmedName) session.conversation.slots.customerName = undefined;
}

function invalidateConfirmedName(session: CallSession): NameCollection {
  const collection = ensureNameCollection(session);
  if (collection.state === 'confirmed' || collection.confirmedName) {
    const preservedTokens = collection.tokens.length
      ? collection.tokens.map((token) => ({ ...token }))
      : collection.confirmedName
        ? createTokensFromValue(collection.confirmedName)
        : [];
    collection.state = 'collecting';
    collection.confirmedName = null;
    collection.presentedCandidate = null;
    // Une correction peut arriver après le « oui » de confirmation. Garder
    // les lettres permet de modifier ensuite une position ciblée au lieu de
    // laisser le candidat confirmé disparaître avec la correction vague.
    collection.tokens = preservedTokens;
    rebuildNameCollection(collection);
    collection.awaitingCorrection = false;
    collection.fallbackRecorded = false;
    session.conversation.slots.customerName = undefined;
  }
  session.conversation.spellingCandidate = null;
  return collection;
}

function mergeSpellingTokens(left: SpellingToken[], right: SpellingToken[]): SpellingToken[] {
  const offset = left.filter(
    (token) => token.kind === 'letter' || token.kind === 'ambiguous',
  ).length;
  return [
    ...left.map((token) => ({ ...token })),
    ...right.map((token) => ({
      ...token,
      position: token.position + offset,
    })),
  ];
}

function clarificationEscalation(language: VoiceLanguageCode = 'fr'): CustomerNameTurnResult {
  return {
    response:
      language === 'en'
        ? "I'll put you through to the manager to help you."
        : 'Je vais vous mettre en relation avec le gérant pour vous aider.',
    confirmedName: null,
    escalate: true,
  };
}

function correctionClarification(
  collection: NameCollection,
  language: VoiceLanguageCode = 'fr',
): CustomerNameTurnResult {
  collection.clarificationCount++;
  if (collection.clarificationCount >= 2) return clarificationEscalation(language);
  return {
    response:
      language === 'en'
        ? "I didn't understand the correction. Which letter would you like to change, please?"
        : "Je n'ai pas compris la correction. Quelle lettre souhaitez-vous modifier, s'il vous plaît ?",
    confirmedName: null,
  };
}

function hasUnrecognizedNameCorrectionCue(transcript: string): boolean {
  const normalized = normalizeForDecision(transcript);
  return (
    /^(?:non\b|pardon\b|excusez\b|en fait\b|je me suis trompe\b|j ai fait une erreur\b|je voulais dire\b|no\b|sorry\b|actually\b|i meant\b|i made a mistake\b)/u.test(
      normalized,
    ) ||
    /\b(?:lettre|epellation|orthographe|corriger|corrige|correction|rectifier|rectification|letter|spelling|spell|correct)\b/u.test(
      normalized,
    )
  );
}

function failedClarification(
  collection: NameCollection,
  language: VoiceLanguageCode = 'fr',
): CustomerNameTurnResult {
  collection.clarificationCount++;
  if (collection.clarificationCount >= 2) return clarificationEscalation(language);
  return { response: ambiguityQuestion(collection, language), confirmedName: null };
}

function fillFirstAmbiguousPosition(
  session: CallSession,
  collection: NameCollection,
  letter: string,
  language: VoiceLanguageCode = 'fr',
): CustomerNameTurnResult {
  const token = collection.tokens.find((candidate) => candidate.kind === 'ambiguous');
  if (!token) return { response: null, confirmedName: null };

  token.value = letter;
  token.kind = 'letter';
  token.raw = letter;
  collection.clarificationCount = 0;
  collection.awaitingCorrection = false;
  collection.fallbackRecorded = false;
  rebuildNameCollection(collection);
  if (collection.ambiguousPositions.length > 0) {
    collection.state = 'clarifying';
    collection.presentedCandidate = null;
    syncLegacySpellingCandidate(session);
    return { response: ambiguityQuestion(collection, language), confirmedName: null };
  }

  collection.state = 'confirming';
  collection.presentedCandidate = knownCandidate(collection);
  syncLegacySpellingCandidate(session);
  return { response: completeCandidateResponse(collection, language), confirmedName: null };
}

function appendIsolatedNameLetter(
  session: CallSession,
  collection: NameCollection,
  letter: string,
  language: VoiceLanguageCode = 'fr',
): CustomerNameTurnResult {
  const tokens = collection.tokens.length
    ? collection.tokens.map((token) => ({ ...token }))
    : createTokensFromValue(collection.presentedCandidate ?? '');
  const position = tokens.filter(
    (token) => token.kind === 'letter' || token.kind === 'ambiguous',
  ).length;
  tokens.push({ position, raw: letter, value: letter, kind: 'letter' });
  collection.tokens = tokens;
  collection.clarificationCount = 0;
  collection.awaitingCorrection = false;
  collection.fallbackRecorded = false;
  collection.confirmedName = null;
  rebuildNameCollection(collection);
  collection.state = 'confirming';
  collection.presentedCandidate = knownCandidate(collection);
  syncLegacySpellingCandidate(session);
  return { response: completeCandidateResponse(collection, language), confirmedName: null };
}

function applyTargetedCorrection(
  session: CallSession,
  transcript: string,
  language: VoiceLanguageCode = 'fr',
): CustomerNameTurnResult | null {
  const ordinal = correctionOrdinal(transcript);
  if (ordinal === null) return null;

  const collection = ensureNameCollection(session);
  if (!collection.tokens.length && collection.confirmedName) {
    collection.tokens = createTokensFromValue(collection.confirmedName);
  }
  if (!collection.tokens.length) return null;

  const letter = extractSingleSpokenLetter(transcript);
  if (!letter) return null;

  const letterTokens = collection.tokens.filter(
    (token) => token.kind === 'letter' || token.kind === 'ambiguous',
  );
  const target = letterTokens[ordinal];
  if (!target) return null;

  const tokensBeforeInvalidation = collection.tokens.map((token) => ({ ...token }));
  invalidateConfirmedName(session);
  // invalidateConfirmedName peut remettre le candidat à zéro ; il faut donc
  // reconstituer les tokens depuis la valeur connue si nécessaire.
  const rebuilt = ensureNameCollection(session);
  if (!rebuilt.tokens.length) {
    rebuilt.tokens = tokensBeforeInvalidation;
  }
  const targetAfterReset = rebuilt.tokens.filter(
    (token) => token.kind === 'letter' || token.kind === 'ambiguous',
  )[ordinal];
  if (!targetAfterReset) return null;

  targetAfterReset.value = letter;
  targetAfterReset.kind = 'letter';
  targetAfterReset.raw = letter;
  rebuilt.clarificationCount = 0;
  rebuilt.awaitingCorrection = false;
  rebuilt.fallbackRecorded = false;
  rebuildNameCollection(rebuilt);

  if (rebuilt.ambiguousPositions.length > 0) {
    rebuilt.state = 'clarifying';
    rebuilt.presentedCandidate = null;
    syncLegacySpellingCandidate(session);
    return { response: ambiguityQuestion(rebuilt, language), confirmedName: null };
  }

  rebuilt.state = 'confirming';
  rebuilt.presentedCandidate = knownCandidate(rebuilt);
  syncLegacySpellingCandidate(session);
  return { response: completeCandidateResponse(rebuilt, language), confirmedName: null };
}

export interface CustomerNameTurnResult {
  /** Réponse déterministe à prononcer, ou null pour laisser le LLM continuer. */
  response: string | null;
  /** Nom confirmé à injecter explicitement dans le tour LLM suivant. */
  confirmedName: string | null;
  /** Vrai lorsque le mécanisme métier de prise de message doit être appelé. */
  escalate?: boolean;
}

/**
 * Contrôle déterministe du nom : les fragments restent en mémoire, les zones
 * ambigües sont précisées et aucun `oui` ne confirme une valeur non présentée.
 */
export function handleCustomerNameTurn(
  session: CallSession,
  transcript: string,
): CustomerNameTurnResult {
  const language = effectiveVoiceLanguage(session);
  const collection = ensureNameCollection(session);
  const normalizedDecision = normalizeForDecision(transcript);
  if (!normalizedDecision) return { response: null, confirmedName: null };

  // Une clôture termine aussi une collecte de nom en cours. Sinon « non
  // merci » peut être interprété comme une correction incomprise, puis
  // atteindre le fallback humain après deux tours.
  if (session.conversation.closing || classifyVoiceSpeechAct(transcript) === 'closing') {
    resetNameCollectionAfterClosing(session, collection);
    return { response: null, confirmedName: null };
  }

  const targeted = applyTargetedCorrection(session, transcript, language);
  if (targeted) return targeted;

  const directParsed = parseSpelledNameTranscriptDetailed(transcript);
  const nameContext = nameQuestionContext(session) || isNameCollectionActive(session);
  const trailingParsed = nameContext
    ? parseTrailingSpellingTranscript(
        transcript,
        collection.state === 'clarifying' && !directParsed?.confident,
      )
    : null;
  // Une seconde tentative peut contenir un mot parasite au début ; une
  // épellation fiable sur son suffixe doit alors remplacer le premier
  // candidat ambigu, sans élargir ce comportement au premier tour.
  const parsed =
    trailingParsed?.confident && collection.state === 'clarifying'
      ? trailingParsed
      : (directParsed ?? trailingParsed);
  // Même si Scribe a perdu la question « quel nom ? », un « non, A D K I F »
  // est une correction explicite. Le traiter comme une épellation garde le
  // verrou métier actif et empêche le LLM de confirmer une valeur devinée.
  const explicitNameCorrection =
    Boolean(parsed?.value) && hasUnrecognizedNameCorrectionCue(transcript);
  const parsedBelongsToName =
    Boolean(parsed) &&
    (nameQuestionContext(session) ||
      Boolean(parsed?.hasExplicitSpellingCue) ||
      Boolean(parsed?.hasNameIntroduction) ||
      explicitNameCorrection ||
      Boolean(parsed?.isFragment && session.conversation.pendingQuestion === 'customerName'));

  // « Non » en réponse à une demande de lettre signifie que le candidat est
  // faux, y compris quand nous étions encore en clarification. Le traiter
  // comme une nouvelle épellation évite de répéter la même question ambiguë.
  if (
    isNameRejection(transcript) &&
    (collection.state === 'clarifying' ||
      collection.state === 'collecting' ||
      collection.state === 'confirming')
  ) {
    collection.state = 'collecting';
    collection.presentedCandidate = null;
    collection.confirmedName = null;
    collection.tokens = [];
    collection.partialCandidate = '';
    collection.ambiguousPositions = [];
    collection.clarificationCount = 0;
    collection.awaitingCorrection = false;
    collection.fallbackRecorded = false;
    session.conversation.spellingCandidate = null;
    return {
      response:
        language === 'en'
          ? 'All right. Could you spell your name again, slowly, please?'
          : "D'accord. Pouvez-vous me redonner votre nom, lettre par lettre, lentement ?",
      confirmedName: null,
    };
  }

  if (
    collection.state === 'confirming' &&
    collection.presentedCandidate &&
    isNameConfirmation(transcript)
  ) {
    const confirmedName = collection.presentedCandidate;
    collection.state = 'confirmed';
    collection.confirmedName = confirmedName;
    collection.presentedCandidate = null;
    collection.clarificationCount = 0;
    collection.awaitingCorrection = false;
    collection.fallbackRecorded = false;
    session.conversation.slots.customerName = confirmedName;
    session.conversation.spellingCandidate = null;
    if (getActivePendingInteraction(session)?.kind === 'customerName') {
      finishActivePendingInteraction(session, 'resolved', 'customerName');
    }
    return { response: null, confirmedName };
  }

  if (
    collection.state === 'confirming' &&
    collection.presentedCandidate &&
    isNameRejection(transcript)
  ) {
    collection.state = 'collecting';
    collection.presentedCandidate = null;
    collection.confirmedName = null;
    collection.tokens = [];
    collection.partialCandidate = '';
    collection.ambiguousPositions = [];
    collection.clarificationCount = 0;
    collection.awaitingCorrection = false;
    session.conversation.spellingCandidate = null;
    return {
      response:
        language === 'en'
          ? 'All right. Could you spell your name again, slowly, please?'
          : "D'accord. Pouvez-vous me redonner votre nom, lettre par lettre, lentement ?",
      confirmedName: null,
    };
  }

  // Une réponse de clarification peut elle-même utiliser la convention
  // « K comme Karim ». Elle ne doit pas remplacer tout le candidat conservé :
  // elle remplit uniquement la première position encore ambiguë.
  if (collection.state === 'clarifying' && parsedBelongsToName && !hasFullRestartCue(transcript)) {
    const singleLetter = extractSingleSpokenLetter(transcript);
    if (singleLetter)
      return fillFirstAmbiguousPosition(session, collection, singleLetter, language);
  }

  if (parsed && parsedBelongsToName) {
    const previousState = collection.state;
    const previousKnown = knownCandidate(collection);
    let nextTokens: SpellingToken[];
    const repeatsKnownPrefix =
      previousKnown.length > 0 &&
      parsed.value.startsWith(previousKnown) &&
      !hasContinuationCue(transcript);
    const shouldAppend =
      previousState === 'collecting' &&
      !hasFullRestartCue(transcript) &&
      !parsed.hasNameIntroduction &&
      !repeatsKnownPrefix &&
      previousKnown !== parsed.value;
    if (shouldAppend) {
      nextTokens = mergeSpellingTokens(collection.tokens, parsed.tokens);
    } else {
      nextTokens = parsed.tokens;
    }

    if (collection.state === 'confirmed' || collection.confirmedName) {
      invalidateConfirmedName(session);
    }

    collection.tokens = nextTokens.map((token) => ({ ...token }));
    collection.confirmedName = null;
    collection.presentedCandidate = null;
    collection.awaitingCorrection = false;
    collection.fallbackRecorded = false;
    rebuildNameCollection(collection);

    const incomingHasAmbiguity = parsed.ambiguousPositions.length > 0;
    const continuedAmbiguity = previousState === 'clarifying' && incomingHasAmbiguity;
    if (continuedAmbiguity) collection.clarificationCount++;

    if (collection.ambiguousPositions.length > 0) {
      collection.state = 'clarifying';
      syncLegacySpellingCandidate(session);
      if (collection.clarificationCount >= 2) {
        return clarificationEscalation(language);
      }
      return { response: ambiguityQuestion(collection, language), confirmedName: null };
    }

    collection.clarificationCount = 0;
    if (parsed.isFragment && nextTokens.length <= 2 && !parsed.hasExplicitSpellingCue) {
      collection.state = 'collecting';
      syncLegacySpellingCandidate(session);
      return { response: partialCandidateResponse(collection, language), confirmedName: null };
    }

    collection.state = 'confirming';
    collection.presentedCandidate = knownCandidate(collection);
    syncLegacySpellingCandidate(session);
    return { response: completeCandidateResponse(collection, language), confirmedName: null };
  }

  if (collection.state === 'clarifying') {
    const singleLetter = extractSingleSpokenLetter(transcript);
    if (singleLetter)
      return fillFirstAmbiguousPosition(session, collection, singleLetter, language);
    return failedClarification(collection, language);
  }

  if (collection.state === 'collecting') {
    if (collection.awaitingCorrection) {
      return correctionClarification(collection, language);
    }
    if (hasUnrecognizedNameCorrectionCue(transcript)) {
      collection.awaitingCorrection = true;
      collection.clarificationCount = 0;
      collection.fallbackRecorded = false;
      return correctionClarification(collection, language);
    }
    const isolatedLetter = isStandaloneSpokenLetter(transcript)
      ? extractSingleSpokenLetter(transcript)
      : null;
    if (isolatedLetter) {
      return appendIsolatedNameLetter(session, collection, isolatedLetter, language);
    }
    if (isNameConfirmation(transcript)) {
      return {
        response:
          language === 'en'
            ? "I don't have a complete name to confirm yet. Please continue spelling it."
            : "Je n'ai pas encore un nom complet à confirmer. Vous pouvez continuer à épeler, s'il vous plaît ?",
        confirmedName: null,
      };
    }
    if (hasContinuationCue(transcript)) {
      return {
        response:
          language === 'en'
            ? 'Please continue spelling your name.'
            : "Vous pouvez continuer à épeler votre nom, s'il vous plaît.",
        confirmedName: null,
      };
    }
    // Un nouveau sujet ne doit pas laisser un ancien fragment être confirmé
    // par un « oui » arrivé plus tard.
    collection.state = 'idle';
    collection.tokens = [];
    collection.partialCandidate = '';
    collection.ambiguousPositions = [];
    collection.presentedCandidate = null;
    session.conversation.spellingCandidate = null;
    return { response: null, confirmedName: null };
  }

  if (collection.state === 'confirming' && collection.presentedCandidate) {
    // Une correction non reconnue ne doit pas faire tomber le garde-fou à
    // `idle` : le LLM pourrait sinon créer la réservation avec sa propre
    // hypothèse. Conserver les lettres et demander une correction ciblée.
    if (hasUnrecognizedNameCorrectionCue(transcript)) {
      collection.state = 'collecting';
      collection.presentedCandidate = null;
      collection.confirmedName = null;
      collection.awaitingCorrection = true;
      collection.clarificationCount = 0;
      collection.fallbackRecorded = false;
      syncLegacySpellingCandidate(session);
      return correctionClarification(collection, language);
    }

    const isolatedLetter = isStandaloneSpokenLetter(transcript)
      ? extractSingleSpokenLetter(transcript)
      : null;
    if (isolatedLetter) {
      return appendIsolatedNameLetter(session, collection, isolatedLetter, language);
    }

    // Sujet différent : invalider le candidat présenté avant de laisser le
    // LLM traiter le nouveau contenu.
    collection.state = 'idle';
    collection.tokens = [];
    collection.partialCandidate = '';
    collection.ambiguousPositions = [];
    collection.awaitingCorrection = false;
    collection.presentedCandidate = null;
    session.conversation.spellingCandidate = null;
  }

  if (collection.state === 'confirmed' || collection.confirmedName) {
    // Une correction non reconnue doit conserver le garde-fou jusqu'à ce
    // qu'une lettre ciblée soit fournie. Une phrase ordinaire, elle, ne doit
    // jamais rouvrir ni modifier un nom déjà confirmé.
    if (hasUnrecognizedNameCorrectionCue(transcript)) {
      invalidateConfirmedName(session);
      collection.state = 'collecting';
      collection.presentedCandidate = null;
      collection.confirmedName = null;
      collection.awaitingCorrection = true;
      collection.clarificationCount = 0;
      collection.fallbackRecorded = false;
      syncLegacySpellingCandidate(session);
      return correctionClarification(collection, language);
    }
    return { response: null, confirmedName: null };
  }

  return { response: null, confirmedName: null };
}

export function classifyVoiceSpeechAct(transcript: string): VoiceSpeechAct {
  const normalized = normalizeTranscript(transcript);

  if (
    /^(?:allo+|vous etes(?: toujours)? la|vous m entendez|ca a coupe|hello|hi|are you(?: still)? there|can you hear me|did we get disconnected)$/.test(
      normalized,
    )
  ) {
    return 'liveness';
  }
  if (
    /^(?:oui|ouais|ok|okay|d accord|dac|hum hum|mh|mhm|bien sur|yes|yeah|yep|sure|right|correct|alright)$/.test(
      normalized,
    )
  ) {
    return 'backchannel';
  }
  if (
    /^(?:(?:non\s+){1,2})?(?:merci(?:\s+(?:c est tout|au revoir))?|c est tout(?:\s+merci)?|au revoir|bonne (?:journee|soiree)|a bientot|thanks?(?:\s+(?:that s all|goodbye))?|thank you(?:\s+(?:that s all|goodbye))?|that s all|goodbye|bye|have a (?:good|great) (?:day|evening)|see you soon)$/.test(
      normalized,
    )
  ) {
    return 'closing';
  }
  // Decline / fin de conversation : "non ça ira", "c'est bon", "ça va aller",
  // "pas besoin", "non merci", "c'est parfait merci", "non c'est bon merci"
  if (
    /^(?:non\s+)?(?:c est bon(?:\s+merci)?|ca ira(?:\s+merci)?|ca va aller|pas (?:besoin|la peine)|c est parfait(?:\s+merci)?|non merci|c est tout bon|laissez tomber|non c est bon|no thanks?|never mind|forget it|no need|that s fine)$/.test(
      normalized,
    )
  ) {
    return 'closing';
  }
  // Phrases contenant un pattern de clôture + texte supplémentaire :
  // "C'est bon, allez on arrête", "ça ira laissez tomber", "non c'est bon je raccroche"
  if (
    /\b(?:c est bon|ca ira|ca va aller|laissez tomber|on arrete|je raccroche|pas la peine|pas besoin|never mind|forget it|hang up|no need)\b/.test(
      normalized,
    ) &&
    !/\b(?:reserv|table|heure|personne|demain|aujourd|soir|midi|annul|book|reservation|table|people|tomorrow|today|tonight|cancel)\b/.test(
      normalized,
    )
  ) {
    return 'closing';
  }
  // La correction peut arriver au milieu d'une phrase (« 19 h 30, non
  // plutôt 20 h 30 »). Elle doit être classée avant toute vérification afin
  // que le brouillon et la disponibilité utilisent la nouvelle valeur.
  if (containsCorrectionMarker(normalized)) return 'correction';
  if (
    /^(?:non\b|plutot\b|en fait\b|j ai dit\b|je voulais dire\b|no\b|rather\b|actually\b|i said\b|i meant\b)/.test(
      normalized,
    )
  ) {
    return 'correction';
  }
  return 'content';
}

/** Réponses courtes dont le sens dépend de la question encore ouverte. */
export function isAffirmativeShortResponse(transcript: string): boolean {
  const normalized = normalizeTranscript(transcript);
  return /^(?:oui|ouais|ok(?:ay)?|d accord|dac|bien sur|exactement|tout a fait|ca marche|c est bon|c est bien ca|c est ca|ca me va|parfait|je confirme|oui (?:c est ca|c est bon|bien sur|exactement))$/.test(
    normalized,
  );
}

export function isNegativeShortResponse(transcript: string): boolean {
  const normalized = normalizeTranscript(transcript);
  return /^(?:non|pas du tout|ce n est pas ca|c est pas ca|je refuse|annulez?)$/.test(normalized);
}

/** Classifie une réponse courte avec la question actuellement attendue. */
export function classifyVoiceSpeechActInContext(
  session: CallSession,
  transcript: string,
): VoiceSpeechAct {
  const pending = session.conversation.pendingQuestion;
  if (pending === 'humanFallback' && isHumanFallbackDecline(transcript)) return 'correction';
  if (pending && (isAffirmativeShortResponse(transcript) || isNegativeShortResponse(transcript))) {
    return isNegativeShortResponse(transcript) ? 'correction' : 'content';
  }
  return classifyVoiceSpeechAct(transcript);
}

export interface VoiceSlotContradiction {
  field: 'date' | 'time' | 'partySize';
  current: string | number;
  proposed: string | number;
}

export function isVoiceQuestionTranscript(transcript: string): boolean {
  const normalized = normalizeTranscript(transcript).replace(/-/gu, ' ');
  return (
    /[?？]/u.test(transcript) ||
    /\b(?:est ce que|c etait une question|c etait juste une question|a quelle heure|quelle heure|quand est ce|pourquoi|comment|c est possible|est ce possible|vous fermez|vous etes (?:ouvert|ouverts)|vous avez de la place|avez vous|do you|are you|can you|could you|what time|when do you)\b/u.test(
      normalized,
    ) ||
    /\b(?:vous|tu) (?:etes|avez|ouvrez|fermez|proposez|pouvez)\b/u.test(normalized)
  );
}

export function isVoiceDialogueStopRequest(transcript: string): boolean {
  const normalized = normalizeTranscript(transcript);
  return /\b(?:on arrete|on s arrete|on va arreter|laissez tomber|je rappellerai|je vous rappellerai|je vous rappellerai plus tard|je rappellerai plus tard)\b/u.test(
    normalized,
  );
}

export function isVoiceDialogueIncompleteTranscript(transcript: string): boolean {
  const trimmed = transcript.trim();
  const normalized = normalizeTranscript(trimmed).replace(/-/gu, ' ');
  if (/(?:\.\.\.|…|[\p{L}][‐‑–-])$/u.test(trimmed)) return true;
  return (
    /^(?:(?:euh|heu|hum|hmm|mmh|mh|mhm)(?:\s+|$))*$/u.test(normalized) ||
    /(?:^|\s)(?:est ce que|c est possible de|je voudrais|j aimerais|au nom de|je m appelle)$/u.test(
      normalized,
    )
  );
}

export function findVoiceSlotContradictions(
  session: CallSession,
  transcript: string,
  now = new Date(),
): VoiceSlotContradiction[] {
  const current = session.conversation.slots;
  const proposed = extractConversationSlots(transcript, session.timezone ?? 'Europe/Paris', now);
  const conflicts: VoiceSlotContradiction[] = [];
  for (const field of ['date', 'time', 'partySize'] as const) {
    const currentValue = current[field];
    const proposedValue = proposed[field];
    if (
      currentValue !== undefined &&
      proposedValue !== undefined &&
      String(currentValue) !== String(proposedValue)
    ) {
      conflicts.push({ field, current: currentValue, proposed: proposedValue });
    }
  }
  return conflicts;
}

/** The deterministic path is reserved for one clear answer to the open field. */
export function isDirectVoiceAnswerToPendingQuestion(
  session: CallSession,
  transcript: string,
  pendingQuestion = session.conversation.pendingQuestion,
): boolean {
  if (!pendingQuestion) return false;
  const extracted = extractConversationSlots(transcript, session.timezone ?? 'Europe/Paris');
  const populated = [extracted.date, extracted.time, extracted.partySize].filter(
    (value) => value !== undefined,
  ).length;
  if (pendingQuestion === 'confirmation') return isAffirmativeShortResponse(transcript);
  if (pendingQuestion === 'partySizeConfirmation') {
    return isAffirmativeShortResponse(transcript) || extracted.partySize !== undefined;
  }
  if (pendingQuestion === 'date') return Boolean(extracted.date) && populated === 1;
  if (pendingQuestion === 'time') return Boolean(extracted.time) && populated === 1;
  if (pendingQuestion === 'partySize') return extracted.partySize !== undefined && populated === 1;
  if (pendingQuestion === 'timeChoice') {
    return (
      (Boolean(extracted.time) && populated === 1) ||
      /^(?:(?:le|la|the) )?(?:premier|premiere|deuxieme|second|seconde|troisieme|dernier|derniere|first|second|third|last)(?: (?:creneau|horaire|one))?(?: s il vous plait| please)?$/u.test(
        normalizeTranscript(transcript),
      )
    );
  }
  if (pendingQuestion === 'customerName') {
    return Boolean(
      parseSpelledNameTranscriptDetailed(transcript)?.value ||
      extractPlainCustomerName(transcript, true),
    );
  }
  if (pendingQuestion === 'customerPhone') return /(?:\+?\d[\d\s().-]{6,}\d)/u.test(transcript);
  return false;
}

function dialogueSlotValue(field: VoiceSlotContradiction['field'], value: string | number): string {
  if (field === 'partySize') {
    const number = Number(value);
    return `${FRENCH_PARTY_SIZE_WORDS[number] ?? number} ${number === 1 ? 'personne' : 'personnes'}`;
  }
  if (field === 'time') return formatAvailabilitySlot(String(value));
  return new Date(`${String(value)}T12:00:00Z`).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

export function buildVoiceCorrectionClarification(
  session: CallSession,
  transcript: string,
): string {
  const contradiction = findVoiceSlotContradictions(session, transcript)[0];
  if (!contradiction) {
    return "Je vous écoute. Qu'est-ce que vous souhaitez corriger dans la réservation ?";
  }
  const current = dialogueSlotValue(contradiction.field, contradiction.current);
  const proposed = dialogueSlotValue(contradiction.field, contradiction.proposed);
  return `J'avais noté ${current}. Vous souhaitez finalement ${proposed} ?`;
}

export function buildVoiceDialogueLoopRecovery(
  session: CallSession,
  pendingQuestion = session.conversation.pendingQuestion,
): string {
  const { date, time, partySize } = session.conversation.slots;
  const known = [
    partySize ? `${FRENCH_PARTY_SIZE_WORDS[partySize] ?? partySize} personnes` : null,
    date ? dialogueSlotValue('date', date) : null,
    time ? formatAvailabilitySlot(time) : null,
  ].filter((value): value is string => Boolean(value));
  const summary = known.length ? `J'ai bien noté ${known.join(', ')}. ` : '';
  switch (pendingQuestion) {
    case 'partySize':
    case 'partySizeConfirmation':
      return `${summary}Il me manque encore le nombre de personnes. Pour combien dois-je regarder ?`;
    case 'date':
      return `${summary}Quel jour vous conviendrait pour la réservation ?`;
    case 'time':
    case 'timeChoice':
      return `${summary}À quel horaire souhaitez-vous venir ?`;
    case 'customerName':
      return `${summary}Quel nom puis-je indiquer pour la réservation ?`;
    case 'customerPhone':
      return `${summary}Quel numéro puis-je utiliser pour la confirmation ?`;
    default:
      return `${summary}Souhaitez-vous poursuivre la réservation ou aviez-vous une autre demande ?`;
  }
}

export function isSafeVoiceCorrectionReply(
  session: CallSession,
  transcript: string,
  reply: string,
): boolean {
  if (!finalAssistantQuestion(reply)) return false;
  const contradiction = findVoiceSlotContradictions(session, transcript)[0];
  if (!contradiction) return true;
  const normalizedReply = normalizeTranscript(reply);
  const tokensFor = (value: string | number): string[] => {
    const numeric = String(value);
    if (contradiction.field !== 'partySize') {
      return [normalizeTranscript(dialogueSlotValue(contradiction.field, value))];
    }
    const words: Record<number, string> = {
      1: 'un',
      2: 'deux',
      3: 'trois',
      4: 'quatre',
      5: 'cinq',
      6: 'six',
      7: 'sept',
      8: 'huit',
      9: 'neuf',
      10: 'dix',
      11: 'onze',
      12: 'douze',
      13: 'treize',
      14: 'quatorze',
      15: 'quinze',
      16: 'seize',
    };
    return [numeric, words[Number(value)]].filter((token): token is string => Boolean(token));
  };
  return [contradiction.current, contradiction.proposed].every((value) =>
    tokensFor(value).some((token) => normalizedReply.includes(token)),
  );
}

function inferIntent(transcript: string): ConversationState['intent'] {
  const normalized = normalizeTranscript(transcript);
  if (/\b(?:annul|supprim|cancel|cancellation)/.test(normalized)) return 'cancel';
  if (/\b(?:retard|en retard)/.test(normalized)) return 'delay';
  if (/\b(?:carte cadeau|bon cadeau|gift card|gift voucher)/.test(normalized)) return 'gift_card';
  if (/\b(?:message|rappeler|reclamation|call me back|speak to the manager)/.test(normalized))
    return 'message';
  if (/\b(?:reserv|table|place|book|booking|reserve|reservation)/.test(normalized))
    return 'reservation';
  if (
    /\b(?:disponib|possible|creneau|available|availability|opening|openings|slot)/.test(normalized)
  )
    return 'availability';
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

const FRENCH_NUMBER_UNITS: Record<string, number> = {
  zero: 0,
  un: 1,
  une: 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  six: 6,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
  onze: 11,
  douze: 12,
  treize: 13,
  quatorze: 14,
  quinze: 15,
  seize: 16,
};

const FRENCH_NUMBER_TENS: Record<string, number> = {
  vingt: 20,
  trente: 30,
  quarante: 40,
  cinquante: 50,
};

const ENGLISH_NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
};

function parseFrenchNumberWords(value: string): number | null {
  const tokens = normalizeTranscript(value).replace(/-/gu, ' ').split(/\s+/u).filter(Boolean);
  if (!tokens.length) return null;

  if (tokens.length === 1)
    return FRENCH_NUMBER_UNITS[tokens[0]] ?? FRENCH_NUMBER_TENS[tokens[0]] ?? null;

  const tens = FRENCH_NUMBER_TENS[tokens[0]];
  if (tens === undefined) {
    if (tokens.length === 2 && tokens[0] === 'dix') {
      const unit = FRENCH_NUMBER_UNITS[tokens[1]];
      return unit !== undefined && unit >= 1 && unit <= 9 ? 10 + unit : null;
    }
    return null;
  }

  if (tokens.length === 2) {
    const unit = FRENCH_NUMBER_UNITS[tokens[1]];
    if (unit !== undefined && unit >= 1 && unit <= 9) return tens + unit;
  }
  if (tokens.length === 3 && tokens[1] === 'et' && (tokens[2] === 'un' || tokens[2] === 'une')) {
    return tens + 1;
  }
  return null;
}

/**
 * « à midi », « vers midi », « pour midi », « midi » seul ou « midi et quart » :
 * une heure. « après-midi », « ce midi », « un repas de midi » ne sont qu'un
 * moment de la journée (`dayPeriod`) : retenir 12:00 serait une heure devinée.
 */
function isExplicitNoonTime(text: string): boolean {
  const withoutAfternoon = text.replace(/\bapres[\s-]midi\b/g, ' ');
  if (!/\bmidi\b/.test(withoutAfternoon)) return false;
  if (/\bmidi\s+(?:et\s+demie?|et\s+quart|trente|quinze|quarante cinq)\b/.test(withoutAfternoon))
    return true;
  if (/\b(?:a|vers|pour|avant|des|jusqu a)\s+midi\b/.test(withoutAfternoon)) return true;
  return /^\W*(?:euh\W+)?midi\W*$/.test(withoutAfternoon);
}

/** « midi », « midi et demi », « midi et quart », « midi trente », « midi quinze ». */
function extractNoonTime(normalized: string): string {
  const tail = normalized.match(
    /\bmidi\s+(et\s+demie?|et\s+quart|trente|quinze|quarante cinq)\b/u,
  )?.[1];
  if (!tail) return '12:00';
  if (/demi|trente/.test(tail)) return '12:30';
  if (/quart|quinze/.test(tail)) return '12:15';
  return '12:45';
}

/**
 * ElevenLabs restitue parfois les heures en toutes lettres (« vers vingt
 * heures »). Cette forme doit être traitée comme une heure numérique avant de
 * demander une nouvelle fois le créneau au client.
 */
function extractSpokenClockTime(normalized: string): string | null {
  const tokens = normalized.replace(/-/gu, ' ').split(/\s+/u).filter(Boolean);

  for (let hourIndex = 0; hourIndex < tokens.length; hourIndex++) {
    if (!['h', 'heure', 'heures'].includes(tokens[hourIndex])) continue;

    let hour: number | null = null;
    for (let length = 3; length >= 1; length--) {
      const start = hourIndex - length;
      if (start < 0) continue;
      const candidate = parseFrenchNumberWords(tokens.slice(start, hourIndex).join(' '));
      if (candidate !== null && candidate >= 0 && candidate <= 23) {
        hour = candidate;
        break;
      }
    }
    if (hour === null) continue;

    let minute = 0;
    if (tokens[hourIndex + 1] === 'et' && ['demi', 'demie'].includes(tokens[hourIndex + 2] ?? '')) {
      minute = 30;
    } else if (tokens[hourIndex + 1] === 'et' && tokens[hourIndex + 2] === 'quart') {
      minute = 15;
    } else if (
      tokens[hourIndex + 1] === 'moins' &&
      tokens[hourIndex + 2] === 'le' &&
      tokens[hourIndex + 3] === 'quart'
    ) {
      hour = (hour + 23) % 24;
      minute = 45;
    } else {
      // Forme la plus longue d'abord : « quarante cinq » vaut 45, pas 40.
      for (let length = 3; length >= 1; length--) {
        const candidate = parseFrenchNumberWords(
          tokens.slice(hourIndex + 1, hourIndex + 1 + length).join(' '),
        );
        if (candidate !== null && candidate >= 0 && candidate <= 59) {
          minute = candidate;
          break;
        }
      }
    }

    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  return null;
}

export function extractConversationSlots(
  transcript: string,
  timezone: string,
  now = new Date(),
): ConversationState['slots'] {
  const normalized = normalizeTranscript(transcript);
  const correctedTranscript = extractCorrectionTail(normalized);
  const slots: ConversationState['slots'] = {};

  const isoDate = correctedTranscript.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (isoDate) {
    slots.date = isoDate;
  } else if (/\b(?:aujourd hui|ce jour|ce soir|today|tonight)\b/.test(correctedTranscript)) {
    slots.date = localDate(now, timezone);
  } else if (/\bapres(?:- |-)demain\b|\bapres demain\b/.test(correctedTranscript)) {
    slots.date = addDays(localDate(now, timezone), 2);
  } else if (/\b(?:demain|tomorrow)\b/.test(correctedTranscript)) {
    slots.date = addDays(localDate(now, timezone), 1);
  } else {
    const weekday = correctedTranscript.match(
      /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
    )?.[1];
    const weekdayIndex: Record<string, number> = {
      dimanche: 0,
      lundi: 1,
      mardi: 2,
      mercredi: 3,
      jeudi: 4,
      vendredi: 5,
      samedi: 6,
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };
    if (weekday) {
      slots.date = nextWeekday(localDate(now, timezone), weekdayIndex[weekday]);
    }
  }

  // ElevenLabs transcrit parfois « 19 30 » sans séparateur. On accepte cette
  // forme en plus de « 19:30 », « 19h30 » et « 19 heures 30 », tout en
  // conservant l'heure seule uniquement lorsqu'elle est explicitement suivie
  // de h/heures (pour ne pas confondre « 2 personnes » avec une heure).
  const englishAmPmMatch = correctedTranscript.match(
    /\b(?:at|around)?\s*(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b/,
  );
  if (englishAmPmMatch) {
    let hour = Number(englishAmPmMatch[1]);
    const minute = Number(englishAmPmMatch[2] ?? '0');
    if (englishAmPmMatch[3] === 'pm' && hour < 12) hour += 12;
    if (englishAmPmMatch[3] === 'am' && hour === 12) hour = 0;
    slots.time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  // Scribe écrit « vingt et une heures » en « 20 et 1 heure » : sans cette
  // réécriture, l'heure lue était 01:00 (banc STT du 24/09).
  // Variantes : « 20 et 1 h 30 », « 20 h et 1 h 30 », « vingt et 1 h 30 ».
  const timeTranscript = correctedTranscript.replace(
    // Après « 20 h » / « 20 heures », « et un » n'est une heure que suivi de « h » :
    // « 20 heures et un enfant » reste 20:00.
    /\b(?:20\s*h(?:eures?)?\s+et\s+(?:1|un|une)(?=\s*h)|(?:20\s+et\s+(?:1|un|une)|vingt\s+et\s+1)(?=\s*h|\s|$))/gu,
    () => '21',
  );
  const timeMatch = slots.time
    ? null
    : timeTranscript.match(
        /\b(?:a|vers|at|around)?\s*([01]?\d|2[0-3])(?:(?:\s*(?::|h(?:eures?)?)\s*)([0-5]\d)?|\s+([0-5]\d))\b/,
      );
  if (timeMatch) {
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2] ?? timeMatch[3] ?? '0');
    slots.time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  } else {
    const spokenClockTime = extractSpokenClockTime(timeTranscript);
    if (spokenClockTime) {
      slots.time = spokenClockTime;
    } else if (isExplicitNoonTime(correctedTranscript)) {
      // « à midi » est la formulation la plus courante au téléphone ; elle
      // doit déclencher la même vérification qu'une heure numérique.
      slots.time = extractNoonTime(correctedTranscript);
    } else if (/\b(?:a|vers)?\s*minuit\b/.test(correctedTranscript)) {
      slots.time = '00:00';
    }
  }

  // « huit heures ce soir », « 8 heures du soir » : une heure du matin suivie
  // de « soir » désigne le service du soir (lu 08:00 jusqu'ici).
  if (slots.time && /\b(?:du|ce|le) soir\b/u.test(correctedTranscript)) {
    const [hour, minute] = slots.time.split(':').map(Number);
    if (hour >= 1 && hour <= 11) {
      slots.time = `${String(hour + 12).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  }

  const partyMatch = correctedTranscript.match(
    new RegExp(
      `\\b(?:pour|de|for|party of|table for)?\\s*${SPOKEN_PARTY_SIZE_PATTERN}\\s+(?:personnes?|people|guests?)\\b`,
    ),
  );
  if (partyMatch) {
    // Au-delà du seuil du restaurant, le nombre est lu quand même : c'est ce
    // qui permet de reconnaître un groupe et de le confier au gérant.
    const partySize = partySizeFromNumberToken(partyMatch[1]);
    if (partySize !== null) slots.partySize = partySize;
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
  language: VoiceLanguageCode = 'fr',
): string {
  const time = formatAvailabilitySlot(request.time, language);
  if (language === 'en') {
    if (availableSlots.length === 0) {
      return `Unfortunately, we're fully booked that day for ${request.partySize} ${request.partySize === 1 ? 'person' : 'people'}. Would you like me to check another day?`;
    }
    if (availableSlots.includes(request.time)) {
      return `Yes, we have a table for ${request.partySize} ${request.partySize === 1 ? 'person' : 'people'} at ${time}. What name should I book it under?`;
    }
    const alternatives = selectClosestAvailabilitySlots(request.time, availableSlots)
      .map((slot) => formatAvailabilitySlot(slot, language))
      .join(' or ');
    return `That time, ${time}, is full, but I have ${alternatives} available. Would either work for you?`;
  }
  if (availableSlots.length === 0) {
    return `Ah, malheureusement on est complets ce jour-là pour ${request.partySize} personne${request.partySize > 1 ? 's' : ''}. Vous voulez que je regarde un autre jour ?`;
  }
  if (availableSlots.includes(request.time)) {
    return `Oui, nous avons de la place pour ${request.partySize} personne${request.partySize > 1 ? 's' : ''} à ${time}. À quel nom je réserve ?`;
  }
  const alternatives = selectClosestAvailabilitySlots(request.time, availableSlots)
    .map((slot) => slot.replace(/^0/, '').replace(':00', ' h').replace(':', ' h '))
    .join(' ou ');
  return `Alors ${time} c'est complet, par contre j'ai ${alternatives}. Ça vous irait ?`;
}

export function buildAvailabilityReplyPlan(
  session: CallSession,
  request: { date: string; time: string; partySize: number },
  availableSlots: string[],
  language: VoiceLanguageCode = 'fr',
): AssistantReplyEmissionPlan {
  // Un jour deviné par rapprochement est relu devant la réponse de
  // disponibilité, qui sinon ne cite que l'heure et le nombre de personnes.
  const reply =
    phoneticDateReadBack(session) + buildAvailabilityReply(request, availableSlots, language);
  const kind: PendingInteractionKind =
    availableSlots.length === 0
      ? 'date'
      : availableSlots.includes(request.time)
        ? 'customerName'
        : 'timeChoice';
  return buildExplicitInteractionReplyPlan(session, reply, kind);
}

export interface AvailabilityLlmContextInput {
  request: { date: string; time: string; partySize: number };
  availableSlots: string[];
  knownCustomerName?: string | null;
}

function formatExactReservationDate(date: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00.000Z`));
}

/**
 * Contexte éphémère transmis au LLM après la vérification de disponibilité.
 * Les faits et les garde-fous restent déterministes ; seule la formulation
 * vocale est confiée au modèle.
 */
/**
 * Horaires qu'une réponse de disponibilité peut prononcer : le créneau demandé
 * s'il est libre, sinon les trois alternatives vérifiées les plus proches.
 */
export function allowedAvailabilityReplyTimes(
  request: { time: string },
  availableSlots: string[],
): string[] {
  if (availableSlots.includes(request.time)) return [request.time];
  return selectClosestAvailabilitySlots(request.time, availableSlots);
}

/** Horaires « HH:MM » prononcés dans une phrase (« 22 h 30 », « 19h », « 12:15 »). */
export function extractSpokenTimes(phrase: string): string[] {
  const times = new Set<string>();
  for (const match of phrase.matchAll(/\b(\d{1,2})\s*(?:h|:)\s*(\d{2})?(?!\d)/giu)) {
    const hour = Number(match[1]);
    const minute = match[2] ? Number(match[2]) : 0;
    if (hour > 23 || minute > 59) continue;
    times.add(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  }
  return [...times];
}

/**
 * Garde-fou sur une réponse LLM après vérification de disponibilité : aucun
 * horaire hors liste autorisée (le créneau demandé peut être cité même complet),
 * et jamais plus de trois horaires.
 */
export function violatesAvailabilityReplyGuard(
  spokenTimes: string[],
  request: { time: string },
  availableSlots: string[],
): boolean {
  if (spokenTimes.length > 3) return true;
  const allowed = new Set([
    request.time,
    ...allowedAvailabilityReplyTimes(request, availableSlots),
  ]);
  return spokenTimes.some((time) => !allowed.has(time));
}

export function buildAvailabilityLlmContext({
  request,
  availableSlots,
  knownCustomerName,
}: AvailabilityLlmContextInput): string {
  const requestedSlotAvailable = availableSlots.includes(request.time);
  // Seuls les horaires que le LLM a le droit d'annoncer lui sont transmis : la
  // liste complète de la journée l'incitait à tout énumérer (appel du 24/09).
  const allowedSlots = allowedAvailabilityReplyTimes(request, availableSlots).map((slot) =>
    formatAvailabilitySlot(slot),
  );
  const closestAlternatives = selectClosestAvailabilitySlots(request.time, availableSlots).map(
    (slot) => formatAvailabilitySlot(slot),
  );

  let nextObjective: string;
  if (availableSlots.length === 0) {
    nextObjective =
      "Le jour est complet d'après l'outil. Explique-le simplement et propose de regarder un autre jour ou de passer le gérant. N'invente aucun horaire.";
  } else if (requestedSlotAvailable) {
    nextObjective = knownCustomerName
      ? `Le nom « ${knownCustomerName} » est déjà connu : ne le redemande pas. Récapitule naturellement la date exacte, l'heure, le nombre de personnes et le nom, puis demande une confirmation explicite avant tout appel à createReservation.`
      : 'Le créneau est disponible. Demande uniquement le nom manquant. Après le nom, récapitule les informations et demande une confirmation explicite avant tout appel à createReservation.';
  } else {
    nextObjective = `Le créneau demandé est complet. Propose uniquement les alternatives vérifiées les plus proches (${closestAlternatives.join(' ou ') || 'aucune'}), puis demande laquelle convient. Ne confirme pas et ne crée pas de réservation tant qu'un créneau n'est pas choisi.`;
  }

  return [
    'CONTEXTE MÉTIER INTERNE — vérification de disponibilité terminée.',
    `Demande vérifiée : date exacte ${request.date} (${formatExactReservationDate(request.date)}), heure ${request.time}, ${request.partySize} personne${request.partySize > 1 ? 's' : ''}.`,
    requestedSlotAvailable
      ? `Résultat de l'outil : créneau demandé disponible. N'annonce aucun autre horaire.`
      : `Résultat de l'outil : créneau demandé indisponible ; seuls horaires annonçables : ${allowedSlots.join(', ') || 'aucun'}.`,
    `Nom déjà connu : ${knownCustomerName || 'non'}.`,
    `Objectif du prochain tour : ${nextObjective}`,
    'Réponds en français, avec une formulation chaleureuse et une seule question utile. Dans le récapitulatif, prononce la date complète (jour, numéro et mois) plutôt que « demain » ou « demain soir » seul. Les créneaux annoncés doivent provenir exclusivement de cette vérification.',
  ].join('\n');
}

/**
 * Réponse de repli quand le moteur de disponibilité est indisponible. Elle ne
 * confirme jamais le créneau et ne demande pas le nom avant une vérification
 * réussie.
 */
export function buildAvailabilityErrorReply(
  language: VoiceLanguageCode = 'fr',
  managerConfigured = false,
): string {
  if (language === 'en') {
    return managerConfigured
      ? "I can't check that time right now. I can put you through to the manager or take a message. Which do you prefer?"
      : "I can't check that time right now, but I can take a message for the manager. Would you like me to do that?";
  }
  return managerConfigured
    ? "Je n'arrive pas à vérifier ce créneau pour le moment. Je peux vous passer le gérant ou prendre un message. Que préférez-vous ?"
    : "Je n'arrive pas à vérifier ce créneau pour le moment, mais je peux prendre un message pour le gérant. Voulez-vous que je le fasse ?";
}

export function buildAvailabilityErrorPlan(session: CallSession): AssistantReplyEmissionPlan {
  const reply = buildAvailabilityErrorReply(
    effectiveVoiceLanguage(session),
    Boolean(session.managerPhone?.trim()),
  );
  return buildExplicitInteractionReplyPlan(session, reply, 'humanFallback');
}

/**
 * Réponse parlée quand le LLM échoue (429, 5xx, timeout, requête refusée).
 *
 * Un silence fait raccrocher l'appelant : on répond toujours, de façon
 * déterministe, à partir de l'état vérifié. Si une disponibilité vient d'être
 * vérifiée pour la demande en cours, on reprend exactement ce résultat ; après
 * deux échecs consécutifs, on propose le gérant ou un message.
 */
export function buildLlmFailurePlan(session: CallSession): AssistantReplyEmissionPlan {
  const language = effectiveVoiceLanguage(session);
  const streak = session.conversation.llmFailureStreak ?? 0;
  const managerConfigured = Boolean(session.managerPhone?.trim());

  if (streak >= 2) {
    const reply =
      language === 'en'
        ? managerConfigured
          ? "I'm having a technical issue. I can put you through to the manager or take a message. Which do you prefer?"
          : "I'm having a technical issue, but I can take a message for the manager. Would you like me to do that?"
        : managerConfigured
          ? 'Je rencontre un petit souci technique. Je peux vous passer le gérant ou prendre un message. Que préférez-vous ?'
          : 'Je rencontre un petit souci technique, mais je peux prendre un message pour le gérant. Voulez-vous que je le fasse ?';
    return buildExplicitInteractionReplyPlan(session, reply, 'humanFallback');
  }

  const { date, time, partySize } = session.conversation.slots;
  const lastAvailability = session.conversation.lastAvailabilityResult;
  if (date && time && partySize && lastAvailability?.key === `${date}:${time}:${partySize}`) {
    return buildAvailabilityReplyPlan(
      session,
      { date, time, partySize },
      lastAvailability.slots,
      language,
    );
  }

  const reply =
    language === 'en'
      ? "Sorry, I didn't quite catch that. Could you say it again?"
      : "Pardon, je n'ai pas bien saisi. Pouvez-vous répéter ?";
  return buildExplicitInteractionReplyPlan(session, reply, 'open');
}

/** Secours court aligné sur le champ encore attendu pour le pilote vocal. */
export function buildVoiceStageFailurePlan(session: CallSession): AssistantReplyEmissionPlan {
  if ((session.conversation.llmFailureStreak ?? 0) >= 2) return buildLlmFailurePlan(session);
  const english = effectiveVoiceLanguage(session) === 'en';
  const prompts: Partial<Record<NonNullable<PendingQuestion>, string>> = english
    ? {
        date: 'Sorry, what date would you prefer?',
        time: 'Sorry, what time would you like to come?',
        timeChoice: 'Sorry, which time works best for you?',
        partySize: 'Sorry, how many people will be joining?',
        partySizeConfirmation: 'Sorry, how many people should I put down?',
        customerName: 'Sorry, could you spell the name for the reservation?',
        customerPhone: 'Sorry, what phone number should I use?',
        confirmation: 'Sorry, would you like me to confirm this reservation?',
      }
    : {
        date: 'Pardon, quelle date souhaitez-vous ?',
        time: 'Pardon, à quelle heure souhaitez-vous venir ?',
        timeChoice: 'Pardon, quel horaire vous conviendrait ?',
        partySize: 'Pardon, vous serez combien ?',
        partySizeConfirmation: 'Pardon, pour combien de personnes ?',
        customerName: 'Pardon, pouvez-vous épeler le nom de la réservation ?',
        customerPhone: 'Pardon, quel numéro de téléphone dois-je noter ?',
        confirmation: 'Pardon, souhaitez-vous confirmer cette réservation ?',
      };
  const pendingQuestion = session.conversation.pendingQuestion;
  const reply =
    (pendingQuestion ? prompts[pendingQuestion] : undefined) ?? buildLlmFailurePlan(session).reply;
  return buildExplicitInteractionReplyPlan(session, reply, 'open');
}

/**
 * « Non » au récapitulatif sans nouvelle valeur exploitable.
 *
 * Le LLM concluait parfois sans question (« je garde donc … », appel du
 * 24/09) : l'appelant ne savait plus quoi dire. Quand le refus vise le nom
 * (mot « nom », épellation, ou nom répété), on repart sur une épellation
 * lettre par lettre ; sinon on demande ce qu'il faut corriger. La réponse
 * finit toujours par une question.
 */
export function buildRecapRejectionPlan(
  session: CallSession,
  transcript: string,
): AssistantReplyEmissionPlan | null {
  const normalized = normalizeTranscript(transcript);
  if (
    !/^(?:non|pas du tout|c est pas ca|ce n est pas ca|c est faux|no|that s wrong)\b/.test(
      normalized,
    )
  )
    return null;
  const extracted = extractConversationSlots(transcript, session.timezone ?? 'Europe/Paris');
  // Une nouvelle date, heure ou taille de groupe est une correction que le
  // flux normal applique : ce n'est pas un refus sans valeur.
  if (extracted.date || extracted.time || extracted.partySize) return null;

  const language = effectiveVoiceLanguage(session);
  const collection = ensureNameCollection(session);
  const currentName = collection.confirmedName ?? session.conversation.slots.customerName ?? '';
  const normalizedName = normalizeTranscript(currentName);
  const targetsName =
    /\b(?:nom|epel\w*|epell\w*|lettre|orthographe|name|spell\w*)\b/.test(normalized) ||
    (normalizedName.length > 0 && normalized.includes(normalizedName.split(' ')[0]));

  if (targetsName) {
    if (collection.state === 'confirmed' || collection.confirmedName)
      invalidateConfirmedName(session);
    session.conversation.slots.customerName = undefined;
    collection.state = 'collecting';
    collection.presentedCandidate = null;
    collection.confirmedName = null;
    collection.tokens = [];
    collection.partialCandidate = '';
    collection.ambiguousPositions = [];
    collection.clarificationCount = 0;
    collection.awaitingCorrection = false;
    collection.fallbackRecorded = false;
    session.conversation.spellingCandidate = null;
    const reply =
      language === 'en'
        ? 'Sorry about that. Could you spell your name for me, letter by letter?'
        : "Pardon. Pouvez-vous m'épeler votre nom, lettre par lettre ?";
    return buildExplicitInteractionReplyPlan(session, reply, 'customerName');
  }

  const reply =
    language === 'en'
      ? 'All right. What should I correct: the date, the time, the number of people or the name?'
      : "D'accord. Qu'est-ce que je dois corriger : la date, l'heure, le nombre de personnes ou le nom ?";
  return buildExplicitInteractionReplyPlan(session, reply, 'open');
}

const CUSTOMER_NAME_STOP_WORDS = new Set([
  'a',
  'au',
  'avec',
  'bon',
  'ca',
  'c est',
  'd accord',
  'de',
  'demain',
  'des',
  'est',
  'heure',
  'je',
  'la',
  'le',
  'les',
  'midi',
  'mon',
  'nom',
  'oui',
  'parfait',
  'personne',
  'personnes',
  'pour',
  'reserver',
  'reservation',
  'table',
  'une',
  'vers',
  'vous',
]);

/**
 * Retient un nom parlé naturellement quand le client répond par exemple
 * « Akif » ou « au nom de Akif ». Les épellations restent entièrement
 * contrôlées par handleCustomerNameTurn.
 */
export function extractPlainCustomerName(transcript: string, expectName = false): string | null {
  const normalized = normalizeTranscript(transcript);
  if (
    !normalized ||
    isAffirmativeShortResponse(transcript) ||
    isNegativeShortResponse(transcript)
  ) {
    return null;
  }

  const spelled = parseSpelledNameTranscriptDetailed(transcript);
  if (spelled?.confident || spelled?.isFragment) return null;

  const explicitMatch = transcript.match(
    /(?:au nom de|mon nom est|je m'appelle|je m’appelle|je suis|my name is|under the name of)\s+([^,.!?]+)/iu,
  );
  const rawCandidate = explicitMatch?.[1]?.trim() ?? (expectName ? transcript.trim() : '');
  const candidate = rawCandidate.replace(/[.!?,]+$/gu, '').trim();
  if (!candidate || candidate.length > 60 || /\d/u.test(candidate)) return null;

  const candidateWords = normalizeTranscript(candidate).split(/\s+/u).filter(Boolean);
  if (candidateWords.length === 0 || candidateWords.length > 4) return null;
  if (candidateWords.some((word) => CUSTOMER_NAME_STOP_WORDS.has(word))) return null;
  if (!candidateWords.every((word) => /^[\p{L}'’-]+$/u.test(word))) return null;

  return candidate;
}

/**
 * Moment de la journée exprimé par l'appelant (« demain soir », « à midi »).
 * « après-midi » n'est pas un service : il n'oriente pas les propositions.
 */
export function extractDayPeriod(transcript: string): DayPeriod | null {
  const text = normalizeTranscript(transcript).replace(/\bapres[\s-]midi\b/g, ' ');
  const dinner = /\b(?:soir|soiree|diner|dinner|tonight|evening)\b/.test(text);
  const lunch = /\b(?:midi|dejeuner|lunch|noon)\b/.test(text);
  if (dinner === lunch) return null;
  return dinner ? 'dinner' : 'lunch';
}

/** Créneaux compatibles avec le moment demandé : service du midi avant 15 h, du soir dès 18 h. */
export function filterSlotsByDayPeriod(slots: string[], period: DayPeriod | undefined): string[] {
  if (!period) return slots;
  return slots.filter((slot) => (period === 'lunch' ? slot < '15:00' : slot >= '18:00'));
}

export function asksForAvailabilityOptions(transcript: string): boolean {
  const text = normalizeTranscript(transcript);
  return /\b(?:disponib|creneaux?|horaires?|possible|available|availability|slots?)|\b(?:quelle heure|quand|what time)\b/.test(
    text,
  );
}

export function getOpenAvailabilityRequest(session: CallSession) {
  const { intent, slots, wantsAvailabilityOptions, toolInFlight } = session.conversation;
  if (!wantsAvailabilityOptions || toolInFlight || slots.time || !slots.date || !slots.partySize)
    return null;
  if (intent !== 'reservation' && intent !== 'availability') return null;
  return { date: slots.date, partySize: slots.partySize };
}

/** Trois créneaux répartis sur la plage plutôt que trois quarts d'heure consécutifs. */
function spreadSlots(slots: string[]): string[] {
  return slots.length <= 3
    ? slots
    : [slots[0], slots[Math.floor(slots.length / 2)], slots[slots.length - 1]];
}

export function buildOpenAvailabilityReply(session: CallSession, availableSlots: string[]): string {
  const slots = [...new Set(availableSlots)].sort();
  const period = session.conversation.dayPeriod;
  const periodSlots = filterSlotsByDayPeriod(slots, period);
  // Rien au moment demandé : on le dit, puis on propose le reste de la journée.
  const periodUnavailable = Boolean(period) && periodSlots.length === 0 && slots.length > 0;
  const offered = spreadSlots(periodUnavailable ? slots : periodSlots);
  const { date, partySize } = session.conversation.slots;
  session.conversation.offeredAvailability = { date: date!, partySize: partySize!, slots: offered };
  const en = effectiveVoiceLanguage(session) === 'en';
  const readBack = phoneticDateReadBack(session);
  if (!offered.length)
    return en
      ? 'I have no available times that day for your party. Would you like to try another day?'
      : "Je n'ai aucun créneau disponible ce jour-là pour votre groupe. Souhaitez-vous regarder un autre jour ?";
  const choices = offered
    .map((slot) => formatAvailabilitySlot(slot, en ? 'en' : 'fr'))
    .join(en ? ' or ' : ' ou ');
  if (periodUnavailable) {
    const periodLabel = en
      ? period === 'lunch'
        ? 'at lunchtime'
        : 'in the evening'
      : period === 'lunch'
        ? 'à midi'
        : 'le soir';
    return (
      readBack +
      (en
        ? `I have nothing left ${periodLabel} that day, but I can offer ${choices}. Would one of those work?`
        : `Je n'ai plus rien ${periodLabel} ce jour-là, mais je peux vous proposer ${choices}. L'un de ces horaires vous convient ?`)
    );
  }
  return (
    readBack +
    (en
      ? `I can offer ${choices}. Which one works for you?`
      : `Je peux vous proposer ${choices}. Quel horaire vous convient ?`)
  );
}

/**
 * Rapprochement phonétique et relecture naturelle : désactivés par défaut,
 * activés par `VOICE_EXPECTED_ANSWER_ENABLED=true`, limités aux restaurants de
 * `VOICE_EXPECTED_ANSWER_RESTAURANT_IDS` (liste vide = tous). Flag coupé, le
 * dialogue est strictement celui d'avant la fonctionnalité.
 */
export function isExpectedAnswerEnabled(session: Pick<CallSession, 'restaurantId'>): boolean {
  if (process.env.VOICE_EXPECTED_ANSWER_ENABLED !== 'true') return false;
  const restaurantIds = (process.env.VOICE_EXPECTED_ANSWER_RESTAURANT_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return restaurantIds.length === 0 || restaurantIds.includes(session.restaurantId);
}

const OPENING_DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/**
 * Heures candidates d'après les horaires d'ouverture (pas de 15 min), pour le
 * jour demandé s'il est connu, sinon pour toute la semaine. Vide si inconnus.
 */
export function openingHourTimes(
  openingHours: CallSession['openingHours'],
  date?: string,
): string[] {
  if (!openingHours) return [];
  const days = date
    ? [OPENING_DAY_KEYS[new Date(`${date}T12:00:00Z`).getUTCDay()]]
    : OPENING_DAY_KEYS;
  const times = new Set<string>();
  for (const day of days) {
    const slot = openingHours[day];
    if (!slot?.open || !slot.close) continue;
    const toMinutes = (value: string) => {
      const [h, m] = value.split(':').map(Number);
      return h * 60 + (m || 0);
    };
    const close = toMinutes(slot.close);
    for (let minute = toMinutes(slot.open); minute < close; minute += 15) {
      times.add(
        `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`,
      );
    }
  }
  return [...times].sort();
}

const WEEKDAY_TOKENS = new Set([
  'lundi',
  'mardi',
  'mercredi',
  'jeudi',
  'vendredi',
  'samedi',
  'dimanche',
  'demain',
  'aujourd',
]);

/** Au-delà, la phrase dit autre chose qu'une réponse courte à la question. */
const MAX_EXPECTED_ANSWER_WORDS = 8;

/**
 * Quand la réponse à une question fermée n'a donné aucune valeur exploitable,
 * cherche la réponse attendue la plus proche phonétiquement. Une valeur nette
 * est retenue ; deux valeurs proches donnent une question « X ou Y ? ».
 * Retourne le champ rempli, s'il y en a un.
 */
function applyExpectedAnswer(
  session: CallSession,
  activeKind: PendingInteractionKind | null,
  transcript: string,
  extracted: ConversationState['slots'],
  now: Date,
  previousChoice: ConversationState['answerChoice'] = null,
): 'partySize' | 'date' | 'time' | null {
  if (!isExpectedAnswerEnabled(session)) return null;
  if (extracted.partySize || extracted.date || extracted.time) return null;
  if (isExploratoryUtterance(transcript)) return null;
  if (normalizeTranscript(transcript).split(' ').length > MAX_EXPECTED_ANSWER_WORDS) return null;

  const kind =
    activeKind === 'partySize'
      ? 'partySize'
      : activeKind === 'date'
        ? 'weekday'
        : activeKind === 'time'
          ? 'time'
          : null;
  if (!kind) return null;
  // Un nombre ou un jour déjà reconnaissable dans la phrase a été lu (ou
  // écarté) par l'analyseur normal : « nos trois enfants » ne veut pas dire
  // trois personnes. Le rapprochement ne sert qu'aux phrases sans valeur lisible.
  const tokens = normalizeTranscript(transcript).split(' ');
  if (
    kind === 'partySize' &&
    tokens.some(
      (token) =>
        /^\d+$/.test(token) ||
        FRENCH_NUMBER_UNITS[token] !== undefined ||
        FRENCH_NUMBER_TENS[token] !== undefined,
    )
  )
    return null;
  if (kind === 'weekday' && tokens.some((token) => WEEKDAY_TOKENS.has(token))) return null;

  // Réponse à « six ou dix ? » : seules les deux valeurs proposées comptent.
  const offered = previousChoice?.kind === kind ? previousChoice.values : undefined;
  // Heures possibles : créneaux vérifiés s'il y en a, sinon horaires
  // d'ouverture du jour demandé, sinon la liste par défaut du module.
  let allowedTimes: string[] | undefined = offered;
  if (kind === 'time' && !offered) {
    const known =
      session.conversation.lastAvailabilityResult?.slots ??
      openingHourTimes(session.openingHours, session.conversation.slots.date);
    const inPeriod = filterSlotsByDayPeriod(known, session.conversation.dayPeriod);
    allowedTimes = inPeriod.length ? inPeriod : known;
  }
  const decision = resolveExpectedAnswer(transcript, kind, offered ?? allowedTimes);
  const [best, second] = decision.candidates;
  session.conversation.lastExpectedAnswer = {
    kind,
    status: decision.status,
    bestScore: best ? Math.round(best.score * 1000) / 1000 : null,
    margin: best && second ? Math.round((second.score - best.score) * 1000) / 1000 : null,
  };
  // Au-delà du seuil du restaurant, un nombre deviné n'est jamais accepté
  // d'office. Un choix reste utile dès qu'une des deux valeurs est réservable
  // (« six ou dix ? ») ; la réponse à ce choix, elle, compte même au-delà.
  const limit = voiceMaxPartySize(session);
  const beyondVoiceLimit = (value: string) =>
    kind === 'partySize' && !offered && Number(value) > limit;
  if (decision.status === 'choice' && decision.values.every(beyondVoiceLimit)) return null;
  if (decision.status === 'accepted' && beyondVoiceLimit(decision.value)) return null;
  if (decision.status === 'choice') {
    session.conversation.answerChoice = { kind, values: decision.values };
    return null;
  }
  if (decision.status !== 'accepted') return null;
  // Une valeur devinée n'est jamais retenue en silence : elle est relue dans
  // la réponse suivante (question suivante ou réponse de disponibilité).
  session.conversation.phoneticAccepted = kind === 'weekday' ? 'date' : kind;

  if (kind === 'partySize') {
    extracted.partySize = Number(decision.value);
    return 'partySize';
  }
  if (kind === 'weekday') {
    const date = extractConversationSlots(
      decision.value,
      session.timezone ?? 'Europe/Paris',
      now,
    ).date;
    if (!date) return null;
    extracted.date = date;
    return 'date';
  }
  extracted.time = decision.value;
  return 'time';
}

/**
 * Confirmation guidée par la confiance : désactivée par défaut, activée par
 * `VOICE_CONFIDENCE_CONFIRM_ENABLED=true`, limitée aux restaurants de
 * `VOICE_CONFIDENCE_CONFIRM_RESTAURANT_IDS` (liste vide = tous).
 */
export function isConfidenceConfirmEnabled(session: Pick<CallSession, 'restaurantId'>): boolean {
  if (process.env.VOICE_CONFIDENCE_CONFIRM_ENABLED !== 'true') return false;
  const restaurantIds = (process.env.VOICE_CONFIDENCE_CONFIRM_RESTAURANT_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return restaurantIds.length === 0 || restaurantIds.includes(session.restaurantId);
}

const JS_WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

function weekdayOfDate(date: string): string {
  return JS_WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

function toMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + (minute || 0);
}

/** L'heure tombe-t-elle dans les horaires du jour (de la semaine si le jour est inconnu) ? */
export function isWithinOpeningHours(
  openingHours: CallSession['openingHours'],
  date: string | undefined,
  time: string,
): boolean {
  if (!openingHours) return true;
  const days = date
    ? [OPENING_DAY_KEYS[new Date(`${date}T12:00:00Z`).getUTCDay()]]
    : OPENING_DAY_KEYS;
  const minute = toMinutes(time);
  return days.some((day) => {
    const slot = openingHours[day];
    if (!slot?.open || !slot.close) return false;
    const open = toMinutes(slot.open);
    let close = toMinutes(slot.close);
    if (close <= open) close += 24 * 60; // service qui finit après minuit
    return (
      (minute >= open && minute < close) || (minute + 24 * 60 >= open && minute + 24 * 60 < close)
    );
  });
}

/**
 * Heure ouverte la plus proche à l'oreille : d'abord les confusions connues
 * (« dix » / « vingt-deux »), puis le rapprochement phonétique de la phase 1.
 */
function closestOpenTime(time: string, openTimes: readonly string[]): string | undefined {
  const known = confusableNeighbours('time', time).find((candidate) =>
    openTimes.includes(candidate),
  );
  if (known) return known;
  const [best] = rankExpectedAnswers(formatAvailabilitySlot(time), 'time', openTimes);
  return best && best.score <= EXPECTED_ANSWER_THRESHOLDS.maxScore ? best.value : undefined;
}

/**
 * Vraisemblance des heures (phase 1, indépendante de la confiance) : une heure
 * hors des horaires d'ouverture n'est jamais retenue en silence. Elle devient
 * « X ou Y ? » avec l'heure ouverte la plus proche à l'oreille, ou une relance
 * qui cite les horaires. Horaires inconnus : rien ne change.
 */
function applyTimePlausibility(
  session: CallSession,
  extracted: ConversationState['slots'],
  previousChoice: ConversationState['answerChoice'],
): void {
  if (!isExpectedAnswerEnabled(session)) return;
  const time = extracted.time;
  if (!time || !session.openingHours) return;
  const date = extracted.date ?? session.conversation.slots.date;
  const openTimes = openingHourTimes(session.openingHours, date);
  if (!openTimes.length) return;
  if (isWithinOpeningHours(session.openingHours, date, time)) return;
  delete extracted.time;
  // L'appelant maintient une heure fermée proposée au tour précédent : on
  // cite les horaires au lieu de reposer la même question.
  const maintained = previousChoice?.kind === 'time' && previousChoice.values.includes(time);
  const neighbour = maintained ? undefined : closestOpenTime(time, openTimes);
  if (neighbour && !session.conversation.answerChoice) {
    session.conversation.answerChoice = { kind: 'time', values: [time, neighbour] };
  } else {
    session.conversation.closedTimeReprompt = true;
  }
}

/**
 * Groupe au-delà du seuil du restaurant : le nombre n'est jamais retenu pour
 * une réservation automatique. Il est confirmé une fois (« Douze personnes,
 * c'est bien ça ? »), puis le tour est confié au gérant. Une valeur choisie
 * dans « X ou Y ? » vaut confirmation.
 */
function applyGroupThreshold(
  session: CallSession,
  transcript: string,
  extracted: ConversationState['slots'],
  previousChoice: ConversationState['answerChoice'],
  previousGroup: ConversationState['groupRequest'],
): void {
  const limit = voiceMaxPartySize(session);
  if (previousGroup && !previousGroup.confirmed) {
    const confirmed =
      extracted.partySize === previousGroup.partySize ||
      (extracted.partySize === undefined && isAffirmativeShortResponse(transcript));
    if (confirmed) {
      delete extracted.partySize;
      session.conversation.groupRequest = { partySize: previousGroup.partySize, confirmed: true };
      return;
    }
  }
  const partySize = extracted.partySize;
  if (partySize === undefined || partySize <= limit) return;
  delete extracted.partySize;
  session.conversation.groupRequest = {
    partySize,
    confirmed:
      previousChoice?.kind === 'partySize' && previousChoice.values.includes(String(partySize)),
  };
}

/** « Douze personnes, c'est bien ça ? » : confirmation explicite d'un groupe. */
export function buildGroupConfirmationPlan(
  session: CallSession,
): AssistantReplyEmissionPlan | null {
  const group = session.conversation.groupRequest;
  if (!group || group.confirmed) return null;
  const en = effectiveVoiceLanguage(session) === 'en';
  const spoken = en
    ? `${group.partySize} people`
    : `${FRENCH_PARTY_SIZE_WORDS[group.partySize] ?? group.partySize} personnes`;
  const reply = en
    ? `${spoken}, is that right?`
    : `${spoken.charAt(0).toUpperCase()}${spoken.slice(1)}, c'est bien ça ?`;
  return {
    reply,
    proposal: {
      source: 'explicit',
      operation: 'activate',
      interaction: {
        kind: 'partySizeConfirmation',
        prompt: reply,
        candidatePartySize: group.partySize,
      },
    },
  };
}

/** Heure fermée maintenue ou sans voisin ouvert : relance qui cite les horaires. */
export function buildClosedTimeRepromptPlan(
  session: CallSession,
): AssistantReplyEmissionPlan | null {
  if (!session.conversation.closedTimeReprompt || !session.openingHours) return null;
  const en = effectiveVoiceLanguage(session) === 'en';
  const date = session.conversation.slots.date;
  const days = date
    ? [OPENING_DAY_KEYS[new Date(`${date}T12:00:00Z`).getUTCDay()]]
    : OPENING_DAY_KEYS;
  const ranges = [
    ...new Set(
      days
        .map((day) => session.openingHours?.[day])
        .filter((slot): slot is { open: string; close: string } =>
          Boolean(slot?.open && slot.close),
        )
        .map((slot) =>
          en
            ? `from ${formatAvailabilitySlot(slot.open, 'en')} to ${formatAvailabilitySlot(slot.close, 'en')}`
            : `de ${formatAvailabilitySlot(slot.open)} à ${formatAvailabilitySlot(slot.close)}`,
        ),
    ),
  ];
  if (!ranges.length) return null;
  const when = date
    ? en
      ? 'That day, we are open'
      : 'Ce jour-là, nous sommes ouverts'
    : en
      ? 'We are open'
      : 'Nous sommes ouverts';
  const primary = en
    ? `${when} ${ranges.join(' or ')}. What time would you like to come?`
    : `${when} ${ranges.join(' ou ')}. Vers quelle heure souhaitez-vous venir ?`;
  // Citer les horaires est déjà la reformulation : le compteur anti-boucle
  // reste actif pour proposer un humain si l'heure fermée persiste.
  if (registerDialogueStall(session, 'time') === 'escalate') {
    return buildHumanFallbackReplyPlan(session);
  }
  return buildExplicitInteractionReplyPlan(session, primary, 'time');
}

/**
 * Types sur lesquels la confirmation par la confiance agit vraiment
 * (`VOICE_CONFIDENCE_CONFIRM_SLOTS`, défaut `partySize`) : la confiance Scribe
 * sépare bien les nombres justes des faux, pas les heures (banc difficile).
 * Hors portée, la décision est seulement observée (`wouldBe…`).
 */
export function confidenceConfirmSlots(): Set<'partySize' | 'date' | 'time'> {
  const raw = process.env.VOICE_CONFIDENCE_CONFIRM_SLOTS ?? 'partySize';
  const slots = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is 'partySize' | 'date' | 'time' =>
      ['partySize', 'date', 'time'].includes(value),
    );
  return new Set(slots);
}

const WOULD_BE = {
  readBack: 'wouldBeReadBack',
  choice: 'wouldBeChoice',
  reprompt: 'wouldBeReprompt',
} as const;

/**
 * Pour chaque valeur retenue ce tour (nombre, jour, heure), vérifie la
 * confiance Scribe des mots qui la portent et la stabilité des partielles.
 * Une valeur douteuse avec un voisin confusable devient « X ou Y ? » ; une
 * valeur très douteuse sans voisin est redemandée ; une heure hors des
 * horaires d'ouverture n'est jamais acceptée d'office.
 */
function applySlotConfidence(
  session: CallSession,
  transcript: string,
  extracted: ConversationState['slots'],
  now: Date,
): void {
  // Flag coupé mais phase 1 active : la décision est calculée et publiée
  // (« wouldBe… ») pour observer, sans rien changer au dialogue.
  const enabled = isConfidenceConfirmEnabled(session);
  if (!enabled && !isExpectedAnswerEnabled(session)) return;
  const scope = confidenceConfirmSlots();
  const evidence =
    session.sttEvidence &&
    normalizeTranscript(session.sttEvidence.transcript) === normalizeTranscript(transcript)
      ? session.sttEvidence
      : null;
  const timezone = session.timezone ?? 'Europe/Paris';
  const partialSlots = (evidence?.partials ?? []).map((partial) =>
    extractConversationSlots(partial, timezone, now),
  );
  const entries: NonNullable<ConversationState['lastSlotConfidence']> = [];

  const slots: Array<['partySize' | 'date' | 'time', ConfidenceSlotKind]> = [
    ['partySize', 'partySize'],
    ['date', 'weekday'],
    ['time', 'time'],
  ];
  for (const [slot, kind] of slots) {
    const raw = extracted[slot];
    if (raw === undefined) continue;
    const apply = enabled && scope.has(slot);
    const value = slot === 'date' ? weekdayOfDate(String(raw)) : String(raw);
    const partialValues = partialSlots.map((partial, index) => {
      // L'analyse exacte ignore les groupes de plus de 7 : « dix » dans une
      // partielle doit pourtant compter comme une valeur différente de « six ».
      if (slot === 'partySize') return partialPartySize(evidence!.partials[index]);
      const partialValue = partial[slot];
      if (partialValue === undefined) return undefined;
      return slot === 'date' ? weekdayOfDate(String(partialValue)) : String(partialValue);
    });
    const slotDate = extracted.date ?? session.conversation.slots.date;
    let openTimes = kind === 'time' ? openingHourTimes(session.openingHours, slotDate) : undefined;
    // La grille est au quart d'heure : une heure ouverte comme 20:10 n'y figure pas.
    if (openTimes?.length && isWithinOpeningHours(session.openingHours, slotDate, value)) {
      openTimes = [...openTimes, value];
    }
    const confidence = valueConfidence(kind, value, evidence?.words);
    const result = decideSlotConfidence({
      kind,
      value,
      confidence,
      partialAlternatives: unstableAlternatives(value, partialValues),
      openTimes,
    });
    // Un seul « X ou Y ? » par tour ; les autres valeurs douteuses sont relues.
    let decision = result.decision;
    if (decision === 'choice' && session.conversation.answerChoice) decision = 'readBack';

    if (!apply) {
      entries.push({
        kind,
        confidence: confidence === null ? null : Math.round(confidence * 100) / 100,
        unstable: result.unstable,
        decision: WOULD_BE[decision],
      });
      continue;
    }
    if (decision === 'choice' && result.choice) {
      session.conversation.answerChoice = { kind, values: result.choice };
      delete extracted[slot];
    } else if (decision === 'reprompt') {
      session.conversation.confidenceReprompt ??= {
        kind,
        outsideOpeningHours: result.outsideOpeningHours,
      };
      delete extracted[slot];
    }
    entries.push({
      kind,
      confidence: confidence === null ? null : Math.round(confidence * 100) / 100,
      unstable: result.unstable,
      decision,
    });
  }
  session.conversation.lastSlotConfidence = entries.length ? entries : null;
}

const PARTIAL_NUMBER_WORDS: Record<string, number> = {
  une: 1,
  un: 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  six: 6,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
  onze: 11,
  douze: 12,
  treize: 13,
  quatorze: 14,
  quinze: 15,
  seize: 16,
};

/** Dernier nombre de 1 à 16 lu dans une partielle (« Dix personnes » → « 10 »). */
function partialPartySize(partial: string | undefined): string | undefined {
  if (!partial) return undefined;
  let found: number | undefined;
  for (const token of normalizeTranscript(partial).split(' ')) {
    const value = /^\d{1,2}$/.test(token) ? Number(token) : PARTIAL_NUMBER_WORDS[token];
    // « un / une » est presque toujours l'article (« une table ») : ignoré.
    if (value !== undefined && value >= 2 && value <= 16) found = value;
  }
  return found === undefined ? undefined : String(found);
}

/** Relance d'une valeur jugée trop incertaine, formulée autrement. */
export function buildConfidenceRepromptPlan(
  session: CallSession,
): AssistantReplyEmissionPlan | null {
  const reprompt = session.conversation.confidenceReprompt;
  if (!reprompt) return null;
  const en = effectiveVoiceLanguage(session) === 'en';
  if (reprompt.kind === 'time') {
    const openTimes = openingHourTimes(session.openingHours, session.conversation.slots.date);
    const primary =
      reprompt.outsideOpeningHours && openTimes.length
        ? en
          ? `We are open from ${formatAvailabilitySlot(openTimes[0], 'en')} that day. What time would you like to come?`
          : `Ce jour-là, nous sommes ouverts à partir de ${formatAvailabilitySlot(openTimes[0])}. Vers quelle heure souhaitez-vous venir ?`
        : en
          ? "Sorry, I didn't catch the time. What time would you like to come?"
          : "Pardon, je n'ai pas bien entendu l'heure. Vers quelle heure souhaitez-vous venir ?";
    return guardDialogueRepromptPlan(session, 'time', primary);
  }
  if (reprompt.kind === 'weekday') {
    return guardDialogueRepromptPlan(
      session,
      'date',
      en
        ? "Sorry, I didn't catch the day. Which day would you like to book?"
        : "Pardon, je n'ai pas bien entendu le jour. Pour quel jour souhaitez-vous réserver ?",
    );
  }
  return guardDialogueRepromptPlan(
    session,
    'partySize',
    en
      ? "Sorry, I didn't catch the number of people. How many will there be?"
      : "Pardon, je n'ai pas bien entendu le nombre de personnes. Vous serez combien ?",
  );
}

/** « Six ou dix ? » : question fermée entre les deux valeurs les plus proches. */
function spokenChoiceValue(
  kind: 'partySize' | 'weekday' | 'time',
  value: string,
  en: boolean,
): string {
  if (kind === 'partySize') {
    const n = Number(value);
    return en ? String(n) : (FRENCH_PARTY_SIZE_WORDS[n] ?? String(n));
  }
  if (kind === 'weekday') return value;
  return formatAvailabilitySlot(value, en ? 'en' : 'fr');
}

const FRENCH_PARTY_SIZE_WORDS: Record<number, string> = {
  1: 'une',
  2: 'deux',
  3: 'trois',
  4: 'quatre',
  5: 'cinq',
  6: 'six',
  7: 'sept',
  8: 'huit',
  9: 'neuf',
  10: 'dix',
  11: 'onze',
  12: 'douze',
  13: 'treize',
  14: 'quatorze',
  15: 'quinze',
  16: 'seize',
};

export function buildAnswerChoicePlan(session: CallSession): AssistantReplyEmissionPlan | null {
  const choice = session.conversation.answerChoice;
  if (!choice) return null;
  const en = effectiveVoiceLanguage(session) === 'en';
  const [first, second] = choice.values.map((value) => spokenChoiceValue(choice.kind, value, en));
  const suffix = choice.kind === 'partySize' ? (en ? ' people' : ' personnes') : '';
  // Les autres valeurs retenues au même tour sont relues dans la même phrase :
  // sinon une erreur sur l'une passe en silence (banc difficile, hv305).
  const readBack = buildNaturalReadBack(session);
  const primary = readBack
    ? `${readBack}${en ? `${first} or ${second}${suffix}?` : `${first} ou ${second}${suffix} ?`}`
    : en
      ? `Sorry, ${first} or ${second}${suffix}?`
      : `Pardon, ${first} ou ${second}${suffix} ?`;
  const key =
    choice.kind === 'partySize' ? 'partySize' : choice.kind === 'weekday' ? 'date' : 'time';
  return guardDialogueRepromptPlan(session, key, primary);
}

export function recordUserTurn(
  session: CallSession,
  transcript: string,
  speechAct: VoiceSpeechAct,
  now = new Date(),
): void {
  if (speechAct === 'closing') {
    observeVoiceReadbackResponse(session, {}, speechAct);
    const closingInteraction = getActivePendingInteraction(session);
    const decision = decideTurnPolicy(
      {
        speechAct,
        intent: session.conversation.intent,
        slots: session.conversation.slots,
        customerName: session.conversation.slots.customerName,
        activeInteractionKind:
          closingInteraction?.kind === 'open' ? null : (closingInteraction?.kind ?? null),
      },
      {
        intent: null,
        slots: {},
        partySizeEvidence: 'none',
        customerName: null,
        wantsAvailabilityOptions: false,
      },
    );
    if (decision.disposition !== 'close') return;
    session.conversation.closing = true;
    cancelAllPendingInteractions(session);
    if (decision.clearReservationConfirmation) clearReservationConfirmation(session);
    return;
  }

  const activeInteraction = getActivePendingInteraction(session);
  const activeKind =
    activeInteraction?.kind === 'open'
      ? null
      : (activeInteraction?.kind ?? session.conversation.pendingQuestion);
  const extracted = extractConversationSlots(transcript, session.timezone ?? 'Europe/Paris', now);
  let partySizeEvidence: PartySizeEvidence =
    extracted.partySize === undefined ? 'none' : 'explicit';

  if (activeKind === 'partySize' && extracted.partySize === undefined) {
    const contextualPartySize = extractContextualPartySize(transcript);
    if (contextualPartySize !== null) {
      extracted.partySize = contextualPartySize;
      partySizeEvidence = 'contextual';
    }
  }
  if (activeKind === 'partySizeConfirmation') {
    if (isAffirmativeShortResponse(transcript)) {
      const candidatePartySize = activeInteraction?.candidatePartySize;
      if (candidatePartySize !== undefined) {
        extracted.partySize = candidatePartySize;
        partySizeEvidence = 'confirmation';
      }
    } else {
      const contextualPartySize = extractContextualPartySize(transcript);
      if (contextualPartySize !== null) {
        extracted.partySize = contextualPartySize;
        partySizeEvidence = 'contextual';
      }
    }
  }

  const current = session.conversation.slots;
  const offered = session.conversation.offeredAvailability;
  if (
    offered &&
    activeKind === 'timeChoice' &&
    offered.date === current.date &&
    offered.partySize === current.partySize &&
    !extracted.date &&
    !extracted.partySize &&
    !extracted.time
  ) {
    const choice = normalizeTranscript(transcript).match(
      /^(?:(?:le|la|the) )?(premier|premiere|deuxieme|second|seconde|troisieme|dernier|derniere|first|second|third|last)(?: (?:creneau|horaire|one))?(?: s il vous plait| please)?$/,
    );
    if (choice) {
      const index = /premier|first/.test(choice[1])
        ? 0
        : /deuxieme|second/.test(choice[1])
          ? 1
          : /troisieme|third/.test(choice[1])
            ? 2
            : offered.slots.length - 1;
      const selectedTime = offered.slots[index];
      if (selectedTime) extracted.time = selectedTime;
    }
  }

  observeVoiceReadbackResponse(session, extracted, speechAct);

  const previousChoice = session.conversation.answerChoice ?? null;
  const previousGroup = session.conversation.groupRequest ?? null;
  session.conversation.answerChoice = null;
  session.conversation.groupRequest = null;
  session.conversation.closedTimeReprompt = false;
  session.conversation.justFilled = null;
  session.conversation.lastExpectedAnswer = null;
  session.conversation.phoneticAccepted = null;
  session.conversation.lastSlotConfidence = null;
  session.conversation.confidenceReprompt = null;
  if (speechAct === 'content' || speechAct === 'correction') {
    const resolved = applyExpectedAnswer(
      session,
      activeKind,
      transcript,
      extracted,
      now,
      previousChoice,
    );
    if (resolved === 'partySize') partySizeEvidence = 'contextual';
  }
  if (previousChoice) {
    const selectedValue =
      previousChoice.kind === 'partySize'
        ? extracted.partySize
        : previousChoice.kind === 'weekday'
          ? extracted.date
            ? weekdayOfDate(extracted.date)
            : undefined
          : extracted.time;
    const normalizedChoiceResponse = normalizeTranscript(transcript);
    const explicitlyNeither =
      /\b(?:aucun(?:e)?(?: des deux)?|ni l un ni l autre|neither|none of those)\b/u.test(
        normalizedChoiceResponse,
      );
    recordVoiceChoiceResponse(previousChoice, selectedValue, speechAct, explicitlyNeither);
  }
  if (speechAct === 'content' || speechAct === 'correction') {
    applyTimePlausibility(session, extracted, previousChoice);
    applySlotConfidence(session, transcript, extracted, now);
  }
  applyGroupThreshold(session, transcript, extracted, previousChoice, previousGroup);

  const wantsAvailabilityOptions = asksForAvailabilityOptions(transcript);
  const plainCustomerName = extractPlainCustomerName(
    transcript,
    session.conversation.pendingQuestion === 'customerName' && !isNameCollectionBlocking(session),
  );
  const decision = decideTurnPolicy(
    {
      speechAct,
      intent: session.conversation.intent,
      slots: current,
      customerName: current.customerName,
      activeInteractionKind: activeKind,
      ...(activeInteraction?.candidatePartySize !== undefined
        ? { activeInteractionCandidatePartySize: activeInteraction.candidatePartySize }
        : {}),
    },
    {
      intent: inferIntent(transcript),
      slots: extracted,
      partySizeEvidence,
      customerName: plainCustomerName,
      wantsAvailabilityOptions,
    },
  );
  if (decision.disposition === 'ignore') return;

  session.conversation.closing = false;
  const dayPeriod = extractDayPeriod(transcript);
  if (dayPeriod) session.conversation.dayPeriod = dayPeriod;
  if (decision.clearReservationConfirmation) clearReservationConfirmation(session);
  if (decision.intent) session.conversation.intent = decision.intent;
  if (decision.wantsAvailabilityOptions) session.conversation.wantsAvailabilityOptions = true;
  if (decision.invalidateAvailability) {
    session.conversation.offeredAvailability = undefined;
    session.conversation.lastAvailabilityResult = null;
    session.conversation.lastAvailabilityCheck = null;
  }
  session.conversation.justFilled = {
    partySize:
      decision.slots.partySize !== undefined && decision.slots.partySize !== current.partySize,
    date: decision.slots.date !== undefined && decision.slots.date !== current.date,
    time: decision.slots.time !== undefined && decision.slots.time !== current.time,
  };
  Object.assign(current, decision.slots);
  for (const slot of ['date', 'time', 'partySize'] as const) {
    const value = decision.slots[slot];
    if (value === undefined) continue;
    session.conversation.slotProvenance = {
      ...session.conversation.slotProvenance,
      [slot]: {
        source:
          slot === 'partySize' && partySizeEvidence !== 'none' ? partySizeEvidence : 'explicit',
        value,
      },
    };
  }
  if (decision.customerName) current.customerName = decision.customerName;

  if (activeInteraction && decision.resolveInteraction) {
    finishActivePendingInteraction(session, 'resolved', decision.resolveInteraction);
  }

  // Un tour qui a fait avancer le brouillon remet le garde-fou à zéro : la
  // relance suivante est une première relance, pas une répétition.
  if (decision.progressed) {
    // Une proposition de repli humain devient caduque dès que l'appelant
    // apporte une information : le parcours de réservation reprend.
    if (
      session.conversation.humanFallbackOffered ||
      session.conversation.pendingQuestion === 'humanFallback'
    ) {
      clearHumanFallback(session);
    } else {
      resetDialogueStall(session);
    }
  }
}

function asksForAvailabilityAlternative(transcript: string): boolean {
  const normalized = normalizeTranscript(transcript);
  return /\b(?:que|qu est ce que) (?:vous|tu) propose(?:z)?(?: quoi)?\b|\b(?:vous|tu) propose(?:z)? quoi\b|\b(?:je|on) (?:lui )?propose quoi\b|\bquelles? (?:sont les )?alternatives?\b|\bautres? (?:heure|horaire|creneau)\b|\b(?:sinon|une autre heure)\b|\bwhat else do you have\b|\bany other (?:time|slot)\b|\bwhat alternatives\b|\bwhat do you suggest\b/.test(
    normalized,
  );
}

function formatAvailabilitySlot(slot: string, language: VoiceLanguageCode = 'fr'): string {
  if (language === 'en') {
    const [hourValue, minuteValue] = slot.split(':').map(Number);
    const suffix = hourValue >= 12 ? 'PM' : 'AM';
    const hour = hourValue % 12 || 12;
    return minuteValue === 0
      ? `${hour} ${suffix}`
      : `${hour}:${String(minuteValue).padStart(2, '0')} ${suffix}`;
  }
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

export function buildAvailabilityFollowupPlan(
  session: CallSession,
  transcript: string,
): AssistantReplyEmissionPlan | null {
  if (!asksForAvailabilityAlternative(transcript)) return null;
  const result = session.conversation.lastAvailabilityResult;
  if (!result) return null;
  const language = effectiveVoiceLanguage(session);

  if (result.slots.length === 0) {
    const noAlternative =
      language === 'en'
        ? "I don't have another verified time that day."
        : "Je n'ai aucun autre créneau vérifié ce jour-là.";
    const reply = `${noAlternative} ${buildHumanFallbackOffer(session)}`;
    return buildExplicitInteractionReplyPlan(session, reply, 'humanFallback');
  }

  const alternatives = selectClosestAvailabilitySlots(result.time, result.slots)
    .map((slot) => formatAvailabilitySlot(slot, language))
    .join(language === 'en' ? ' or ' : ' ou ');
  const reply =
    language === 'en'
      ? `I can offer ${alternatives}. Which one works for you?`
      : `Je peux vous proposer ${alternatives}. Lequel vous convient ?`;
  return buildExplicitInteractionReplyPlan(session, reply, 'timeChoice');
}

export function buildAvailabilityFollowupResponse(
  session: CallSession,
  transcript: string,
): string | null {
  return buildAvailabilityFollowupPlan(session, transcript)?.reply ?? null;
}

export function buildReservationProgressPlan(
  session: CallSession,
  transcript = '',
): AssistantReplyEmissionPlan | null {
  const { intent, slots } = session.conversation;
  if (intent !== 'reservation' && intent !== 'availability') return null;
  // Une conversation qui se clôt ne doit plus relancer le formulaire.
  if (session.conversation.closing) return null;

  // Ne pas répondre déterministiquement si le transcript de l'utilisateur
  // n'est pas pertinent pour la réservation (plainte, question, frustration,
  // phrase longue ou complexe). Dans ce cas, laisser le LLM gérer.
  if (transcript) {
    const normalized = normalizeTranscript(transcript);
    // Mots qui indiquent que l'utilisateur ne répond pas à la question en attente
    if (
      /\b(?:pourquoi|comment|arrete|raccroche|laissez tomber|c est bon|allez|genant|bizarre|probleme|marche pas|entends pas|comprends pas|why|how|stop|hang up|never mind|problem|not working|can t hear|don t understand)\b/.test(
        normalized,
      )
    ) {
      return null;
    }
    // Si le transcript est long (> 60 chars) et ne contient aucune info de slot,
    // c'est probablement une phrase complexe → LLM
    const extracted = extractConversationSlots(transcript, session.timezone ?? 'Europe/Paris');
    const hasSlotInfo = Boolean(extracted.date || extracted.time || extracted.partySize);
    // Une question, une objection ou une demande d'explication n'est pas une
    // réponse au champ manquant : le LLM y répond dans le contexte plutôt que
    // de relancer le formulaire comme si l'appelant n'avait rien dit.
    if (!hasSlotInfo && isExploratoryUtterance(transcript)) return null;
    if (normalized.length > 60 && !hasSlotInfo) {
      return null;
    }
  }

  const language = effectiveVoiceLanguage(session);
  const readBack = buildNaturalReadBack(session);
  if (!slots.date)
    return guardDialogueRepromptPlan(
      session,
      'date',
      readBack + (language === 'en' ? 'What day would you like to come?' : 'Pour quel jour ?'),
    );
  if (!slots.partySize)
    return guardDialogueRepromptPlan(
      session,
      'partySize',
      readBack + (language === 'en' ? 'How many people will there be?' : 'Vous serez combien ?'),
    );
  if (!slots.time)
    return guardDialogueRepromptPlan(
      session,
      'time',
      readBack +
        (language === 'en'
          ? 'What time would you like to come?'
          : 'Vous voulez venir vers quelle heure ?'),
    );
  return null;
}

/**
 * Relecture naturelle des valeurs comprises au tour précédent, glissée devant
 * la question suivante (« Six personnes, très bien. Pour quel jour ? »). Une
 * erreur de transcription (« cinq » pour « sept ») s'entend et se corrige tout
 * de suite, sans tour supplémentaire. La date est relue avec son numéro, pour
 * qu'une confusion de jour soit audible.
 */
function phoneticDateReadBack(session: CallSession): string {
  return session.conversation.phoneticAccepted === 'date'
    ? buildNaturalReadBack(session, 'date')
    : '';
}

function buildNaturalReadBack(session: CallSession, only?: 'date'): string {
  if (!isExpectedAnswerEnabled(session)) return '';
  const justFilled = session.conversation.justFilled;
  if (!justFilled) return '';
  const filled: { partySize?: boolean; date?: boolean; time?: boolean } = only
    ? { date: justFilled.date }
    : {
        ...justFilled,
        // Une heure devinée est toujours relue, même si elle n'a pas changé.
        time: justFilled.time || session.conversation.phoneticAccepted === 'time',
      };
  const { partySize, date } = session.conversation.slots;
  const en = effectiveVoiceLanguage(session) === 'en';
  const parts: string[] = [];
  const readBacks: Array<{ kind: VoiceQualityKind; value: string | number }> = [];
  if (filled.partySize && partySize) {
    readBacks.push({ kind: 'party_size', value: partySize });
    parts.push(
      en
        ? `${partySize} ${partySize === 1 ? 'person' : 'people'}`
        : partySize === 1
          ? 'une personne'
          : `${FRENCH_PARTY_SIZE_WORDS[partySize] ?? partySize} personnes`,
    );
  }
  if (filled.date && date) {
    readBacks.push({ kind: 'date', value: date });
    parts.push(
      new Date(`${date}T12:00:00Z`).toLocaleDateString(en ? 'en-GB' : 'fr-FR', {
        weekday: 'long',
        day: 'numeric',
        timeZone: 'UTC',
      }),
    );
  }
  // L'heure est relue dans la question suivante (« Quatre personnes à 20 h,
  // très bien. ») ; la réponse de disponibilité, qui la cite déjà, n'appelle
  // cette relecture que pour le jour : pas de double relecture.
  const time = session.conversation.slots.time;
  if (filled.time && time) {
    readBacks.push({ kind: 'time', value: time });
    const spoken = formatAvailabilitySlot(time, en ? 'en' : 'fr');
    parts.push(parts.length ? `${en ? 'at' : 'à'} ${spoken}` : spoken);
  }
  if (!parts.length) return '';
  for (const readBack of readBacks) {
    recordVoiceReadbackForTurn(session, readBack.kind, readBack.value);
  }
  const phrase = parts.join(' ');
  return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}, ${en ? 'great' : 'très bien'}. `;
}

export function buildReservationProgressResponse(
  session: CallSession,
  transcript = '',
): string | null {
  return buildReservationProgressPlan(session, transcript)?.reply ?? null;
}

/**
 * Une question, une objection ou un aveu d'incompréhension demandent une
 * réponse contextualisée, jamais une relance mécanique du champ manquant.
 */
function isExploratoryUtterance(transcript: string): boolean {
  if (/\?/.test(transcript)) return true;
  const normalized = normalizeTranscript(transcript);
  return /\b(?:pourquoi|comment|qu est ce que|est ce que|c est quoi|expliquez|explique|je ne comprends pas|je comprends pas|je ne sais pas|why|how|what is|do you|can you|could you|i don t understand|i don t know)\b/.test(
    normalized,
  );
}

function isAmbiguousPartySizeReply(session: CallSession, transcript: string): boolean {
  if (session.conversation.pendingQuestion !== 'partySize') return false;
  const extracted = extractConversationSlots(transcript, session.timezone ?? 'Europe/Paris');
  if (extracted.partySize) return false;
  // Une autre information (date, heure) fait avancer la réservation : ce n'est
  // pas une réponse incomprise.
  if (extracted.date || extracted.time) return false;

  const normalized = normalizeTranscript(transcript);
  if (
    /\b(?:personne|personnes|on sera|nous serons|combien|people|guests|party|how many)\b/.test(
      normalized,
    )
  ) {
    return true;
  }
  // Réponse courte sans aucun fait exploitable, souvent un nombre mal transcrit
  // (« six personnes » → « super femme », appel du 24/09) : on redemande le
  // nombre au lieu de passer à la question suivante.
  const wordCount = normalized.split(' ').filter(Boolean).length;
  return wordCount > 0 && wordCount <= 5 && !isExploratoryUtterance(transcript);
}

/**
 * Détecte une proposition de repli humain (transfert gérant ou prise de
 * message) dans un texte de l'agent. La réponse de l'appelant doit alors
 * déclencher une action réelle au lieu de relancer le formulaire.
 */
export function isHumanFallbackOfferText(text: string): boolean {
  const normalized = normalizeTranscript(text);
  return containsHumanTransferOffer(normalized) || containsHumanMessageOffer(normalized);
}

function containsHumanTransferOffer(normalized: string): boolean {
  return /\b(?:passe(?:r)? le gerant|transferer au gerant|transfert au gerant|put you through|connect you to the manager)\b/.test(
    normalized,
  );
}

function containsHumanMessageOffer(normalized: string): boolean {
  return /\b(?:(?:prendre|prenne|laisser|laisse) un message|take a message|leave a message)\b/.test(
    normalized,
  );
}

/** Mots jusqu'à « vingt », chiffres jusqu'à 100 : de quoi reconnaître un groupe. */
const SPOKEN_PARTY_SIZE_PATTERN =
  '(\\d{1,3}|zero|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix[ -](?:sept|huit|neuf)|dix|onze|douze|treize|quatorze|quinze|seize|vingt|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|twenty)';

const MAX_SPOKEN_PARTY_SIZE = 100;

function partySizeFromNumberToken(token: string): number | null {
  const normalized = normalizeTranscript(token);
  const value =
    parseFrenchNumberWords(normalized) ??
    (normalized === 'twenty' ? 20 : ENGLISH_NUMBER_WORDS[normalized]) ??
    (/^\d{1,3}$/.test(normalized) ? Number(normalized) : null);
  // Le seuil du restaurant (`voiceMaxPartySize`) est appliqué au tour, pas ici :
  // un nombre au-delà doit être lu pour déclencher le parcours de groupe.
  return value !== null && value >= 1 && value <= MAX_SPOKEN_PARTY_SIZE ? value : null;
}

export function voiceMaxPartySize(session: Pick<CallSession, 'maxPartySize'>): number {
  const value = session.maxPartySize;
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
    ? Math.min(value, MAX_SPOKEN_PARTY_SIZE)
    : DEFAULT_MAX_PARTY_SIZE;
}

/** Lit un nombre sans unité quand la question active attend explicitement les couverts. */
function extractContextualPartySize(transcript: string): number | null {
  const normalized = normalizeTranscript(transcript);
  const contextualPattern = new RegExp(
    `\\b(?:on (?:serait|sera|serons|est|ferait|fera|fait|vient)|nous (?:serions|serons|sommes|ferions|faisons|venons)|vous (?:etes|seriez|serez)|we (?:are|will be)|there (?:will be|are))\\s+(?:bien\\s+)?(?:a|pour)?\\s*${SPOKEN_PARTY_SIZE_PATTERN}\\b`,
    'g',
  );
  // « on sera une petite tablée », « on est un groupe » : un/une suivi d'un
  // autre mot que l'unité est un article, pas un nombre de couverts.
  const contextualMatches = [...normalized.matchAll(contextualPattern)].filter(
    (match) =>
      !/^une?$/.test(match[1]) ||
      !/^\s+(?!(?:personnes?|seule?|people|guests?|person)\b)\p{L}/u.test(
        normalized.slice((match.index ?? 0) + match[0].length),
      ),
  );
  if (contextualMatches.length) {
    const values = contextualMatches
      .map((match) => partySizeFromNumberToken(match[1]))
      .filter((value): value is number => value !== null);
    if (new Set(values).size === 1) return values[0];
    return null;
  }

  const bareAnswer = normalized.match(
    new RegExp(
      `^(?:oui |ouais |alors |ben |non |plutot |en fait )?(?:pour |for )?${SPOKEN_PARTY_SIZE_PATTERN}(?: personnes?| people| guests?)?(?: s il vous plait| svp| merci| please)?$`,
    ),
  );
  return bareAnswer ? partySizeFromNumberToken(bareAnswer[1]) : null;
}

function partySizeConfirmationCandidate(question: string): number | null {
  if (!question.includes('?')) return null;
  return extractContextualPartySize(question);
}

function humanFallbackModeFromText(text: string): 'choice' | 'transfer' | 'message' {
  const normalized = normalizeTranscript(text);
  const offersTransfer = containsHumanTransferOffer(normalized);
  const offersMessage = containsHumanMessageOffer(normalized);
  if (offersTransfer && offersMessage) return 'choice';
  return offersTransfer ? 'transfer' : 'message';
}

export function pendingQuestionFrom(question: string): PendingQuestion {
  const normalized = normalizeTranscript(question);
  // Proposition de repli humain : la réponse de l'appelant doit déclencher une
  // action réelle (transfert ou prise de message), pas une relance du formulaire.
  if (isHumanFallbackOfferText(question)) return 'humanFallback';
  if (partySizeConfirmationCandidate(question) !== null) return 'partySizeConfirmation';
  if (/\b(?:quelle date|quel jour|quand|what day|which day|what date|when)/.test(normalized))
    return 'date';
  if (
    /\b(?:ca vous irait|cela vous irait|quel(?:le)? horaire (?:choisissez|preferez|souhaitez)[ -]vous|quel(?:le)? creneau (?:choisissez|preferez|souhaitez)[ -]vous|quel horaire vous conviendrait|quel creneau vous conviendrait|quel horaire vous convient|quel creneau vous convient|entre .* horaires?|parmi .* horaires?|would either work|which one works|what time works)/.test(
      normalized,
    )
  )
    return 'timeChoice';
  if (
    /\b(?:quelle heure|a quelle heure|vers quelle heure|quel horaire|quel creneau|what time|which time)/.test(
      normalized,
    )
  )
    return 'time';
  if (/\b(?:combien de personnes|pour combien|vous serez combien)/.test(normalized)) {
    return 'partySize';
  }
  if (/\b(?:how many people|how many guests|how many of you|party size)/.test(normalized))
    return 'partySize';
  if (
    /\b(?:votre nom|quel est votre nom|au nom de qui|a quel nom|quel nom|nom pour la reservation|quelle est la (?:premiere|deuxieme|troisieme|quatrieme|cinquieme|sixieme) lettre|lettre par lettre|epeler|epellez?|what is your name|what name|under what name|spell your name|spelling)\b/.test(
      normalized,
    )
  )
    return 'customerName';
  if (/\b(?:telephone|numero|phone|telephone number|mobile)/.test(normalized))
    return 'customerPhone';
  if (
    /\b(?:vous me confirmez|confirmez[- ]vous|est[- ]ce correct|c est bien ca|c est bien cela|ca vous convient|cela vous convient|ca vous va|cela vous va|ca vous irait|cela vous irait|ca marche|c est bon(?: pour vous)?|c est correct|tout est bon|je confirme|on part la dessus|on valide|vous validez|je peux confirmer|je peux la reserver|je la reserve|je note|je valide|voulez[- ]vous que je reserve|souhaitez[- ]vous que je reserve|je lance la reservation|je cree la reservation|shall i book|may i confirm|should i book|is that correct|does that work)\b/.test(
      normalized,
    )
  )
    return 'confirmation';
  return null;
}

export function proposeAssistantInteractionFromLlmText(
  session: CallSession,
  reply: string,
): AssistantInteractionProposal {
  const lastQuestion = finalAssistantQuestion(reply);
  let pendingQuestion: PendingQuestion = null;
  if (lastQuestion) {
    // Une confirmation d'épellation (« A-K-I-F, c'est bien cela ? ») porte
    // sur le nom présenté, pas sur le récapitulatif de réservation. Le
    // contexte de collecte reste prioritaire sur le motif générique
    // « c'est bien cela ».
    pendingQuestion =
      isNameCollectionBlocking(session) &&
      session.conversation.nameCollection.state === 'confirming'
        ? 'customerName'
        : pendingQuestionFrom(lastQuestion);
  } else if (isNameCollectionBlocking(session)) {
    // L'état de collecte ne doit pas disparaître parce qu'une réponse
    // intermédiaire n'a pas de point d'interrogation exploitable.
    pendingQuestion = 'customerName';
  }
  // Une proposition de repli humain peut s'étaler sur plusieurs phrases : on
  // l'analyse sur le texte complet, pas seulement sur la dernière question.
  // L'état précédent ne survit pas à une nouvelle réponse de l'agent : une
  // question de réservation ultérieure remplace l'ancienne proposition.
  const fallbackOffer = isHumanFallbackOfferText(reply);
  const interactionKind: PendingInteractionKind | null = fallbackOffer
    ? 'humanFallback'
    : (pendingQuestion ?? (lastQuestion ? 'open' : null));
  if (!interactionKind) return { source: 'llm_text_fallback', operation: 'cancel' };
  return {
    source: 'llm_text_fallback',
    operation: 'activate',
    interaction: {
      kind: interactionKind,
      prompt: interactionKind === 'humanFallback' ? reply : (lastQuestion ?? reply),
      ...(fallbackOffer ? { fallbackMode: humanFallbackModeFromText(reply) } : {}),
      ...(interactionKind === 'partySizeConfirmation'
        ? {
            candidatePartySize: partySizeConfirmationCandidate(lastQuestion ?? reply) ?? undefined,
          }
        : {}),
    },
  };
}

/** Extracts presentation text only; it does not infer an interaction kind. */
export function finalAssistantQuestion(reply: string): string | null {
  return reply.match(/([^.!?\n]+\?)\s*$/u)?.[1]?.trim() ?? null;
}

function buildExplicitInteractionReplyPlan(
  session: CallSession,
  reply: string,
  kind: PendingInteractionKind,
): AssistantReplyEmissionPlan {
  const prompt = kind === 'humanFallback' ? reply : (finalAssistantQuestion(reply) ?? reply);
  const interaction: NonNullable<AssistantInteractionProposal['interaction']> = {
    kind,
    prompt,
    ...(kind === 'humanFallback'
      ? { fallbackMode: session.managerPhone?.trim() ? 'choice' : 'message' }
      : {}),
    ...(kind === 'partySizeConfirmation'
      ? {
          candidatePartySize: getActivePendingInteraction(session)?.candidatePartySize,
        }
      : {}),
  };
  return {
    reply,
    proposal: { source: 'explicit', operation: 'activate', interaction },
  };
}

function buildHumanFallbackReplyPlan(
  session: CallSession,
  reply = buildHumanFallbackOffer(session),
): AssistantReplyEmissionPlan {
  return buildExplicitInteractionReplyPlan(session, reply, 'humanFallback');
}

/**
 * Applies only a policy-approved assistant plan. `reply` is presentation and
 * contributes no question or interaction semantics here.
 */
export function recordAssistantReply(
  session: CallSession,
  reply: string,
  decision: AssistantInteractionPolicyDecision,
): void {
  if (decision.status !== 'accepted') return;

  if (decision.operation === 'activate' && decision.interaction) {
    if (decision.clearReservationConfirmation) clearReservationConfirmation(session);
    activatePendingInteraction(session, decision.interaction.kind, decision.interaction.prompt, {
      ...(decision.interaction.fallbackMode
        ? { fallbackMode: decision.interaction.fallbackMode }
        : {}),
      ...(decision.interaction.candidatePartySize !== undefined
        ? { candidatePartySize: decision.interaction.candidatePartySize }
        : {}),
    });
  } else if (decision.operation === 'cancel') {
    if (getActivePendingInteraction(session)) {
      finishActivePendingInteraction(session, 'cancelled');
    }
    resumeSuspendedPendingInteraction(session);
    if (decision.clearReservationConfirmation) clearReservationConfirmation(session);
  }

  if (decision.operation === 'activate' && decision.interaction?.kind === 'confirmation') {
    // L'accord reste lié au brouillon exact autorisé par la policy.
    session.conversation.pendingReservationConfirmationKey =
      decision.pendingReservationConfirmationKey;
    session.conversation.confirmedReservationKey = null;
  }

  if (
    /je n'ai pas (?:bien )?compris|pouvez-vous repeter|i (?:didn't|did not) understand|could you repeat|please repeat/i.test(
      reply,
    )
  ) {
    session.conversation.misunderstandingCount++;
  } else {
    // Une réponse métier cohérente confirme que le tour courant a été
    // compris : ne pas cumuler des incompréhensions anciennes.
    session.conversation.misunderstandingCount = 0;
  }
}

/** Proposes the legacy deterministic interpretation, then routes it through policy. */
export function recordAssistantReplyWithPolicy(
  session: CallSession,
  reply: string,
  proposal: AssistantInteractionProposal,
): void {
  const decision = decideAssistantInteractionPolicy(
    proposal,
    getReservationConfirmationKey(session),
  );
  if (decision.status === 'accepted') {
    recordAssistantReply(session, reply, decision);
    return;
  }

  const safeFallback = decideAssistantInteractionPolicy(
    { source: proposal.source, operation: 'cancel' },
    getReservationConfirmationKey(session),
  );
  if (safeFallback.status === 'accepted') recordAssistantReply(session, reply, safeFallback);
}

/** Use only for unstructured LLM text when its caller has no typed reply plan. */
export function recordAssistantReplyFromLlmTextFallback(session: CallSession, reply: string): void {
  recordAssistantReplyWithPolicy(
    session,
    reply,
    proposeAssistantInteractionFromLlmText(session, reply),
  );
}

/** Fil de dialogue suivi par le garde-fou anti-boucle. */
export type DialogueStallKey =
  | 'date'
  | 'time'
  | 'timeChoice'
  | 'partySize'
  | 'customerName'
  | 'customerPhone'
  | 'open';

/** Oublie le fil en cours : un tour qui a fait avancer le brouillon repart à zéro. */
export function resetDialogueStall(session: CallSession): void {
  session.conversation.stalledTurns = 0;
  session.conversation.stallSignature = null;
}

/**
 * Garde-fou d'un tour confié au modèle : la même question reposée sans nouveau
 * fait compte comme une relance, exactement comme une relance déterministe.
 */
export function recordModelTurnStall(
  session: CallSession,
  questionBeforeTurn: PendingQuestion,
  progressed: boolean,
): DialogueStallLevel | null {
  if (progressed) {
    resetDialogueStall(session);
    return null;
  }
  const question = session.conversation.pendingQuestion;
  if (!question || question !== questionBeforeTurn) return null;
  return registerDialogueStall(session, dialogueStallKeyFromPendingQuestion(session));
}

/**
 * Après deux relances sur la même question, le tour suivant revient au
 * déterministe, qui reformule puis propose un repli humain réel.
 */
export function isModelTurnStalled(session: CallSession): boolean {
  const { stalledTurns, stallSignature, pendingQuestion } = session.conversation;
  return (
    pendingQuestion !== null &&
    stalledTurns >= 2 &&
    stallSignature === dialogueStallKeyFromPendingQuestion(session)
  );
}

/** Efface la trace du garde-fou anti-boucle avant le tour suivant. */
export function clearDialogueGuardTrace(session: CallSession): void {
  session.conversation.lastDialogueGuard = null;
}

function dialogueStallKeyFromPendingQuestion(session: CallSession): DialogueStallKey {
  switch (session.conversation.pendingQuestion) {
    case 'date':
    case 'time':
    case 'timeChoice':
    case 'partySize':
    case 'customerName':
    case 'customerPhone':
      return session.conversation.pendingQuestion;
    case 'partySizeConfirmation':
      return 'partySize';
    default:
      return 'open';
  }
}

/**
 * Enregistre une relance déterministe et retourne le niveau de réponse.
 *
 * `ask` pour la première demande, `reformulate` quand la même question revient
 * sans progrès, `escalate` quand le blocage persiste : le dialogue ne doit
 * jamais rester coincé sur une phrase répétée à l'identique.
 */
export function registerDialogueStall(
  session: CallSession,
  key: DialogueStallKey,
): DialogueStallLevel {
  const conversation = session.conversation;
  if (conversation.stallSignature === key) {
    conversation.stalledTurns += 1;
  } else {
    conversation.stallSignature = key;
    conversation.stalledTurns = 1;
  }
  const level: DialogueStallLevel =
    conversation.stalledTurns >= 3
      ? 'escalate'
      : conversation.stalledTurns >= 2
        ? 'reformulate'
        : 'ask';
  conversation.lastDialogueGuard = { key, level, count: conversation.stalledTurns };
  return level;
}

/** Reformulation d'une question déjà posée, avec un exemple concret. */
function buildReformulatedPrompt(session: CallSession, key: DialogueStallKey): string {
  const en = effectiveVoiceLanguage(session) === 'en';
  switch (key) {
    case 'date':
      return en
        ? "I still don't have the day. Say for example “tomorrow” or “Friday”. Which day suits you?"
        : "Je n'ai pas encore le jour. Dites-moi par exemple « demain » ou « vendredi ». Quel jour vous convient ?";
    case 'time':
      return en
        ? 'What time would work for you? For example 7 PM or 8:30 PM.'
        : 'Quelle heure vous arrangerait ? Par exemple « 19 h » ou « 20 h 30 ».';
    case 'timeChoice':
      return en
        ? 'Which of the times I just offered would you like? Say “the first”, “the second”, or the exact time.'
        : 'Lequel des horaires que je viens de proposer préférez-vous ? Dites « le premier », « le deuxième », ou l’heure exacte.';
    case 'partySize':
      return en
        ? 'How many people should I book for? Just tell me a number, for example “four”.'
        : 'Je note combien de personnes ? Dites-moi simplement un nombre, par exemple « quatre ».';
    case 'customerName':
      return en
        ? 'What name should I put the booking under? You can also spell it letter by letter.'
        : 'Quel nom je note pour la réservation ? Vous pouvez aussi épeler votre nom, lettre par lettre.';
    case 'customerPhone':
      return en
        ? 'Which number may I use to text you the confirmation?'
        : 'Quel numéro je peux utiliser pour vous envoyer la confirmation par SMS ?';
    case 'open':
      return en
        ? 'Let’s restart simply. Tell me what you need: a table, a cancellation, or a message for the team.'
        : "Reprenons simplement. Dites-moi ce dont vous avez besoin : une table, une annulation ou un message pour l'équipe.";
  }
}

/**
 * Proposition de repli humain réellement disponible. Elle annonce uniquement
 * ce que le manager peut exécuter : transfert si une ligne gérant est
 * configurée, prise de message sinon.
 */
export function buildHumanFallbackOffer(session: CallSession): string {
  const en = effectiveVoiceLanguage(session) === 'en';
  let offer: string;
  if (session.managerPhone?.trim()) {
    offer = en
      ? 'I can put you through to the manager, or take a message for them. Which do you prefer?'
      : 'Je peux vous passer le gérant, ou prendre un message pour lui. Que préférez-vous ?';
  } else {
    offer = en
      ? 'I can take a message for the manager; they will call you back. Would you like me to do that?'
      : 'Je peux prendre un message pour le gérant, il vous rappellera. Voulez-vous que je le fasse ?';
  }
  return offer;
}

/** Efface l'état de repli humain quand la proposition n'est plus en attente. */
export function clearHumanFallback(
  session: CallSession,
  status: Extract<PendingInteractionStatus, 'resolved' | 'cancelled'> = 'cancelled',
): void {
  const active = getActivePendingInteraction(session);
  if (status === 'resolved') {
    // Un transfert ou un message termine le parcours vocal courant ; ne
    // réactive pas une ancienne question de réservation après cette action.
    for (const interaction of session.conversation.pendingInteractions) {
      if (interaction.status === 'suspended') interaction.status = 'cancelled';
    }
  }
  for (const interaction of session.conversation.pendingInteractions) {
    if (interaction.kind === 'humanFallback' && interaction.status === 'suspended') {
      interaction.status = status;
    }
  }
  if (active?.kind === 'humanFallback') {
    finishActivePendingInteraction(session, status);
  } else {
    syncPendingInteractionProjection(session);
  }
  resetDialogueStall(session);
}

export type HumanFallbackChoice = 'transfer' | 'message' | 'clarify' | null;

function isHumanFallbackDecline(transcript: string): boolean {
  return /^(?:non merci|non merci beaucoup|no thanks?|pas besoin|ca ira|laissez tomber|never mind|forget it)$/.test(
    normalizeTranscript(transcript),
  );
}

function explicitlySelectsTransfer(transcript: string): boolean {
  const normalized = normalizeTranscript(transcript);
  return /^(?:(?:oui|ouais|ok|d accord|alors|ben) )?(?:(?:passez?[- ]moi|mettez?[- ]moi en relation|transfer(?:ez)?[- ]moi|put me through|connect me to)\b.*|(?:le )?(?:gerant|manager|transfert|transfer)(?: s il vous plait)?)$/.test(
    normalized,
  );
}

function explicitlySelectsMessage(transcript: string): boolean {
  const normalized = normalizeTranscript(transcript);
  return /^(?:(?:oui|ouais|ok|d accord|alors|ben) )?(?:(?:prenez|prends|prendre|laissez|laisser) un message|(?:un )?message|(?:je prefere|je choisis) (?:un message|que vous preniez un message)|rappel|rappelez[- ]moi)$/.test(
    normalized,
  );
}

/** Reformule la demande sans choisir ni exécuter une action à la place du client. */
export function buildHumanFallbackClarification(session: CallSession, transcript: string): string {
  const en = effectiveVoiceLanguage(session) === 'en';
  const normalized = normalizeTranscript(transcript);
  const explicitlyWantsTransfer = explicitlySelectsTransfer(normalized);
  if (explicitlyWantsTransfer && !session.managerPhone?.trim()) {
    return en
      ? 'I can’t put you through to the manager directly, but I can take a message. Would you like me to do that?'
      : 'Je ne peux pas vous passer le gérant directement, mais je peux prendre un message. Voulez-vous que je le fasse ?';
  }
  if (session.managerPhone?.trim()) {
    return en
      ? 'Would you prefer that I put you through to the manager or take a message?'
      : 'Vous préférez que je vous passe le gérant ou que je prenne un message ?';
  }
  return en
    ? 'Would you like me to take a message for the manager?'
    : 'Souhaitez-vous que je prenne un message pour le gérant ?';
}

/**
 * Interprète la réponse à une proposition de repli humain. Un accord ne choisit
 * qu'une proposition oui/non ; entre deux choix, il faut une demande explicite.
 */
export function resolveHumanFallbackChoice(
  session: CallSession,
  transcript: string,
): HumanFallbackChoice {
  const hasManagerLine = Boolean(session.managerPhone?.trim());
  const wantsTransfer = explicitlySelectsTransfer(transcript);
  const wantsMessage = explicitlySelectsMessage(transcript);
  const fallbackMode =
    session.conversation.humanFallbackMode ?? (hasManagerLine ? 'choice' : 'message');

  let choice: HumanFallbackChoice = null;
  if (wantsTransfer && hasManagerLine) choice = 'transfer';
  else if (wantsMessage) choice = 'message';
  else if (wantsTransfer) choice = 'clarify';
  else if (isAffirmativeShortResponse(transcript)) {
    if (fallbackMode === 'choice') choice = 'clarify';
    else if (fallbackMode === 'transfer') choice = hasManagerLine ? 'transfer' : 'clarify';
    else choice = 'message';
  }

  if (choice === 'transfer' || choice === 'message') {
    clearHumanFallback(session, 'resolved');
    return choice;
  }
  if (
    isNegativeShortResponse(transcript) ||
    isHumanFallbackDecline(transcript) ||
    classifyVoiceSpeechAct(transcript) === 'closing'
  ) {
    // Refuser le transfert/message ne signifie pas nécessairement terminer
    // l'appel : le LLM peut reprendre le besoin initial.
    clearHumanFallback(session);
    return null;
  }
  if (choice === 'clarify') return choice;

  // Une question ou un autre sujet invalide l'ancien choix. Le tour suivant
  // sera lié à la nouvelle question réellement posée par l'agent.
  clearHumanFallback(session);
  return null;
}

/**
 * Applique le garde-fou à une relance : première formulation habituelle,
 * reformulation avec exemple, puis proposition de repli humain. La formulation
 * principale reste fournie par l'appelant pour que le message exact du tour
 * initial ne change pas.
 */
export function guardDialogueReprompt(
  session: CallSession,
  key: DialogueStallKey,
  primary: string,
): string {
  return guardDialogueRepromptPlan(session, key, primary).reply;
}

export function guardDialogueRepromptPlan(
  session: CallSession,
  key: DialogueStallKey,
  primary: string,
): AssistantReplyEmissionPlan {
  const level = registerDialogueStall(session, key);
  if (level === 'escalate') return buildHumanFallbackReplyPlan(session);
  const reply = level === 'reformulate' ? buildReformulatedPrompt(session, key) : primary;
  return buildExplicitInteractionReplyPlan(session, reply, key);
}

/** Réponses courtes qui ne nécessitent ni interprétation ni appel LLM.
 *
 * Volontairement minimal : on laisse le LLM gérer le stt conversationnel
 * (demander date/heure/nombre, répondre aux questions, gérer les corrections)
 * pour des réponses naturelles et variées. Le déterministe ne garde que :
 * - proposition de repli humain après 2 incompréhensions (sécurité)
 * - backchannel simple (l'utilisateur dit "oui" → reposer la dernière question)
 * - clarification nombre de personnes ambigu
 * - followup de disponibilité (alternatives proposées par l'outil)
 * - garde-fou anti-boucle : reformulation puis repli humain réel
 */
export function buildDeterministicTurnPlan(
  session: CallSession,
  speechAct: VoiceSpeechAct,
  transcript = '',
  options: { deferUnresolvedToModel?: boolean } = {},
): AssistantReplyEmissionPlan | null {
  // Une proposition de repli humain en attente est traitée par l'orchestrateur
  // (transfert ou message réellement exécuté) : le déterministe ne la répète pas.
  if (session.conversation.pendingQuestion === 'humanFallback') return null;

  // Décidés à ce tour par l'analyse de la réponse : ils passent avant la
  // relance générique d'une réponse courte.
  if (speechAct === 'content' || speechAct === 'correction') {
    const groupPlan = buildGroupConfirmationPlan(session);
    if (groupPlan) return groupPlan;
    const closedTimePlan = buildClosedTimeRepromptPlan(session);
    if (closedTimePlan) return closedTimePlan;
  }

  const pendingShortResponse = buildPendingQuestionReplyPlan(session, transcript);
  if (pendingShortResponse) return pendingShortResponse;

  // Deux incompréhensions consécutives constituent un échec de dialogue,
  // pas une invitation à poser une troisième fois la même question. On propose
  // un repli humain réel au lieu d'annoncer un transfert qui n'aurait pas lieu.
  if (speechAct === 'content' && session.conversation.misunderstandingCount >= 2) {
    return buildHumanFallbackReplyPlan(session);
  }

  if (
    speechAct === 'backchannel' &&
    session.conversation.pendingQuestion !== 'confirmation' &&
    session.conversation.lastAssistantQuestion
  ) {
    const primary =
      effectiveVoiceLanguage(session) === 'en'
        ? `All right. ${session.conversation.lastAssistantQuestion}`
        : `D'accord. ${session.conversation.lastAssistantQuestion}`;
    return guardDialogueRepromptPlan(
      session,
      dialogueStallKeyFromPendingQuestion(session),
      primary,
    );
  }

  if (speechAct === 'content' || speechAct === 'correction') {
    const answerChoicePlan = buildAnswerChoicePlan(session);
    if (answerChoicePlan) return answerChoicePlan;
    const confidenceRepromptPlan = buildConfidenceRepromptPlan(session);
    if (confidenceRepromptPlan) return confidenceRepromptPlan;
    // Canary TurnPlan : une réponse que les extracteurs n'ont pas comprise va
    // au modèle au lieu d'une relance mécanique de la même question.
    if (!options.deferUnresolvedToModel && isAmbiguousPartySizeReply(session, transcript)) {
      const primary =
        effectiveVoiceLanguage(session) === 'en'
          ? "I didn't catch the number of people. How many will there be?"
          : "Je n'ai pas bien compris le nombre de personnes. Vous serez combien ?";
      return guardDialogueRepromptPlan(session, 'partySize', primary);
    }
    // Followup de disponibilité : alternatives proposées par l'outil
    // (ces réponses dépendent du résultat de checkAvailability, pas du LLM)
    return buildAvailabilityFollowupPlan(session, transcript);
  }

  return null;
}

export function buildDeterministicTurnResponse(
  session: CallSession,
  speechAct: VoiceSpeechAct,
  transcript = '',
): string | null {
  return buildDeterministicTurnPlan(session, speechAct, transcript)?.reply ?? null;
}

/**
 * Garde-fou pour une réponse courte donnée à une question métier. Un « oui »
 * à « À quel nom je réserve ? » n'est pas un acquiescement à répéter : il
 * manque encore la valeur attendue.
 */
export function buildPendingQuestionReplyPlan(
  session: CallSession,
  transcript: string,
): AssistantReplyEmissionPlan | null {
  if (!isAffirmativeShortResponse(transcript)) return null;

  const en = effectiveVoiceLanguage(session) === 'en';
  const primary = ((): string | null => {
    switch (session.conversation.pendingQuestion) {
      case 'date':
        return en
          ? 'Which day would you like to book?'
          : 'Pour quel jour souhaitez-vous réserver ?';
      case 'time':
        return en
          ? 'What time would you like to come?'
          : 'Vers quelle heure souhaitez-vous venir ?';
      case 'timeChoice':
        return en ? 'Which time would work for you?' : 'Quel horaire vous conviendrait ?';
      case 'partySize':
        return en
          ? 'How many people should I book for?'
          : 'Pour combien de personnes dois-je réserver ?';
      case 'partySizeConfirmation':
        return null;
      case 'customerName':
        if (
          session.conversation.nameCollection.state === 'confirming' &&
          session.conversation.nameCollection.presentedCandidate
        )
          return null;
        return en
          ? 'What name should I put the reservation under?'
          : 'Quel nom dois-je inscrire pour la réservation ?';
      case 'customerPhone':
        return en
          ? 'Which phone number may I use for the confirmation?'
          : 'Quel numéro de téléphone puis-je utiliser pour la confirmation ?';
      case 'confirmation':
      case 'humanFallback':
      case null:
        return null;
    }
  })();
  if (!primary) return null;
  // Une acquiescement répété sur la même question ne doit pas produire la même
  // phrase à l'identique : le garde-fou reformule, puis propose un repli humain.
  return guardDialogueRepromptPlan(session, dialogueStallKeyFromPendingQuestion(session), primary);
}

export function buildPendingQuestionResponse(
  session: CallSession,
  transcript: string,
): string | null {
  return buildPendingQuestionReplyPlan(session, transcript)?.reply ?? null;
}
