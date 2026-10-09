'use client';

import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, Check, Loader2, Pencil, Save, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function useFooterTarget(id: string) {
  const [footer, setFooter] = useState<HTMLElement | null | undefined>(undefined);

  useIsomorphicLayoutEffect(() => {
    setFooter(document.getElementById(id));
  }, [id]);

  return footer;
}

export function StepHeader({
  icon: Icon,
  title,
  body,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <div data-step-header>
      <div className="mb-4 inline-flex rounded-lg bg-primary/10 p-3 text-primary">
        <Icon size={22} />
      </div>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}

export function Field({
  label,
  hint,
  source,
  children,
}: {
  label: string;
  hint?: string;
  source?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="block space-y-2">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
          <span className="min-w-0">{label}</span>
          {source ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              <Check size={12} aria-hidden="true" />
              {source}
            </span>
          ) : null}
        </span>
        {children}
      </label>
      {hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-lg border border-border bg-background/60 px-3 py-2 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground',
              value === option.value && 'border-primary/50 bg-primary/10 text-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function OnboardingAction({ children }: { children: ReactNode }) {
  const footer = useFooterTarget('onboarding-step-actions');
  if (footer === undefined) return null;
  return footer ? createPortal(children, footer) : children;
}

export function SubmitButton({
  saving,
  disabled = false,
  children,
}: {
  saving: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const footer = useFooterTarget('onboarding-step-actions');
  if (footer === undefined) return null;

  const action = (
    <Button
      type="submit"
      form={footer ? 'onboarding-voice-form' : undefined}
      disabled={saving || disabled}
      className="h-12 rounded-full px-6 transition-all duration-200"
    >
      {saving ? <Loader2 className="animate-spin" size={16} /> : <ArrowRight size={16} />}
      {children}
    </Button>
  );
  return footer ? createPortal(action, footer) : action;
}

export function ConnectReviewLayout({
  editing,
  onEditingChange,
  icon: Icon,
  title,
  summary,
  children,
  wide = false,
  canExitEditing = true,
  summaryStaysVisible = false,
  editorId = 'connect-step-editor',
  hideHeader = false,
}: {
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  icon: LucideIcon;
  title: string;
  summary: ReactNode;
  children: ReactNode;
  wide?: boolean;
  canExitEditing?: boolean;
  summaryStaysVisible?: boolean;
  editorId?: string;
  hideHeader?: boolean;
}) {
  return (
    <div
      data-review={summaryStaysVisible || !editing}
      data-wide-review={wide && !editing ? true : undefined}
      className={cn('w-full', wide ? 'max-w-6xl' : 'max-w-5xl')}
    >
      <section className="overflow-hidden rounded-[2.25rem] bg-card">
        {!hideHeader && (
          <header className="flex flex-wrap items-center justify-between gap-4 bg-muted/70 px-5 py-5 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-card text-brand">
                <Icon size={20} aria-hidden="true" />
              </span>
              <h2 className="min-w-0 text-lg font-semibold tracking-tight text-foreground sm:text-xl">
                {title}
              </h2>
            </div>
            {(!editing || canExitEditing) && (
              <Button
                type="button"
                variant={editing ? 'ghost' : 'outline'}
                size="sm"
                aria-expanded={editing}
                onClick={() => onEditingChange(!editing)}
                className="shrink-0 gap-2 rounded-lg transition-all duration-200"
              >
                {editing ? <ArrowLeft size={14} /> : <Pencil size={14} />}
                {editing ? 'Retour au résumé' : 'Modifier les informations'}
              </Button>
            )}
          </header>
        )}
        {summaryStaysVisible ? (
          <div className="p-5 sm:p-6">
            {summary}
            <div
              id={editorId}
              aria-hidden={!editing}
              inert={!editing}
              className={cn(
                'pointer-events-none grid grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity,margin] duration-300 ease-out motion-reduce:transition-none',
                editing && 'pointer-events-auto mt-5 grid-rows-[1fr] opacity-100',
              )}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="border-t border-border pt-5">{children}</div>
              </div>
            </div>
          </div>
        ) : (
          <div
            key={editing ? 'edit' : 'summary'}
            className="animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none"
          >
            <div className="p-5 sm:p-6">{editing ? children : summary}</div>
          </div>
        )}
      </section>
    </div>
  );
}

export function ConnectStepAction({
  formId,
  saving,
  label,
}: {
  formId: string;
  saving: boolean;
  label: string;
}) {
  const footer = useFooterTarget('connect-step-actions');
  if (footer === undefined) return null;

  const action = (
    <Button
      type="submit"
      form={formId}
      disabled={saving}
      className="h-11 min-w-40 gap-2 rounded-xl px-5 transition-all duration-200"
    >
      {saving ? <Loader2 className="animate-spin" size={16} /> : null}
      {saving ? 'Enregistrement…' : label}
      {!saving && <ArrowRight size={16} />}
    </Button>
  );

  return footer ? createPortal(action, footer) : action;
}

export const DAY_LABELS = [
  ['mon', 'Lundi'],
  ['tue', 'Mardi'],
  ['wed', 'Mercredi'],
  ['thu', 'Jeudi'],
  ['fri', 'Vendredi'],
  ['sat', 'Samedi'],
  ['sun', 'Dimanche'],
] as const;

export const PROFILE_OPTIONS = [
  { value: 'BISTROT_BRASSERIE', label: 'Bistrot' },
  { value: 'SEMI_GASTRO', label: 'Semi-gastro' },
  { value: 'GASTRONOMIQUE', label: 'Gastronomique' },
];

export const FILLER_OPTIONS = [
  { value: 'WARM', label: 'Chaleureux' },
  { value: 'CASUAL', label: 'Naturel' },
  { value: 'FORMAL', label: 'Formel' },
];

export const SUGGESTIONS = [
  'Proposer la formule midi en semaine.',
  'Mentionner la terrasse quand elle est disponible.',
  'Prévenir que le vendredi soir part vite.',
];

export const CUISINES_PRESETS = [
  'Italien',
  'Japonais',
  'Français',
  'Pizza',
  'Burgers',
  'Végétarien',
];
export const DIETARY_PRESETS = ['végétarien', 'vegan', 'sans gluten', 'halal', 'casher'];
export const FEATURES_PRESETS = [
  'terrasse',
  'groupe',
  'privatisation',
  'anniversaire',
  'ouvert dimanche',
  'brunch',
];

export function resizeImage(
  file: File,
  maxWidth: number,
  maxHeight: number,
  cropRatio?: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const sourceWidth = cropRatio ? Math.min(img.width, img.height * cropRatio) : img.width;
        const sourceHeight = cropRatio ? Math.min(img.height, img.width / cropRatio) : img.height;
        let width = sourceWidth;
        let height = sourceHeight;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(
          img,
          (img.width - sourceWidth) / 2,
          (img.height - sourceHeight) / 2,
          sourceWidth,
          sourceHeight,
          0,
          0,
          width,
          height,
        );
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
}

export function OnboardingPreview({
  eyebrow,
  title,
  icon: Icon,
  children,
}: {
  eyebrow: string;
  title?: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <aside className="overflow-hidden rounded-[2.25rem] bg-card">
      <div className="px-6 py-4">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {eyebrow}
        </p>
        {title ? <h3 className="mt-2 text-lg font-semibold tracking-tight">{title}</h3> : null}
      </div>
      <div className="relative mx-3 mb-3 overflow-hidden rounded-2xl bg-foreground p-6 text-background">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full border border-background/10"
        />
        <span className="relative mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-background/20">
          <Icon size={21} aria-hidden="true" />
        </span>
        <div className="relative space-y-4">{children}</div>
      </div>
    </aside>
  );
}
