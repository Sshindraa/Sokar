/** lastBooking : dernière heure de début de réservation du service, incluse. */
export type Slot = { open: string; close: string; lastBooking?: string };
export type DayHours = {
  open: string;
  close: string;
  lastBooking?: string;
  slots?: Slot[];
  services?: Slot[];
} | null;
export type WeekHours = Record<string, DayHours>;
export type Mode = 'continuous' | 'split';

export const PRESETS: Record<Mode, Slot[]> = {
  continuous: [{ open: '12:00', close: '22:00', lastBooking: '21:30' }],
  split: [
    { open: '12:00', close: '14:30', lastBooking: '14:00' },
    { open: '19:00', close: '22:30', lastBooking: '22:00' },
  ],
};

export const SLOT_LABELS = ['Midi', 'Soir'] as const;
const MINUTES_PER_DAY = 24 * 60;
const LATEST_OVERNIGHT_CLOSE = 6 * 60;
const BOOKING_STEP_MINUTES = 30;

function toMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Services du jour, chacun avec sa dernière réservation : une valeur absente (horaires enregistrés
 * avant cette option) est remplie avec le dernier créneau qui tient avant la fermeture.
 */
export function slotsOf(day: DayHours): Slot[] {
  if (!day) return [];
  if (day.slots?.length) return day.slots.map(withLastBooking);
  // Read the local legacy shape while old records are being opened and saved.
  if (day.services?.length) return day.services.map(withLastBooking);
  return [withLastBooking({ open: day.open, close: day.close, lastBooking: day.lastBooking })];
}

