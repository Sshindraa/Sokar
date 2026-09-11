import { WebSocket } from 'ws';
import type { CallSession } from './types';
import { playFiller } from './fillers-cache';
import { logger } from '../../../shared/logger/pino';
import { recordVoiceTurnEvent } from './turn-telemetry';

/**
 * Un filler ne doit pas masquer une réponse rapide. Le délai laisse au LLM
 * une fenêtre silencieuse naturelle, et la probabilité évite une ritournelle
 * audible à chaque tour.
 */
export const THINKING_FILLER_DELAY_MS = 900;
export const THINKING_FILLER_PROBABILITY = 0.35;
export const THINKING_FILLER_COOLDOWN_MS = 5_000;

interface FillerSchedule {
  timer: ReturnType<typeof setTimeout> | null;
  controller: AbortController;
  started: boolean;
  playbackSettled: boolean;
  interruptionRecorded: boolean;
}

export interface ThinkingFillerScheduleOptions {
  delayMs?: number;
  probability?: number;
  cooldownMs?: number;
  random?: () => number;
}

const schedules = new WeakMap<CallSession, FillerSchedule>();
const lastStartedAt = new WeakMap<CallSession, number>();

function isEligible(session: CallSession): boolean {
  return Boolean(
    !session.ended &&
    !session.ending &&
    session.state === 'PROCESSING' &&
    session.telnyxWs &&
    session.telnyxWs.readyState === WebSocket.OPEN,
  );
}

/** Annule le délai ou la lecture en cours pour cette réponse. */
export function cancelScheduledFiller(session: CallSession): void {
  const schedule = schedules.get(session);
  if (!schedule) return;
  if (schedule.timer) clearTimeout(schedule.timer);
  schedule.timer = null;
  schedule.controller.abort();
  if (schedule.started && !schedule.playbackSettled && !schedule.interruptionRecorded) {
    schedule.interruptionRecorded = true;
    recordVoiceTurnEvent(session, 'filler_interrupted', { purpose: 'thinking' });
  }
  schedules.delete(session);
}

/**
 * Programme une formule d'attente courte. La fonction ne lance aucun travail
 * immédiatement : une réponse LLM rapide ou une reprise de parole peut donc
 * annuler le filler avant qu'il ne produise le moindre audio.
 */
export function scheduleThinkingFiller(
  session: CallSession,
  style: 'CASUAL' | 'FORMAL' | 'WARM',
  options: ThinkingFillerScheduleOptions = {},
): void {
  cancelScheduledFiller(session);
  if (!isEligible(session)) return;

  const random = options.random ?? Math.random;
  const probability = Math.max(0, Math.min(1, options.probability ?? THINKING_FILLER_PROBABILITY));
  if (random() >= probability) return;

  const cooldownMs = Math.max(0, options.cooldownMs ?? THINKING_FILLER_COOLDOWN_MS);
  const previousStart = lastStartedAt.get(session) ?? 0;
  if (Date.now() - previousStart < cooldownMs) return;

  const controller = new AbortController();
  const schedule: FillerSchedule = {
    timer: null,
    controller,
    started: false,
    playbackSettled: false,
    interruptionRecorded: false,
  };
  schedules.set(session, schedule);
  const delayMs = Math.max(0, options.delayMs ?? THINKING_FILLER_DELAY_MS);

  schedule.timer = setTimeout(() => {
    schedule.timer = null;
    if (controller.signal.aborted || schedules.get(session) !== schedule || !isEligible(session)) {
      cancelScheduledFiller(session);
      return;
    }

    schedule.started = true;
    lastStartedAt.set(session, Date.now());
    recordVoiceTurnEvent(session, 'filler_started', { purpose: 'thinking', delayedMs: delayMs });
    playFiller(session, style, 'generic', {
      signal: controller.signal,
      randomize: true,
    })
      .then(() => {
        schedule.playbackSettled = true;
        if (!controller.signal.aborted) {
          recordVoiceTurnEvent(session, 'filler_completed', { purpose: 'thinking' });
        }
      })
      .catch((err: unknown) => {
        schedule.playbackSettled = true;
        if (!controller.signal.aborted) {
          logger.warn(
            { err, callId: session.callControlId },
            '[thinking-filler] failed (non-blocking)',
          );
        }
      })
      .finally(() => {
        if (schedules.get(session) === schedule) schedules.delete(session);
      });
  }, delayMs);
}
