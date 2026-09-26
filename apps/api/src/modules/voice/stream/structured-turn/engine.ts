/**
 * Moteur de tour structuré (canary). Un appel au modèle comprend le tour,
 * tient le brouillon, choisit une action et formule la réponse. Le code valide
 * les faits proposés, exécute les actions autorisées et rend leur résultat au
 * modèle pour la formulation. Aucune règle lexicale n'interprète l'appelant.
 */
import type { CallSession } from '../types';
import type { CallSessionManager } from '../manager';
import { speakTtsStreamed } from '../tts-handler';
import { finishCall } from '../call-ending';
import { parseRestaurantIdList } from '../feature-flags';
import {
  markVoiceTurnLlmFirstPhrase,
  markVoiceTurnLlmFirstToken,
  recordVoiceTurnEvent,
  recordVoiceTurnEventIfCurrent,
} from '../turn-telemetry';
import {
  buildLlmFailurePlan,
  getReservationConfirmationKey,
  voiceMaxPartySize,
} from '../conversation-controller';
import { recordDebugTool } from '../debug-dialogue';
import { logger } from '../../../../shared/logger/pino';
import {
  STRUCTURED_TURN_SCHEMA_NAME,
  buildStructuredTurnJsonSchema,
  parseStructuredTurnOutput,
  type StructuredTurnAction,
  type StructuredTurnOutput,
} from './schema';
import {
  applyProposedDraft,
  authorizeStructuredAction,
  bookingKey,
  createStructuredTurnState,
  isBookingComplete,
  todayInTimezone,
  type StructuredTurnState,
} from './fact-guards';
import { buildStructuredTurnMessages } from './prompt';
import { PhraseSplitter, SayStreamExtractor } from './say-stream';

export function isStructuredTurnEnabled(
  restaurantId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(
    restaurantId &&
    parseRestaurantIdList(env.VOICE_STRUCTURED_TURN_RESTAURANT_IDS).includes(restaurantId),
  );
}

function responseFormat(actions?: readonly StructuredTurnAction[]) {
  return {
    type: 'json_schema' as const,
    json_schema: {
      name: STRUCTURED_TURN_SCHEMA_NAME,
      strict: true as const,
      schema: buildStructuredTurnJsonSchema(actions),
    },
  };
}

/** Après une action exécutée, le modèle ne peut plus que parler ou terminer l'appel. */
const AFTER_ACTION_ACTIONS: readonly StructuredTurnAction[] = ['none', 'end_call'];

/** Au-delà, seuls les créneaux les plus proches de l'heure demandée sont donnés au modèle. */
const MAX_SLOTS_IN_RESULT = 12;

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function nearestSlots(slots: string[], time: string): string[] {
  if (slots.length <= MAX_SLOTS_IN_RESULT || !time) return slots.slice(0, MAX_SLOTS_IN_RESULT);
  const target = minutesOf(time);
  return [...slots]
    .sort((left, right) => Math.abs(minutesOf(left) - target) - Math.abs(minutesOf(right) - target))
    .slice(0, MAX_SLOTS_IN_RESULT)
    .sort();
}

const PENDING_BY_AWAITING: Partial<
  Record<StructuredTurnOutput['awaiting'], CallSession['conversation']['pendingQuestion']>
> = {
  date: 'date',
  time: 'time',
  partySize: 'partySize',
  customerName: 'customerName',
  // Relecture de l'orthographe : l'appelant peut ré-épeler, le profil STT d'épellation reste actif.
  customerNameConfirmation: 'customerName',
  confirmation: 'confirmation',
  humanFallback: 'humanFallback',
};

/** Miroir du brouillon dans l'état historique : télémétrie, finalisation, profil STT. */
function mirrorConversation(session: CallSession, state: StructuredTurnState): void {
  const { conversation } = session;
  const { draft } = state;
  if (draft.date || draft.time || draft.partySize || draft.customerName) {
    conversation.intent = conversation.intent ?? 'reservation';
  }
  conversation.slots.date = draft.date || undefined;
  conversation.slots.time = draft.time || undefined;
  conversation.slots.partySize = draft.partySize || undefined;
  conversation.slots.customerName = draft.customerName.trim() || undefined;
  conversation.pendingQuestion = PENDING_BY_AWAITING[state.lastAwaiting] ?? null;
}

