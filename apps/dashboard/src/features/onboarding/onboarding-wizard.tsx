'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, Globe, LockKeyhole } from 'lucide-react';
import { SokarLogo } from '@/components/SokarLogo';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ChoiceSelect } from './choice-select';
import { useOnboarding } from './onboarding-provider';
import { STEP_COMPONENTS } from './steps';
import styles from './onboarding-atmosphere.module.css';
import {
  ONBOARDING_TASK_KEYS,
  getVisibleOnboardingState,
  resolveOnboardingTask,
  type OnboardingTaskKey,
} from './types';

const COPY: Record<OnboardingTaskKey, { title: string; body: string; label: string }> = {
  restaurant: {
    title: 'Commençons par votre restaurant',
    body: 'Retrouvez votre fiche, puis complétez vos coordonnées.',
    label: 'Votre restaurant',
  },
  hours: {
    title: 'Vos horaires de réservation',
    body: 'Choisissez la dernière arrivée acceptée pour chaque service.',
    label: 'Vos horaires',
  },
  floor: {
    title: 'Votre salle, vos règles',
    body: 'Ajoutez vos tables et fixez la taille des groupes.',
    label: 'Salle et règles',
  },
  knowledge: {
    title: 'La voix de votre restaurant',
    body: 'Choisissez le ton, ajoutez vos consignes, puis écoutez un appel.',
    label: 'Consignes & démo',
  },
  phone: {
    title: 'Votre accueil au téléphone',
    body: 'Préparez le renvoi et vérifiez la réception d’un appel.',
    label: 'Appels',
  },
  channels: {
    title: 'Présentez votre restaurant',
    body: 'Créez votre page de réservation.',
    label: 'Sokar Connect',
  },
  'connect-identity': {
    title: 'Votre restaurant, en ligne',
    body: 'Personnalisez votre page et découvrez le résultat.',
    label: 'Votre page',
  },
  'connect-location': {
    title: 'Aidez vos clients à vous trouver',
    body: 'Vérifiez votre adresse sur la carte.',
    label: 'Votre adresse',
  },
  'connect-cuisine': {
    title: 'Qu’est-ce qui vous distingue ?',
    body: 'Précisez votre cuisine, votre ambiance et vos services.',
    label: 'Cuisine et ambiance',
  },
  'connect-activation': {
    title: 'Publiez votre page',
    body: 'Vérifiez votre page, puis publiez-la.',
    label: 'Publication',
  },
};

const STEP_HINTS: Partial<Record<OnboardingTaskKey, string>> = {
  restaurant: 'Vos coordonnées',
  hours: 'Dernières arrivées',
  floor: 'Tables et conditions',
  knowledge: 'Voix et personnalité',
  phone: 'Renvoi et appel test',
  'connect-identity': 'Personnalisation et aperçu',
  'connect-location': 'Adresse et localisation',
  'connect-cuisine': 'Cuisine et services',
  'connect-activation': 'Aperçu et mise en ligne',
};

