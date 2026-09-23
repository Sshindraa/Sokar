/**
 * Faux services du banc d'évaluation : réservations, base et Telnyx sont
 * simulés ; les appels Groq passent au vrai `fetch`. À n'utiliser que sous
 * vitest (la base est déjà remplacée par `src/test/setup.ts`).
 */
import { vi, type Mock } from 'vitest';
import { db } from '../../../shared/db/client';
import { ReservationService } from '../../reservations/reservation.service';
import { CallSessionManager } from '../stream/manager';
import { instrumentToolCalls, type ScenarioRuntime } from './run-scenario';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** Créneaux du scénario limités aux horaires d'ouverture du jour demandé. */
export function slotsForDate(runtime: ScenarioRuntime, date: string): string[] {
  const weekday = WEEKDAY_KEYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
  const hours = runtime.openingHours[weekday];
  if (!hours) return [];
  return runtime.availableSlots.filter((slot) => slot >= hours.open && slot < hours.close);
}

export interface EvalFakesState {
  runtime: ScenarioRuntime | null;
  restaurantId: string;
}

export function installEvalFakes(state: EvalFakesState): void {
  vi.spyOn(ReservationService, 'availability').mockImplementation(async (_id, date, partySize) => {
    const slots = state.runtime ? slotsForDate(state.runtime, date) : [];
    state.runtime?.returnedSlots.push(...slots);
    return { date, partySize, slots } as unknown as Awaited<
      ReturnType<typeof ReservationService.availability>
    >;
  });
  vi.spyOn(ReservationService, 'create').mockImplementation(async (input) => {
    const reservedAt = new Date(input.reservedAt);
    state.runtime?.createdReservations.push({
      date: `${reservedAt.getFullYear()}-${pad(reservedAt.getMonth() + 1)}-${pad(reservedAt.getDate())}`,
      time: `${pad(reservedAt.getHours())}:${pad(reservedAt.getMinutes())}`,
      partySize: input.partySize,
    });
    return { id: `eval-reservation-${Date.now()}` } as unknown as Awaited<
      ReturnType<typeof ReservationService.create>
    >;
  });

  // L'appel existe et appartient au restaurant de la session en cours.
  const fakeDb = db as unknown as Record<
    string,
    Record<string, Mock<(...args: unknown[]) => unknown>>
  >;
  fakeDb.call.findUnique.mockImplementation(async () => ({
    id: 'eval-call',
    restaurantId: state.restaurantId,
  }));
  fakeDb.message ??= {};
  fakeDb.message.create = vi.fn(async () => ({ id: 'eval-message' }));
  fakeDb.reservation.findMany.mockResolvedValue([]);
  fakeDb.reservation.findFirst.mockResolvedValue(null);

  // Transfert Telnyx accepté sans réseau ; tout le reste passe.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('telnyx')) return new Response('{}', { status: 200 });
    return realFetch(input, init);
  };

  (CallSessionManager as unknown as { instance?: CallSessionManager }).instance =
    new CallSessionManager();
  instrumentToolCalls(CallSessionManager.getInstance(), () => state.runtime);
}
