'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  Circle,
  CircleDot,
  ExternalLink,
  PhoneCall,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useOnboarding } from './onboarding-provider';
import type { OnboardingStep, OnboardingStatus } from './types';

const STATUS_LABEL: Record<OnboardingStatus, string> = {
  completed: 'Terminé',
  current: 'En cours',
  blocked: 'Bloqué',
  skipped: 'Plus tard',
  pending: 'À faire',
};

const ACTION_COPY: Record<string, { title: string; body: string; cta: string; impact: string }> = {
  restaurant: {
    title: 'Validez l’identité du restaurant',
    body: 'Sokar doit connaître le bon interlocuteur avant de prendre des réservations.',
    cta: 'Compléter l’identité',
    impact: 'Base indispensable pour les alertes, confirmations et relances.',
  },
  hours: {
    title: 'Définissez les créneaux réservables',
    body: 'L’assistant évite les mauvais créneaux et répond avec assurance.',
    cta: 'Configurer les horaires',
    impact: 'Empêche les propositions hors service.',
  },
  knowledge: {
    title: 'Donnez le ton et les consignes',
    body: 'Un assistant crédible sait quoi recommander et comment parler aux clients.',
    cta: 'Configurer la personnalité',
    impact: 'Rend les réponses plus naturelles dès le premier appel.',
  },
  calendar: {
    title: 'Connectez le planning',
    body: 'Sokar vérifie les disponibilités avant de confirmer une table.',
    cta: 'Connecter l’agenda',
    impact: 'Réduit les doubles réservations.',
  },
  phone: {
    title: 'Mettez les appels en service',
    body: 'Le numéro Sokar et le renvoi opérateur transforment la configuration en appels réels.',
    cta: 'Activer le téléphone',
    impact: 'Dernière étape avant le test grandeur nature.',
  },
};

function StatusIcon({ status }: { status: OnboardingStatus }) {
  if (status === 'completed') return <Check className="text-emerald-400" size={16} />;
  if (status === 'current') return <CircleDot className="animate-pulse text-primary" size={17} />;
  if (status === 'blocked') return <AlertTriangle className="text-amber-400" size={16} />;
  if (status === 'skipped') return <Clock3 className="text-muted-foreground" size={16} />;
  return <Circle className="text-muted-foreground" size={16} />;
}

export function DashboardOnboardingGate() {
  const router = useRouter();
  const pathname = usePathname();
  const { state, loading } = useOnboarding();

  useEffect(() => {
    if (loading || !state || state.onboardingDone || !pathname?.startsWith('/dashboard')) return;
    const target =
      state.currentStep.status === 'completed' || state.currentStep.status === 'skipped'
        ? (state.steps.find((step) => step.status === 'current' || step.status === 'pending')
            ?.key ?? state.currentStep.key)
        : state.currentStep.key;
    router.replace(`/onboarding/${target}`);
  }, [loading, pathname, router, state]);

  return null;
}

export function DashboardOnboardingPanel() {
  const { state, loading, error } = useOnboarding();

  if (loading || !state || state.onboardingDone) return null;

  return (
    <div className="mb-5 space-y-3">
      <OnboardingBanner />
      <div className="grid gap-3 xl:grid-cols-[1.4fr_1fr]">
        <OnboardingStepper />
        <CurrentActionCard />
      </div>
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive transition-all duration-200">
          {error}
        </div>
      )}
    </div>
  );
}

export function OnboardingBanner() {
  const { state, openStep } = useOnboarding();
  if (!state || state.onboardingDone) return null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card/90 p-4 shadow-lg backdrop-blur-xl transition-all duration-200 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary">
          <PhoneCall size={18} />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">
            Configuration incomplète · {state.completedCount}/{state.totalCount} terminées
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Prochaine action : {state.currentStep.title.toLowerCase()} · {state.progress}% prêt.
          </p>
        </div>
      </div>
      <Button
        type="button"
        onClick={() => openStep(state.currentStep.key)}
        className="w-full transition-all duration-200 md:w-auto"
      >
        Continuer
        <ArrowRight size={16} />
      </Button>
    </div>
  );
}

export function OnboardingStepper() {
  const { state, openStep } = useOnboarding();
  if (!state) return null;

  return (
    <section className="rounded-lg border border-border bg-card/80 p-4 backdrop-blur-xl transition-all duration-200 md:p-5">
      <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Mise en service
          </p>
          <h2 className="mt-1 text-lg font-semibold text-foreground">
            Votre assistant est prêt à {state.progress}%
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Étape {state.currentStep.index} sur {state.totalCount}
        </p>
      </div>

      <div className="grid gap-2 md:grid-cols-5">
        {state.steps.map((step) => (
          <StepperButton key={step.key} step={step} onClick={() => openStep(step.key)} />
        ))}
      </div>
    </section>
  );
}

function StepperButton({ step, onClick }: { step: OnboardingStep; onClick: () => void }) {
  const isCurrent = step.status === 'current' || step.status === 'blocked';

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'min-h-24 rounded-lg border border-border bg-background/60 p-3 text-left transition-all duration-200 hover:border-primary/50 hover:bg-accent/40',
        isCurrent && 'min-h-32 border-primary/50 bg-primary/10 shadow-lg',
        step.status === 'completed' && 'border-emerald-500/30 bg-emerald-500/10',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background">
          <StatusIcon status={step.status} />
        </span>
        <span className="text-xs font-medium text-muted-foreground">
          {STATUS_LABEL[step.status]}
        </span>
      </div>
      <p className={cn('mt-3 text-sm font-semibold text-foreground', isCurrent && 'text-base')}>
        {step.index}. {step.title}
      </p>
      {isCurrent && <p className="mt-2 text-xs text-muted-foreground">{step.description}</p>}
    </button>
  );
}

export function CurrentActionCard() {
  const { state, openStep, updateTask } = useOnboarding();
  if (!state) return null;

  const step = state.currentStep;
  const copy = ACTION_COPY[step.key] ?? ACTION_COPY.restaurant;
  const canSkip = !step.required && step.status !== 'completed';

  return (
    <section className="rounded-lg border border-border bg-card/80 p-4 backdrop-blur-xl transition-all duration-200 md:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Action recommandée
          </p>
          <h2 className="mt-1 text-lg font-semibold text-foreground">{copy.title}</h2>
        </div>
        <StatusIcon status={step.status} />
      </div>

      <p className="mt-3 text-sm text-muted-foreground">{copy.body}</p>
      <div className="mt-4 rounded-lg border border-border bg-background/60 p-3 text-sm text-muted-foreground">
        {copy.impact}
      </div>

      {step.status === 'blocked' && (
        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200 transition-all duration-200">
          {step.state.reason || 'Cette étape demande une action externe.'}
        </div>
      )}

      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          onClick={() => openStep(step.key)}
          className="transition-all duration-200"
        >
          {copy.cta}
          <ArrowRight size={16} />
        </Button>
        {step.key === 'calendar' && step.status === 'blocked' && (
          <Button
            type="button"
            variant="outline"
            onClick={() => openStep('calendar')}
            className="transition-all duration-200"
          >
            Réessayer Google
            <ExternalLink size={16} />
          </Button>
        )}
        {canSkip && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => updateTask('skip', step.key, { reason: 'À reprendre plus tard' })}
            className="transition-all duration-200"
          >
            Plus tard
          </Button>
        )}
        {state.onboardingDone && (
          <span className="inline-flex items-center gap-2 text-sm text-emerald-400">
            <CheckCircle2 size={16} />
            Assistant configuré
          </span>
        )}
      </div>
    </section>
  );
}
