'use client';

import { useEffect } from 'react';
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

const hasClerkKey = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

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
  'connect-identity': {
    title: 'Configurez l’identité publique de votre page',
    body: 'Déterminez l’adresse web unique (slug) de votre fiche, écrivez une description attrayante pour vos clients et ajoutez une photo de couverture.',
    cta: 'Remplir l’identité publique',
    impact: 'Améliore le référencement sur Google, ChatGPT et Perplexity.',
  },
  'connect-location': {
    title: 'Définissez la localisation exacte',
    body: 'Renseignez l’adresse de l’établissement et validez les coordonnées géographiques sur la carte interactive.',
    cta: 'Renseigner la localisation',
    impact: 'Permet d’apparaître dans les recherches géolocalisées des clients.',
  },
  'connect-cuisine': {
    title: 'Précisez votre cuisine et l’ambiance',
    body: 'Sélectionnez vos types de cuisine, la gamme de prix, les options de régime et les atouts du restaurant (terrasse, privatisation, etc.).',
    cta: 'Configurer la cuisine et l’ambiance',
    impact: 'Aide les assistants IA à recommander votre restaurant selon les critères clients.',
  },
  'connect-capacity': {
    title: 'Établissez les règles de réservation',
    body: 'Indiquez la capacité d’accueil, les limites de groupe et configurez d’éventuels acomptes pour sécuriser vos tables.',
    cta: 'Configurer les règles',
    impact: 'Prévient le no-show et évite les surréservations indésirables.',
  },
  'connect-activation': {
    title: 'Activez la page internet et son mode agent',
    body: 'Visualisez le rendu final de votre page publique et activez sa publication pour la rendre réservable.',
    cta: 'Vérifier et activer Connect',
    impact: 'Met instantanément votre établissement en ligne.',
  },
};

function StatusIcon({ status }: { status: OnboardingStatus }) {
  if (status === 'completed') return <Check className="text-success" size={16} />;
  if (status === 'current') return <CircleDot className="animate-pulse text-primary" size={17} />;
  if (status === 'blocked') return <AlertTriangle className="text-warning" size={16} />;
  if (status === 'skipped') return <Clock3 className="text-muted-foreground" size={16} />;
  return <Circle className="text-muted-foreground" size={16} />;
}

