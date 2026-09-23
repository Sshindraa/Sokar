import type { AvailabilityResult } from '../../reservations/reservation.service';
import { logger } from '../../../shared/logger/pino';
import { extractConversationSlots, isNameCollectionBlocking } from './conversation-controller';
import type { CallSessionManager } from './manager';
import type { CallSession } from './types';

/** Un résultat pré-chargé plus ancien n'est pas réutilisé. */
export const AVAILABILITY_PREFETCH_MAX_AGE_MS = 20_000;

/**
 * Pré-charge les disponibilités pendant que le client finit sa phrase. Dès
 * que l'état courant et le transcript partiel donnent date, heure et nombre
 * de personnes, la lecture part en tâche de fond. C'est une lecture seule :
 * elle ne modifie ni l'état de l'appel ni son historique.
 */
export function prefetchAvailabilityFromPartial(
  session: CallSession,
  mgr: Pick<CallSessionManager, 'getAvailability'>,
  transcript: string,
): void {
  const { intent, slots, toolInFlight } = session.conversation;
  if (intent && intent !== 'reservation' && intent !== 'availability') return;
  if (toolInFlight || isNameCollectionBlocking(session)) return;
  if (session.conversation.pendingQuestion === 'customerName') return;

  const extracted = extractConversationSlots(transcript, session.timezone);
  const date = extracted.date ?? slots.date;
  const time = extracted.time ?? slots.time;
  const partySize = extracted.partySize ?? slots.partySize;
  if (!date || !time || !partySize) return;

  // La disponibilité ne dépend que de la date et du nombre de personnes.
  const key = `${date}:${partySize}`;
  const current = session.availabilityPrefetch;
  if (current?.key === key && Date.now() - current.startedAt < AVAILABILITY_PREFETCH_MAX_AGE_MS) {
    return;
  }

  const startedAt = Date.now();
  const promise = mgr.getAvailability(session, date, partySize).catch((err: unknown) => {
    logger.warn(
      { err: err instanceof Error ? err.name : String(err), callId: session.callControlId },
      '[availability-prefetch] Prefetch failed',
    );
    return null;
  });
  session.availabilityPrefetch = { key, startedAt, promise };
}

/**
 * Récupère le pré-chargement s'il correspond exactement à la demande finale.
 * Il est consommé une seule fois. Un échec du pré-chargement renvoie null :
 * l'appelant relance alors une lecture normale.
 */
export function takeAvailabilityPrefetch(
  session: CallSession,
  date: string,
  partySize: number,
): Promise<AvailabilityResult | null> | null {
  const prefetch = session.availabilityPrefetch;
  session.availabilityPrefetch = null;
  if (!prefetch || prefetch.key !== `${date}:${partySize}`) return null;
  if (Date.now() - prefetch.startedAt >= AVAILABILITY_PREFETCH_MAX_AGE_MS) return null;
  return prefetch.promise;
}
