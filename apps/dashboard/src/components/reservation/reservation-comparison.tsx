'use client';

import { ArrowRight, Check, Info, Phone } from 'lucide-react';

type Choice = { date: string; time: string; partySize: number };
const dateLabel = (date: string) =>
  new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', weekday: 'short' }).format(
    new Date(`${date}T12:00:00`),
  );

export function ReservationComparison({
  original,
  choice,
  terms,
  phone,
  demo,
}: {
  original: Choice;
  choice: Choice;
  terms?: string;
  phone?: string | null;
  demo?: boolean;
}) {
  const date = new Date(`${original.date}T12:00:00`);
  const rows = [
    {
      label: 'Date',
      before: dateLabel(original.date),
      after: dateLabel(choice.date),
      changed: original.date !== choice.date,
    },
    {
      label: 'Heure',
      before: original.time.replace(':', 'h'),
      after: choice.time ? choice.time.replace(':', 'h') : 'À choisir',
      changed: original.time !== choice.time,
    },
    {
      label: 'Personnes',
      before: String(original.partySize),
      after: String(choice.partySize),
      changed: original.partySize !== choice.partySize,
    },
  ];
  return (
    <>
      <p
        aria-label="Réservation actuelle"
        className="rounded-xl border border-[hsl(var(--reservation-line))] bg-[hsl(var(--reservation-panel)/0.65)] px-3 py-3 text-xs font-medium leading-relaxed text-[hsl(var(--reservation-soft))] lg:hidden"
      >
        Actuel :{' '}
        <span className="text-[hsl(var(--reservation-ink))]">
          {dateLabel(original.date)} · {original.time.replace(':', 'h')} · {original.partySize}{' '}
          pers.
        </span>
      </p>
      <div className="hidden space-y-3 lg:block">
        <section
          aria-label="Comparaison de la réservation"
          className="rounded-2xl border border-[hsl(var(--reservation-line))] bg-[hsl(var(--reservation-line)/0.55)] p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--reservation-soft))]">
              Votre réservation
            </h2>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--reservation-confirmed-bg))] px-2.5 py-1 text-[10px] font-semibold text-[hsl(var(--reservation-confirmed))]">
              <Check size={11} aria-hidden="true" /> Confirmée
            </span>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <div
              aria-hidden="true"
              className="flex h-16 w-14 shrink-0 flex-col items-center justify-center rounded-xl border border-[hsl(var(--reservation-line))] bg-[hsl(var(--reservation-panel)/0.75)]"
            >
              <span className="text-[9px] font-semibold uppercase tracking-wider text-[hsl(var(--reservation-soft))]">
                {new Intl.DateTimeFormat('fr-FR', { weekday: 'short' })
                  .format(date)
                  .replace('.', '')}
              </span>
              <span className="mt-1 text-2xl font-semibold leading-none text-[hsl(var(--reservation-ink))]">
                {date.getDate()}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-base font-semibold text-[hsl(var(--reservation-ink))]">
                Table à {original.time.replace(':', 'h')}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-[hsl(var(--reservation-soft))]">
                {dateLabel(original.date)} · {original.partySize} personnes
              </p>
            </div>
          </div>
          {rows.some((row) => row.changed) && (
            <div
              className="mt-4 space-y-2 border-t border-[hsl(var(--reservation-line))] pt-3"
              aria-live="polite"
            >
              <p className="pb-1 text-[9px] font-semibold uppercase tracking-wider text-[hsl(var(--reservation-soft))]">
                Votre nouveau choix
              </p>
              {rows
                .filter((row) => row.changed)
                .map((row) => (
                  <div
                    key={row.label}
                    className="flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <span className="text-[hsl(var(--reservation-soft))]">{row.label}</span>
                    <span className="flex items-center gap-2">
                      <s className="text-[hsl(var(--reservation-soft))]">{row.before}</s>
                      <ArrowRight
                        size={11}
                        className="text-[hsl(var(--reservation-muted))]"
                        aria-hidden="true"
                      />
                      <strong className="font-semibold text-[hsl(var(--reservation-ink))]">
                        {row.after}
                      </strong>
                    </span>
                  </div>
                ))}
            </div>
          )}
        </section>
        {(terms || (phone && !demo)) && (
          <section
            aria-label="Conditions de réservation"
            className="space-y-3 rounded-2xl border border-[hsl(var(--reservation-line))] bg-[hsl(var(--reservation-panel)/0.55)] p-4"
          >
            {terms && (
              <p className="flex items-start gap-2 text-xs leading-relaxed text-[hsl(var(--reservation-soft))]">
                <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                {terms}
              </p>
            )}
            {phone && !demo && (
              <a
                href={`tel:${phone.replace(/[^+0-9]/g, '')}`}
                className="inline-flex min-h-11 items-center gap-2 text-xs font-medium text-[hsl(var(--reservation-ink))] underline-offset-4 transition-all duration-200 hover:underline"
              >
                <Phone size={13} aria-hidden="true" /> Contacter le restaurant
              </a>
            )}
          </section>
        )}
      </div>
    </>
  );
}
