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
  const [selected, setSelected] = useState(() => DAYS.find((day) => initial[day]) ?? DAYS[0]);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [correcting, setCorrecting] = useState(false);
  const [advanced, setAdvanced] = useState<number | null>(null);
  const [undo, setUndo] = useState<WeekHours | null>(null);
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
        : 'Service';
  const groups = slotsOf(hours[selected] ?? null).map((slot, index, list) => ({
    key: `${selected}:${index}`,
    slot,
    index,
    days: [selected],
    name: serviceName(list, index),
  }));
  const [customCopy, setCustomCopy] = useState(false);
  const [targets, setTargets] = useState<string[]>([]);
  const [copyMessage, setCopyMessage] = useState('');
  const [undoConfirmed, setUndoConfirmed] = useState<Record<string, boolean>>({});
  const configured = (day: string) =>
    slotsOf(hours[day] ?? null).every((slot, index) => confirmed[serviceKey(day, index, slot)]);
  const remainingDays = openDays.filter((day) => !configured(day) || Boolean(errors[day])).length;
  const hasErrors =
    Object.values(errors).some(Boolean) ||
    !openDays.length ||
    openDays.some((day) => !configured(day));
  function configure(group: (typeof groups)[number], value: string) {
    setHours((current) => {
      const next = { ...current };
      for (const day of group.days)
        next[day] = toDayHours(
          slotsOf(current[day] ?? null).map((slot) =>
            slot.open === group.slot.open && slot.close === group.slot.close
              ? { ...slot, lastBooking: value }
              : slot,
          ),
        );
      return next;
    });
    setConfirmed((current) => {
      const next = { ...current };
      for (const day of group.days)
        slotsOf(hours[day] ?? null).forEach((slot, index) => {
          if (slot.open === group.slot.open && slot.close === group.slot.close)
            next[serviceKey(day, index, slot)] = true;
        });
      return next;
    });
  }
  function configuredService(day: string, target: Slot) {
    const daySlots = slotsOf(hours[day] ?? null);
    const index = daySlots.findIndex(
      (slot) => slot.open === target.open && slot.close === target.close,
    );
    return index >= 0 && Boolean(confirmed[serviceKey(day, index, daySlots[index])]);
  }
  const label = DAY_LABELS.find(([day]) => day === selected)![1];
  const slots = slotsOf(hours[selected] ?? null);

  function setDay(value: DayHours) {
    setConfirmed((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([key]) => !key.startsWith(`${selected}:`)),
      ),
    );
    setHours((current) => ({ ...current, [selected]: value }));
    setUndo(null);
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
  function copyBookings(destinationDays = targets) {
    setUndo(hours);
    setUndoConfirmed(confirmed);
    const next = { ...hours };
    const nextConfirmed = { ...confirmed };
    const skipped: string[] = [];
    for (const day of destinationDays) {
      const dest = slotsOf(hours[day] ?? null);
      next[day] = toDayHours(
        dest.map((slot, index) => {
          const sourceIndex = slots.findIndex(
            (_, i) => serviceName(slots, i) === serviceName(dest, index),
          );
          const source = slots[sourceIndex];
          if (
            !source ||
            !confirmed[serviceKey(selected, sourceIndex, source)] ||
            !source.lastBooking ||
            !lastBookingOptions(slot).includes(source.lastBooking)
          ) {
            skipped.push(
              `${DAY_LABELS.find(([key]) => key === day)![1]} · ${serviceName(dest, index)}`,
            );
            return slot;
          }
          nextConfirmed[serviceKey(day, index, slot)] = true;
          return { ...slot, lastBooking: source.lastBooking };
        }),
      );
    }
    setHours(next);
    setConfirmed(nextConfirmed);
    setTargets([]);
    setCopyMessage(
      skipped.length
        ? `À vérifier : ${skipped.join(', ')}. Leur dernière arrivée n’a pas été modifiée.`
        : 'Dernières arrivées copiées.',
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
        body="Choisissez la dernière arrivée acceptée pour chaque service."
      />
      <div className="min-w-0 flex-1">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            {placeImportDraft && (
              <div className="flex flex-wrap items-center gap-2 text-[13px] leading-5 text-muted-foreground">
                <Calendar size={14} aria-hidden="true" />
                <span>Horaires Google Maps</span>
                {placeImportDraft.hoursNeedReview.length > 0 && (
                  <span>
                    — À renseigner :{' '}
                    {DAY_LABELS.filter(([day]) => placeImportDraft.hoursNeedReview.includes(day))
                      .map(([, name]) => name)
                      .join(', ')}
                  </span>
                )}
              </div>
            )}
            <p role="status" className="text-[13px] font-medium leading-5 text-muted-foreground">
              {!openDays.length
                ? 'Choisissez vos jours d’ouverture'
                : remainingDays > 0
                  ? `${remainingDays} ${remainingDays > 1 ? 'jours à compléter' : 'jour à compléter'}`
                  : 'Votre semaine est prête'}
            </p>
          </div>
          <div
            role="group"
            aria-label="Jours de la semaine"
            className="grid auto-cols-[7.5rem] grid-flow-col gap-2 overflow-x-auto pb-2 sm:grid-flow-row sm:auto-cols-auto sm:grid-cols-4 sm:overflow-visible sm:pb-0 xl:grid-cols-7"
          >
            {DAY_LABELS.map(([day, name]) => {
              const daySlots = slotsOf(hours[day] ?? null);
              return (
                <button
                  key={day}
                  type="button"
                  aria-label={`Modifier ${name.toLowerCase()}`}
                  aria-pressed={selected === day}
                  aria-controls="day-hours-editor"
                  onClick={() => {
                    setSelected(day);
                    setCorrecting(false);
                    setTargets([]);
                    setCopyMessage('');
                    setAdvanced(null);
                  }}
                  className={cn(
                    'flex min-w-0 flex-col items-stretch rounded-2xl px-3 py-3 text-left',
                    interactive,
                    selected === day
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card hover:bg-brand/5',
                    !daySlots.length && selected !== day && 'bg-muted/30 text-muted-foreground',
                  )}
                >
                  <span className="mb-1 flex items-center justify-between gap-1 text-sm font-semibold">
                    {name}
                    {daySlots.length > 0 && configured(day) && !errors[day] ? (
                      <>
                        <Check size={14} aria-hidden="true" />
                        <span className="sr-only">Dernières arrivées définies</span>
                      </>
                    ) : selected === day ? (
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-primary-foreground"
                        aria-hidden="true"
                      />
                    ) : null}
                  </span>
                  <span className="flex min-h-10 flex-col gap-1 text-[13px] leading-5 tabular-nums">
                    {daySlots.length ? (
                      daySlots.map((slot, index) => {
                        return (
                          <span key={index} className="flex items-center gap-1">
                            {index === 0 ? (
                              <Sun
                                size={11}
                                aria-hidden="true"
                                className="hidden shrink-0 xl:block"
                              />
                            ) : (
                              <Moon
                                size={11}
                                aria-hidden="true"
                                className="hidden shrink-0 xl:block"
                              />
                            )}
                            <span>
                              {slot.open}–{slot.close}
                            </span>
                          </span>
                        );
                      })
                    ) : (
                      <span>Fermé</span>
                    )}
                  </span>
                  {errors[day] && (
                    <span className="mt-2 block text-xs text-destructive">À corriger</span>
                  )}
                </button>
              );
            })}
          </div>
          <h3 className="text-xl font-semibold tracking-tight">{label}</h3>
          {!slots.length && (
            <p className="text-sm text-muted-foreground">Le restaurant est fermé ce jour.</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {groups.map((group) => {
              const done = group.days.every((day) => configuredService(day, group.slot));
              const values = group.days.map(
                (day) =>
                  slotsOf(hours[day] ?? null).find(
                    (slot) => slot.open === group.slot.open && slot.close === group.slot.close,
                  )?.lastBooking,
              );
              const value = done && new Set(values).size === 1 ? (values[0] ?? '') : '';
              return (
                <section
                  key={group.key}
                  className={cn(
                    'rounded-3xl p-4',
                    group.name === 'Soir' ? 'bg-card' : 'bg-brand/10',
                  )}
                >
                  <h3 className="flex items-center gap-3 text-xl font-semibold">
                    <span
                      className="inline-flex size-8 items-center justify-center rounded-xl bg-card text-brand"
                      aria-hidden="true"
                    >
                      {group.name === 'Soir' ? <Moon size={17} /> : <Sun size={17} />}
                    </span>
                    {group.name}
                    <span className="ml-auto text-sm font-medium tabular-nums text-muted-foreground">
                      {group.slot.open}–{group.slot.close}
                      {isOvernight(group.slot) && (
                        <span className="block text-xs font-normal">le lendemain</span>
                      )}
                    </span>
                  </h3>
                  <div className="mt-4">
                    <p className="mb-2 text-sm font-medium">Dernière arrivée</p>
                    <ChoiceSelect
                      label={`${group.name} ${group.slot.open}–${group.slot.close} : dernière arrivée`}
                      value={value}
                      placeholder="Choisir l’heure"
                      options={lastBookingOptions(group.slot).map((time) => ({
                        value: time,
                        label: time,
                      }))}
                      onChange={(time) => configure(group, time)}
                      triggerClassName="h-11 w-full rounded-full border-0 bg-muted/50 tabular-nums"
                    />
                  </div>
                </section>
              );
            })}
          </div>
          {slots.length > 0 && configured(selected) && !errors[selected] && openDays.length > 1 && (
            <div className="rounded-3xl bg-card/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    Les mêmes dernières arrivées les autres jours ?
                  </p>
                  <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
                    Les heures d’ouverture et de fermeture restent inchangées.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    !configured(selected) || Boolean(errors[selected]) || openDays.length < 2
                  }
                  onClick={() => copyBookings(openDays.filter((day) => day !== selected))}
                  className={cn('rounded-full', interactive)}
                >
                  Appliquer aux jours ouverts
                </Button>
              </div>
              <button
                type="button"
                aria-expanded={customCopy}
                aria-controls="copy-specific-days"
                onClick={() => setCustomCopy(!customCopy)}
                className={cn(
                  'mt-2 text-[13px] text-muted-foreground underline underline-offset-4 hover:text-foreground',
                  interactive,
                )}
              >
                Choisir les jours
              </button>
              {customCopy && (
                <div
                  id="copy-specific-days"
                  className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3"
                >
                  {DAY_LABELS.filter(([day]) => day !== selected && hours[day]).map(
                    ([day, name]) => (
                      <button
                        type="button"
                        key={day}
                        aria-label={`Appliquer à ${name.toLowerCase()}`}
                        aria-pressed={targets.includes(day)}
                        onClick={() =>
                          setTargets((current) =>
                            current.includes(day)
                              ? current.filter((item) => item !== day)
                              : [...current, day],
                          )
                        }
                        className={cn(
                          'rounded-lg border px-3 py-2 text-xs',
                          interactive,
                          targets.includes(day)
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'border-border hover:bg-muted',
                        )}
                      >
                        {name}
                      </button>
                    ),
                  )}
                  <Button
                    type="button"
                    size="sm"
                    disabled={!targets.length || !configured(selected) || Boolean(errors[selected])}
                    onClick={() => copyBookings()}
                    className={interactive}
                  >
                    Appliquer
                  </Button>
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            aria-expanded={correcting}
            onClick={() => setCorrecting(!correcting)}
            className={cn(
              'self-start text-[13px] text-muted-foreground underline underline-offset-4 hover:text-foreground',
              interactive,
            )}
          >
            Modifier les horaires
          </button>
          {correcting && (
            <section
              id="day-hours-editor"
              aria-label={`Horaires du ${label.toLowerCase()}`}
              className="rounded-2xl border border-border bg-background p-4"
            >
              <div className="mb-3 flex items-center justify-between gap-4">
                <h3 className="text-xl font-semibold tracking-tight">{label}</h3>
                <label className="flex items-center gap-2 text-sm">
                  <span aria-hidden="true">{slots.length ? 'Ouvert' : 'Fermé'}</span>
                  <span className="sr-only">{label} ouvert</span>
                  <Switch
                    id={`open-${selected}`}
                    checked={slots.length > 0}
                    onCheckedChange={toggleDay}
                  />
                </label>
              </div>
              {slots.length > 0 ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {slots.map((slot, index) => {
                      const service =
                        slots.length > 1
                          ? index === 0
                            ? 'Midi'
                            : 'Soir'
                          : slot.open >= '16:00'
                            ? 'Soir'
                            : 'Service';
                      return (
                        <div
                          key={`${selected}-${index}`}
                          className="grid grid-cols-2 items-start gap-3 rounded-xl border border-border bg-muted/20 p-4"
                        >
                          <span className="col-span-full flex items-center gap-2 text-sm font-semibold">
                            {service !== 'Soir' ? (
                              <Sun size={16} aria-hidden="true" />
                            ) : (
                              <Moon size={16} aria-hidden="true" />
                            )}
                            {service}
                          </span>
                          <label>
                            <span className="mb-1 block text-xs text-muted-foreground">
                              Première arrivée
                            </span>
                            <Input
                              type="time"
                              step={900}
                              value={slot.open}
                              onChange={(event) => setSlot(index, 'open', event.target.value)}
                              aria-label={`${label}, ${service.toLowerCase()} : première arrivée`}
                              aria-invalid={Boolean(errors[selected])}
                              required
                              className="h-10 rounded-lg bg-background tabular-nums"
                            />
                          </label>
                          <div>
                            <span className="mb-1 block text-xs text-muted-foreground">
                              Dernière arrivée
                            </span>
                            <ChoiceSelect
                              label={`${label}, ${service.toLowerCase()} : dernière arrivée`}
                              value={slot.lastBooking ?? ''}
                              options={lastBookingOptions(slot).map((value) => ({
                                value,
                                label: value,
                              }))}
                              onChange={(value) => setSlot(index, 'lastBooking', value)}
                              invalid={Boolean(errors[selected])}
                              triggerClassName="h-10 w-full rounded-lg bg-background tabular-nums"
                            />
                            {isOvernight(slot) && (
                              <span className="text-xs text-muted-foreground">
                                Fin le lendemain
                              </span>
                            )}
                          </div>
                          <div className="col-span-full flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
                            <span>
                              Fin du service :{' '}
                              <span className="font-medium text-foreground">{slot.close}</span>
                              {isOvernight(slot) && ' le lendemain'}
                            </span>
                            <button
                              type="button"
                              aria-label={`Modifier la fin du ${service.toLowerCase()}`}
                              aria-expanded={advanced === index}
                              onClick={() => setAdvanced(advanced === index ? null : index)}
                              className={cn(
                                'inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground',
                                interactive,
                              )}
                            >
                              <Pencil size={12} aria-hidden="true" />
                              Modifier
                            </button>
                            {advanced === index && (
                              <label className="w-full">
                                Fin du service
                                <Input
                                  type="time"
                                  step={900}
                                  value={slot.close}
                                  onChange={(event) => setSlot(index, 'close', event.target.value)}
                                  aria-label={`${label}, ${service.toLowerCase()} : fin du service`}
                                  className="mt-1 h-10 w-32 rounded-lg"
                                />
                              </label>
                            )}
                            <button
                              type="button"
                              aria-label={`Retirer le service ${service.toLowerCase()}`}
                              onClick={() => {
                                const previous = hours;
                                setUndoConfirmed(confirmed);
                                setDay(toDayHours(slots.filter((_, i) => i !== index)));
                                setUndo(previous);
                                setAdvanced(null);
                              }}
                              className={cn('ml-auto text-xs hover:text-foreground', interactive)}
                            >
                              Retirer ce service
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    {slots.length < 2 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setDay(
                            toDayHours(
                              slots[0].open >= '16:00'
                                ? [{ ...PRESETS.split[0] }, ...slots]
                                : [...slots, { ...PRESETS.split[1] }],
                            ),
                          )
                        }
                        className={interactive}
                      >
                        <Plus size={14} className="mr-1" />
                        Ajouter un service
                      </Button>
                    )}
                  </div>
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">
                    Ces heures définissent les arrivées réservables, toutes les 30 minutes.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Aucune réservation ce jour-là. Activez ce jour pour ajouter vos services.
                </p>
              )}
              {errors[selected] && (
                <p role="alert" className="mt-3 text-sm text-destructive">
                  {errors[selected]}
                </p>
              )}
            </section>
          )}
          {undo && (
            <div role="status" className="flex items-center gap-2 text-sm">
              <Check size={15} aria-hidden="true" />
              {copyMessage || 'Dernières arrivées copiées.'}
              <button
                type="button"
                onClick={() => {
                  setHours(undo);
                  setConfirmed(undoConfirmed);
                  setCopyMessage('');
                  setUndo(null);
                }}
                className={cn('underline underline-offset-4', interactive)}
              >
                Annuler
              </button>
            </div>
          )}
          {!openDays.length && (
            <p role="alert" className="text-sm text-destructive">
              Ouvrez au moins un jour pour que Sokar puisse proposer des créneaux.
            </p>
          )}
          {saveError && (
            <p role="alert" className="text-sm text-destructive">
              {saveError}
            </p>
          )}
        </div>
      </div>
      <SubmitButton saving={saving} disabled={hasErrors}>
        Continuer
      </SubmitButton>
    </form>
  );
}
