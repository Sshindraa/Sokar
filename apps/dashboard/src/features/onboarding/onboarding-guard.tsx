'use client';

import { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { useOnboarding } from './onboarding-provider';
import type { OnboardingTaskKey } from './types';
import { cn } from '@/lib/utils';

/**
 * Wrapper qui désactive un élément interactif (bouton, toggle) tant que
 * l'étape d'onboarding liée n'est pas complétée. Affiche un tooltip
 * explicatif au survol.
 *
 * Usage :
 * <OnboardingGuard task="restaurant">
 *   <Button onClick={...}>Publier</Button>
 * </OnboardingGuard>
 */
export function OnboardingGuard({
  task,
  children,
  message,
  className,
}: {
  task: OnboardingTaskKey;
  children: ReactNode;
  message?: string;
  className?: string;
}) {
  const { state, openStepModal } = useOnboarding();

  if (!state) return <>{children}</>;

  const step = state.steps.find((s) => s.key === task);
  const isBlocked = step && step.status !== 'completed' && step.status !== 'skipped';

  if (!isBlocked) return <>{children}</>;

  const defaultMessage = `Termine l'étape « ${step?.title} » pour activer cette action`;
  const tooltip = message || defaultMessage;

  return (
    <div
      className={cn('relative inline-flex group', className)}
      title={tooltip}
      aria-label={tooltip}
    >
      {/* Overlay qui bloque les clics */}
      <div className="absolute inset-0 z-10 cursor-not-allowed rounded-[inherit]" />
      {/* Version désactivée de l'enfant */}
      <div className="opacity-50 pointer-events-none select-none [&_button]:pointer-events-none [&_button]:disabled:opacity-60 [&_input]:pointer-events-none [&_label]:pointer-events-none">
        {children}
      </div>
      {/* Badge verrou */}
      <button
        type="button"
        onClick={() => openStepModal(task)}
        className="absolute -top-2 -right-2 z-20 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-lg transition-all duration-200 hover:bg-accent hover:text-foreground"
        title={`Ouvrir l'étape ${step?.title}`}
      >
        <Lock size={12} />
      </button>
    </div>
  );
}

/**
 * Bannière affichée en haut des pages de configuration (agentic, canal-a, settings)
 * pour indiquer que certaines actions sont bloquées par l'onboarding.
 */
export function OnboardingLockBanner({ task }: { task: OnboardingTaskKey }) {
  const { state, openStepModal } = useOnboarding();
  if (!state) return null;

  const step = state.steps.find((s) => s.key === task);
  if (!step || step.status === 'completed' || step.status === 'skipped') return null;

  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm transition-all duration-200">
      <div className="flex items-center gap-2">
        <Lock className="text-amber-400 shrink-0" size={16} />
        <span className="text-amber-200">
          Action bloquée — termine l'étape « {step.title} » pour déverrouiller cette section.
        </span>
      </div>
      <button
        type="button"
        onClick={() => openStepModal(task)}
        className="shrink-0 rounded-md border border-amber-500/40 px-3 py-1 text-xs font-medium text-amber-200 transition-all duration-200 hover:bg-amber-500/20"
      >
        Configurer maintenant
      </button>
    </div>
  );
}
