'use client';

import type { ReactNode } from 'react';
import { Check, Info, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { ChoiceSelect } from '../choice-select';
import {
  CANCELLATION_PRESETS,
  cancellationSummary,
  CUSTOM_CANCELLATION,
  MAX_PER_SIZE,
  TEMPLATES,
  durationLabel,
  plural,
  tableLabel,
  type TableCounts,
} from './floor-config';

export type PanelId = 'room' | 'practical';

function seatsOf(counts: TableCounts) {
  return Object.entries(counts).reduce((sum, [size, count]) => sum + Number(size) * count, 0);
}

/** Le modèle choisi reste repéré tant que la salle n'a pas été retouchée. */
function sameCounts(a: TableCounts, b: TableCounts) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => (a[Number(key)] ?? 0) === (b[Number(key)] ?? 0));
}

export type RailItem = { id: PanelId; title: string; summary: string; done: boolean };

/**
 * Fil de progression : deux sections, une seule ouverte. Même style léger que le parcours de l'étape
 * Appels ; le résumé de chaque section reste visible pour savoir où l'on en est sans l'ouvrir.
 */
export function PanelRail({
  items,
  active,
  onSelect,
}: {
  items: RailItem[];
  active: PanelId | null;
  onSelect: (id: PanelId) => void;
}) {
  return (
    <ol aria-label="Sections de l’étape" className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {items.map((item, index) => {
        const current = item.id === active;
        return (
          <li key={item.id} className="flex min-w-0 items-center gap-3">
            {index > 0 && (
              <span aria-hidden="true" className="hidden h-px w-10 bg-border sm:block" />
            )}
            <button
              type="button"
              aria-current={current ? 'step' : undefined}
              onClick={() => onSelect(item.id)}
              className="flex min-w-0 items-center gap-2 rounded-full py-1 pl-1 pr-3 text-left transition-all duration-200 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-all duration-200',
                  item.done
                    ? 'bg-success/15 text-success'
                    : current
                      ? 'bg-foreground text-background'
                      : 'bg-muted text-muted-foreground',
                )}
              >
                {item.done ? <Check size={14} /> : index + 1}
              </span>
              <span
                className={cn(
                  'whitespace-nowrap text-sm font-medium',
                  current ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {item.title}
                {item.done ? <span className="sr-only"> — terminé</span> : null}
              </span>
              <span className="sr-only truncate text-xs text-muted-foreground lg:not-sr-only">
                <span className="sr-only"> — </span>
                <span aria-hidden="true">· </span>
                {item.summary}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Stepper({
  value,
  onChange,
  min = 0,
  max = MAX_PER_SIZE,
  inputLabel,
  decreaseLabel,
  increaseLabel,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  inputLabel: string;
  decreaseLabel: string;
  increaseLabel: string;
}) {
  const buttonClass =
    'inline-flex size-9 items-center justify-center rounded-lg border border-border bg-background text-foreground transition-all duration-200 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        className={buttonClass}
        aria-label={decreaseLabel}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        <Minus size={15} aria-hidden="true" />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        aria-label={inputLabel}
        onChange={(event) =>
          onChange(Math.max(min, Math.min(max, Math.trunc(Number(event.target.value)) || min)))
        }
        className="h-9 w-14 rounded-lg border border-input bg-background text-center text-sm font-semibold tabular-nums transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <button
        type="button"
        className={buttonClass}
        aria-label={increaseLabel}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <Plus size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Vue de dessus simplifiée : une pastille par table, avec sa capacité. Peu de tables : de grosses pastilles. */
function FloorDots({ counts }: { counts: TableCounts }) {
  const tables = Object.entries(counts)
    .flatMap(([size, count]) => Array.from({ length: count }, () => Number(size)))
    .sort((a, b) => a - b);
  const shown = tables.slice(0, 45);
  const rest = tables.length - shown.length;
  const size = shown.length <= 8 ? 64 : shown.length <= 20 ? 48 : shown.length <= 32 ? 40 : 32;
  return (
    <div aria-hidden="true" className="flex min-h-[4.5rem] flex-1 flex-wrap content-center gap-1.5">
      {shown.map((capacity, index) => (
        <span
          key={index}
          style={{ width: size, height: size, fontSize: Math.round(size / 3) }}
          className="flex items-center justify-center rounded-lg border border-background/30 bg-background/10 font-semibold tabular-nums"
        >
          {capacity}
        </span>
      ))}
      {rest > 0 && <span className="self-center text-xs text-background/60">+{rest}</span>}
    </div>
  );
}

export function TablesPanel({
  loading,
  loadError,
  onRetry,
  counts,
  sizes,
  addableSizes,
  totals,
  onCount,
  onTemplate,
  onAddSize,
  compact = false,
}: {
  compact?: boolean;
  loading: boolean;
  loadError: string;
  onRetry: () => void;
  counts: TableCounts;
  sizes: number[];
  addableSizes: number[];
  totals: { tables: number; seats: number; largest: number };
  onCount: (size: number, value: number) => void;
  onTemplate: (counts: TableCounts) => void;
  onAddSize: (size: number) => void;
}) {
  return (
    <div
      className={cn(
        'grid min-h-0 w-full flex-1 items-stretch gap-6 lg:gap-8',
        !compact && 'lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]',
      )}
    >
      <section aria-label="Vos tables" className="flex min-h-0 flex-col gap-2">
        {loading ? (
          <p role="status" className="text-sm text-muted-foreground">
            Chargement de votre salle…
          </p>
        ) : loadError ? (
          <div role="alert" className="space-y-3">
            <p className="text-sm text-destructive">{loadError}</p>
            <Button type="button" variant="outline" onClick={onRetry}>
              Réessayer
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <p id="floor-templates-label" className="text-xs text-muted-foreground">
                Partir d’un modèle
              </p>
              <div
                role="group"
                aria-labelledby="floor-templates-label"
                className="grid grid-cols-3 gap-1.5"
              >
                {TEMPLATES.map((template) => {
                  const selected = sameCounts(counts, template.counts);
                  return (
                    <button
                      key={template.label}
                      type="button"
                      aria-label={template.label}
                      aria-pressed={selected}
                      onClick={() => onTemplate(template.counts)}
                      className={cn(
                        'h-10 min-w-0 truncate whitespace-nowrap rounded-lg border px-1 text-sm font-medium xl:px-2 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        selected
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
                      )}
                    >
                      {template.label}
                      <span
                        className={cn(
                          'ml-1.5 hidden text-xs font-normal xl:inline',
                          !selected && 'opacity-70',
                        )}
                      >
                        {seatsOf(template.counts)} couv.
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <ul className="flex flex-1 flex-col divide-y divide-border rounded-2xl border border-border bg-background">
              <li className="flex items-center justify-between gap-3 px-5 py-2.5">
                <span className="text-sm font-medium text-foreground">Vos tables</span>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {totals.tables === 0
                    ? 'Aucune table'
                    : `${plural(totals.tables, 'table', 'tables')} · ${plural(totals.seats, 'couvert', 'couverts')}`}
                </span>
              </li>
              {sizes.map((size) => (
                <li key={size} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="min-w-0">
                    <span
                      className={cn(
                        'block text-sm font-medium transition-all duration-200',
                        (counts[size] ?? 0) > 0 ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {tableLabel(size)}
                    </span>
                    {(counts[size] ?? 0) > 0 && (
                      <span className="block text-sm text-muted-foreground">
                        {plural((counts[size] ?? 0) * size, 'couvert', 'couverts')}
                      </span>
                    )}
                  </span>
                  <Stepper
                    value={counts[size] ?? 0}
                    onChange={(value) => onCount(size, value)}
                    inputLabel={`Nombre de tables de ${size}`}
                    decreaseLabel={`Une table de ${size} en moins`}
                    increaseLabel={`Une table de ${size} en plus`}
                  />
                </li>
              ))}
              {addableSizes.length > 0 && (
                <li className="px-5 py-2.5">
                  <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                    <span>Une autre taille de table ?</span>
                    <ChoiceSelect
                      label="Ajouter une autre taille de table"
                      value=""
                      onChange={(selected) => {
                        const size = Number(selected);
                        if (size) onAddSize(size);
                      }}
                      options={addableSizes.map((size) => ({
                        value: String(size),
                        label: tableLabel(size),
                      }))}
                      triggerClassName="h-9 w-36 rounded-lg !text-sm"
                      contentClassName="w-[min(21rem,calc(100vw-2rem))]"
                    />
                  </div>
                </li>
              )}
            </ul>
          </>
        )}
      </section>

      {!compact && (
        <aside
          aria-label="Résumé de votre salle"
          className="flex flex-col justify-between gap-4 rounded-2xl bg-foreground p-5 text-background"
        >
          <div className="grid grid-cols-3 gap-3">
            {[
              { value: totals.tables, label: totals.tables > 1 ? 'tables' : 'table' },
              { value: totals.seats, label: totals.seats > 1 ? 'couverts' : 'couvert' },
              { value: totals.largest, label: 'plus grande table' },
            ].map((item) => (
              <div key={item.label}>
                <p
                  className={cn(
                    'text-3xl font-semibold tabular-nums leading-none tracking-tight',
                    item.value === 0 && 'text-background/40',
                  )}
                >
                  {item.value}
                </p>
                <p className="mt-0.5 text-xs text-background/60">{item.label}</p>
              </div>
            ))}
          </div>
          <FloorDots counts={counts} />
          <p className="border-t border-background/15 pt-3 text-sm leading-relaxed text-background/70">
            {totals.tables === 0
              ? 'Sans table, Sokar ne peut proposer aucun créneau à vos clients.'
              : `Votre plus grande table accueille ${totals.largest} ${totals.largest > 1 ? 'personnes' : 'personne'} : c’est la taille maximale d’un groupe que Sokar pourra placer.`}
          </p>
        </aside>
      )}
    </div>
  );
}

const FIELD_H = 'h-10';
const TEXT = 'text-sm';

/** Une règle par ligne : l'intitulé à gauche, le réglage à droite. Les lignes se partagent la hauteur. */
function RuleRow({
  id,
  title,
  hint,
  grouped = false,
  stacked = false,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  grouped?: boolean;
  stacked?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-col justify-center gap-2 px-5 py-3',
        !stacked && 'sm:flex-row sm:items-center sm:justify-between sm:gap-6',
      )}
    >
      <div className={cn('flex min-w-0 items-center gap-1', !stacked && 'sm:max-w-[42%]')}>
        {grouped ? (
          <span id={`${id}-label`} className={cn(TEXT, 'block font-medium text-foreground')}>
            {title}
          </span>
        ) : (
          <label htmlFor={id} className={cn(TEXT, 'block font-medium text-foreground')}>
            {title}
          </label>
        )}
        {hint ? <InfoTip text={hint} /> : null}
      </div>
      <div className={cn('min-w-0 space-y-1.5', stacked ? 'w-full' : 'sm:w-[52%]')}>{children}</div>
    </div>
  );
}

/** Explication de première lecture : cachée derrière une icône, visible au survol ou au clavier. */
function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={text}
        className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground transition-all duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Info size={14} aria-hidden="true" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full left-0 z-20 mb-1 w-60 rounded-lg bg-foreground px-3 py-2 text-xs leading-5 text-background opacity-0 shadow-lg transition-opacity duration-200 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

const selectClass = `${FIELD_H} w-full rounded-xl border border-input bg-background px-3 ${TEXT} text-foreground transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`;

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex flex-col justify-center rounded-xl bg-background/10 p-4">
      <p className="text-xs text-background/60">{label}</p>
      <p className="mt-1 text-lg font-semibold leading-tight tracking-tight">{value}</p>
      {detail ? <p className="mt-0.5 text-xs text-background/60">{detail}</p> : null}
    </div>
  );
}

export type RulesValues = {
  maxParty: number;
  partyCapacity: number;
  duration: number;
  durationOptions: number[];
  cancellation: string;
  customPolicy: string;
  policyText: string;
  depositRequired: boolean;
  depositAmount: number;
  depositThreshold: number;
};

export function RulesPanel({
  values,
  onDuration,
  onCancellation,
  onCustomPolicy,
  onDepositRequired,
  onDepositAmount,
  onDepositThreshold,
  onMaxParty,
  compact = false,
}: {
  compact?: boolean;
  values: RulesValues;
  onMaxParty: (value: number) => void;
  onDuration: (value: number) => void;
  onCancellation: (value: string) => void;
  onCustomPolicy: (value: string) => void;
  onDepositRequired: (value: boolean) => void;
  onDepositAmount: (value: number) => void;
  onDepositThreshold: (value: number) => void;
}) {
  const v = values;
  return (
    <div
      className={cn(
        'grid min-h-0 w-full flex-1 items-stretch gap-6 lg:gap-8',
        !compact && 'lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]',
      )}
    >
      <section
        aria-label="Vos règles de réservation"
        className="flex flex-col divide-y divide-border self-start rounded-2xl border border-border bg-background"
      >
        <RuleRow
          id="rule-duration"
          title="Durée d’un repas"
          hint="Le temps pendant lequel une table reste prise."
          grouped
          stacked
        >
          <div
            id="rule-duration"
            role="group"
            aria-labelledby="rule-duration-label"
            className="grid grid-cols-4 gap-1.5 xl:grid-cols-7"
          >
            {v.durationOptions.map((minutes) => (
              <button
                key={minutes}
                type="button"
                aria-pressed={v.duration === minutes}
                onClick={() => onDuration(minutes)}
                className={cn(
                  'min-h-10 min-w-0 whitespace-nowrap rounded-lg border px-1 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  v.duration === minutes
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border bg-background text-muted-foreground hover:border-foreground/40 hover:bg-accent hover:text-foreground',
                )}
              >
                {durationLabel(minutes)}
              </button>
            ))}
          </div>
        </RuleRow>
        <RuleRow
          id="rule-cancellation"
          title="Annulation gratuite jusqu’à"
          hint="Choisissez « Pas d’annulation » si aucune annulation n’est gratuite, ou « Autre » pour écrire votre propre condition."
          grouped
          stacked
        >
          <div
            id="rule-cancellation"
            role="group"
            aria-labelledby="rule-cancellation-label"
            className="flex flex-wrap gap-1.5"
          >
            {CANCELLATION_PRESETS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-label={item.label}
                aria-pressed={v.cancellation === item.id}
                onClick={() => onCancellation(item.id)}
                className={cn(
                  'min-h-10 flex-auto whitespace-nowrap rounded-lg border px-3 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  v.cancellation === item.id
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border bg-background text-muted-foreground hover:border-foreground/40 hover:bg-accent hover:text-foreground',
                )}
              >
                {item.id === 'none' ? item.short : `${item.short} avant`}
              </button>
            ))}
            <button
              type="button"
              aria-label="Autre condition…"
              aria-pressed={v.cancellation === CUSTOM_CANCELLATION}
              onClick={() => onCancellation(CUSTOM_CANCELLATION)}
              className={cn(
                'min-h-10 flex-auto whitespace-nowrap rounded-lg border px-3 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                v.cancellation === CUSTOM_CANCELLATION
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border bg-background text-muted-foreground hover:border-foreground/40 hover:bg-accent hover:text-foreground',
              )}
            >
              Autre
            </button>
          </div>
          {v.cancellation === CUSTOM_CANCELLATION && (
            <textarea
              aria-label="Votre condition d’annulation"
              value={v.customPolicy}
              maxLength={280}
              rows={2}
              placeholder="Ex. : annulation gratuite jusqu’à la veille, 12 h."
              onChange={(event) => onCustomPolicy(event.target.value)}
              className={cn(
                TEXT,
                'flex w-full rounded-xl border border-input bg-background px-3 py-2 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            />
          )}
        </RuleRow>
        <RuleRow
          id="rule-party"
          title="Réservation en ligne jusqu’à"
          hint="Calculé d’après votre plus grande table. Pour un groupe plus grand, le gérant prend le relais."
          grouped
          stacked
        >
          <div role="group" aria-labelledby="rule-party-label" className="flex items-center gap-3">
            <Stepper
              value={v.maxParty}
              onChange={onMaxParty}
              min={1}
              max={100}
              inputLabel="Nombre maximum de personnes par réservation"
              decreaseLabel="Une personne de moins"
              increaseLabel="Une personne de plus"
            />
            <span className="text-sm text-muted-foreground">personnes</span>
          </div>
          {v.maxParty > v.partyCapacity && (
            <p className="text-xs leading-5 text-muted-foreground">
              Plus que votre plus grande table ({v.partyCapacity} pers.) : il faudra rapprocher des
              tables.
            </p>
          )}
        </RuleRow>
        <div className="flex flex-col gap-3 px-5 py-3">
          <div className="flex items-center gap-3">
            <Switch
              id="rule-deposit"
              checked={v.depositRequired}
              onCheckedChange={onDepositRequired}
              className={cn(!v.depositRequired && 'border-foreground/25')}
            />
            <label
              htmlFor="rule-deposit"
              className={cn(TEXT, 'block whitespace-nowrap font-medium text-foreground')}
            >
              Demander un acompte
            </label>
            <InfoTip text="Une garantie versée à la réservation. Vous choisissez le montant par personne et à partir de combien de personnes elle s’applique." />
          </div>
          {v.depositRequired && (
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="block text-sm text-muted-foreground">Montant par personne</span>
                <span className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    aria-label="Montant par personne (€)"
                    className={cn(FIELD_H, 'w-24 rounded-xl px-3')}
                    value={v.depositAmount}
                    onChange={(event) => onDepositAmount(Number(event.target.value))}
                  />
                  <span aria-hidden="true" className="text-sm text-muted-foreground">
                    €
                  </span>
                </span>
              </label>
              <label className="space-y-1">
                <span className="block text-sm text-muted-foreground">
                  À partir de (0 = tous les groupes)
                </span>
                <span className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    aria-label="À partir de (personnes)"
                    className={cn(FIELD_H, 'w-24 rounded-xl px-3')}
                    value={v.depositThreshold}
                    onChange={(event) => onDepositThreshold(Number(event.target.value))}
                  />
                  <span aria-hidden="true" className="text-sm text-muted-foreground">
                    personnes
                  </span>
                </span>
              </label>
            </div>
          )}
        </div>
      </section>

      {!compact && (
        <aside
          aria-label="Ce que verront vos clients"
          className="flex flex-col gap-3 rounded-2xl bg-foreground p-5 text-background"
        >
          <p className="text-xs font-medium uppercase tracking-widest text-background/60">
            Ce que verront vos clients
          </p>
          <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-2">
            <Tile label="Groupe maximum" value={`${v.maxParty} pers.`} />
            <Tile label="Durée d’un repas" value={durationLabel(v.duration)} />
            <Tile
              label={cancellationSummary(v.cancellation).label}
              value={cancellationSummary(v.cancellation).value}
            />
            <Tile
              label="Acompte"
              value={v.depositRequired ? `${v.depositAmount} €` : 'Aucun'}
              detail={
                v.depositRequired
                  ? v.depositThreshold > 0
                    ? `par personne, dès ${v.depositThreshold} personnes`
                    : 'par personne'
                  : undefined
              }
            />
          </div>
          <div className="space-y-1 border-t border-background/15 pt-3 text-xs leading-5 text-background/70">
            <p>Réservation en ligne ou par téléphone jusqu’à {v.maxParty} personnes.</p>
            <p>{v.policyText || 'Votre condition d’annulation apparaîtra ici.'}</p>
            <p>Pour un groupe plus grand, Sokar passe la main au gérant.</p>
          </div>
        </aside>
      )}
    </div>
  );
}
