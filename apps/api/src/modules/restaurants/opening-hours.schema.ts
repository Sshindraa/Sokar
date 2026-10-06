import { z } from 'zod';

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MINUTES_PER_DAY = 24 * 60;
const LATEST_OVERNIGHT_CLOSE = 6 * 60;

const OpeningHourPeriodSchema = z.object({
  open: z.string().regex(TIME_PATTERN),
  close: z.string().regex(TIME_PATTERN),
});

export const OpeningHoursDaySchema = z
  .object({
    open: z.string().regex(TIME_PATTERN),
    close: z.string().regex(TIME_PATTERN),
    services: z.array(OpeningHourPeriodSchema).length(2).optional(),
    slots: z.array(OpeningHourPeriodSchema).max(2).optional(),
  })
  .superRefine((day, context) => {
    const periods = day.slots?.length
      ? day.slots
      : day.services?.length
        ? day.services
        : [{ open: day.open, close: day.close }];
    const first = periods[0];
    const last = periods.at(-1);
    if (!first || !last) return;

    if (day.open !== first.open || day.close !== last.close) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Les heures principales doivent correspondre aux bornes des services.',
      });
    }

    let previousStart: number | null = null;
    let previousEnd: number | null = null;
    for (const period of periods) {
      const open = toMinutes(period.open);
      let close = toMinutes(period.close);
      if (close === open || (close < open && close > LATEST_OVERNIGHT_CLOSE)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'La fermeture doit suivre l’ouverture, au plus tard à 06:00 le lendemain.',
        });
        continue;
      }
      if (close < open) close += MINUTES_PER_DAY;

      let start = open;
      if (previousStart != null && start < previousStart) {
        if ((previousEnd ?? 0) <= MINUTES_PER_DAY) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Les services doivent être indiqués dans l’ordre de la journée.',
          });
        }
        start += MINUTES_PER_DAY;
        close += MINUTES_PER_DAY;
      }
      if (previousEnd != null && start < previousEnd) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Les services se chevauchent.',
        });
      }
      previousStart = start;
      previousEnd = close;
    }
  });

export const OpeningHoursSchema = z.record(
  z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
  z.union([OpeningHoursDaySchema, z.null()]),
);

function toMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}