export function OnboardingWizard({ footerControls }: { footerControls?: ReactNode }) {
  const { state, updateTask, error } = useOnboarding();
  const [selected, setSelected] = useState<OnboardingTaskKey | null>(null);
  const [requestedStepLoaded, setRequestedStepLoaded] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const visibleSteps = state ? getVisibleOnboardingState(state).steps : [];
  const initial =
    visibleSteps.find((step) => step.status === 'current' || step.status === 'pending') ??
    visibleSteps.find((step) => step.status !== 'completed');
  const key = selected ?? initial?.key ?? 'restaurant';
  const step = visibleSteps.find((item) => item.key === key);
  const group = step?.group ?? 'voice';
  const voiceSteps = visibleSteps.filter((item) => item.group === 'voice');
  const connectSteps = visibleSteps.filter((item) => item.group === 'connect');
  const groupSteps = group === 'voice' ? voiceSteps : connectSteps;
  const groupPosition = Math.max(1, groupSteps.findIndex((item) => item.key === key) + 1);
  const voiceTarget = voiceSteps.find((item) => item.status !== 'completed') ?? voiceSteps[0];
  const connectTarget = connectSteps.find((item) => item.status !== 'completed') ?? connectSteps[0];
  const index = ONBOARDING_TASK_KEYS.indexOf(key);
  const Step = STEP_COMPONENTS[key];

  // Les liens directs et les anciennes URL d’étapes rejoignent le même parcours.
  useEffect(() => {
    const legacy = new URLSearchParams(window.location.search).get('step');
    const target = resolveOnboardingTask(legacy);
    if (target) setSelected(target);
    setRequestedStepLoaded(true);
  }, []);

  useEffect(() => {
    if (!requestedStepLoaded) return;
    void updateTask('start', key);
    // Mark only a navigation change, not each state refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, requestedStepLoaded]);

  function navigate(target: OnboardingTaskKey) {
    setSelected(target);
    requestAnimationFrame(() => {
      if (content.current) content.current.scrollTop = 0;
      heading.current?.focus();
    });
  }

  function finish(next: OnboardingTaskKey | null) {
    const remaining = visibleSteps.find((item) => item.key !== key && item.status !== 'completed');
    if (next) navigate(next);
    else if (remaining) navigate(remaining.key);
  }

  if (!state) return null;

  const completedInGroup = groupSteps.filter((item) => item.status === 'completed').length;

  return (
    <div
      data-onboarding-ui
      className="min-h-screen bg-background md:grid md:h-dvh md:min-h-0 md:grid-cols-[230px_minmax(0,1fr)] lg:grid-cols-[250px_minmax(0,1fr)]"
    >
      <aside
        className="relative flex flex-col gap-5 overflow-hidden bg-background px-5 py-4 text-foreground md:min-h-0 md:gap-5 md:overflow-y-auto md:p-6 lg:px-7 lg:py-8"
        aria-label="Votre parcours de mise en service"
      >
        <div className="flex items-center gap-2.5">
          <SokarLogo className="size-8 text-foreground" />
          <span className="text-lg font-semibold tracking-tight">Sokar</span>
        </div>
        <p className="text-xs text-foreground/70 md:hidden">
          {group === 'voice'
            ? 'Vos réservations, puis Sokar Connect.'
            : 'Sokar Connect · Votre page de réservation'}
        </p>
        <div className="relative hidden md:block">
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-foreground/60">
            {group === 'voice' ? '01 / Vos réservations' : '02 / Sokar Connect'}
          </p>
          <h1 className="mt-4 max-w-52 text-lg font-medium leading-tight tracking-tight">
            {group === 'voice' ? 'Votre accueil, à votre image.' : 'Votre maison, en ligne.'}
          </h1>
          <div className="mt-4 flex items-center justify-between text-xs text-foreground/60">
            <span>
              {completedInGroup} terminée{completedInGroup !== 1 ? 's' : ''}
            </span>
            <span
              aria-label={`Étape ${groupPosition} sur ${groupSteps.length}`}
              className="font-medium text-foreground"
            >
              {groupPosition} sur {groupSteps.length}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Progression du parcours"
            aria-valuemin={0}
            aria-valuemax={groupSteps.length}
            aria-valuenow={completedInGroup}
            className="mt-3 h-0.5 overflow-hidden rounded-full bg-foreground/15"
          >
            <div
              className="h-full rounded-full bg-foreground transition-all duration-200"
              style={{
                width: `${groupSteps.length ? (completedInGroup / groupSteps.length) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
        <ol
          className="relative hidden space-y-2 md:block"
          aria-label={group === 'voice' ? 'Étapes de vos réservations' : 'Étapes de Sokar Connect'}
        >
          {groupSteps.map((item, position) => {
            const current = item.key === key;
            const completed = item.status === 'completed';
            return (
              <li key={item.key}>
                <button
                  type="button"
                  aria-label={COPY[item.key].label}
                  onClick={() => navigate(item.key)}
                  aria-current={current ? 'step' : undefined}
                  className={cn(
                    'group flex min-h-12 w-full items-center gap-3 rounded-full px-3 py-2.5 text-left text-sm transition-all duration-200 hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground',
                    current ? 'bg-foreground/10 text-foreground' : 'text-foreground/65',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-medium',
                      current
                        ? 'bg-foreground text-background'
                        : completed
                          ? 'bg-foreground/10 text-foreground'
                          : 'text-foreground/65',
                    )}
                  >
                    {completed && !current ? <Check size={13} /> : position + 1}
                  </span>
                  <span className="min-w-0">
                    <span className={cn('block', current && 'font-semibold')}>
                      {COPY[item.key].label}
                    </span>
                    {current && (
                      <span className="mt-1 block text-xs font-normal text-foreground/60">
                        {STEP_HINTS[item.key]}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="hidden md:mt-auto md:block">
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
                className="group flex w-full items-start gap-3 rounded-[1.75rem] bg-muted/50 p-4 text-left transition-all duration-200 hover:bg-foreground/10"
              >
                <Globe
                  size={18}
                  className="mt-0.5 shrink-0 text-foreground/65"
                  aria-hidden="true"
                />
                <span className="flex-1">
                  <span className="block text-sm font-semibold">Sokar Connect</span>
                  <span className="mt-1 block text-xs leading-5 text-foreground/65">
                    {state.connectOnboardingDone
                      ? 'Revoir votre page en ligne'
                      : 'Créer votre page de réservation'}
                  </span>
                </span>
                <ArrowRight
                  size={15}
                  aria-hidden="true"
                  className="mt-1 shrink-0 text-foreground/65"
                />
              </button>
            ) : (
              <div
                role="group"
                aria-label="Sokar Connect, disponible après le parcours Vos réservations"
                className="flex items-start gap-3 rounded-[1.75rem] bg-muted/50 p-4"
              >
                <Globe
                  size={18}
                  className="mt-0.5 shrink-0 text-foreground/65"
                  aria-hidden="true"
                />
                <div>
                  <p className="text-sm font-semibold">Sokar Connect</p>
                  <p className="mt-1 text-xs leading-5 text-foreground/65">
                    Votre page de réservation.
                  </p>
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] text-foreground/65">
                    <LockKeyhole size={11} aria-hidden="true" /> Prochaine partie
                  </p>
                </div>
              </div>
            )
          ) : (
            <button
              type="button"
              onClick={() => voiceTarget && navigate(voiceTarget.key)}
              aria-label="Revenir au parcours Vos réservations"
              className="flex w-full items-start gap-3 rounded-[1.75rem] bg-muted/50 p-4 text-left transition-all duration-200 hover:bg-foreground/10"
            >
              <ArrowLeft
                size={17}
                className="mt-0.5 shrink-0 text-foreground/65"
                aria-hidden="true"
              />
              <span>
                <span className="block text-sm font-semibold">Vos réservations</span>
                <span className="mt-1 block text-xs leading-5 text-foreground/65">
                  {state.voiceOnboardingDone
                    ? 'Configuré · Revoir vos réglages'
                    : 'En cours · Revoir vos réglages'}
                </span>
              </span>
            </button>
          )}
        </div>
        {footerControls && <div className="hidden shrink-0 md:flex">{footerControls}</div>}
      </aside>
      <section className="relative flex min-w-0 flex-col bg-background md:h-dvh md:min-h-0 md:overflow-hidden">
        <header className="relative shrink-0 px-6 pb-5 pt-6 lg:px-8">
          <div className="relative w-full">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute right-0 top-7 hidden lg:block"
            >
              <div className={cn(styles.orb, styles.headerOrb)} />
            </div>
            <p className="pr-10 text-[11px] font-medium uppercase leading-5 tracking-[0.18em] text-muted-foreground">
              <span className="inline-flex items-center gap-2 whitespace-nowrap">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />
                {group === 'voice' ? 'Vos réservations' : 'Sokar Connect'}
              </span>{' '}
              <span aria-hidden="true" className="px-1.5 text-muted-foreground/50">
                /
              </span>{' '}
              <span className="whitespace-nowrap">
                Étape {groupPosition} sur {groupSteps.length}
              </span>
            </p>
            <h2
              ref={heading}
              tabIndex={-1}
              className="relative mt-3 max-w-3xl pr-5 text-[1.625rem] font-semibold leading-tight tracking-[-0.035em] outline-none sm:text-3xl lg:pr-20 lg:text-[2rem]"
            >
              {COPY[key].title}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              {COPY[key].body}
            </p>
            <ChoiceSelect
              label="Changer d’étape"
              value={key}
              onChange={(selected) => navigate(selected as OnboardingTaskKey)}
              options={groupSteps.map((item, position) => ({
                value: item.key,
                label: `${position + 1}. ${COPY[item.key].label}${item.status === 'completed' ? ' — Terminé' : ''}`,
              }))}
              triggerClassName="mt-4 h-11 w-full rounded-xl bg-card md:hidden"
              contentClassName="w-[min(22rem,calc(100vw-2rem))]"
            />
          </div>
        </header>
        <div
          ref={content}
          className="min-w-0 px-6 pb-6 md:flex md:min-h-0 md:flex-1 md:overflow-y-auto lg:px-8"
        >
          <div
            data-inline-onboarding
            data-onboarding-step={key}
            className="w-full min-w-0 [&_[data-review]]:max-w-none [&_[data-step-header]]:hidden md:flex md:min-h-0 md:flex-1 md:flex-col"
          >
            <Step key={key} onComplete={finish} onNavigate={navigate} />
            {error && (
              <p
                role="alert"
                className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
              >
                La modification n’a pas été enregistrée. Vérifiez vos informations et réessayez.
              </p>
            )}
          </div>
        </div>
        <footer className="mt-auto shrink-0 bg-background px-6 py-3 lg:px-8 [&_button]:h-11 [&_button]:rounded-full">
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            {footerControls && <div className="mr-auto md:hidden">{footerControls}</div>}
            {index > 0 ? (
              <Button
                variant="ghost"
                onClick={() => navigate(ONBOARDING_TASK_KEYS[index - 1])}
                className="h-11 rounded-xl text-muted-foreground transition-all duration-200"
              >
                <ArrowLeft size={16} /> Étape précédente
              </Button>
            ) : (
              <p className="hidden text-xs text-muted-foreground sm:block">
                Vos réglages restent modifiables.
              </p>
            )}
            <div className="ml-auto flex min-h-11 max-w-full flex-wrap items-center gap-2">
              <div id="onboarding-step-actions" />
              <div id="connect-step-actions" />
            </div>
          </div>
        </footer>
      </section>
    </div>
  );
}
