'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, Sun, Moon, Infinity as InfinityIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { useOnboarding } from '../onboarding-provider';
import { StepHeader, SubmitButton, DAY_LABELS } from '../ui';
import type { StepProps } from '../types';
import {
  type DayHours,
  type Mode,
  type Slot,
  type WeekHours,
  PRESETS,
  SLOT_LABELS,
  initialWeek,
  isOvernight,
  modeOf,
  slotsOf,
  switchMode,
  toDayHours,
  validateDay,
} from '../hours';

const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: 'split', label: 'Midi et soir' },
  { value: 'continuous', label: 'Continu' },
];

const DAYS = DAY_LABELS.map(([day]) => day);

export function HoursStep({ onComplete }: StepProps) {
  const { patch, orgId } = useApi();
  const { state, updateTask, placeImportDraft } = useOnboarding();
  const importedHours = placeImportDraft?.openingHours;
  const openingHours = importedHours ?? state?.restaurant.openingHours;
  const initial = useMemo(
    () =>
      initialWeek(openingHours as Record<string, DayHours> | undefined, state?.defaultHours, DAYS),
    [openingHours, state?.defaultHours],
  );

  const [hours, setHours] = useState<WeekHours>(initial);
  const [saving, setSaving] = useState(false);
  const [undo, setUndo] = useState<{ previous: WeekHours; message: string } | null>(null);
  const lastSlots = useRef<Record<string, Slot[]>>({});

  useEffect(() => setHours(initial), [initial]);

  useEffect(() => {
    if (!undo) return;
    const timeout = setTimeout(() => setUndo(null), 6000);
    return () => clearTimeout(timeout);
  }, [undo]);

  const openDays = DAYS.filter((day) => hours[day]);
  const errors = Object.fromEntries(DAYS.map((day) => [day, validateDay(hours[day] ?? null)]));
  const hasErrors = Object.values(errors).some(Boolean) || openDays.length === 0;
  const globalMode: Mode | null = (() => {
    const modes = new Set(openDays.map((day) => modeOf(hours[day] ?? null)));
    return modes.size === 1 ? [...modes][0] : null;
  })();

  function setDay(day: string, value: DayHours) {
    setHours((current) => ({ ...current, [day]: value }));
    setUndo(null);
  }

  function toggleDay(day: string, open: boolean) {
    if (!open) {
      lastSlots.current[day] = slotsOf(hours[day] ?? null);
      setDay(day, null);
      return;
    }

    const restore = lastSlots.current[day];
    setDay(day, toDayHours(restore?.length ? restore : PRESETS[globalMode ?? 'split']));
  }

  function setSlot(day: string, index: number, key: keyof Slot, value: string) {
    const slots = slotsOf(hours[day] ?? null).map((slot, slotIndex) =>
      slotIndex === index ? { ...slot, [key]: value } : slot,
    );
    setDay(day, toDayHours(slots));
  }

  function applyModeToAll(mode: Mode) {
    setUndo({
      previous: hours,
      message: `${mode === 'split' ? 'Midi et soir' : 'Service continu'} appliqué aux jours ouverts.`,
    });
    setHours((current) => {
      const next = { ...current };
      for (const day of DAYS) {
        if (next[day]) next[day] = toDayHours(PRESETS[mode]);
      }
      return next;
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (hasErrors) return;

    setSaving(true);
    try {
      await patch(`restaurants/${orgId}`, { openingHours: hours });
      await updateTask('complete', 'hours');
      onComplete('knowledge');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      id="onboarding-voice-form"
      onSubmit={handleSubmit}
      className="mx-0 w-full max-w-6xl space-y-3"
    >
      <StepHeader
        icon={Calendar}
        title="Horaires de réservation"
        body="Choisissez les jours et les périodes où vous acceptez les réservations. Les clients pourront choisir une heure de réservation toutes les 30 minutes, par exemple 12 h, 12 h 30 ou 13 h."
      />

      {placeImportDraft && (
        <div className="space-y-1 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <p>
            Suggestions reprises des horaires d’ouverture Google Maps. Vérifiez-les : elles ne
            définissent pas forcément vos créneaux de réservation. Sokar peut répondre aux appels 24
            h/24.
          </p>
          <p className="text-xs font-normal" translate="no">
            Google Maps
          </p>
          {placeImportDraft.hoursNeedReview.length > 0 && (
            <p className="pt-1 text-foreground">
              {placeImportDraft.hoursNeedReview.length === DAYS.length
                ? 'Aucun horaire exploitable n’a été trouvé. Renseignez manuellement vos créneaux de réservation.'
                : `À vérifier ou saisir manuellement : ${DAY_LABELS.filter(([day]) =>
                    placeImportDraft.hoursNeedReview.includes(day),
                  )
                    .map(([, label]) => label)
                    .join(
                      ', ',
                    )}. Certains horaires Google ne correspondent pas au format de réservation.`}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground xl:text-base">
            Votre rythme de la semaine
          </span>
          <Segmented
            label="Rythme de service pour tous les jours ouverts"
            value={globalMode}
            options={MODE_OPTIONS}
            onChange={applyModeToAll}
          />
          {globalMode === null && openDays.length > 0 && (
            <span className="text-xs text-muted-foreground">
              Horaires différents selon les jours
            </span>
          )}
        </div>
        <span className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground">
          <Calendar size={14} aria-hidden="true" />
          {openDays.length} jours ouverts · heures proposées toutes les 30 min
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-background">
        {DAY_LABELS.map(([day, label]) => {
          const value = hours[day] ?? null;
          const open = Boolean(value);
          const slots = slotsOf(value);
          const error = errors[day];

          return (
            <div
              key={day}
              className={cn(
                'grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b px-3 py-1.5 transition-all duration-200 last:border-b-0 lg:grid-cols-[8rem_minmax(0,1fr)_auto] lg:gap-x-2 xl:grid-cols-[9rem_minmax(0,1fr)_auto] xl:gap-x-3',
                open ? 'border-border bg-background' : 'border-border bg-muted/30',
                error && 'border-destructive/50',
              )}
            >
              <label
                htmlFor={`open-${day}`}
                className="flex cursor-pointer select-none items-center gap-2"
              >
                <Switch
                  id={`open-${day}`}
                  checked={open}
                  onCheckedChange={(checked) => toggleDay(day, checked)}
                  className={cn(!open && 'border-border bg-input')}
                />
                <span
                  className={cn('text-sm font-medium xl:text-base', !open && 'text-foreground/80')}
                >
                  {label}
                </span>
                {!open && (
                  <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground xl:text-sm">
                    Fermé
                  </span>
                )}
              </label>

              {open ? (
                <>
                  <div className="col-start-2 row-start-1 lg:col-start-3">
                    <Segmented
                      label={`Rythme du ${label.toLowerCase()}`}
                      value={modeOf(value)}
                      options={MODE_OPTIONS}
                      onChange={(mode) => setDay(day, switchMode(value, mode))}
                      compact
                    />
                  </div>

                  <div className="col-span-2 col-start-1 row-start-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 lg:col-span-1 lg:col-start-2 lg:row-start-1 lg:w-fit lg:max-w-full lg:justify-self-center">
                    {slots.map((slot, index) => {
                      const slotLabel = slots.length > 1 ? SLOT_LABELS[index] : 'Service';
                      return (
                        <div key={`${day}-${index}`} className="flex min-w-0 items-center gap-2">
                          {slots.length > 1 && (
                            <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-foreground/80 xl:text-sm">
                              {index === 0 ? (
                                <Sun size={12} aria-hidden="true" />
                              ) : (
                                <Moon size={12} aria-hidden="true" />
                              )}
                              {slotLabel}
                            </span>
                          )}
                          <div className="grid grid-cols-[4rem_1.5rem_4rem] items-center xl:grid-cols-[4.5rem_1.5rem_4.5rem]">
                            <TimeInput
                              value={slot.open}
                              onChange={(next) => setSlot(day, index, 'open', next)}
                              aria-label={`${label}, ${slotLabel.toLowerCase()} : ouverture`}
                              aria-invalid={Boolean(error)}
                            />
                            <span
                              aria-hidden="true"
                              className="w-full text-center text-muted-foreground"
                            >
                              –
                            </span>
                            <TimeInput
                              value={slot.close}
                              onChange={(next) => setSlot(day, index, 'close', next)}
                              aria-label={`${label}, ${slotLabel.toLowerCase()} : fermeture`}
                              aria-invalid={Boolean(error)}
                            />
                          </div>
                          {isOvernight(slot) && (
                            <span className="text-xs text-muted-foreground">lendemain</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : null}

              {error && (
                <p role="alert" className="col-span-full text-xs text-destructive">
                  {error}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground xl:text-sm">
        Ces horaires concernent uniquement les réservations. Si le renvoi d’appel est activé, Sokar
        continue à prendre toutes les réservations en dehors de ces plages.
      </p>

      <div role="status" aria-live="polite">
        {undo && (
          <div className="inline-flex items-center gap-3 rounded-md bg-foreground px-3 py-2 text-sm text-background">
            {undo.message}
            <button
              type="button"
              onClick={() => {
                setHours(undo.previous);
                setUndo(null);
              }}
              className="font-medium underline underline-offset-2 transition-all duration-200"
            >
              Annuler
            </button>
          </div>
        )}
      </div>

      {openDays.length === 0 && (
        <p role="alert" className="text-sm text-destructive">
          Ouvrez au moins un jour pour que Sokar puisse proposer des créneaux.
        </p>
      )}

      <SubmitButton saving={saving} disabled={hasErrors}>
        Continuer vers Consignes & démo
      </SubmitButton>
    </form>
  );
}

function TimeInput({
  value,
  onChange,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  'aria-label': string;
  'aria-invalid': boolean;
}) {
  return (
    <Input
      type="time"
      step={900}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      required
      className="block h-9 w-16 rounded-lg border-transparent bg-muted/50 px-1 text-center tabular-nums focus-visible:border-border xl:w-[4.5rem] xl:px-2 [&::-webkit-calendar-picker-indicator]:hidden"
      {...rest}
    />
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  compact = false,
}: {
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
  compact?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 items-center rounded-xl border border-border bg-muted/50 p-0.5',
        compact && 'min-h-10',
      )}
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <label key={option.value} className="cursor-pointer">
            <input
              type="radio"
              name={`onboarding-${label.toLowerCase().replace(/\s+/g, '-')}`}
              value={option.value}
              checked={active}
              onChange={(event) => {
                if (event.currentTarget.checked) onChange(option.value);
              }}
              className="peer sr-only"
            />
            <span
              className={cn(
                'inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-lg px-2 text-sm font-medium transition-all duration-200 peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring',
                'gap-1.5',
                !compact && 'px-3',
                active
                  ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {!compact &&
                (option.value === 'split' ? (
                  <Sun size={14} aria-hidden="true" />
                ) : (
                  <InfinityIcon size={14} aria-hidden="true" />
                ))}
              {option.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}
