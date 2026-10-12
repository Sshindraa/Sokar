'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, Check, Moon, Plus, Sun, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { ChoiceSelect } from '../choice-select';
import { useApi } from '@/lib/api';
import { useOnboarding } from '../onboarding-provider';
import { StepHeader, SubmitButton, DAY_LABELS } from '../ui';
import type { StepProps } from '../types';
import {
  type DayHours,
  type Slot,
  type WeekHours,
  PRESETS,
  initialWeek,
  isOvernight,
  lastBookingOptions,
  slotsOf,
  toDayHours,
  updateSlot,
  validateDay,
} from '../hours';

const DAYS = DAY_LABELS.map(([day]) => day);
const interactive =
  'transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function lastBookingForDay(slot: Slot, requested: string): string | undefined {
  const [openHour, openMinute] = slot.open.split(':').map(Number);
  const opening = openHour * 60 + openMinute;
  const [requestedHour, requestedMinute] = requested.split(':').map(Number);
  let cutoff = requestedHour * 60 + requestedMinute;
  if (cutoff < opening) cutoff += 24 * 60;

  let latest: string | undefined;
  for (const option of lastBookingOptions(slot)) {
    const [hour, minute] = option.split(':').map(Number);
    let time = hour * 60 + minute;
    if (time < opening) time += 24 * 60;
    if (time <= cutoff) latest = option;
  }
  return latest;
}

