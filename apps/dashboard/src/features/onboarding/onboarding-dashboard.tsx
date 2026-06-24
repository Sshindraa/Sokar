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
  'canal-a-identity': {
    title: 'Configurez l’identité publique de votre page',
    body: 'Déterminez l’adresse web unique (slug) de votre fiche, écrivez une description attrayante pour vos clients et ajoutez une photo de couverture.',
    cta: 'Remplir l’identité publique',
    impact: 'Améliore le référencement sur Google, ChatGPT et Perplexity.',
  },
  'canal-a-location': {
    title: 'Définissez la localisation exacte',
    body: 'Renseignez l’adresse de l’établissement et validez les coordonnées géographiques sur la carte interactive.',
    cta: 'Renseigner la localisation',
    impact: 'Permet d’apparaître dans les recherches géolocalisées des clients.',
  },
  'canal-a-cuisine': {
    title: 'Précisez votre cuisine et l’ambiance',
    body: 'Sélectionnez vos types de cuisine, la gamme de prix, les options de régime et les atouts du restaurant (terrasse, privatisation, etc.).',
    cta: 'Configurer la cuisine et l’ambiance',
    impact: 'Aide les assistants IA à recommander votre restaurant selon les critères clients.',
  },
  'canal-a-capacity': {
    title: 'Établissez les règles de réservation',
    body: 'Indiquez la capacité d’accueil, les limites de groupe et configurez d’éventuels acomptes pour sécuriser vos tables.',
    cta: 'Configurer les règles',
    impact: 'Prévient le no-show et évite les surréservations indésirables.',
  },
  'canal-a-activation': {
    title: 'Activez la page internet et son mode agent',
    body: 'Visualisez le rendu final de votre page publique et activez sa publication pour la rendre réservable.',
    cta: 'Vérifier et activer le Canal A',
    impact: 'Met instantanément votre établissement en ligne.',
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
    if (!hasClerkKey) return;
    if (loading || !state || state.voiceOnboardingDone || !pathname?.startsWith('/dashboard')) return;
    const voiceKeys = ['restaurant', 'hours', 'knowledge', 'calendar', 'phone'];
    const voiceSteps = state.steps.filter((s) => voiceKeys.includes(s.key));
    const targetStep = voiceSteps.find((s) => s.status === 'current' || s.status === 'pending') ?? voiceSteps[0];
    router.replace(`/onboarding/${targetStep.key}`);
  }, [loading, pathname, router, state]);

  return null;
}

export function DashboardOnboardingPanel() {
  const { state, loading, error } = useOnboarding();

  if (!hasClerkKey || loading || !state) return null;
  if (state.voiceOnboardingDone && state.canalAOnboardingDone) return null;

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

export function OnboardingBanners() {
  const { state, openStep } = useOnboarding();
  if (!state) return null;

  const showVoiceBanner = !state.voiceOnboardingDone;
  const showCanalABanner = !state.canalAOnboardingDone;

  const voiceCurrent = state.steps.filter((s) => ['restaurant', 'hours', 'knowledge', 'calendar', 'phone'].includes(s.key))
    .find((s) => s.status === 'current' || s.status === 'pending') ?? state.steps[0];

  const canalACurrent = state.steps.filter((s) => ['canal-a-identity', 'canal-a-location', 'canal-a-cuisine', 'canal-a-capacity', 'canal-a-activation'].includes(s.key))
    .find((s) => s.status === 'current' || s.status === 'pending') ?? state.steps[5];

  return (
    <div className="flex flex-col gap-3">
      {showVoiceBanner && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card/90 p-4 shadow-lg backdrop-blur-xl transition-all duration-200 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary">
              <PhoneCall size={18} />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                Assistant Vocal Sokar · {state.steps.filter(s => ['restaurant', 'hours', 'knowledge', 'calendar', 'phone'].includes(s.key) && s.status === 'completed').length}/5 terminées
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Prochaine action : {voiceCurrent.title.toLowerCase()} · {state.voiceProgress}% prêt.
              </p>
            </div>
          </div>
          <Button
            type="button"
            onClick={() => openStep(voiceCurrent.key)}
            className="w-full transition-all duration-200 md:w-auto"
          >
            Continuer la configuration de la Voice
            <ArrowRight size={16} />
          </Button>
        </div>
      )}

      {showCanalABanner && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card/90 p-4 shadow-lg backdrop-blur-xl transition-all duration-200 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-amber-500/10 p-2 text-amber-500">
              <ExternalLink size={18} />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                Page Internet & Assistants (Canal A) · {state.steps.filter(s => ['canal-a-identity', 'canal-a-location', 'canal-a-cuisine', 'canal-a-capacity', 'canal-a-activation'].includes(s.key) && s.status === 'completed').length}/5 terminées
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Prochaine action : {canalACurrent.title.toLowerCase()} · {state.canalAProgress}% prêt.
              </p>
            </div>
          </div>
          <Button
            type="button"
            onClick={() => openStep(canalACurrent.key)}
            className="w-full transition-all duration-200 md:w-auto bg-amber-600 hover:bg-amber-700 text-white"
          >
            Configurer le Canal A
            <ArrowRight size={16} />
          </Button>
        </div>
      )}
    </div>
  );
}

