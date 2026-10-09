'use client';

import type { ReactNode } from 'react';
import {
  Accessibility,
  Baby,
  Check,
  PawPrint,
  Salad,
  SquareParking,
  Sun,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { DIETARY_PRESETS } from '../ui';
import type { PracticalInfo } from '../types';

export const PRACTICAL_NOTES_MAX = 500;

type ChoiceOption<T extends string | boolean> = { value: T; label: string };

const YES_NO: ChoiceOption<boolean>[] = [
  { value: true, label: 'Oui' },
  { value: false, label: 'Non' },
];

const PARKING: ChoiceOption<NonNullable<PracticalInfo['parking']>>[] = [
  { value: 'onsite', label: 'Sur place' },
  { value: 'nearby', label: 'À proximité' },
  { value: 'none', label: 'Aucun' },
];

const PETS: ChoiceOption<NonNullable<PracticalInfo['pets']>>[] = [
  { value: 'yes', label: 'Oui' },
  { value: 'terrace', label: 'En terrasse' },
  { value: 'no', label: 'Non' },
];

/** Questions obligatoires : ce que les clients demandent le plus avant de réserver. */
export const PRACTICAL_REQUIRED = [
  { key: 'terrace', label: 'Terrasse' },
  { key: 'parking', label: 'Parking' },
  { key: 'accessible', label: 'Accessibilité' },
  { key: 'pets', label: 'Animaux' },
  { key: 'kidsMenu', label: 'Menu enfant' },
  { key: 'privatization', label: 'Privatisation' },
] as const;

export function missingPracticalQuestions(info: PracticalInfo) {
  return PRACTICAL_REQUIRED.filter((question) => info[question.key] === undefined);
}

export const PRACTICAL_FIELDS = [
  'terrace',
  'privatization',
  'parking',
  'accessible',
  'pets',
  'kidsMenu',
  'menuUrl',
  'notes',
] as const;

export function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Terrasse et privatisation viennent de la fiche Connect tant que rien n'a été saisi ici. */
export function initialPracticalInfo(
  stored: PracticalInfo | undefined,
  ambiance: string[] | undefined,
): PracticalInfo {
  const features = ambiance ?? [];
  return {
    ...(stored ?? {}),
    terrace: stored?.terrace ?? (features.includes('terrasse') ? true : undefined),
    privatization: stored?.privatization ?? (features.includes('privatisation') ? true : undefined),
  };
}

/**
 * Seules les réponses modifiées partent : une réponse laissée telle quelle n'est pas réécrite, et une
 * réponse retirée (`null`) redevient « non précisé ».
 */
export function buildPracticalChanges(
  initial: PracticalInfo,
  info: PracticalInfo,
): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const key of PRACTICAL_FIELDS) {
    const next = key === 'notes' ? info.notes?.trim() || undefined : info[key];
    if (next !== initial[key]) changes[key] = next === undefined ? null : next;
  }
  return changes;
}

/** Nombre de réponses données, pour l'en-tête de la section repliée. */
export function countPracticalAnswers(info: PracticalInfo, dietary: string[]): number {
  const answered = PRACTICAL_FIELDS.filter((key) => {
    const value = info[key];
    return typeof value === 'string' ? value.trim() !== '' : value !== undefined;
  }).length;
  return answered + (dietary.length > 0 ? 1 : 0);
}

