import type {
  CallSession,
  ConversationState,
  NameCollection,
  SpellingToken,
  VoiceSpeechAct,
} from './types';

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
 * Tokens que Flux peut produire quand l'appelant épelle un nom en français.
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
]);

const NAME_INTRODUCTION_PATTERN =
  /\b(?:au nom de|un nom de|(?:en|un) nombre de actifs?|nom de|mon nom est|mon nom|je m appelle|je suis)\b/u;
const SPELLING_INTRODUCTION_PATTERN =
  /\b(?:epel(?:er|e|ez|ant)?|epell(?:er|e|ez|ant)?|lettres?(?: par lettre)?|alphabet)\b/u;
const FULL_RESTART_MARKER_PATTERN =
  /\b(?:je recommence|je reprends|je vous redonne|je vais vous redonner)\b/u;
const CONTINUATION_MARKER_PATTERN = /\b(?:la suite|le reste|continue(?:r|z)?)\b/u;
/**
 * Flux peut placer « non » ou « pardon » devant une nouvelle épellation.
 * Retirer uniquement ce préfixe permet de reconnaître la correction sans
 * transformer une phrase ordinaire contenant « non » en suite de lettres.
 */
const SPELLING_CORRECTION_PREFIX_PATTERN =
  /^(?:non|pardon|excusez|en fait|je me suis trompe|je voulais dire|j ai dit)\s+/u;

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

function ordinalLabel(position: number): string {
  if (position === 0) return 'première';
  if (position === 1) return 'deuxième';
  if (position === 2) return 'troisième';
  if (position === 3) return 'quatrième';
  return position + 1 + 'e';
}

function ambiguityQuestion(collection: NameCollection): string {
  const position = collection.ambiguousPositions[0] ?? 0;
  const partial = formatCandidateForSpeech(collection.partialCandidate);
  return (
    "J'ai compris " +
    partial +
    '. Quelle est la ' +
    ordinalLabel(position) +
    " lettre, s'il vous plaît ?"
  );
}

function completeCandidateResponse(collection: NameCollection): string {
  return formatCandidateForSpeech(knownCandidate(collection)) + ", c'est bien cela ?";
}

function partialCandidateResponse(collection: NameCollection): string {
  return (
    "J'ai noté " +
    formatCandidateForSpeech(collection.partialCandidate) +
    " pour l'instant. Vous pouvez continuer, ou me dire si c'est tout le nom."
  );
}

function isNameConfirmation(transcript: string): boolean {
  const normalized = normalizeForDecision(transcript);
  return /^(?:oui|ouais|ok(?:ay)?|d accord|bien sur|exactement|tout a fait|c est ca|c est bien ca|voila)(?: (?:c est ca|c est bien ca|exactement|voila))?$/u.test(
    normalized,
  );
}

function isNameRejection(transcript: string): boolean {
  const normalized = normalizeForDecision(transcript);
  return /^(?:non|pas du tout|ce n est pas ca|ce n est pas le bon nom|j ai dit non)$/u.test(
    normalized,
  );
}

function hasFullRestartCue(transcript: string): boolean {
  const normalized = normalizeForDecision(transcript);
  return /\b(?:je recommence|je vous redonne|je vais vous redonner|je reprends|mon nom est|au nom de|je m appelle|j ai dit)\b/u.test(
    normalized,
  );
}

