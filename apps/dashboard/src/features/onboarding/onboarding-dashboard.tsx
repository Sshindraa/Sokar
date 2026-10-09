'use client';

import { useEffect, useState } from 'react';
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
import type { OnboardingStep, OnboardingStatus, OnboardingTaskKey } from './types';

const STATUS_LABEL: Record<OnboardingStatus, string> = {
  completed: 'Terminé',
  current: 'En cours',
  blocked: 'À résoudre',
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
  floor: {
    title: 'Décrivez votre salle et vos règles',
    body: 'Sokar calcule vos disponibilités à partir de vos tables, de la durée d’un repas et de la taille maximale des groupes : sans elles, aucun créneau ne peut être proposé.',
    cta: 'Configurer ma salle',
    impact: 'Sans table, aucun client ne peut réserver.',
  },
  knowledge: {
    title: 'Donnez le ton et les consignes',
    body: 'Un assistant crédible sait quoi recommander et comment parler aux clients.',
    cta: 'Configurer la personnalité',
    impact: 'Rend les réponses plus naturelles dès le premier appel.',
  },
  phone: {
    title: 'Mettez les appels en service',
    body: 'Le numéro Sokar et le renvoi opérateur transforment la configuration en appels réels.',
    cta: 'Activer le téléphone',
    impact: 'Dernière étape avant le test grandeur nature.',
  },
  channels: {
    title: 'Vérifiez vos canaux de réservation',
    body: 'Testez les créneaux calculés, puis configurez votre page en ligne dans Sokar Connect. Le lien et le widget seront disponibles après publication.',
    cta: 'Vérifier mes canaux',
    impact: 'Confirmez vos disponibilités avant de publier votre page de réservation.',
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
          accentClassName || 'bg-brand/70',
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
    const voiceSteps = state.steps.filter((s) => s.group === 'voice');
    const targetStep =
      voiceSteps.find((s) => s.status === 'current' || s.status === 'pending') ?? voiceSteps[0];
    openStepModal(targetStep.key);
  }, [loading, state, activeStep, openStepModal]);

  return null;
}

type Journey = 'voice' | 'connect';

const STEP_LABELS: Record<string, string> = {
  restaurant: 'Restaurant',
  hours: 'Horaires',
  floor: 'Salle et règles',
  knowledge: 'Consignes et démo',
  phone: 'Appels',
  channels: 'Canaux',
  'connect-identity': 'Identité publique',
  'connect-location': 'Localisation',
  'connect-cuisine': 'Cuisine et ambiance',
  'connect-activation': 'Finalisation et publication',
};

function nextStep(steps: OnboardingStep[]) {
  return (
    steps.find((step) => step.status === 'current' || step.status === 'pending') ??
    steps.find((step) => step.status === 'blocked') ??
    steps.find((step) => step.status === 'skipped')
  );
}

const READINESS_STEP: Record<'hours' | 'tables' | 'rules', OnboardingTaskKey> = {
  hours: 'hours',
  tables: 'floor',
  rules: 'floor',
};

/**
 * Tant qu'il manque les horaires, les tables ou les règles, aucun canal (téléphone, widget, Google,
 * assistants IA) ne peut proposer de créneau : on le dit clairement, avec un accès direct à ce qui manque.
 */
function ReadinessNotice() {
  const { state, openStepModal } = useOnboarding();
  const readiness = state?.readiness;
  if (!readiness || readiness.ready) return null;
  const missing = readiness.checks.filter((check) => !check.ok);

  return (
    <div
      role="status"
      className="flex flex-col gap-3 border-b border-warning/30 bg-warning/10 px-6 py-4 transition-all duration-200 md:flex-row md:items-center md:justify-between"
    >
      <div className="flex min-w-0 items-start gap-3">
        <AlertTriangle className="mt-0.5 shrink-0 text-warning" size={18} aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            Vos clients ne peuvent pas encore réserver
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Il manque : {missing.map((check) => check.label.toLowerCase()).join(', ')}.
          </p>
        </div>
      </div>
      <Button
        variant="outline"
        onClick={() => openStepModal(READINESS_STEP[missing[0].key])}
        className="shrink-0 transition-all duration-200"
      >
        Compléter <ArrowRight size={16} />
      </Button>
    </div>
  );
}