function Choice<T extends string | boolean>({
  label,
  options,
  value,
  missing,
  onChange,
}: {
  label: string;
  options: ChoiceOption<T>[];
  value: T | undefined;
  missing: boolean;
  onChange: (value: T | undefined) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1.5">
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={selected}
            // Un second clic revient à « non précisé » : on ne force jamais une réponse.
            onClick={() => onChange(selected ? undefined : option.value)}
            className={cn(
              'h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-sm font-medium text-muted-foreground transition-all duration-200 hover:border-foreground/40 hover:bg-accent hover:text-foreground',
              selected && 'border-foreground bg-foreground text-background',
              missing && !selected && 'border-destructive/40',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Chaque question vit dans une tuile (visible sur les écrans hauts) : sur grand écran les tuiles se
 * partagent la hauteur, sur écran court elles se fondent dans la page pour tout garder visible.
 */
function Tile({
  icon: Icon,
  label,
  shortLabel,
  answered,
  missing,
  children,
  className,
}: {
  icon: LucideIcon;
  label: string;
  /** Titre affiché quand il diffère du nom accessible (questions longues). */
  shortLabel?: string;
  answered?: boolean;
  missing?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col justify-between gap-3 rounded-xl border border-border bg-muted/20 p-3 transition-colors duration-200',
        missing && 'border-destructive/50 bg-destructive/5',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={cn(
            'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors duration-200',
            answered && 'border-transparent bg-primary/10 text-primary',
          )}
        >
          <Icon size={15} />
        </span>
        <p
          className={cn(
            'min-w-0 text-sm font-medium text-foreground',
            missing && 'text-destructive',
          )}
        >
          {shortLabel ?? label}
          {missing ? <span className="sr-only"> : réponse attendue</span> : null}
        </p>
        {answered ? (
          <span
            aria-hidden="true"
            className="ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
          >
            <Check size={12} />
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/**
 * Faits que les clients demandent avant de réserver. Les six questions sont obligatoires ; les options
 * alimentaires, l'adresse du menu et les précisions restent libres (« aucune » est une réponse valable).
 * L'assistant ne répond qu'avec ce qui est renseigné.
 */
export function PracticalFields({
  info,
  dietary,
  menuUrlInvalid,
  showMissing,
  onChange,
  onToggleDietary,
}: {
  info: PracticalInfo;
  dietary: string[];
  menuUrlInvalid: boolean;
  /** Après un essai de validation : met en évidence les questions encore sans réponse. */
  showMissing: boolean;
  onChange: <K extends keyof PracticalInfo>(key: K, value: PracticalInfo[K] | undefined) => void;
  onToggleDietary: (item: string) => void;
}) {
  const gap = 'gap-3';
  return (
    <div className={cn('flex h-full min-h-0 flex-col', gap)}>
      <p className="text-xs leading-5 text-muted-foreground">
        Répondez aux six questions : ce sont celles que vos clients posent le plus. Sokar n’invente
        rien et passe la main au gérant pour tout le reste.
      </p>
      <div className={cn('grid sm:grid-cols-2 lg:grid-cols-3 lg:grid-rows-2 flex-[3]', gap)}>
        <Tile
          icon={Sun}
          label="Terrasse"
          answered={info.terrace !== undefined}
          missing={showMissing && info.terrace === undefined}
        >
          <Choice
            label="Terrasse"
            options={YES_NO}
            value={info.terrace}
            missing={showMissing && info.terrace === undefined}
            onChange={(v) => onChange('terrace', v)}
          />
        </Tile>
        <Tile
          icon={SquareParking}
          label="Parking"
          answered={info.parking !== undefined}
          missing={showMissing && info.parking === undefined}
        >
          <Choice
            label="Parking"
            options={PARKING}
            value={info.parking}
            missing={showMissing && info.parking === undefined}
            onChange={(v) => onChange('parking', v)}
          />
        </Tile>
        <Tile
          icon={Accessibility}
          label="Accessible aux personnes à mobilité réduite"
          shortLabel="Mobilité réduite"
          answered={info.accessible !== undefined}
          missing={showMissing && info.accessible === undefined}
        >
          <Choice
            label="Accessible aux personnes à mobilité réduite"
            options={YES_NO}
            value={info.accessible}
            missing={showMissing && info.accessible === undefined}
            onChange={(v) => onChange('accessible', v)}
          />
        </Tile>
        <Tile
          icon={PawPrint}
          label="Animaux acceptés"
          answered={info.pets !== undefined}
          missing={showMissing && info.pets === undefined}
        >
          <Choice
            label="Animaux acceptés"
            options={PETS}
            value={info.pets}
            missing={showMissing && info.pets === undefined}
            onChange={(v) => onChange('pets', v)}
          />
        </Tile>
        <Tile
          icon={Baby}
          label="Menu enfant"
          answered={info.kidsMenu !== undefined}
          missing={showMissing && info.kidsMenu === undefined}
        >
          <Choice
            label="Menu enfant"
            options={YES_NO}
            value={info.kidsMenu}
            missing={showMissing && info.kidsMenu === undefined}
            onChange={(v) => onChange('kidsMenu', v)}
          />
        </Tile>
        <Tile
          icon={Users}
          label="Privatisation possible"
          answered={info.privatization !== undefined}
          missing={showMissing && info.privatization === undefined}
        >
          <Choice
            label="Privatisation possible"
            options={YES_NO}
            value={info.privatization}
            missing={showMissing && info.privatization === undefined}
            onChange={(v) => onChange('privatization', v)}
          />
        </Tile>
      </div>

      <Tile icon={Salad} label="Options alimentaires proposées" answered={dietary.length > 0}>
        <div
          role="group"
          aria-label="Options alimentaires proposées"
          className="flex flex-wrap gap-1.5"
        >
          {DIETARY_PRESETS.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={dietary.includes(item)}
              onClick={() => onToggleDietary(item)}
              className={cn(
                'h-9 rounded-lg border border-border bg-background px-3 text-sm font-medium capitalize text-muted-foreground transition-all duration-200 hover:border-foreground/40 hover:bg-accent hover:text-foreground',
                dietary.includes(item) && 'border-foreground bg-foreground text-background',
              )}
            >
              {item}
            </button>
          ))}
        </div>
      </Tile>

      <div className={cn('grid sm:grid-cols-2', gap)}>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-foreground">
            Adresse de votre menu en ligne
          </span>
          <Input
            type="url"
            inputMode="url"
            className="h-10 rounded-xl"
            placeholder="https://monrestaurant.fr/menu"
            value={info.menuUrl ?? ''}
            aria-invalid={menuUrlInvalid}
            onChange={(event) => onChange('menuUrl', event.target.value || undefined)}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-foreground">Autre chose à savoir ?</span>
          <textarea
            value={info.notes ?? ''}
            maxLength={PRACTICAL_NOTES_MAX}
            rows={1}
            placeholder="Ex. : chiens bienvenus le midi, chaises hautes disponibles"
            onChange={(event) => onChange('notes', event.target.value || undefined)}
            className="flex min-h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      </div>
    </div>
  );
}