function hasContinuationCue(transcript: string): boolean {
  const normalized = normalizeForDecision(transcript);
  return /\b(?:puis|ensuite|la suite|et apres|continue|continuer|le reste|apres)\b/u.test(
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
  if (!match || !/\blettre\b/u.test(normalized)) return null;
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

function clarificationEscalation(): CustomerNameTurnResult {
  return {
    response: 'Je vais vous mettre en relation avec le gérant pour vous aider.',
    confirmedName: null,
    escalate: true,
  };
}

const NAME_CORRECTION_CLARIFICATION =
  "Je n'ai pas compris la correction. Quelle lettre souhaitez-vous modifier, s'il vous plaît ?";

function correctionClarification(collection: NameCollection): CustomerNameTurnResult {
  collection.clarificationCount++;
  if (collection.clarificationCount >= 2) return clarificationEscalation();
  return { response: NAME_CORRECTION_CLARIFICATION, confirmedName: null };
}

function hasUnrecognizedNameCorrectionCue(transcript: string): boolean {
  const normalized = normalizeForDecision(transcript);
  return (
    /^(?:non\b|pardon\b|excusez\b|en fait\b|je me suis trompe\b|j ai fait une erreur\b|je voulais dire\b)/u.test(
      normalized,
    ) ||
    /\b(?:lettre|epellation|orthographe|corriger|corrige|correction|rectifier|rectification)\b/u.test(
      normalized,
    )
  );
}

function failedClarification(collection: NameCollection): CustomerNameTurnResult {
  collection.clarificationCount++;
  if (collection.clarificationCount >= 2) return clarificationEscalation();
  return { response: ambiguityQuestion(collection), confirmedName: null };
}

function fillFirstAmbiguousPosition(
  session: CallSession,
  collection: NameCollection,
  letter: string,
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
    return { response: ambiguityQuestion(collection), confirmedName: null };
  }

  collection.state = 'confirming';
  collection.presentedCandidate = knownCandidate(collection);
  syncLegacySpellingCandidate(session);
  return { response: completeCandidateResponse(collection), confirmedName: null };
}

function appendIsolatedNameLetter(
  session: CallSession,
  collection: NameCollection,
  letter: string,
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
  return { response: completeCandidateResponse(collection), confirmedName: null };
}

function applyTargetedCorrection(
  session: CallSession,
  transcript: string,
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
    return { response: ambiguityQuestion(rebuilt), confirmedName: null };
  }

  rebuilt.state = 'confirming';
  rebuilt.presentedCandidate = knownCandidate(rebuilt);
  syncLegacySpellingCandidate(session);
  return { response: completeCandidateResponse(rebuilt), confirmedName: null };
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

  const targeted = applyTargetedCorrection(session, transcript);
  if (targeted) return targeted;

  const parsed = parseSpelledNameTranscriptDetailed(transcript);
  // Même si Flux a perdu la question « quel nom ? », un « non, A D K I F »
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
      response: "D'accord. Pouvez-vous me redonner votre nom, lettre par lettre, lentement ?",
      confirmedName: null,
    };
  }

  // Une réponse de clarification peut elle-même utiliser la convention
  // « K comme Karim ». Elle ne doit pas remplacer tout le candidat conservé :
  // elle remplit uniquement la première position encore ambiguë.
  if (collection.state === 'clarifying' && parsedBelongsToName && !hasFullRestartCue(transcript)) {
    const singleLetter = extractSingleSpokenLetter(transcript);
    if (singleLetter) return fillFirstAmbiguousPosition(session, collection, singleLetter);
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
        return clarificationEscalation();
      }
      return { response: ambiguityQuestion(collection), confirmedName: null };
    }

    collection.clarificationCount = 0;
    if (parsed.isFragment && nextTokens.length <= 2 && !parsed.hasExplicitSpellingCue) {
      collection.state = 'collecting';
      syncLegacySpellingCandidate(session);
      return { response: partialCandidateResponse(collection), confirmedName: null };
    }

    collection.state = 'confirming';
    collection.presentedCandidate = knownCandidate(collection);
    syncLegacySpellingCandidate(session);
    return { response: completeCandidateResponse(collection), confirmedName: null };
  }

  if (collection.state === 'clarifying') {
    const singleLetter = extractSingleSpokenLetter(transcript);
    if (singleLetter) return fillFirstAmbiguousPosition(session, collection, singleLetter);
    return failedClarification(collection);
  }

  if (collection.state === 'collecting') {
    if (collection.awaitingCorrection) {
      return correctionClarification(collection);
    }
    if (hasUnrecognizedNameCorrectionCue(transcript)) {
      collection.awaitingCorrection = true;
      collection.clarificationCount = 0;
      collection.fallbackRecorded = false;
      return correctionClarification(collection);
    }
    const isolatedLetter = isStandaloneSpokenLetter(transcript)
      ? extractSingleSpokenLetter(transcript)
      : null;
    if (isolatedLetter) {
      return appendIsolatedNameLetter(session, collection, isolatedLetter);
    }
    if (isNameConfirmation(transcript)) {
      return {
        response:
          "Je n'ai pas encore un nom complet à confirmer. Vous pouvez continuer à épeler, s'il vous plaît ?",
        confirmedName: null,
      };
    }
    if (hasContinuationCue(transcript)) {
      return {
        response: "Vous pouvez continuer à épeler votre nom, s'il vous plaît.",
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
      return correctionClarification(collection);
    }

    const isolatedLetter = isStandaloneSpokenLetter(transcript)
      ? extractSingleSpokenLetter(transcript)
      : null;
    if (isolatedLetter) {
      return appendIsolatedNameLetter(session, collection, isolatedLetter);
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
      return correctionClarification(collection);
    }
    return { response: null, confirmedName: null };
  }

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
    return `Oui, nous avons de la place pour ${request.partySize} personne${request.partySize > 1 ? 's' : ''} à ${time}. À quel nom je réserve ?`;
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
    /\b(?:votre nom|quel est votre nom|au nom de qui|a quel nom|quel nom|nom pour la reservation|quelle est la (?:premiere|deuxieme|troisieme|quatrieme|cinquieme|sixieme) lettre|lettre par lettre|epeler|epellez?)\b/.test(
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
  if (lastQuestion) {
    session.conversation.pendingQuestion = pendingQuestionFrom(lastQuestion);
  } else if (isNameCollectionBlocking(session)) {
    // L'état de collecte ne doit pas disparaître parce qu'une réponse
    // intermédiaire n'a pas de point d'interrogation exploitable.
    session.conversation.pendingQuestion = 'customerName';
  } else {
    session.conversation.pendingQuestion = null;
  }

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