export function HoursStep({ onComplete }: StepProps) {
  const { patch, orgId } = useApi();
  const { state, updateTask, placeImportDraft, setPlaceImportDraft } = useOnboarding();
  const openingHours = placeImportDraft?.openingHours ?? state?.restaurant.openingHours;
  const initial = useMemo(
    () =>
      initialWeek(openingHours as Record<string, DayHours> | undefined, state?.defaultHours, DAYS),
    [openingHours, state?.defaultHours],
  );
  const [hours, setHours] = useState<WeekHours>(initial);
  const [selected, setSelected] = useState<string>(
    () => DAYS.find((day) => initial[day]) ?? DAYS[0],
  );
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [correcting, setCorrecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const lastSlots = useRef<Record<string, Slot[]>>({});
  useEffect(() => {
    setHours(initial);
    setConfirmed({});
  }, [initial]);
  const errors = Object.fromEntries(DAYS.map((day) => [day, validateDay(hours[day] ?? null)]));
  const openDays = DAYS.filter((day) => hours[day]);
  const serviceKey = (day: string, index: number, slot: Slot) =>
    `${day}:${index}:${slot.open}:${slot.close}`;
  const serviceName = (list: Slot[], index: number) =>
    list.length > 1
      ? index === 0
        ? 'Midi'
        : 'Soir'
      : list[index].open >= '16:00'
        ? 'Soir'
        : 'Midi';
  const configured = (day: string) =>
    slotsOf(hours[day] ?? null).every((slot, index) => confirmed[serviceKey(day, index, slot)]);
  const daysWithService = (service: string) =>
    openDays.filter((day) => {
      const daySlots = slotsOf(hours[day] ?? null);
      return daySlots.some((slot, index) => serviceName(daySlots, index) === service);
    }).length;
  const hasErrors =
    Object.values(errors).some(Boolean) ||
    !openDays.length ||
    openDays.some((day) => !configured(day));
  const label = DAY_LABELS.find(([day]) => day === selected)![1];
  const slots = slotsOf(hours[selected] ?? null);

  function configure(day: string, index: number, value: string) {
    const source = slotsOf(hours[day] ?? null);
    const service = serviceName(source, index);
    const nextHours = { ...hours };
    const nextConfirmed = { ...confirmed };

    for (const targetDay of openDays) {
      const target = slotsOf(hours[targetDay] ?? null);
      let updated = false;
      const nextSlots = target.map((slot, targetIndex) => {
        if (serviceName(target, targetIndex) !== service) return slot;
        const lastBooking = lastBookingForDay(slot, value);
        if (!lastBooking) return slot;
        updated = true;
        nextConfirmed[serviceKey(targetDay, targetIndex, slot)] = true;
        return { ...slot, lastBooking };
      });
      if (updated) nextHours[targetDay] = toDayHours(nextSlots);
    }

    setHours(nextHours);
    setConfirmed(nextConfirmed);
  }
  function setDay(value: DayHours) {
    setConfirmed((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([key]) => !key.startsWith(`${selected}:`)),
      ),
    );
    setHours((current) => ({ ...current, [selected]: value }));
  }
  function setSlot(index: number, key: keyof Slot, value: string) {
    setDay(toDayHours(slots.map((slot, i) => (i === index ? updateSlot(slot, key, value) : slot))));
  }
  function toggleDay(open: boolean) {
    if (!open) {
      lastSlots.current[selected] = slots;
      setDay(null);
    } else
      setDay(
        toDayHours(
          lastSlots.current[selected]?.length ? lastSlots.current[selected] : PRESETS.split,
        ),
      );
  }
  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (hasErrors) return;
    setSaving(true);
    setSaveError('');
    try {
      await patch(`restaurants/${orgId}`, { openingHours: hours });
      if (placeImportDraft)
        setPlaceImportDraft({ ...placeImportDraft, openingHours: hours, hoursNeedReview: [] });
      await updateTask('complete', 'hours');
      onComplete('floor');
    } catch {
      setSaveError('Les horaires n’ont pas pu être enregistrés. Réessayez.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      id="onboarding-voice-form"
      onSubmit={handleSubmit}
      className="flex min-h-0 w-full flex-1 flex-col gap-3"
    >
      <StepHeader
        icon={Calendar}
        title="Vos horaires de réservation"
        body="Réglez chaque service une fois : votre choix s’applique automatiquement aux jours ouverts."
      />
      <div className="min-w-0 flex-1 space-y-6">
        <div
          role="group"
          aria-label="Jours de la semaine"
          className="grid auto-cols-[8rem] grid-flow-col gap-2 overflow-x-auto pb-2 sm:grid-flow-row sm:auto-cols-auto sm:grid-cols-4 sm:overflow-visible sm:pb-0 xl:grid-cols-7"
        >
          {DAY_LABELS.map(([day, name]) => {
            const daySlots = slotsOf(hours[day] ?? null);
            const done = daySlots.length > 0 && configured(day) && !errors[day];
            return (
              <button
                key={day}
                type="button"
                aria-label={`Modifier ${name.toLowerCase()}`}
                aria-pressed={selected === day}
                aria-describedby={`hours-status-${day}`}
                onClick={() => {
                  setSelected(day);
                  setCorrecting(false);
                }}
                className={cn(
                  'flex min-w-0 flex-col items-stretch gap-1.5 rounded-2xl border px-4 py-5 text-left',
                  interactive,
                  selected === day
                    ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                    : 'border-border/70 bg-transparent hover:border-foreground/30 hover:bg-card',
                )}
              >
                <span className="mb-1 flex items-center justify-between gap-1 text-base font-semibold">
                  {name}
                  {done ? (
                    <Check size={14} aria-hidden="true" />
                  ) : selected === day ? (
                    <span
                      className="size-1.5 rounded-full bg-primary-foreground"
                      aria-hidden="true"
                    />
                  ) : null}
                </span>
                <span
                  className={cn(
                    'flex min-h-10 flex-col gap-1 text-sm leading-5 tabular-nums',
                    selected === day ? 'text-primary-foreground/80' : 'text-muted-foreground',
                  )}
                >
                  {daySlots.length
                    ? daySlots.map((slot, index) => (
                        <span key={index} className="flex items-center gap-1">
                          {index === 0 ? (
                            <Sun
                              size={13}
                              aria-hidden="true"
                              className="hidden shrink-0 xl:block"
                            />
                          ) : (
                            <Moon
                              size={13}
                              aria-hidden="true"
                              className="hidden shrink-0 xl:block"
                            />
                          )}
                          {slot.open}–{slot.close}
                        </span>
                      ))
                    : 'Fermé'}
                </span>
                <span id={`hours-status-${day}`} className="sr-only">
                  {errors[day]
                    ? 'À corriger'
                    : done
                      ? 'Configuré'
                      : daySlots.length
                        ? 'À compléter'
                        : 'Fermé'}
                </span>
                {errors[day] && <span className="text-xs text-destructive">À corriger</span>}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-2xl font-semibold tracking-tight">Derniers créneaux réservables</h3>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={correcting}
            aria-controls="day-hours-editor"
            onClick={() => setCorrecting(!correcting)}
            className={cn('gap-2 rounded-xl text-muted-foreground', interactive)}
          >
            <Pencil size={14} aria-hidden="true" />
            {correcting
              ? 'Masquer les horaires d’ouverture'
              : `Modifier les horaires de ${label.toLowerCase()}`}
          </Button>
        </div>
        {!slots.length && (
          <p className="text-sm text-muted-foreground">Le restaurant est fermé ce jour.</p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {slots.map((slot, index) => {
            const service = serviceName(slots, index);
            const affectedDays = daysWithService(service);
            return (
              <section
                key={`${selected}:${index}`}
                className={cn(
                  'rounded-3xl border p-5 sm:p-7',
                  service === 'Soir'
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border/60 bg-secondary/60 text-foreground',
                )}
              >
                <h3 className="flex flex-wrap items-center gap-3 text-2xl font-medium tracking-tight">
                  <span
                    className={cn(
                      'inline-flex size-11 items-center justify-center rounded-full',
                      service === 'Soir'
                        ? 'bg-primary-foreground/10 text-primary-foreground'
                        : 'bg-brand/10 text-brand',
                    )}
                    aria-hidden="true"
                  >
                    {service === 'Soir' ? <Moon size={20} /> : <Sun size={20} />}
                  </span>
                  {service}
                  <span
                    className={cn(
                      'ml-auto text-xs font-normal tabular-nums tracking-normal',
                      service === 'Soir' ? 'text-primary-foreground/70' : 'text-muted-foreground',
                    )}
                  >
                    <span className="sr-only">Ouverture : </span>
                    {slot.open}–{slot.close}
                    {isOvernight(slot) && (
                      <span className="block text-xs font-normal">le lendemain</span>
                    )}
                  </span>
                </h3>
                <div className="mt-7">
                  <p
                    className={cn(
                      'mb-2 text-xs font-medium',
                      service === 'Soir' ? 'text-primary-foreground/70' : 'text-muted-foreground',
                    )}
                  >
                    Dernière arrivée
                    <span
                      className={cn(
                        'ml-2 font-normal',
                        service === 'Soir' ? 'text-primary-foreground/65' : 'text-muted-foreground',
                      )}
                    >
                      ·{' '}
                      {`${affectedDays} jour${affectedDays > 1 ? 's' : ''} concerné${affectedDays > 1 ? 's' : ''}`}
                    </span>
                  </p>
                  <ChoiceSelect
                    label={`${service} ${slot.open}–${slot.close} : dernière arrivée`}
                    value={
                      confirmed[serviceKey(selected, index, slot)] ? (slot.lastBooking ?? '') : ''
                    }
                    placeholder="Choisir"
                    options={lastBookingOptions(slot).map((time) => ({ value: time, label: time }))}
                    onChange={(time) => configure(selected, index, time)}
                    triggerClassName={cn(
                      'h-16 w-full rounded-2xl border px-4 text-xl font-medium tabular-nums sm:text-2xl',
                      service === 'Soir'
                        ? 'border-primary-foreground/20 bg-primary-foreground/5 text-primary-foreground data-[placeholder]:text-primary-foreground/60 hover:border-primary-foreground/40 hover:bg-primary-foreground/10 focus:ring-primary-foreground/40'
                        : 'border-border bg-background/80 text-foreground data-[placeholder]:text-muted-foreground hover:border-brand/50 hover:bg-background',
                    )}
                  />
                  <p
                    className={cn(
                      'mt-2 text-xs leading-5',
                      service === 'Soir' ? 'text-primary-foreground/70' : 'text-muted-foreground',
                    )}
                  >
                    {`Ce choix est appliqué d’un coup aux ${affectedDays} jour${affectedDays > 1 ? 's' : ''} concernés. L’heure s’ajuste aux horaires de chacun.`}
                  </p>
                </div>
              </section>
            );
          })}
        </div>
        {correcting && (
          <section
            id="day-hours-editor"
            aria-label={`Horaires du ${label.toLowerCase()}`}
            className="space-y-4 rounded-2xl border border-border bg-background p-4"
          >
            <h3 className="text-xl font-semibold">{label}</h3>
            <label className="flex items-center justify-between gap-3 text-sm font-medium">
              {label} ouvert
              <Switch checked={slots.length > 0} onCheckedChange={toggleDay} />
            </label>
            {slots.map((slot, index) => (
              <div key={`${selected}:${index}`} className="space-y-3 rounded-2xl bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{serviceName(slots, index)}</h3>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDay(toDayHours(slots.filter((_, i) => i !== index)))}
                    className={cn('text-xs text-muted-foreground', interactive)}
                  >
                    Retirer
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {(['open', 'close'] as const).map((field) => (
                    <label key={field} className="space-y-1 text-xs text-muted-foreground">
                      <span>{field === 'open' ? 'Ouverture' : 'Fermeture'}</span>
                      <Input
                        type="time"
                        step={900}
                        value={slot[field]}
                        onChange={(event) => setSlot(index, field, event.target.value)}
                        aria-label={`${label}, ${serviceName(slots, index).toLowerCase()} : ${field === 'open' ? 'ouverture' : 'fermeture'}`}
                        aria-invalid={Boolean(errors[selected])}
                        className="h-10 rounded-lg bg-background tabular-nums"
                      />
                    </label>
                  ))}
                </div>
                {isOvernight(slot) && (
                  <p className="text-xs text-muted-foreground">Fermeture le lendemain</p>
                )}
              </div>
            ))}
            {slots.length > 0 && slots.length < 2 && (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setDay(
                    toDayHours(
                      slots[0].open >= '16:00'
                        ? [{ ...PRESETS.split[0] }, ...slots]
                        : [...slots, { ...PRESETS.split[1] }],
                    ),
                  )
                }
                className={cn('rounded-xl', interactive)}
              >
                <Plus size={14} aria-hidden="true" /> Ajouter un service
              </Button>
            )}
            {errors[selected] && (
              <p role="alert" className="text-sm text-destructive">
                {errors[selected]}
              </p>
            )}
            <Button
              type="button"
              onClick={() => setCorrecting(false)}
              className={cn('rounded-full', interactive)}
            >
              Terminer
            </Button>
          </section>
        )}
      </div>
      {!openDays.length && (
        <p role="alert" className="text-sm text-destructive">
          Ouvrez au moins un jour pour proposer des créneaux.
        </p>
      )}
      {saveError && (
        <p role="alert" className="text-sm text-destructive">
          {saveError}
        </p>
      )}
      <SubmitButton saving={saving} disabled={hasErrors}>
        Continuer
      </SubmitButton>
    </form>
  );
}
