'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Circle } from 'lucide-react';
import { SokarLogo } from '@/components/SokarLogo';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useOnboarding } from './onboarding-provider';
import { STEP_COMPONENTS } from './steps';
import { ONBOARDING_TASK_KEYS, type OnboardingTaskKey } from './types';

const COPY: Record<OnboardingTaskKey, { title: string; body: string; label: string }> = {
  restaurant: {
    title: 'Vérifions votre restaurant',
    body: 'Vérifiez que Sokar a les bonnes informations sur votre restaurant.',
    label: 'Votre restaurant',
  },
  hours: {
    title: 'Horaires de réservation',
    body: 'Choisissez les jours et les plages horaires où votre restaurant accepte les réservations. Sokar propose des créneaux toutes les 30 minutes.',
    label: 'Vos horaires',
  },
  knowledge: {
    title: 'Consignes & démo',
    body: 'Donnez à Sokar la manière de parler qui correspond à votre restaurant.',
    label: 'Consignes & démo',
  },
  calendar: {
    title: 'Choisissez votre planning',
    body: 'Le planning Sokar vous permet de continuer sans connecter un agenda Google.',
    label: 'Planning',
  },
  phone: {
    title: 'Vérifions vos appels',
    body: 'Préparez le renvoi vers votre numéro Sokar, puis vérifiez la réception d’un appel test.',
    label: 'Appels',
  },
  'connect-identity': {
    title: 'Présentez votre restaurant',
    body: 'Vérifiez le nom, la description et la photo qui accueilleront vos futurs clients.',
    label: 'Votre présentation',
  },
  'connect-location': {
    title: 'Aidez vos clients à vous trouver',
    body: 'Vérifiez votre adresse et la position de votre restaurant sur la carte.',
    label: 'Votre adresse',
  },
  'connect-cuisine': {
    title: 'Qu’est-ce qui vous distingue ?',
    body: 'Précisez votre cuisine, votre ambiance et les services proposés à vos clients.',
    label: 'Cuisine et ambiance',
  },
  'connect-capacity': {
    title: 'Des réservations à votre rythme',
    body: 'Vérifiez votre capacité et vos règles pour accueillir chaque groupe dans de bonnes conditions.',
    label: 'Règles de réservation',
  },
  'connect-activation': {
    title: 'Votre page est prête à être vérifiée',
    body: 'Prévisualisez votre page de réservation, puis confirmez sa publication.',
    label: 'Vérification et publication',
  },
};