interface PassResult {
  output: StructuredTurnOutput;
  spoken: boolean;
}

/**
 * Silence après un tour jugé inachevé avant de répondre quand même : l'appelant
 * cherchait peut-être ses mots mais attend maintenant une réponse.
 */
export const INCOMPLETE_TURN_SILENCE_MS = 2_500;

const incompleteTurnTimers = new WeakMap<CallSession, ReturnType<typeof setTimeout>>();

function clearIncompleteTurnTimer(session: CallSession): void {
  const timer = incompleteTurnTimers.get(session);
  if (timer) clearTimeout(timer);
  incompleteTurnTimers.delete(session);
}

function armIncompleteTurnTimer(
  session: CallSession,
  mgr: CallSessionManager,
  fragment: string,
): void {
  clearIncompleteTurnTimer(session);
  const timer = setTimeout(() => {
    incompleteTurnTimers.delete(session);
    if (session.ended || session.ending) return;
    if (session.structuredTurn?.pendingFragment !== fragment) return;
    const generation = ++session.responseGeneration;
    void runStructuredTurn(
      session,
      '',
      mgr,
      () => !session.ended && session.responseGeneration === generation,
      { callerFinished: true },
    );
  }, INCOMPLETE_TURN_SILENCE_MS);
  timer.unref?.();
  incompleteTurnTimers.set(session, timer);
}

