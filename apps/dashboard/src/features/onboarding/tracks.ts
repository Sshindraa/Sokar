import { resolveOnboardingTask, type OnboardingStep, type OnboardingTaskKey } from './types';

/**
 * Parcours affichés. Le socle (la salle) se règle une fois et sert à tous les canaux ; chaque
 * canal se configure ensuite dans l'ordre choisi depuis l'écran « Vos canaux ». L'API garde ses
 * groupes historiques `voice` / `connect` : ce découpage n'existe que côté dashboard.
 */
export type OnboardingTrack = 'socle' | 'phone' | 'online';

export const TRACK_STEPS: Record<OnboardingTrack, OnboardingTaskKey[]> = {
  socle: ['restaurant', 'hours', 'floor'],
  phone: ['knowledge', 'phone'],
  online: ['connect-identity', 'connect-activation'],
};

export const CHANNEL_TRACKS = ['phone', 'online'] as const satisfies readonly OnboardingTrack[];

/** Écran « Vos canaux » : une vue du parcours, pas une tâche d'onboarding côté API. */
export const CHANNELS_VIEW = 'canaux';

export type OnboardingView = OnboardingTaskKey | typeof CHANNELS_VIEW;

export function isChannelsView(view: OnboardingView): view is typeof CHANNELS_VIEW {
  return view === CHANNELS_VIEW;
}

export function trackOf(key: OnboardingTaskKey): OnboardingTrack {
  if (TRACK_STEPS.phone.includes(key)) return 'phone';
  if (TRACK_STEPS.online.includes(key) || resolveOnboardingTask(key) === 'connect-identity')
    return 'online';
  return 'socle';
}

/** Une étape de l'URL, l'écran des canaux, ou rien si le paramètre est inconnu. */
export function resolveOnboardingView(value: string | null): OnboardingView | undefined {
  if (value === CHANNELS_VIEW) return CHANNELS_VIEW;
  return resolveOnboardingTask(value);
}

export function trackSteps(steps: OnboardingStep[], track: OnboardingTrack): OnboardingStep[] {
  return TRACK_STEPS[track]
    .map((key) => steps.find((step) => step.key === key))
    .filter((step): step is OnboardingStep => Boolean(step));
}

export type TrackProgress = {
  steps: OnboardingStep[];
  completed: number;
  done: boolean;
  /** Première étape à faire, ou la première étape quand tout est terminé (pour « Revoir »). */
  target: OnboardingTaskKey;
};

export function trackProgress(steps: OnboardingStep[], track: OnboardingTrack): TrackProgress {
  const items = trackSteps(steps, track);
  const completed = items.filter((step) => step.status === 'completed').length;
  const next = items.find((step) => step.status !== 'completed');
  return {
    steps: items,
    completed,
    done: items.length > 0 && completed === items.length,
    target: next?.key ?? items[0]?.key ?? TRACK_STEPS[track][0],
  };
}

/**
 * Où reprendre sans étape dans l'URL : la salle tant qu'elle n'est pas prête, puis un canal
 * commencé et non terminé, sinon l'écran des canaux pour choisir le suivant.
 */
export function resumeView(steps: OnboardingStep[]): OnboardingView {
  const socle = trackProgress(steps, 'socle');
  if (!socle.done) return socle.target;
  for (const track of CHANNEL_TRACKS) {
    const progress = trackProgress(steps, track);
    if (progress.completed > 0 && !progress.done) return progress.target;
  }
  return CHANNELS_VIEW;
}