export function OnboardingWizard() {
  const { state, updateTask, error } = useOnboarding();
  const [selected, setSelected] = useState<OnboardingTaskKey | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const initial =
    state?.steps.find((step) => step.status === 'current' || step.status === 'pending') ??
    state?.steps.find((step) => step.status !== 'completed');
  const key = selected ?? initial?.key ?? 'restaurant';
  const step = state?.steps.find((item) => item.key === key);
  const group = step?.group ?? 'voice';
  const voiceSteps = state?.steps.filter((item) => item.group === 'voice') ?? [];
  const connectSteps = state?.steps.filter((item) => item.group === 'connect') ?? [];
  const groupSteps = group === 'voice' ? voiceSteps : connectSteps;
  const voiceTarget = voiceSteps.find((item) => item.status !== 'completed') ?? voiceSteps[0];
  const connectTarget = connectSteps.find((item) => item.status !== 'completed') ?? connectSteps[0];
  const index = ONBOARDING_TASK_KEYS.indexOf(key);
  const Step = STEP_COMPONENTS[key];

  useEffect(() => {
    void updateTask('start', key);
    // Mark only a navigation change, not each state refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  function navigate(target: OnboardingTaskKey) {
    setSelected(target);
    requestAnimationFrame(() => heading.current?.focus());
  }

  function finish(next: OnboardingTaskKey | null) {
    const remaining = state?.steps.find((item) => item.key !== key && item.status !== 'completed');
    if (next) navigate(next);
    else if (remaining) navigate(remaining.key);
  }

  if (!state) return null;

  return (
    <div className="min-h-screen overflow-hidden bg-card md:grid md:h-dvh md:min-h-0 md:grid-cols-[280px_minmax(0,1fr)] lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside
        className="flex flex-col border-b border-border bg-gradient-to-br from-primary/5 via-secondary/60 to-brand/10 p-6 md:border-b-0 md:border-r md:p-5 lg:p-7"
        aria-label="Votre parcours de mise en service"
      >
        <SokarLogo className="mb-3 hidden h-8 w-8 text-foreground md:block" />
        <h1 className="mt-2 text-xl font-bold tracking-tight md:text-2xl">
          {group === 'voice' ? 'Préparons votre assistant' : 'Votre page de réservation'}
        </h1>
        <p className="mt-2 text-sm leading-5 text-muted-foreground">
          {group === 'voice' ? 'Environ 5 minutes' : 'Rendez votre restaurant visible en ligne.'}
        </p>
        <ol
          className="mt-6 hidden space-y-1 md:block"
          aria-label={group === 'voice' ? 'Étapes de l’assistant vocal' : 'Étapes de Sokar Connect'}
        >
          {groupSteps.map((item) => {
            const current = item.key === key;
            const completed = !current && item.status === 'completed';
            return (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => navigate(item.key)}
                  aria-current={item.key === key ? 'step' : undefined}
                  className={cn(
                    'flex min-h-9 w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left text-sm text-muted-foreground transition-all duration-200 hover:bg-card/60 hover:text-foreground',
                    item.key === key && 'font-semibold text-foreground',
                    completed && 'text-onboarding-complete hover:text-onboarding-complete',
                  )}
                >
                  {completed ? (
                    <Check size={15} className="shrink-0 text-onboarding-complete" />
                  ) : (
                    <Circle
                      size={13}
                      className={cn('shrink-0', current && 'fill-primary text-primary')}
                    />
                  )}
                  {COPY[item.key].label}
                </button>
              </li>
            );
          })}
        </ol>
        {group === 'voice' ? (
          state.voiceOnboardingDone ? (
            <button
              type="button"
              onClick={() => connectTarget && navigate(connectTarget.key)}
              aria-label={
                state.connectOnboardingDone
                  ? 'Revoir Sokar Connect'
                  : 'Continuer vers Sokar Connect'
              }
              className="relative mt-auto border-t border-border pt-5 text-left transition-all duration-200 hover:text-foreground"
            >
              <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {state.connectOnboardingDone ? 'Configuré' : 'Ensuite'}
              </span>
              <span className="mt-1 block font-semibold text-foreground">Sokar Connect</span>
              <span className="mt-1 block pr-7 text-sm leading-5 text-muted-foreground">
                Rendez votre restaurant visible en ligne.
              </span>
              <ArrowRight
                size={16}
                aria-hidden="true"
                className="absolute bottom-1 right-0 text-muted-foreground"
              />
            </button>
          ) : (
            <div
              aria-label="Ensuite : Sokar Connect. Rendez votre restaurant visible en ligne."
              className="mt-auto border-t border-border pt-5 text-muted-foreground"
            >
              <span className="block text-xs font-semibold uppercase tracking-wider">Ensuite</span>
              <span className="mt-1 block font-semibold text-foreground/80">Sokar Connect</span>
              <span className="mt-1 block text-sm leading-5">
                Rendez votre restaurant visible en ligne.
              </span>
            </div>
          )
        ) : (
          <button
            type="button"
            onClick={() => voiceTarget && navigate(voiceTarget.key)}
            aria-label="Revenir au parcours Assistant vocal"
            className="mt-auto border-t border-border pt-5 text-left transition-all duration-200 hover:text-foreground"
          >
            <span className="flex items-center gap-2 font-semibold text-foreground">
              <Check size={15} className="text-success" aria-hidden="true" />
              Assistant vocal
            </span>
            <span className="mt-1 block pl-[23px] text-sm text-muted-foreground">
              Configuré · Revoir le parcours
            </span>
          </button>
        )}
      </aside>
      <section className="flex min-w-0 flex-col md:h-dvh md:min-h-0">
        <header className="shrink-0 px-6 pb-4 pt-6 sm:px-8 md:pb-1 md:pt-7 lg:px-8">
          <p className="text-xs font-medium text-muted-foreground md:hidden">
            {group === 'voice' ? 'Assistant vocal' : 'Sokar Connect'} · Étape {step?.index ?? 1} sur
            5
          </p>
          <h2
            ref={heading}
            tabIndex={-1}
            className="mt-2 text-2xl font-bold tracking-tight outline-none"
          >
            {COPY[key].title}
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">{COPY[key].body}</p>
          <select
            aria-label="Changer d’étape"
            value={key}
            onChange={(event) => navigate(event.target.value as OnboardingTaskKey)}
            className="mt-3 h-11 w-full rounded-lg border border-border bg-background px-3 text-sm md:hidden"
          >
            {groupSteps.map((item) => (
              <option key={item.key} value={item.key}>
                {item.index}. {COPY[item.key].label}
                {item.status === 'completed' ? ' — Terminé' : ''}
              </option>
            ))}
          </select>
        </header>
        <div
          data-inline-onboarding
          className="min-w-0 px-6 pb-5 sm:px-8 md:min-h-0 md:flex-1 md:flex md:flex-col md:justify-start md:overflow-y-auto md:pb-3 md:pt-2 lg:px-8 [&_[data-step-header]]:hidden [&>form]:grid-cols-1 [&>div]:grid-cols-1"
        >
          <Step key={key} onComplete={finish} />
          {error && (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
            >
              La modification n’a pas été enregistrée. Vérifiez vos informations et réessayez.
            </p>
          )}
        </div>
        <footer className="mt-auto flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-3 sm:px-8 md:py-2 lg:px-8">
          {index > 0 && (
            <Button
              variant="ghost"
              onClick={() => navigate(ONBOARDING_TASK_KEYS[index - 1])}
              className="transition-all duration-200"
            >
              <ArrowLeft size={16} />
              Étape précédente
            </Button>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div id="onboarding-step-actions" />
            <div id="connect-step-actions" />
          </div>
        </footer>
      </section>
    </div>
  );
}
