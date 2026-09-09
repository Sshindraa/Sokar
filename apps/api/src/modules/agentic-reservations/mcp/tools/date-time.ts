import {
  DEFAULT_RESTAURANT_TIMEZONE,
  zonedTimeToUtc,
} from '../../../../shared/timezone/restaurant-time.js';

/**
 * Fuseau utilisé lorsqu'un client MCP envoie une date locale sans timezone.
 * Sokar est actuellement centré sur les restaurants français ; les outils
 * acceptent toujours un champ `timezone` explicite pour les autres zones.
 */
export const DEFAULT_MCP_TIMEZONE = DEFAULT_RESTAURANT_TIMEZONE;

/**
 * ISO 8601 avec ou sans offset :
 * - 2026-09-10T20:00
 * - 2026-09-10T20:00:00
 * - 2026-09-10T20:00:00+02:00
 * - 2026-09-10T20:00:00Z
 *
 * Le schéma valide la forme. La validation calendaire et la conversion DST
 * sont faites par parseMcpDateTime, une fois le fuseau du restaurant connu.
 */
export const MCP_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/i;

type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  offset: string | undefined;
};

function readParts(value: string): DateTimeParts | null {
  const match = value.match(MCP_DATE_TIME_PATTERN);
  if (!match) return null;

  const fraction = match[7] ?? '';
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
    millisecond: fraction ? Number(fraction.padEnd(3, '0')) : 0,
    offset: match[8],
  };
}

function hasValidCalendarParts(parts: DateTimeParts): boolean {
  if (
    parts.year < 1000 ||
    parts.year > 9999 ||
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.hour > 23 ||
    parts.minute > 59 ||
    parts.second > 59 ||
    parts.millisecond > 999
  ) {
    return false;
  }

  const check = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      parts.millisecond,
    ),
  );
  return (
    check.getUTCFullYear() === parts.year &&
    check.getUTCMonth() === parts.month - 1 &&
    check.getUTCDate() === parts.day &&
    check.getUTCHours() === parts.hour &&
    check.getUTCMinutes() === parts.minute &&
    check.getUTCSeconds() === parts.second &&
    check.getUTCMilliseconds() === parts.millisecond
  );
}

function hasValidOffset(offset: string | undefined): boolean {
  if (!offset || offset.toUpperCase() === 'Z') return true;
  const sign = offset[0];
  const hours = Number(offset.slice(1, 3));
  const minutes = Number(offset.slice(4, 6));
  return (sign === '+' || sign === '-') && hours <= 23 && minutes <= 59;
}

export function isValidMcpTimeZone(timezone: string): boolean {
  if (!timezone || timezone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export function isMcpDateTimeSyntax(value: unknown): value is string {
  return typeof value === 'string' && readParts(value) !== null;
}

function localParts(date: Date, timezone: string): DateTimeParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '0';
  return {
    year: Number(value('year')),
    month: Number(value('month')),
    day: Number(value('day')),
    hour: Number(value('hour')) % 24,
    minute: Number(value('minute')),
    second: Number(value('second')),
    millisecond: 0,
    offset: undefined,
  };
}

/**
 * Convertit une date MCP vers un instant UTC.
 *
 * Les valeurs avec offset sont déjà des instants (`Z`, `+02:00`, ...).
 * Les valeurs sans offset sont des heures locales dans `timezone`. Un horaire
 * inexistant pendant le passage à l'heure d'été est rejeté au lieu d'être
 * silencieusement décalé par le runtime JavaScript.
 */
export function parseMcpDateTime(value: string, timezone = DEFAULT_MCP_TIMEZONE): Date | null {
  const parts = readParts(value);
  if (!parts || !hasValidCalendarParts(parts) || !hasValidOffset(parts.offset)) return null;
  if (!isValidMcpTimeZone(timezone)) return null;

  if (parts.offset) {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  const datePart = `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  const timePart = `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
  const minuteInstant = zonedTimeToUtc(datePart, timePart, timezone);
  const parsed = new Date(minuteInstant.getTime() + parts.second * 1_000 + parts.millisecond);
  const roundTrip = localParts(parsed, timezone);

  return roundTrip.year === parts.year &&
    roundTrip.month === parts.month &&
    roundTrip.day === parts.day &&
    roundTrip.hour === parts.hour &&
    roundTrip.minute === parts.minute &&
    roundTrip.second === parts.second
    ? parsed
    : null;
}

export function parseMcpDateRange(args: {
  start: string;
  end: string;
  timezone?: string;
  defaultTimezone?: string;
}):
  | { ok: true; start: Date; end: Date; timezone: string }
  | { ok: false; code: 'INVALID_DATETIME'; error: string } {
  const timezone = args.timezone ?? args.defaultTimezone ?? DEFAULT_MCP_TIMEZONE;
  if (!isValidMcpTimeZone(timezone)) {
    return {
      ok: false,
      code: 'INVALID_DATETIME',
      error: `Invalid timezone "${timezone}". Use an IANA timezone such as Europe/Paris.`,
    };
  }

  const start = parseMcpDateTime(args.start, timezone);
  const end = parseMcpDateTime(args.end, timezone);
  if (!start || !end) {
    return {
      ok: false,
      code: 'INVALID_DATETIME',
      error:
        'slot times must be valid ISO 8601 date-times. Include Z or an offset, or provide a local date-time with timezone.',
    };
  }
  if (end.getTime() <= start.getTime()) {
    return {
      ok: false,
      code: 'INVALID_DATETIME',
      error: 'The end time must be after the start time.',
    };
  }

  return { ok: true, start, end, timezone };
}