export function DashboardOnboardingPanel({ required = false }: { required?: boolean } = {}) {
  const { state, loading, error, openStepModal } = useOnboarding();
  const [selectedJourney, setSelectedJourney] = useState<Journey | null>(null);

  if (loading)
    return (
      <div
        role="status"
        className="mb-5 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground"
      >
        Chargement de votre configuration…
      </div>
    );
  if (!state)
    return error ? (
      <div
        role="alert"
        className="mb-5 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground"
      >
        Votre configuration est momentanément indisponible. Actualisez la page pour réessayer.
      </div>
    ) : null;

  const journey =
    selectedJourney ?? (state.voiceOnboardingDone ? 'connect' : state.currentStep.group);
  const steps = state.steps.filter((step) => step.group === journey);
  const target = nextStep(steps);
  const completed = steps.filter((step) => step.status === 'completed').length;
  const isVoice = journey === 'voice';
  const journeyDone = isVoice ? state.voiceOnboardingDone : state.connectOnboardingDone;

  return (
    <section
      aria-label="Mise en service de Sokar"
      className="mb-6 overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
    >
      <div className="flex flex-col gap-4 border-b border-border p-6 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Mise en service
          </p>
          <h2 className="mt-2 text-xl font-bold tracking-tight text-foreground">
            {journeyDone
              ? isVoice
                ? 'Votre assistant est configuré'
                : 'Votre page Connect est configurée'
              : isVoice
                ? 'Préparez votre assistant vocal'
                : 'Préparez votre page de réservation'}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {isVoice
              ? 'Votre restaurant, votre salle et vos règles, une démonstration, puis la mise en service des appels.'
              : 'Vos informations publiques, puis la publication de votre page.'}
          </p>
        </div>
        <div
          role="group"
          aria-label="Choisir le parcours"
          className="flex flex-wrap gap-1 rounded-xl bg-secondary p-1"
        >
          {(['voice', 'connect'] as const).map((group) => (
            <Button
              key={group}
              variant={journey === group ? 'default' : 'ghost'}
              aria-pressed={journey === group}
              onClick={() => setSelectedJourney(group)}
              className="transition-all duration-200"
            >
              {group === 'voice' ? <PhoneCall size={16} /> : <ExternalLink size={16} />}
              {group === 'voice' ? 'Assistant vocal' : 'Sokar Connect'}
            </Button>
          ))}
        </div>
      </div>

      <ReadinessNotice />

      <div className="p-6 md:p-8">
        {journeyDone ? (
          <div className="space-y-4">
            <CheckCircle2 className="text-success" size={24} />
            <h3 className="text-lg font-semibold text-foreground">
              {isVoice ? 'Vérifiez le résultat avec un appel test' : 'Vérifiez votre page publique'}
            </h3>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {isVoice
                ? 'Appelez votre numéro Sokar, demandez une réservation et vérifiez qu’elle apparaît dans votre planning.'
                : 'Ouvrez l’aperçu de votre page pour vérifier les informations et le parcours de réservation.'}
            </p>
            <Button
              onClick={() => openStepModal(isVoice ? 'phone' : 'connect-activation')}
              className="transition-all duration-200"
            >
              {isVoice ? 'Vérifier les appels' : 'Voir ma page'} <ArrowRight size={16} />
            </Button>
          </div>
        ) : target ? (
          <CurrentActionCard step={target} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Choisissez une étape ci-dessous pour vérifier votre configuration.
          </p>
        )}

        <div className="mt-6 border-t border-border pt-5">
          <div className="mb-4 flex items-center gap-4">
            <p className="shrink-0 text-xs text-muted-foreground">
              {completed} sur {steps.length} étapes terminées
            </p>
            <div className="max-w-40 flex-1">
              <ProgressBar
                value={steps.length ? (completed / steps.length) * 100 : 0}
                accentClassName="bg-primary"
              />
            </div>
          </div>
          <ol className="flex flex-wrap gap-2" aria-label="Progression du parcours">
            {steps.map((step) => (
              <li key={step.key}>
                <button
                  type="button"
                  onClick={() => openStepModal(step.key)}
                  aria-current={target?.key === step.key ? 'step' : undefined}
                  aria-label={`${STEP_LABELS[step.key] ?? step.title} — ${STATUS_LABEL[step.status]}`}
                  className={cn(
                    'inline-flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground',
                    target?.key === step.key && 'bg-secondary font-semibold text-foreground',
                  )}
                >
                  <StatusIcon status={step.status} />
                  {STEP_LABELS[step.key] ?? step.title}
                </button>
              </li>
            ))}
          </ol>
          <details className="mt-3">
            <summary className="cursor-pointer rounded-lg py-2 text-sm text-muted-foreground transition-all duration-200 hover:text-foreground">
              Voir toutes les étapes
            </summary>
            <div className="mt-3">
              <OnboardingStepper />
            </div>
          </details>
        </div>
      </div>
      <div className="flex flex-col gap-3 border-t border-border bg-secondary/30 px-6 py-4 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-muted-foreground">
          {required
            ? isVoice
              ? 'Le parcours Sokar Connect est également requis pour ouvrir votre espace.'
              : 'Le parcours Assistant vocal est également requis pour ouvrir votre espace.'
            : isVoice
              ? 'Vous souhaitez aussi recevoir des réservations en ligne ?'
              : 'Vous souhaitez aussi confier vos appels à Sokar ?'}
        </p>
        <Button
          variant="ghost"
          onClick={() => setSelectedJourney(isVoice ? 'connect' : 'voice')}
          className="justify-start transition-all duration-200"
        >
          {isVoice
            ? required
              ? 'Configurer Sokar Connect'
              : 'Découvrir Sokar Connect'
            : 'Configurer l’assistant vocal'}{' '}
          <ArrowRight size={16} />
        </Button>
      </div>
      {error && (
        <p role="alert" className="border-t border-border p-4 text-sm text-destructive">
          La modification n’a pas pu être enregistrée. Réessayez dans quelques instants.
        </p>
      )}
    </section>
  );
}

