'use client';

import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  CalendarCheck,
  CreditCard,
  Loader2,
  Mail,
  PhoneCall,
  PhoneOff,
  Sparkles,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { BillingStatus, BillingTrial } from '@/types/api';

/** The last days of the trial switch to the warning tone. */
export const TRIAL_URGENT_DAYS = 3;
/** The e-mail reminder leaves this many days before the end (Stripe `trial_will_end`). */
const REMINDER_DAYS_BEFORE_END = 3;

// ─── Billing status, fetched once per dashboard session ─────────────────────

type BillingStatusContextValue = { status: BillingStatus | null; refresh: () => void };

const BillingStatusContext = createContext<BillingStatusContextValue>({
  status: null,
  refresh: () => undefined,
});

export function BillingStatusProvider({
  children,
  initialStatus,
}: {
  children: ReactNode;
  /** Fixed status (tests, previews): no request is made. */
  initialStatus?: BillingStatus;
}) {
  const { get, isSignedIn } = useApi();
  const [status, setStatus] = useState<BillingStatus | null>(initialStatus ?? null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (initialStatus || !isSignedIn) return;
    let cancelled = false;
    void get<BillingStatus>('billing/status')
      .then((result) => {
        if (!cancelled) setStatus(result);
      })
      .catch(() => {
        // Billing is informative in the shell: an unavailable status never blocks the dashboard.
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [get, initialStatus, isSignedIn, version]);

  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  return (
    <BillingStatusContext.Provider value={{ status, refresh }}>
      {children}
    </BillingStatusContext.Provider>
  );
}

export function useBillingStatus(): BillingStatusContextValue {
  return useContext(BillingStatusContext);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

function formatDay(iso: string | Date, withWeekday = true): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    ...(withWeekday ? { weekday: 'long' } : {}),
    day: 'numeric',
    month: 'long',
  });
}

export function trialHeadline(daysLeft: number): string {
  if (daysLeft <= 0) return 'Dernier jour d’essai';
  if (daysLeft === 1) return 'Plus qu’un jour d’essai';
  return `Plus que ${daysLeft} jours d’essai`;
}

/** Day of the trial in progress, from 1 to `totalDays`. */
export function trialDay(trial: BillingTrial): number {
  return Math.min(trial.totalDays, Math.max(1, trial.totalDays - trial.daysLeft + 1));
}

function isUrgent(trial: BillingTrial): boolean {
  return trial.daysLeft <= TRIAL_URGENT_DAYS;
}

/** Opens the Stripe customer portal, where the restaurant adds its card. */
export function useOpenBillingPortal() {
  const { post } = useApi();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = useCallback(async () => {
    setOpening(true);
    setError(null);
    try {
      const session = await post<{ url?: string }>('billing/portal-session');
      if (!session.url) throw new Error('portal-unavailable');
      window.location.assign(session.url);
    } catch {
      setError('Impossible d’ouvrir l’ajout de carte. Réessayez dans un instant.');
      setOpening(false);
    }
  }, [post]);
  return { open, opening, error };
}

// ─── Visual pieces ──────────────────────────────────────────────────────────

/**
 * Ring showing the share of the trial already used. The theme is monochrome: urgency is told by
 * contrast (a brighter arc, days in the centre), not by a hue.
 */
export function TrialRing({
  trial,
  size = 22,
  showDays = false,
  inverted = false,
}: {
  trial: BillingTrial;
  size?: number;
  showDays?: boolean;
  /** Drawn on a light (primary) background. */
  inverted?: boolean;
}) {
  const stroke = size >= 32 ? 3 : 2.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const used = trialDay(trial) / trial.totalDays;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className={inverted ? 'stroke-primary-foreground/20' : 'stroke-border'}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - used)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className={cn(
            'transition-all duration-200',
            inverted
              ? 'stroke-primary-foreground'
              : isUrgent(trial)
                ? 'stroke-foreground'
                : 'stroke-muted-foreground',
          )}
        />
      </svg>
      {showDays && (
        <span
          aria-hidden="true"
          className="absolute text-sm font-black tabular-nums text-foreground"
        >
          {trial.daysLeft}
        </span>
      )}
    </span>
  );
}