export async function runStructuredTurn(
  session: CallSession,
  rawTranscript: string,
  mgr: CallSessionManager,
  isCurrentResponse: () => boolean,
  options: { callerFinished?: boolean } = {},
): Promise<void> {
  const state = (session.structuredTurn ??= createStructuredTurnState());
  clearIncompleteTurnTimer(session);
  // Un début de phrase retenu au tour précédent est la même prise de parole.
  const transcript = [state.pendingFragment, rawTranscript]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(' ')
    .trim();
  state.pendingFragment = null;
  if (!transcript) return;
  const turnId = session.currentTurn?.id;
  const abortController = new AbortController();
  session.abortController = abortController;
  const isLive = () => isCurrentResponse() && !abortController.signal.aborted;
  const today = todayInTimezone(session.timezone || 'Europe/Paris');
  const historyBefore = [...session.history];
  const ttsPromises: Promise<void>[] = [];
  const startedAt = Date.now();
  let firstPhraseSpoken = false;

  session.turnCount++;
  session.history.push({ role: 'user', content: transcript });
  mgr.transition(session, 'PROCESSING');
  recordVoiceTurnEvent(session, 'llm_started', { mode: 'structured' });

  const speakPhrase = (phrase: string) => {
    if (!isLive()) return;
    if (!firstPhraseSpoken) {
      firstPhraseSpoken = true;
      markVoiceTurnLlmFirstPhrase(session, turnId);
      mgr.transition(session, 'SPEAKING');
    }
    recordVoiceTurnEvent(session, 'llm_phrase_generated', { characterCount: phrase.length });
    ttsPromises.push(speakTtsStreamed(session, phrase).catch(() => undefined));
  };

  const runPass = async (actionResult?: string): Promise<PassResult> => {
    const extractor = new SayStreamExtractor();
    const splitter = new PhraseSplitter();
    let action: string | null = null;
    let turnComplete: boolean | null = null;
    let firstToken = true;
    const messages = buildStructuredTurnMessages({
      systemPrompt: session.systemPrompt,
      history: historyBefore,
      transcript,
      state,
      ...(actionResult ? { actionResult } : {}),
      ...(options.callerFinished ? { callerFinished: true } : {}),
    });
    const format = responseFormat(actionResult ? AFTER_ACTION_ACTIONS : undefined);
    const text = await mgr.streamStructuredCompletion(session, messages, format, {
      signal: abortController.signal,
      telemetryTurnId: turnId,
      onDelta: (delta) => {
        if (!isLive()) return;
        if (firstToken) {
          firstToken = false;
          markVoiceTurnLlmFirstToken(session, turnId);
        }
        const said = extractor.push(delta);
        // `turnComplete` et `action` précèdent `say` dans le schéma : ils sont
        // connus quand la phrase commence.
        if (turnComplete === null) {
          const match = /"turnComplete"\s*:\s*(true|false)/.exec(extractor.raw);
          if (match) turnComplete = match[1] === 'true';
        }
        action ??= /"action"\s*:\s*"([a-z_]+)"/.exec(extractor.raw)?.[1] ?? null;
        const mayContinue = turnComplete === true || options.callerFinished === true;
        if (said && action === 'none' && mayContinue) splitter.push(said).forEach(speakPhrase);
      },
    });
    const output = parseStructuredTurnOutput(text);
    if (!output) throw new Error('Invalid structured turn output');
    const spoken = output.action === 'none' && (output.turnComplete || !!options.callerFinished);
    if (spoken) {
      const rest = splitter.flush();
      if (rest) speakPhrase(rest);
    }
    return { output, spoken };
  };

  const runAvailability = async (): Promise<string> => {
    const { date, time, partySize } = state.draft;
    recordDebugTool(session, 'checkAvailability');
    recordVoiceTurnEvent(session, 'availability_started', {});
    const availabilityStartedAt = Date.now();
    try {
      const result = await mgr.getAvailability(session, date, partySize);
      state.availability = { date, partySize, slots: result.slots };
      recordVoiceTurnEvent(session, 'availability_completed', {
        durationMs: Date.now() - availabilityStartedAt,
        slotCount: result.slots.length,
      });
      const offered = nearestSlots(result.slots, time);
      const requested = time
        ? result.slots.includes(time)
          ? ` ${time} est disponible.`
          : ` ${time} n'est pas disponible.`
        : '';
      return result.slots.length
        ? `Disponibilité réelle le ${date} pour ${partySize} personne(s) : créneaux libres ${offered.join(', ')}.${requested} Ne propose que ces horaires.`
        : `Aucun créneau libre le ${date} pour ${partySize} personne(s). Propose une autre date, le gérant ou un message.`;
    } catch (err) {
      recordVoiceTurnEvent(session, 'availability_failed', {
        durationMs: Date.now() - availabilityStartedAt,
      });
      logger.warn(
        { err: err instanceof Error ? err.name : String(err), callId: session.callControlId },
        '[structured-turn] Availability check failed',
      );
      return "La vérification de disponibilité a échoué. N'annonce aucun horaire ; propose le gérant ou un message.";
    }
  };

  const runCreateReservation = async (): Promise<string> => {
    const { date, time, partySize, customerName } = state.draft;
    const { conversation } = session;
    conversation.slots.date = date;
    conversation.slots.time = time;
    conversation.slots.partySize = partySize;
    conversation.slots.customerName = customerName.trim();
    conversation.lastAvailabilityResult = {
      key: `${date}:${time}:${partySize}`,
      date,
      time,
      partySize,
      slots: state.availability?.slots ?? [],
    };
    // L'accord a été vérifié par les garde-fous : récapitulatif lu, accepté.
    conversation.confirmedReservationKey = getReservationConfirmationKey(session);
    const createdBefore = session.reservationCreatedAt;
    const result = await mgr.createReservationFromConversation(session);
    if (session.reservationCreatedAt !== createdBefore) state.reservationCreated = true;
    return (
      result ??
      "La réservation n'a pas pu être créée : les informations ne correspondent plus au créneau vérifié."
    );
  };

  const endCall = async (goodbye: string) => {
    await Promise.all(ttsPromises);
    session.history.push({ role: 'assistant', content: goodbye });
    await finishCall(session, mgr, goodbye);
  };

  try {
    const first = await runPass();
    if (!isLive()) return;
    if (!first.output.turnComplete && !options.callerFinished) {
      // L'appelant n'a pas fini : l'agent se tait et garde le début de phrase.
      session.history.pop();
      session.turnCount--;
      state.pendingFragment = transcript;
      recordVoiceTurnEvent(session, 'structured_turn', {
        pass: 1,
        turnComplete: false,
        interpretation: first.output.interpretation,
        confidence: first.output.confidence,
      });
      mgr.transition(session, 'LISTENING');
      armIncompleteTurnTimer(session, mgr, transcript);
      return;
    }
    const applied = applyProposedDraft(state.draft, first.output, { today });
    state.draft = applied.draft;
    const decision = authorizeStructuredAction(state, first.output, state.draft, {
      maxPartySize: voiceMaxPartySize(session),
    });
    recordVoiceTurnEvent(session, 'structured_turn', {
      pass: 1,
      interpretation: first.output.interpretation,
      action: first.output.action,
      awaiting: first.output.awaiting,
      confidence: first.output.confidence,
      changedFields: applied.changed.join(',') || null,
      rejectedFields: applied.rejected.join(',') || null,
      actionDecision: decision.allowed ? 'allowed' : decision.reason,
    });

    let final = first.output;
    let actionResult: string | null = null;
    if (!decision.allowed) {
      actionResult = `Action ${first.output.action} non exécutée (${decision.reason}). Poursuis la conversation sans l'annoncer comme faite.`;
    } else {
      switch (first.output.action) {
        case 'end_call':
          if (first.output.say.trim()) {
            await endCall(first.output.say.trim());
            return;
          }
          actionResult =
            "L'appelant termine l'appel : formule un au revoir court, action=end_call.";
          break;
        case 'check_availability':
          actionResult = await runAvailability();
          break;
        case 'create_reservation':
          actionResult = await runCreateReservation();
          break;
        case 'take_message':
          actionResult = first.output.message.trim()
            ? await mgr.recordCallerMessage(session, first.output.message.trim())
            : "Message vide, non enregistré : demande ce qu'il faut transmettre.";
          break;
        case 'transfer': {
          const reply = await mgr.handoffToManager(session, {
            kind: 'human_fallback_choice',
            choice: 'transfer',
          });
          if (!isLive()) return;
          session.history.push({ role: 'assistant', content: reply });
          speakPhrase(reply);
          await Promise.all(ttsPromises);
          return;
        }
        case 'none':
          break;
      }
    }

    if (actionResult) {
      if (!isLive()) return;
      const second = await runPass(actionResult);
      if (!isLive()) return;
      const reapplied = applyProposedDraft(state.draft, second.output, { today });
      state.draft = reapplied.draft;
      recordVoiceTurnEvent(session, 'structured_turn', {
        pass: 2,
        interpretation: second.output.interpretation,
        action: second.output.action,
        awaiting: second.output.awaiting,
        confidence: second.output.confidence,
        changedFields: reapplied.changed.join(',') || null,
        rejectedFields: reapplied.rejected.join(',') || null,
      });
      final = second.output;
      if (second.output.action === 'end_call' && second.output.confidence !== 'low') {
        if (second.output.say.trim()) {
          await endCall(second.output.say.trim());
          return;
        }
      } else if (!second.spoken && second.output.say.trim()) {
        // Une seconde action n'est jamais exécutée : la phrase reste dite.
        speakPhrase(second.output.say.trim());
      }
    }

    const said = final.say.trim();
    if (!said) throw new Error('Structured turn produced no speech');
    state.lastAwaiting = final.awaiting;
    state.recapKey =
      final.awaiting === 'confirmation' && isBookingComplete(state.draft)
        ? bookingKey(state.draft)
        : null;
    mirrorConversation(session, state);
    session.history.push({ role: 'assistant', content: said });
    recordVoiceTurnEventIfCurrent(session, turnId, 'llm_completed', {
      mode: 'structured',
      durationMs: Date.now() - startedAt,
      characterCount: said.length,
    });
    await Promise.all(ttsPromises);
    if (isCurrentResponse()) mgr.transition(session, 'LISTENING');
  } catch (err) {
    if (!isLive()) return;
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), callId: session.callControlId },
      '[structured-turn] Turn failed, spoken fallback',
    );
    recordVoiceTurnEventIfCurrent(session, turnId, 'llm_interrupted', {
      mode: 'structured',
      reason: 'error',
      durationMs: Date.now() - startedAt,
    });
    await Promise.all(ttsPromises);
    const fallback = buildLlmFailurePlan(session).reply;
    session.history.push({ role: 'assistant', content: fallback });
    mgr.transition(session, 'SPEAKING');
    await speakTtsStreamed(session, fallback);
    if (isCurrentResponse()) mgr.transition(session, 'LISTENING');
  }
}