export function OnboardingStepper() {
  const { state, openStepModal } = useOnboarding();
  if (!state) return null;

  const voiceSteps = state.steps.filter((s) => s.group === 'voice');
  const connectSteps = state.steps.filter((s) => s.group === 'connect');

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
        <p className="mt-2 text-xs font-bold text-foreground">
          {step.index}. {step.title}
        </p>
      </div>
    </button>
  );
}

export function CurrentActionCard({ step: selectedStep }: { step?: OnboardingStep } = {}) {
  const { state, openStepModal } = useOnboarding();
  if (!state) return null;
  const step = selectedStep ?? nextStep(state.steps) ?? state.currentStep;
  const copy = ACTION_COPY[step.key] ?? ACTION_COPY.restaurant;
  const blocked = step.status === 'blocked';
  const serviceIssue =
    blocked && /clerk|oauth|api|configuration sokar/i.test(step.state.reason ?? '');

  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
      <div className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Prochaine étape
        </p>
        <h3 className="mt-3 text-2xl font-bold tracking-tight text-foreground">{copy.title}</h3>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{copy.body}</p>
        {step.key === 'knowledge' && (
          <p className="mt-2 text-sm text-muted-foreground">
            La démonstration permet d’écouter un exemple de conversation. Elle ne confirme pas une
            réservation réelle.
          </p>
        )}
        {blocked && (
          <div
            role="status"
            className="mt-4 rounded-xl border border-border bg-secondary/50 p-4 text-sm text-muted-foreground"
          >
            <p className="font-semibold text-foreground">
              {serviceIssue
                ? 'Une configuration côté Sokar est nécessaire'
                : 'Cette étape reste à résoudre'}
            </p>
            <p className="mt-1">
              {serviceIssue
                ? 'La connexion au planning est indisponible pour le moment. Vous pouvez continuer à préparer les autres étapes ; les disponibilités de cet agenda ne sont pas encore vérifiées.'
                : 'Ouvrez cette étape pour vérifier les informations et les options disponibles. Les autres réglages restent accessibles.'}
            </p>
          </div>
        )}
      </div>
      <Button
        type="button"
        onClick={() => openStepModal(step.key)}
        className="shrink-0 transition-all duration-200"
      >
        {blocked ? 'Voir les options' : copy.cta}
        <ArrowRight size={16} />
      </Button>
    </div>
  );
}
