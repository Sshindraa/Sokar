export type Slot = { open: string; close: string };
export type DayHours = { open: string; close: string; slots?: Slot[]; services?: Slot[] } | null;
export type WeekHours = Record<string, DayHours>;
export type Mode = 'continuous' | 'split';

export const PRESETS: Record<Mode, Slot[]> = {
  continuous: [{ open: '12:00', close: '22:00' }],
  split: [
    { open: '12:00', close: '14:30' },
    { open: '19:00', close: '22:30' },
  ],
};

export const SLOT_LABELS = ['Midi', 'Soir'] as const;
const MINUTES_PER_DAY = 24 * 60;
const LATEST_OVERNIGHT_CLOSE = 6 * 60;

function toMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function slotsOf(day: DayHours): Slot[] {
  if (!day) return [];
  if (day.slots?.length) return day.slots;
  // Read the local legacy shape while old records are being opened and saved.
  if (day.services?.length) return day.services;
  return [{ open: day.open, close: day.close }];
}

export function toDayHours(slots: Slot[]): DayHours {
  const first = slots[0];
  const last = slots[slots.length - 1];
  if (!first || !last) return null;

  return slots.length > 1
    ? { open: first.open, close: last.close, slots: slots.map((slot) => ({ ...slot })) }
    : { open: first.open, close: first.close };
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
  if (mode === 'continuous') return toDayHours([{ open: first.open, close: last.close }]);

  const firstOpen = toMinutes(first.open);
  const lastClose = toMinutes(last.close);
  const canKeepBounds = firstOpen != null && firstOpen < toMinutes(PRESETS.split[0].close)!;
  const dinnerClose = lastClose != null ? last.close : PRESETS.split[1].close;
  return toDayHours(
    canKeepBounds
      ? [
          { open: first.open, close: PRESETS.split[0].close },
          { open: PRESETS.split[1].open, close: dinnerClose },
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