/** One segment per trial day: elapsed, today, still to come. */
export function TrialTrack({ trial }: { trial: BillingTrial }) {
  const today = trialDay(trial);
  return (
    <div>
      <div className="flex gap-1" role="img" aria-label={`Jour ${today} sur ${trial.totalDays}`}>
        {Array.from({ length: trial.totalDays }, (_, index) => {
          const day = index + 1;
          return (
            <span
              key={day}
              className={cn(
                'h-1.5 flex-1 rounded-full transition-all duration-200',
                day < today && 'bg-foreground/35',
                day === today && 'bg-primary',
                day > today && 'bg-secondary',
              )}
            />
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>
          Jour {today} sur {trial.totalDays}
        </span>
        <span>Fin le {formatDay(trial.endsAt, false)}</span>
      </div>
    </div>
  );
}

function RecapTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof PhoneCall;
  label: string;
  value: number;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card p-4">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground/75">
        <Icon size={15} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-black leading-none tracking-tight text-foreground tabular-nums">
          {value.toLocaleString('fr-FR')}
        </p>
        <p className="mt-1.5 text-[10px] font-bold uppercase leading-tight tracking-[0.1em] text-muted-foreground">
          {label}
        </p>
      </div>
    </div>
  );
}

/** What Sokar did during the trial, in the dashboard's KPI style. */
export function TrialRecap({ trial }: { trial: BillingTrial }) {
  const recap = trial.recap;
  if (!recap) return null;
  if (recap.calls === 0) {
    return (
      <div className="flex gap-3 rounded-2xl border border-border bg-card p-4 text-sm">
        <PhoneOff size={18} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
        <div>
          <p className="font-semibold text-foreground">Aucun appel reçu pour l’instant</p>
          <p className="mt-1 text-muted-foreground">
            Le plus souvent, le renvoi de votre ligne vers votre numéro Sokar n’est pas encore
            activé. Une fois fait, l’assistant décroche à votre place pendant le service.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      <RecapTile icon={PhoneCall} label="Appels décrochés" value={recap.calls} />
      <RecapTile icon={CalendarCheck} label="Réservations" value={recap.reservations} />
      <RecapTile icon={Users} label="Couverts" value={recap.covers} />
    </div>
  );
}

/** What happens next, with real dates. */
export function TrialTimeline({ endsAt }: { endsAt: string }) {
  const end = new Date(endsAt);
  const reminder = new Date(end.getTime() - REMINDER_DAYS_BEFORE_END * DAY_MS);
  const steps = [
    {
      icon: Mail,
      when: formatDay(reminder),
      text:
        reminder.getTime() < Date.now()
          ? 'Nous vous avons envoyé un rappel par e-mail, avec le bilan de votre essai.'
          : 'Nous vous envoyons un rappel par e-mail, avec le bilan de votre essai.',
      past: reminder.getTime() < Date.now(),
    },
    {
      icon: CreditCard,
      when: formatDay(end),
      text: 'Fin de l’essai. Avec une carte enregistrée, votre formule démarre sans interruption. Sans carte, l’assistant cesse de décrocher : pensez alors à désactiver le renvoi de votre ligne.',
      past: false,
    },
  ];
  return (
    <ol className="space-y-3">
      {steps.map(({ icon: Icon, when, text, past }) => (
        <li key={when} className={cn('flex gap-3 text-sm', past && 'opacity-50')}>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
            <Icon size={14} aria-hidden="true" />
          </span>
          <div>
            <p className="font-semibold text-foreground first-letter:uppercase">{when}</p>
            <p className="text-muted-foreground">{text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Before the trial starts (onboarding): today, the reminder, the first payment. */
export function TrialStartTimeline({
  totalDays,
  now = new Date(),
}: {
  totalDays: number;
  now?: Date;
}) {
  const end = new Date(now.getTime() + totalDays * DAY_MS);
  const reminder = new Date(end.getTime() - REMINDER_DAYS_BEFORE_END * DAY_MS);
  const steps = [
    {
      icon: Sparkles,
      when: 'Aujourd’hui',
      text: 'Votre essai démarre : l’assistant décroche pour vous, sans carte bancaire.',
    },
    {
      icon: Mail,
      when: formatDay(reminder, false),
      text: 'Nous vous envoyons le bilan de votre essai et un rappel.',
    },
    {
      icon: CreditCard,
      when: formatDay(end, false),
      text: 'Votre formule démarre si vous avez ajouté une carte. Sinon, rien n’est prélevé.',
    },
  ];
  return (
    <ol className="relative space-y-4">
      <span aria-hidden="true" className="absolute bottom-3 left-[13px] top-3 w-px bg-border" />
      {steps.map(({ icon: Icon, when, text }, index) => (
        <li key={when} className="relative flex gap-3 text-sm">
          <span
            className={cn(
              'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-muted-foreground',
              index === 0
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-border bg-card',
            )}
          >
            <Icon size={14} aria-hidden="true" />
          </span>
          <div>
            <p className="font-semibold text-foreground">{when}</p>
            <p className="text-muted-foreground">{text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ─── Header chip + trial panel ──────────────────────────────────────────────

export function TrialPanel({
  trial,
  canManageBilling,
}: {
  trial: BillingTrial;
  canManageBilling: boolean;
}) {
  const portal = useOpenBillingPortal();
  return (
    <div className="space-y-6">
      <TrialTrack trial={trial} />
      <TrialRecap trial={trial} />
      <TrialTimeline endsAt={trial.endsAt} />
      <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        {canManageBilling ? (
          <Button
            onClick={() => void portal.open()}
            disabled={portal.opening}
            className="h-11 rounded-full px-6"
          >
            {portal.opening ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <CreditCard aria-hidden="true" />
            )}
            Ajouter une carte
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Le propriétaire du compte peut ajouter une carte depuis son espace.
          </p>
        )}
        <Link
          href="/pricing"
          className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-all duration-200 hover:text-foreground"
        >
          Comparer les formules
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
      {portal.error && (
        <p role="alert" className="text-sm text-destructive">
          {portal.error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Aucun prélèvement avant le {formatDay(trial.endsAt, false)}. Sans engagement en mensuel.
      </p>
    </div>
  );
}

function TrialDialog({
  trial,
  open,
  onOpenChange,
  canManageBilling,
}: {
  trial: BillingTrial;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManageBilling: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-3xl p-6 sm:p-8">
        <DialogHeader className="space-y-2 text-left">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            <Sparkles size={12} aria-hidden="true" />
            Essai gratuit
          </p>
          <DialogTitle className="text-2xl font-black tracking-tight">
            {trialHeadline(trial.daysLeft)}
          </DialogTitle>
          <DialogDescription>
            Votre assistant répond à vos clients jusqu’au {formatDay(trial.endsAt)}.
          </DialogDescription>
        </DialogHeader>
        <TrialPanel trial={trial} canManageBilling={canManageBilling} />
      </DialogContent>
    </Dialog>
  );
}

/** Compact header entry during the trial; opens the trial panel. */
export function TrialChip({ canManageBilling }: { canManageBilling: boolean }) {
  const { status } = useBillingStatus();
  const [open, setOpen] = useState(false);
  const trial = status?.subscriptionStatus === 'trialing' ? status.trial : undefined;
  if (!trial) return null;
  const urgent = isUrgent(trial);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${trialHeadline(trial.daysLeft)} : voir le détail`}
        className={cn(
          'inline-flex h-9 items-center gap-2 rounded-full border pl-1.5 pr-3 text-xs font-semibold transition-all duration-200',
          urgent
            ? 'border-transparent bg-primary text-primary-foreground hover:bg-primary/90'
            : 'border-border bg-card/60 text-foreground hover:bg-accent',
        )}
      >
        <TrialRing trial={trial} inverted={urgent} />
        <span className={cn('hidden sm:inline', !urgent && 'text-muted-foreground')}>Essai</span>
        <span>{trial.daysLeft <= 0 ? 'Dernier jour' : `${trial.daysLeft} j`}</span>
      </button>
      <TrialDialog
        trial={trial}
        open={open}
        onOpenChange={setOpen}
        canManageBilling={canManageBilling}
      />
    </>
  );
}

// ─── Page-level notices ─────────────────────────────────────────────────────

/**
 * Shown above the page content: the last days of the trial (gentle), then a suspended service
 * (blocking information, never a modal). Nothing the rest of the time.
 */
export function BillingNotice({ canManageBilling }: { canManageBilling: boolean }) {
  const { status } = useBillingStatus();
  const [open, setOpen] = useState(false);
  const portal = useOpenBillingPortal();
  if (!status) return null;

  if (status.suspended) {
    return (
      <section
        role="alert"
        className="mb-6 flex flex-col gap-4 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 transition-all duration-200 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <PhoneOff size={18} aria-hidden="true" />
          </span>
          <div>
            <p className="font-semibold text-foreground">Votre assistant ne répond plus</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Votre abonnement est terminé. Vos réglages, votre salle et votre fichier client sont
              conservés : choisissez une formule et l’assistant reprend immédiatement.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Votre ligne est encore renvoyée vers Sokar ? Vos clients entendent un court message
              leur demandant de rappeler. Désactivez ce renvoi chez votre opérateur pour qu’ils vous
              joignent directement.
            </p>
          </div>
        </div>
        <Button asChild className="h-11 shrink-0 rounded-full px-6">
          <Link href="/pricing">
            Réactiver mon assistant
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </section>
    );
  }

  const trial = status.subscriptionStatus === 'trialing' ? status.trial : undefined;
  if (!trial || !isUrgent(trial)) return null;
  return (
    <>
      <section
        role="status"
        className="mb-6 flex flex-col gap-4 rounded-2xl border border-foreground/15 bg-card p-5 transition-all duration-200 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-center gap-4">
          <TrialRing trial={trial} size={44} showDays />
          <div>
            <p className="font-semibold text-foreground">{trialHeadline(trial.daysLeft)}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Ajoutez une carte pour que l’assistant continue de répondre après le{' '}
              {formatDay(trial.endsAt, false)}.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => setOpen(true)}
            className="h-11 rounded-full px-4 text-muted-foreground"
          >
            Voir mon essai
          </Button>
          {canManageBilling && (
            <Button
              onClick={() => void portal.open()}
              disabled={portal.opening}
              className="h-11 rounded-full px-6"
            >
              {portal.opening ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <CreditCard aria-hidden="true" />
              )}
              Ajouter une carte
            </Button>
          )}
        </div>
      </section>
      {portal.error && (
        <p role="alert" className="-mt-4 mb-6 text-sm text-destructive">
          {portal.error}
        </p>
      )}
      <TrialDialog
        trial={trial}
        open={open}
        onOpenChange={setOpen}
        canManageBilling={canManageBilling}
      />
    </>
  );
}