export function OnboardingStepper() {
  const { state, openStep } = useOnboarding();
  if (!state) return null;

  const voiceSteps = state.steps.filter((s) => ['restaurant', 'hours', 'knowledge', 'calendar', 'phone'].includes(s.key));
  const canalASteps = state.steps.filter((s) => ['canal-a-identity', 'canal-a-location', 'canal-a-cuisine', 'canal-a-capacity', 'canal-a-activation'].includes(s.key));

  return (
    <section className="rounded-lg border border-border bg-card/80 p-4 backdrop-blur-xl transition-all duration-200 md:p-5">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-foreground">Étapes de mise en service</h2>
      </div>

      <div className="space-y-4">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              1. Assistant Vocal ({state.voiceProgress}%)
            </span>
          </div>
          <div className="grid gap-2 md:grid-cols-5">
            {voiceSteps.map((step) => (
              <StepperButton key={step.key} step={step} onClick={() => openStep(step.key)} />
            ))}
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              2. Référencement & Réservations IA (Canal A - {state.canalAProgress}%)
            </span>
          </div>
          <div className="grid gap-2 md:grid-cols-5">
            {canalASteps.map((step) => (
              <StepperButton key={step.key} step={step} onClick={() => openStep(step.key)} />
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
        'min-h-[90px] rounded-lg border border-border bg-background/60 p-3 text-left transition-all duration-200 hover:border-primary/50 hover:bg-accent/40 flex flex-col justify-between',
        isCurrent && 'border-primary/50 bg-primary/10 shadow-lg',
        step.status === 'completed' && 'border-emerald-500/30 bg-emerald-500/10',
      )}
    >
      <div className="flex items-center justify-between gap-2 w-full">
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background">
          <StatusIcon status={step.status} />
        </span>
        <span className="text-[10px] font-medium text-muted-foreground">
          {STATUS_LABEL[step.status]}
        </span>
      </div>
      <div>
        <p className="mt-2 text-xs font-semibold text-foreground line-clamp-2">
          {step.index}. {step.title}
        </p>
      </div>
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
    <section className="rounded-lg border border-border bg-card/80 p-4 backdrop-blur-xl transition-all duration-200 md:p-5 flex flex-col justify-between">
      <div>
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
      </div>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          onClick={() => openStep(step.key)}
          className={cn(
            "transition-all duration-200",
            step.key.startsWith('canal-a') && "bg-amber-600 hover:bg-amber-700 text-white"
          )}
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
        {state.onboardingDone && step.key === 'phone' && (
          <span className="inline-flex items-center gap-2 text-sm text-emerald-400 self-center">
            <CheckCircle2 size={16} />
            Assistant configuré
          </span>
        )}
      </div>
    </section>
  );
}
