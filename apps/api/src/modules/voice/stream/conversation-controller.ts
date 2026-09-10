import type {
  CallSession,
  ConversationState,
  NameCollection,
  SpellingToken,
  VoiceSpeechAct,
} from './types';
import { effectiveVoiceLanguage, type VoiceLanguageCode } from './voice-language';

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
    spellingCandidate: null,
    nameCollection: createNameCollection(),
    misunderstandingCount: 0,
    closing: false,
  };
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
    if (token.text === 'double' || token.text === 'deux') {
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

    if ((lexical.text === 'double' || lexical.text === 'deux') && !tokens[index + 1]?.punctuation) {
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
          addSpellingToken(output, parts, raw, doubled.value, 'letter', letterPosition);
          addSpellingToken(output, parts, raw, doubled.value, 'letter', letterPosition);
          knownLetterCount += 2;
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
  session.conversation.pendingQuestion = null;
  session.conversation.lastAssistantQuestion = null;
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
  session.conversation.pendingQuestion = null;
  session.conversation.lastAssistantQuestion = null;
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
    session.conversation.pendingQuestion = null;
    session.conversation.lastAssistantQuestion = null;
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
  if (
    /^(?:non\b|plutot\b|en fait\b|j ai dit\b|je voulais dire\b|no\b|rather\b|actually\b|i said\b|i meant\b)/.test(
      normalized,
    )
  ) {
    return 'correction';
  }
  return 'content';
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
      for (let length = 1; length <= 3; length++) {
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
  const slots: ConversationState['slots'] = {};

  const isoDate = normalized.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (isoDate) {
    slots.date = isoDate;
  } else if (/\b(?:aujourd hui|ce jour|ce soir|today|tonight)\b/.test(normalized)) {
    slots.date = localDate(now, timezone);
  } else if (/\b(?:demain|tomorrow)\b/.test(normalized)) {
    slots.date = addDays(localDate(now, timezone), 1);
  } else {
    const weekday = normalized.match(
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
  const englishAmPmMatch = normalized.match(
    /\b(?:at|around)?\s*(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b/,
  );
  if (englishAmPmMatch) {
    let hour = Number(englishAmPmMatch[1]);
    const minute = Number(englishAmPmMatch[2] ?? '0');
    if (englishAmPmMatch[3] === 'pm' && hour < 12) hour += 12;
    if (englishAmPmMatch[3] === 'am' && hour === 12) hour = 0;
    slots.time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  const timeMatch = slots.time
    ? null
    : normalized.match(
        /\b(?:a|vers|at|around)?\s*([01]?\d|2[0-3])(?:(?:\s*(?::|h(?:eures?)?)\s*)([0-5]\d)?|\s+([0-5]\d))\b/,
      );
  if (timeMatch) {
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2] ?? timeMatch[3] ?? '0');
    slots.time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  } else {
    const spokenClockTime = extractSpokenClockTime(normalized);
    if (spokenClockTime) {
      slots.time = spokenClockTime;
    } else if (/\b(?:a|vers)?\s*midi\b/.test(normalized)) {
      // « à midi » est la formulation la plus courante au téléphone ; elle
      // doit déclencher la même vérification qu'une heure numérique.
      slots.time = '12:00';
    } else if (/\b(?:a|vers)?\s*minuit\b/.test(normalized)) {
      slots.time = '00:00';
    }
  }

  const partyMatch = normalized.match(
    /\b(?:pour|de|for|party of|table for)?\s*(\d+|un|une|deux|trois|quatre|cinq|six|sept|one|two|three|four|five|six|seven)\s+(?:personnes?|people|guests?)\b/,
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
    const partySize =
      words[partyMatch[1]] ?? ENGLISH_NUMBER_WORDS[partyMatch[1]] ?? Number(partyMatch[1]);
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

/**
 * Réponse de repli quand le moteur de disponibilité est indisponible. Elle ne
 * confirme jamais le créneau et ne demande pas le nom avant une vérification
 * réussie.
 */
export function buildAvailabilityErrorReply(language: VoiceLanguageCode = 'fr'): string {
  return language === 'en'
    ? "I can't check that time right now. Would you like me to put you through to the manager?"
    : "Je n'arrive pas à vérifier ce créneau pour le moment. Voulez-vous que je vous passe le gérant ?";
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

export function buildAvailabilityFollowupResponse(
  session: CallSession,
  transcript: string,
): string | null {
  if (!asksForAvailabilityAlternative(transcript)) return null;
  const result = session.conversation.lastAvailabilityResult;
  if (!result) return null;
  const language = effectiveVoiceLanguage(session);

  if (result.slots.length === 0) {
    return language === 'en'
      ? "I don't have another verified time that day. I can put you through to the manager or take a message."
      : "Je n'ai aucun autre créneau vérifié ce jour-là. Je peux vous passer le gérant ou prendre un message.";
  }

  const alternatives = selectClosestAvailabilitySlots(result.time, result.slots)
    .map((slot) => formatAvailabilitySlot(slot, language))
    .join(language === 'en' ? ' or ' : ' ou ');
  return language === 'en'
    ? `I can offer ${alternatives}. Which one works for you?`
    : `Je peux vous proposer ${alternatives}. Lequel vous convient ?`;
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
    if (normalized.length > 60 && !hasSlotInfo) {
      return null;
    }
  }

  const language = effectiveVoiceLanguage(session);
  if (!slots.date)
    return language === 'en' ? 'What day would you like to come?' : 'Pour quel jour ?';
  if (!slots.partySize)
    return language === 'en' ? 'How many people will there be?' : 'Vous serez combien ?';
  if (!slots.time)
    return language === 'en'
      ? 'What time would you like to come?'
      : 'Vous voulez venir vers quelle heure ?';
  return null;
}

function isAmbiguousPartySizeReply(session: CallSession, transcript: string): boolean {
  if (session.conversation.pendingQuestion !== 'partySize') return false;
  if (extractConversationSlots(transcript, session.timezone ?? 'Europe/Paris').partySize)
    return false;

  const normalized = normalizeTranscript(transcript);
  return /\b(?:personne|personnes|on sera|nous serons|combien|people|guests|party|how many)\b/.test(
    normalized,
  );
}

function pendingQuestionFrom(question: string): ConversationState['pendingQuestion'] {
  const normalized = normalizeTranscript(question);
  if (/\b(?:quelle date|quel jour|quand|what day|which day|what date|when)/.test(normalized))
    return 'date';
  if (/\b(?:quelle heure|a quelle heure|vers quelle heure|what time|which time)/.test(normalized))
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
  return null;
}

export function recordAssistantReply(session: CallSession, reply: string): void {
  const lastQuestion = reply.match(/(?:^|[.!]\s*)([^.?!]+\?)\s*$/u)?.[1]?.trim() ?? null;
  session.conversation.lastAssistantQuestion = lastQuestion;
  if (lastQuestion) {
    session.conversation.pendingQuestion = pendingQuestionFrom(lastQuestion);
  } else if (isNameCollectionBlocking(session)) {
    // L'état de collecte ne doit pas disparaître parce qu'une réponse
    // intermédiaire n'a pas de point d'interrogation exploitable.
    session.conversation.pendingQuestion = 'customerName';
  } else {
    session.conversation.pendingQuestion = null;
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

/** Réponses courtes qui ne nécessitent ni interprétation ni appel LLM.
 *
 * Volontairement minimal : on laisse le LLM gérer le stt conversationnel
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
    return effectiveVoiceLanguage(session) === 'en'
      ? "I'll put you through to the manager to help you."
      : 'Je vais vous passer le gérant pour vous aider.';
  }

  if (speechAct === 'backchannel' && session.conversation.lastAssistantQuestion) {
    return effectiveVoiceLanguage(session) === 'en'
      ? `All right. ${session.conversation.lastAssistantQuestion}`
      : `D'accord. ${session.conversation.lastAssistantQuestion}`;
  }

  if (speechAct === 'content' || speechAct === 'correction') {
    if (isAmbiguousPartySizeReply(session, transcript)) {
      return effectiveVoiceLanguage(session) === 'en'
        ? "I didn't catch the number of people. How many will there be?"
        : "Je n'ai pas bien compris le nombre de personnes. Vous serez combien ?";
    }
    // Followup de disponibilité : alternatives proposées par l'outil
    // (ces réponses dépendent du résultat de checkAvailability, pas du LLM)
    return buildAvailabilityFollowupResponse(session, transcript);
  }

  return null;
}
