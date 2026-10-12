'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, LockKeyhole } from 'lucide-react';
import { SokarLogo } from '@/components/SokarLogo';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ChoiceSelect } from './choice-select';
import { OnboardingChannels } from './onboarding-channels';
import { useOnboarding } from './onboarding-provider';
import { STEP_COMPONENTS } from './steps';
import {
  CHANNELS_VIEW,
  TRACK_STEPS,
  isChannelsView,
  resolveOnboardingView,
  resumeView,
  trackOf,
  trackProgress,
  type OnboardingTrack,
  type OnboardingView,
} from './tracks';
import { getVisibleOnboardingState, type OnboardingTaskKey } from './types';

const COPY: Record<OnboardingTaskKey, { title: string; body: string; label: string }> = {
  restaurant: {
    title: 'Commençons par votre restaurant',
    body: 'Retrouvez votre fiche, puis complétez vos coordonnées.',
    label: 'Votre restaurant',
  },
  hours: {
    title: 'Vos horaires de réservation',
    body: 'Réglez chaque service une fois : le choix s’applique aux jours ouverts.',
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

const CHANNELS_COPY = {
  title: 'Choisissez vos canaux',
  body: 'Votre salle est prête. Activez le téléphone et la réservation en ligne, dans l’ordre de votre choix.',
  label: 'Vos canaux',
};

const TRACK_COPY: Record<
  OnboardingTrack | typeof CHANNELS_VIEW,
  { eyebrow: string; heading: string; mobile: string; label: string }
> = {
  socle: {
    eyebrow: 'Étape 1 · Votre salle',
    heading: 'Configurez votre salle',
    mobile: 'Votre salle, puis vos canaux de réservation.',
    label: 'Votre salle',
  },
  canaux: {
    eyebrow: 'Étape 2 · Vos canaux',
    heading: 'Ouvrez vos réservations',
    mobile: 'Téléphone et réservation en ligne, dans l’ordre de votre choix.',
    label: 'Vos canaux',
  },
  phone: {
    eyebrow: 'Canal · Téléphone',
    heading: 'Activez vos appels',
    mobile: 'Canal téléphone · Votre agent vocal',
    label: 'Téléphone',
  },
  online: {
    eyebrow: 'Canal · En ligne',
    heading: 'Ouvrez la réservation en ligne',
    mobile: 'Canal en ligne · Page, site et assistants IA',
    label: 'En ligne',
  },
};

type NavItem = {
  id: OnboardingView;
  label: string;
  hint?: string;
  completed: boolean;
  current: boolean;
};

export function OnboardingWizard({ footerControls }: { footerControls?: ReactNode }) {
  const { state, updateTask, error } = useOnboarding();
  const [selected, setSelected] = useState<OnboardingView | null>(null);
  const [requestedStepLoaded, setRequestedStepLoaded] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const visibleSteps = state ? getVisibleOnboardingState(state).steps : [];
  const socle = trackProgress(visibleSteps, 'socle');
  // Les canaux puisent dans la salle : leur écran et leurs étapes restent fermés tant qu'elle
  // n'est pas prête, y compris par lien direct ou par le bouton Retour.
  const requested = selected ?? resumeView(visibleSteps);
  const redirected =
    Boolean(state) && !socle.done && (isChannelsView(requested) || trackOf(requested) !== 'socle');
  const view: OnboardingView = redirected ? socle.target : requested;
  const channels = isChannelsView(view);
  const key: OnboardingTaskKey | null = channels ? null : view;
  const track: OnboardingTrack | null = key ? trackOf(key) : null;
  const phone = trackProgress(visibleSteps, 'phone');
  const online = trackProgress(visibleSteps, 'online');
  const groupSteps = track ? trackProgress(visibleSteps, track).steps : [];
  const trackIndex = key && track ? TRACK_STEPS[track].indexOf(key) : -1;
  const copy = TRACK_COPY[track ?? CHANNELS_VIEW];
  const Step = key ? STEP_COMPONENTS[key] : null;

  // Les liens directs et les anciennes URL d’étapes rejoignent le même parcours.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('step');
    const target = resolveOnboardingView(requested);
    if (target) setSelected(target);
    setRequestedStepLoaded(true);
  }, []);

  // L'adresse suit l'étape affichée : un rechargement ou un lien copié rouvre la bonne étape, et
  // chaque changement d'étape ajoute une entrée d'historique pour que Retour remonte une à une.
  // La première écriture (étape de reprise, ancien nom d'étape) remplace l'adresse d'arrivée, tout
  // comme une étape fermée remplacée par la salle : l'étape refusée ne reste pas dans l'historique.
  const historySynced = useRef(false);
  const ready = requestedStepLoaded && Boolean(state);
  useEffect(() => {
    if (!ready) return;
    const url = new URL(window.location.href);
    const first = !historySynced.current;
    historySynced.current = true;
    // Déjà à jour : premier affichage d'un lien direct, ou retour arrière qui vient d'ouvrir l'étape.
    if (url.searchParams.get('step') === view) return;
    url.searchParams.set('step', view);
    if (first || redirected) window.history.replaceState(window.history.state, '', url);
    else window.history.pushState(null, '', url);
  }, [view, ready, redirected]);

  // Retour / Suivant du navigateur : l'étape suit l'adresse.
  useEffect(() => {
    function handlePopState() {
      const target = resolveOnboardingView(new URLSearchParams(window.location.search).get('step'));
      if (!target) return;
      setSelected(target);
      requestAnimationFrame(() => {
        if (content.current) content.current.scrollTop = 0;
        heading.current?.focus();
      });
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // L'écran des canaux n'est pas une tâche : seule une vraie étape est marquée commencée.
  useEffect(() => {
    if (!requestedStepLoaded || !key) return;
    void updateTask('start', key);
    // Mark only a navigation change, not each state refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, requestedStepLoaded]);

  function navigate(target: OnboardingView) {
    setSelected(target);
    requestAnimationFrame(() => {
      if (content.current) content.current.scrollTop = 0;
      heading.current?.focus();
    });
  }

  // Une étape terminée enchaîne dans son parcours ; la fin d'un parcours ramène aux canaux, même
  // si l'étape proposait une étape d'un autre parcours (ex. Salle et règles → Consignes & démo).
  function finish(next: OnboardingTaskKey | null) {
    if (!key || !track) return;
    if (next && trackOf(next) === track) return navigate(next);
    const remaining = groupSteps.find((item) => item.key !== key && item.status !== 'completed');
    navigate(remaining?.key ?? CHANNELS_VIEW);
  }

  if (!state) return null;

  const navItems: NavItem[] = track
    ? groupSteps.map((item) => ({
        id: item.key,
        label: COPY[item.key].label,
        hint: STEP_HINTS[item.key],
        completed: item.status === 'completed',
        current: item.key === key,
      }))
    : [
        { id: socle.target, label: TRACK_COPY.socle.label, completed: socle.done, current: false },
        { id: phone.target, label: TRACK_COPY.phone.label, completed: phone.done, current: false },
        {
          id: online.target,
          label: TRACK_COPY.online.label,
          completed: online.done,
          current: false,
        },
      ];
  const progressTotal = track ? groupSteps.length : 2;
  const progressDone = track
    ? groupSteps.filter((item) => item.status === 'completed').length
    : [phone, online].filter((progress) => progress.done).length;
  const previous: { view: OnboardingView; label: string } | null =
    track && trackIndex > 0
      ? { view: TRACK_STEPS[track][trackIndex - 1], label: 'Étape précédente' }
      : track && track !== 'socle'
        ? { view: CHANNELS_VIEW, label: 'Vos canaux' }
        : channels
          ? { view: 'floor', label: 'Étape précédente' }
          : null;
  const mobileOptions = [
    ...(channels || socle.done ? [{ value: CHANNELS_VIEW, label: CHANNELS_COPY.label }] : []),
    ...navItems.map((item, position) => ({
      value: item.id,
      label: `${track ? `${position + 1}. ` : ''}${item.label}${item.completed ? ' — Terminé' : ''}`,
    })),
  ];
  const title = key ? COPY[key].title : CHANNELS_COPY.title;
  const body = key ? COPY[key].body : CHANNELS_COPY.body;

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
        <p className="text-xs text-foreground/70 md:hidden">{copy.mobile}</p>
        <div className="relative hidden md:block">
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-foreground/60">
            {copy.eyebrow}
          </p>
          <h1 className="mt-4 max-w-52 text-lg font-medium leading-tight tracking-tight">
            {copy.heading}
          </h1>
          <p className="mt-4 text-xs text-muted-foreground">
            {progressDone}/{progressTotal} {track ? 'étapes terminées' : 'canaux prêts'}
          </p>
          <div
            role="progressbar"
            aria-label="Progression du parcours"
            aria-valuemin={0}
            aria-valuemax={progressTotal}
            aria-valuenow={progressDone}
            className="mt-3 h-0.5 overflow-hidden rounded-full bg-foreground/15"
          >
            <div
              className="h-full rounded-full bg-foreground transition-all duration-200"
              style={{ width: `${progressTotal ? (progressDone / progressTotal) * 100 : 0}%` }}
            />
          </div>
        </div>
        <ol
          className="relative hidden space-y-2 md:block"
          aria-label={track ? `Étapes : ${copy.label}` : 'Votre salle et vos canaux'}
        >
          {navItems.map((item, position) => (
            <li key={`${item.label}-${item.id}`}>
              <button
                type="button"
                aria-label={item.label}
                onClick={() => navigate(item.id)}
                aria-current={item.current ? 'step' : undefined}
                className={cn(
                  'group flex min-h-12 w-full items-center gap-3 rounded-full px-3 py-2.5 text-left text-sm transition-all duration-200 hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground',
                  item.current ? 'bg-foreground/10 text-foreground' : 'text-foreground/65',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-medium',
                    item.current
                      ? 'bg-foreground text-background'
                      : item.completed
                        ? 'bg-foreground/10 text-foreground'
                        : 'text-foreground/65',
                  )}
                >
                  {item.completed && !item.current ? <Check size={13} /> : position + 1}
                </span>
                <span className="min-w-0">
                  <span className={cn('block', item.current && 'font-semibold')}>{item.label}</span>
                  {item.current && item.hint && (
                    <span className="mt-1 block text-xs font-normal text-foreground/60">
                      {item.hint}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ol>
        {track && (
          <div className="hidden md:mt-auto md:block">
            {socle.done ? (
              <button
                type="button"
                onClick={() => navigate(CHANNELS_VIEW)}
                aria-label={
                  track === 'socle' ? 'Continuer vers vos canaux' : 'Revenir à vos canaux'
                }
                className="group flex w-full items-start gap-3 rounded-[1.75rem] bg-muted/50 p-4 text-left transition-all duration-200 hover:bg-foreground/10"
              >
                {track !== 'socle' && (
                  <ArrowLeft
                    size={17}
                    className="mt-0.5 shrink-0 text-foreground/65"
                    aria-hidden="true"
                  />
                )}
                <span className="flex-1">
                  <span className="block text-sm font-semibold">Vos canaux</span>
                  <span className="mt-1 block text-xs leading-5 text-foreground/65">
                    Téléphone {phone.done ? 'prêt' : 'à activer'} · En ligne{' '}
                    {online.done ? 'prêt' : 'à activer'}
                  </span>
                </span>
                {track === 'socle' && (
                  <ArrowRight
                    size={15}
                    aria-hidden="true"
                    className="mt-1 shrink-0 text-foreground/65"
                  />
                )}
              </button>
            ) : (
              <div
                role="group"
                aria-label="Vos canaux"
                className="flex items-start gap-3 rounded-[1.75rem] bg-muted/50 p-4"
              >
                <LockKeyhole
                  size={18}
                  className="mt-0.5 shrink-0 text-foreground/65"
                  aria-hidden="true"
                />
                <div>
                  <p className="text-sm font-semibold">Vos canaux</p>
                  <p className="mt-1 text-xs leading-5 text-foreground/65">
                    Téléphone et réservation en ligne, une fois votre salle prête.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
        {footerControls && (
          <div className={cn('hidden shrink-0 md:flex', !track && 'md:mt-auto')}>
            {footerControls}
          </div>
        )}
      </aside>
      <section className="relative flex min-w-0 flex-col bg-background md:h-dvh md:min-h-0 md:overflow-hidden">
        <header className="relative shrink-0 px-6 pb-5 pt-6 lg:px-8">
          <div className="relative w-full">
            <h2
              ref={heading}
              tabIndex={-1}
              className="relative max-w-3xl pr-5 text-[1.625rem] font-semibold leading-tight tracking-[-0.035em] outline-none sm:text-3xl lg:text-[2rem]"
            >
              {title}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{body}</p>
            <ChoiceSelect
              label="Changer d’étape"
              value={view}
              onChange={(selected) => navigate(selected as OnboardingView)}
              options={mobileOptions}
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
            data-onboarding-step={view}
            className="w-full min-w-0 [&_[data-review]]:max-w-none [&_[data-step-header]]:hidden md:flex md:min-h-0 md:flex-1 md:flex-col"
          >
            {Step && key ? (
              <Step key={key} onComplete={finish} onNavigate={navigate} />
            ) : (
              <OnboardingChannels
                steps={visibleSteps}
                readiness={state.readiness}
                onOpen={navigate}
              />
            )}
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
            {previous ? (
              <Button
                variant="ghost"
                onClick={() => navigate(previous.view)}
                className="h-11 rounded-xl text-muted-foreground transition-all duration-200"
              >
                <ArrowLeft size={16} /> {previous.label}
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