function formatTime(totalMinutes: number): string {
  const minutes = totalMinutes % MINUTES_PER_DAY;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Heures de début valides pour la dernière réservation : grille de 30 min, avant la fermeture. */
export function lastBookingOptions(slot: Slot): string[] {
  const open = toMinutes(slot.open);
  const end = overnightEnd(slot);
  if (open == null || end == null) return [];
  const options: string[] = [];
  for (let current = open; current < end; current += BOOKING_STEP_MINUTES) {
    options.push(formatTime(current));
  }
  return options;
}

/** Dernier créneau qui tient avant la fermeture : la règle appliquée avant cette option. */
export function defaultLastBooking(slot: Slot): string | undefined {
  const open = toMinutes(slot.open);
  const end = overnightEnd(slot);
  if (open == null || end == null) return undefined;
  let last: number | undefined;
  for (let current = open; current + BOOKING_STEP_MINUTES <= end; current += BOOKING_STEP_MINUTES) {
    last = current;
  }
  return last == null ? undefined : formatTime(last);
}

function withLastBooking(slot: Slot): Slot {
  if (slot.lastBooking) return slot;
  const fallback = defaultLastBooking(slot);
  return fallback ? { ...slot, lastBooking: fallback } : slot;
}

function keepOrDefaultLastBooking(slot: Slot, candidate: string | undefined): Slot {
  const lastBooking =
    candidate && lastBookingOptions(slot).includes(candidate)
      ? candidate
      : defaultLastBooking(slot);
  return lastBooking ? { ...slot, lastBooking } : slot;
}

/**
 * Modifie une borne d'un service en gardant la dernière réservation cohérente : elle suit la
 * fermeture tant qu'elle valait la valeur par défaut, et revient à la valeur par défaut si elle
 * n'est plus valide.
 */
export function updateSlot(slot: Slot, key: keyof Slot, value: string): Slot {
  const next = { ...slot, [key]: value };
  if (key === 'lastBooking') return next;
  const followsDefault = slot.lastBooking === defaultLastBooking(slot);
  return keepOrDefaultLastBooking(next, followsDefault ? undefined : slot.lastBooking);
}

/** Heures de début proposées aux clients pour un service : de l'ouverture à la dernière réservation. */
export function bookingStarts(slot: Slot): string[] {
  const options = lastBookingOptions(slot);
  const last = slot.lastBooking ?? defaultLastBooking(slot);
  const index = last ? options.indexOf(last) : -1;
  return index >= 0 ? options.slice(0, index + 1) : options;
}

/** Jours ouverts consécutifs aux mêmes services, dans l'ordre de la semaine : de quoi la résumer. */
export function groupWeek(
  hours: WeekHours,
  days: readonly string[],
): { days: string[]; slots: Slot[] }[] {
  const groups: { days: string[]; slots: Slot[]; key: string }[] = [];
  let previousOpen = false;
  for (const day of days) {
    const slots = slotsOf(hours[day] ?? null);
    if (!slots.length) {
      previousOpen = false;
      continue;
    }
    const key = JSON.stringify(
      slots.map(({ open, close, lastBooking }) => [open, close, lastBooking]),
    );
    const last = groups[groups.length - 1];
    if (previousOpen && last?.key === key) last.days.push(day);
    else groups.push({ days: [day], slots, key });
    previousOpen = true;
  }
  return groups.map(({ days: groupDays, slots }) => ({ days: groupDays, slots }));
}

export function toDayHours(slots: Slot[]): DayHours {
  const first = slots[0];
  const last = slots[slots.length - 1];
  if (!first || !last) return null;

  return slots.length > 1
    ? { open: first.open, close: last.close, slots: slots.map((slot) => ({ ...slot })) }
    : {
        open: first.open,
        close: first.close,
        ...(first.lastBooking ? { lastBooking: first.lastBooking } : {}),
      };
}

export function modeOf(day: DayHours): Mode {
  return slotsOf(day).length > 1 ? 'split' : 'continuous';
}

/** Passe d'un mode à l'autre en gardant les bornes saisies quand elles restent cohérentes. */
export function switchMode(day: DayHours, mode: Mode): DayHours {
  const slots = slotsOf(day);
  if (slots.length === 0 || modeOf(day) === mode) return day;
  const first = slots[0];
  const last = slots.at(-1)!;
  if (mode === 'continuous') {
    return toDayHours([
      keepOrDefaultLastBooking({ open: first.open, close: last.close }, last.lastBooking),
    ]);
  }

  const firstOpen = toMinutes(first.open);
  const lastClose = toMinutes(last.close);
  const canKeepBounds = firstOpen != null && firstOpen < toMinutes(PRESETS.split[0].close)!;
  const dinnerClose = lastClose != null ? last.close : PRESETS.split[1].close;
  return toDayHours(
    canKeepBounds
      ? [
          keepOrDefaultLastBooking({ open: first.open, close: PRESETS.split[0].close }, undefined),
          keepOrDefaultLastBooking(
            { open: PRESETS.split[1].open, close: dinnerClose },
            last.lastBooking,
          ),
        ]
      : PRESETS.split,
  );
}

function overnightEnd(slot: Slot): number | null {
  const open = toMinutes(slot.open);
  const close = toMinutes(slot.close);
  if (open == null || close == null || open === close) return null;
  if (close > open) return close;
  if (close > LATEST_OVERNIGHT_CLOSE) return null;
  return close + MINUTES_PER_DAY;
}

export function isOvernight(slot: Slot): boolean {
  const open = toMinutes(slot.open);
  const close = toMinutes(slot.close);
  return open != null && close != null && close < open && close <= LATEST_OVERNIGHT_CLOSE;
}

export function validateDay(day: DayHours): string | null {
  const slots = slotsOf(day);
  if (slots.length > 2) return 'Saisissez au maximum deux services.';

  const normalized = slots.map((slot) => {
    const open = toMinutes(slot.open);
    const end = overnightEnd(slot);
    return open == null || end == null ? null : { open, end };
  });

  if (normalized.some((slot) => slot == null)) {
    return 'Vérifiez les heures : la fermeture doit suivre l’ouverture, au plus tard à 06:00 le lendemain.';
  }

  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1]!;
    const current = normalized[index]!;
    const isNextDay = current.open < previous.open;
    if (isNextDay && previous.end <= MINUTES_PER_DAY) {
      return 'Indiquez les services dans l’ordre de la journée.';
    }
    const currentOpen = isNextDay ? current.open + MINUTES_PER_DAY : current.open;
    const previousEnd = previous.open + (previous.end - previous.open);
    const currentEnd = currentOpen + (current.end - current.open);
    if (currentOpen < previousEnd || currentEnd <= currentOpen) {
      return 'Les services se chevauchent. Vérifiez la fin du midi et le début du soir.';
    }
  }

  for (const slot of slots) {
    if (!slot.lastBooking || !lastBookingOptions(slot).includes(slot.lastBooking)) {
      return 'Indiquez la dernière réservation de chaque service, dans le service et par pas de 30 minutes.';
    }
  }

  return null;
}

/** Existing hours are retained; new restaurants start with the lunch/dinner preset. */
export function initialWeek(
  existing: Record<string, DayHours> | undefined,
  defaults: Record<string, { open: string; close: string }> | undefined,
  days: readonly string[],
): WeekHours {
  if (existing && Object.keys(existing).length > 0) {
    const week: WeekHours = { ...existing };
    for (const day of days) {
      const value = existing[day];
      week[day] = value ? toDayHours(slotsOf(value)) : null;
    }
    return week;
  }

  const hasDefaults = defaults && Object.keys(defaults).length > 0;
  const fallbackOpen = ['tue', 'wed', 'thu', 'fri', 'sat'];
  const week: WeekHours = {};
  for (const day of days) {
    const open = hasDefaults ? Boolean(defaults[day]) : fallbackOpen.includes(day);
    week[day] = open ? toDayHours(PRESETS.split) : null;
  }
  return week;
}