/** Barre de progression fine — remplace le simple pourcentage textuel par un repère visuel. */
function ProgressBar({ value, accentClassName }: { value: number; accentClassName?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
      <div
        className={cn(
          'h-full rounded-full transition-all duration-500',
          accentClassName || 'bg-brand',
        )}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function DashboardOnboardingGate() {
  const { state, loading, activeStep, openStepModal } = useOnboarding();

  // Soft gate : si le minimum viable (restaurant + hours) n'est pas atteint,
  // on ouvre automatiquement la modale d'onboarding au montage du dashboard.
  // L'utilisateur reste sur /dashboard (le panneau s'affiche derrière la modale)
  // et peut fermer la modale s'il le souhaite — il reviendra via le panneau.
  useEffect(() => {
    if (!hasClerkKey) return;
    if (loading || !state) return;
    if (state.minimumViableDone) return;
    if (activeStep) return; // déjà ouverte
    const voiceKeys = ['restaurant', 'hours', 'knowledge', 'calendar', 'phone'];
    const voiceSteps = state.steps.filter((s) => voiceKeys.includes(s.key));
    const targetStep =
      voiceSteps.find((s) => s.status === 'current' || s.status === 'pending') ?? voiceSteps[0];
    openStepModal(targetStep.key);
  }, [loading, state, activeStep, openStepModal]);

  return null;
}

export function DashboardOnboardingPanel() {
  const { state, loading, error } = useOnboarding();

  if (!hasClerkKey || loading || !state) return null;

  // Pattern Mural (+10% rétention J7) : la checklist ne disparaît pas
  // brutalement à la fin. On affiche un panneau "résumé" compact avec
  // les checkmarks verts qui persiste, rappelant que tout est configuré
  // et invitant à découvrir les fonctionnalités du dashboard.
  if (state.voiceOnboardingDone && state.connectOnboardingDone) {
    return <OnboardingCompletedSummary />;
  }

  return (
    <div className="mb-5 space-y-4">
      <OnboardingBanners />
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

/**
 * Panneau de résumé affiché après complétion de tout l'onboarding.
 * Persiste sur le dashboard — pattern Mural (+10% rétention J7).
 * Compact, non-bloquant, rappelle que tout est prêt.
 */
function OnboardingCompletedSummary() {
  const { state } = useOnboarding();
  if (!state) return null;

  const voiceSteps = state.steps.filter((s) =>
    ['restaurant', 'hours', 'knowledge', 'calendar', 'phone'].includes(s.key),
  );
  const connectSteps = state.steps.filter((s) =>
    [
      'connect-identity',
      'connect-location',
      'connect-cuisine',
      'connect-capacity',
      'connect-activation',
    ].includes(s.key),
  );

  return (
    <div className="mb-5 rounded-2xl border border-success/20 bg-success/[0.06] p-5 shadow-sm transition-all duration-200">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-success/25 bg-success/10 text-success">
          <CheckCircle2 size={20} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-foreground">
            Configuration terminée — votre assistant est prêt
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Voice {state.voiceProgress}% · Connect {state.connectProgress}%
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-success/15 pt-4">
        {voiceSteps.map((step) => (
          <span
            key={step.key}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <Check size={12} className="text-success" />
            {step.title.toLowerCase()}
          </span>
        ))}
        {connectSteps.map((step) => (
          <span
            key={step.key}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <Check size={12} className="text-success" />
            {step.title.toLowerCase()}
          </span>
        ))}
      </div>
    </div>
  );
}

export function OnboardingBanners() {
  const { state, openStepModal } = useOnboarding();
  if (!state) return null;

  const showVoiceBanner = !state.voiceOnboardingDone;
  const showConnectBanner = !state.connectOnboardingDone;

  const voiceCurrent =
    state.steps
      .filter((s) => ['restaurant', 'hours', 'knowledge', 'calendar', 'phone'].includes(s.key))
      .find((s) => s.status === 'current' || s.status === 'pending') ?? state.steps[0];

  const connectCurrent =
    state.steps
      .filter((s) =>
        [
          'connect-identity',
          'connect-location',
          'connect-cuisine',
          'connect-capacity',
          'connect-activation',
        ].includes(s.key),
      )
      .find((s) => s.status === 'current' || s.status === 'pending') ?? state.steps[5];

  return (
    <div className="flex flex-col gap-3">
      {showVoiceBanner && (
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm transition-all duration-200 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-primary">
              <PhoneCall size={19} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground">
                Assistant Vocal Sokar ·{' '}
                {
                  state.steps.filter(
                    (s) =>
                      ['restaurant', 'hours', 'knowledge', 'calendar', 'phone'].includes(s.key) &&
                      s.status === 'completed',
                  ).length
                }
                /5 terminées
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Prochaine action : {voiceCurrent.title.toLowerCase()}
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <div className="w-40 max-w-[50vw]">
                  <ProgressBar value={state.voiceProgress} accentClassName="bg-primary" />
                </div>
                <span className="text-[11px] font-bold text-muted-foreground">
                  {state.voiceProgress}%
                </span>
              </div>
            </div>
          </div>
          <Button
            type="button"
            onClick={() => openStepModal(voiceCurrent.key)}
            className="w-full transition-all duration-200 md:w-auto"
          >
            Continuer la configuration de la Voice
            <ArrowRight size={16} />
          </Button>
        </div>
      )}

      {showConnectBanner && (
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm transition-all duration-200 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-warning/25 bg-warning/10 text-warning">
              <ExternalLink size={19} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground">
                Sokar Connect ·{' '}
                {
                  state.steps.filter(
                    (s) =>
                      [
                        'connect-identity',
                        'connect-location',
                        'connect-cuisine',
                        'connect-capacity',
                        'connect-activation',
                      ].includes(s.key) && s.status === 'completed',
                  ).length
                }
                /5 terminées
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Prochaine action : {connectCurrent.title.toLowerCase()}
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <div className="w-40 max-w-[50vw]">
                  <ProgressBar value={state.connectProgress} accentClassName="bg-warning" />
                </div>
                <span className="text-[11px] font-bold text-muted-foreground">
                  {state.connectProgress}%
                </span>
              </div>
            </div>
          </div>
          <Button
            type="button"
            onClick={() => openStepModal(connectCurrent.key)}
            className="w-full transition-all duration-200 md:w-auto bg-warning text-warning-foreground hover:opacity-90"
          >
            Configurer Connect
            <ArrowRight size={16} />
          </Button>
        </div>
      )}
    </div>
  );
}

export function OnboardingStepper() {
  const { state, openStepModal } = useOnboarding();
  if (!state) return null;

  const voiceSteps = state.steps.filter((s) =>
    ['restaurant', 'hours', 'knowledge', 'calendar', 'phone'].includes(s.key),
  );
  const connectSteps = state.steps.filter((s) =>
    [
      'connect-identity',
      'connect-location',
      'connect-cuisine',
      'connect-capacity',
      'connect-activation',
    ].includes(s.key),
  );

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm transition-all duration-200 md:p-6">
      <div className="mb-5">
        <h2 className="text-lg font-black tracking-tight text-foreground">
          Étapes de mise en service
        </h2>
      </div>

      <div className="space-y-6">
        <div>
          <div className="mb-3 flex items-center gap-3">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              1. Assistant vocal
            </span>
            <div className="h-1.5 flex-1 max-w-[10rem]">
              <ProgressBar value={state.voiceProgress} accentClassName="bg-primary" />
            </div>
            <span className="text-xs font-bold text-foreground">{state.voiceProgress}%</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-5">
            {voiceSteps.map((step) => (
              <StepperButton key={step.key} step={step} onClick={() => openStepModal(step.key)} />
            ))}
          </div>
        </div>

        <div className="border-t border-border pt-5">
          <div className="mb-3 flex items-center gap-3">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              2. Sokar Connect
            </span>
            <div className="h-1.5 flex-1 max-w-[10rem]">
              <ProgressBar value={state.connectProgress} accentClassName="bg-warning" />
            </div>
            <span className="text-xs font-bold text-foreground">{state.connectProgress}%</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-5">
            {connectSteps.map((step) => (
              <StepperButton key={step.key} step={step} onClick={() => openStepModal(step.key)} />
            ))}
          </div>
        </div>
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
        'min-h-[92px] rounded-xl border border-border bg-secondary/40 p-3 text-left transition-all duration-200 hover:border-primary/40 hover:bg-accent flex flex-col justify-between',
        isCurrent &&
          'border-primary/40 bg-primary/[0.06] shadow-[0_0_0_1px_hsl(var(--primary)/0.15)]',
        step.status === 'completed' && 'border-success/25 bg-success/[0.06]',
      )}
    >
      <div className="flex items-center justify-between gap-2 w-full">
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card">
          <StatusIcon status={step.status} />
        </span>
        <span className="text-[10px] font-bold uppercase text-muted-foreground">
          {STATUS_LABEL[step.status]}
        </span>
      </div>
      <div>
        <p className="mt-2 text-xs font-bold text-foreground line-clamp-2">
          {step.index}. {step.title}
        </p>
      </div>
    </button>
  );
}

export function CurrentActionCard() {
  const { state, openStepModal, updateTask } = useOnboarding();
  if (!state) return null;

  const step = state.currentStep;
  const copy = ACTION_COPY[step.key] ?? ACTION_COPY.restaurant;
  const canSkip = !step.required && step.status !== 'completed';

  return (
    <section className="flex flex-col justify-between rounded-2xl border border-brand/20 bg-brand/[0.04] p-5 shadow-sm transition-all duration-200 md:p-6">
      <div>
        <div className="flex items-start justify-between gap-4">
          <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-brand">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" />
            Action recommandée
          </p>
          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card">
            <StatusIcon status={step.status} />
          </span>
        </div>
        <h2 className="mt-2 text-xl font-black tracking-tight text-foreground">{copy.title}</h2>

        <p className="mt-3 text-sm text-muted-foreground">{copy.body}</p>
        <div className="mt-4 rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
          {copy.impact}
        </div>

        {step.status === 'blocked' && (
          <div className="mt-3 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning transition-all duration-200">
            {step.state.reason || 'Cette étape demande une action externe.'}
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          onClick={() => openStepModal(step.key)}
          className={cn(
            'transition-all duration-200',
            step.key.startsWith('connect') && 'bg-warning text-warning-foreground hover:opacity-90',
          )}
        >
          {copy.cta}
          <ArrowRight size={16} />
        </Button>
        {step.key === 'calendar' && step.status === 'blocked' && (
          <Button
            type="button"
            variant="outline"
            onClick={() => openStepModal('calendar')}
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
        {state.onboardingDone && step.key === 'phone' && (
          <span className="inline-flex items-center gap-2 text-sm text-success self-center">
            <CheckCircle2 size={16} />
            Assistant configuré
          </span>
        )}
      </div>
    </section>
  );
}
