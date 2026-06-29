'use client';

import { useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
} from '@/components/ui/dialog';
import { useOnboarding } from './onboarding-provider';
import type { OnboardingTaskKey } from './types';
import { STEP_COMPONENTS, STEP_KEYS, STEP_META } from './steps';
import { OnboardingNavFooter } from './onboarding-nav-footer';

/**
 * Modal centré qui héberge une étape d'onboarding.
 * Pilote par `activeStep` dans le OnboardingProvider.
 * - L'utilisateur peut fermer (X / Esc / overlay) : closeStepModal()
 * - À la complétion d'une étape, le step appelle onComplete(nextKey|null)
 *   qui ouvre l'étape suivante ou ferme le modal.
 * - Footer de navigation partagé avec la page dédiée via OnboardingNavFooter.
 */
export function OnboardingModal() {
  const { state, activeStep, openStepModal, closeStepModal, updateTask } = useOnboarding();

  const open = Boolean(activeStep);

  // Calcule prev/next pour la navigation du footer
  const { prev, next } = useMemo(() => {
    if (!activeStep) return { prev: null, next: null };
    const idx = STEP_KEYS.indexOf(activeStep);
    return {
      prev: idx > 0 ? STEP_KEYS[idx - 1] : null,
      next: idx < STEP_KEYS.length - 1 ? STEP_KEYS[idx + 1] : null,
    };
  }, [activeStep]);

  // Marque l'étape comme "start" à l'ouverture (côté API + state local)
  useEffect(() => {
    if (activeStep) {
      void updateTask('start', activeStep);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStep]);

  const StepComponent = activeStep ? STEP_COMPONENTS[activeStep] : null;
  const meta = activeStep ? STEP_META[activeStep] : null;

  const handleComplete = (nextStep: OnboardingTaskKey | null) => {
    if (nextStep) {
      openStepModal(nextStep);
    } else {
      closeStepModal();
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) closeStepModal();
  };

  const handlePrev = () => {
    if (prev) openStepModal(prev);
  };

  const handleNext = () => {
    if (next) openStepModal(next);
  };

  const completedCount = state?.completedCount ?? 0;
  const totalCount = state?.totalCount ?? STEP_KEYS.length;
  const progress = state?.progress ?? 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {meta && (
              <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-primary">
                {meta.group === 'voice' ? 'Voice' : 'Connect'} · {meta.index}/5
              </span>
            )}
            {meta?.title ?? 'Mise en service'}
          </DialogTitle>
        </DialogHeader>

        {StepComponent && activeStep && (
          <div className="pt-2">
            <StepComponent onComplete={handleComplete} />
          </div>
        )}

        <OnboardingNavFooter
          currentStep={activeStep ?? 'restaurant'}
          onPrev={prev ? handlePrev : null}
          onNext={next ? handleNext : null}
          onExit={closeStepModal}
          completedCount={completedCount}
          totalCount={totalCount}
          progress={progress}
        />
      </DialogContent>
    </Dialog>
  );
}
