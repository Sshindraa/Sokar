'use client';

import { useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
} from '@/components/ui/dialog';
import { ArrowLeft } from 'lucide-react';
import { useOnboarding } from './onboarding-provider';
import type { OnboardingTaskKey } from './types';
import { STEP_COMPONENTS, STEP_GROUP_SIZE, STEP_KEYS, STEP_META } from './steps';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { OnboardingNavFooter } from './onboarding-nav-footer';

const CONNECT_STEP_COPY = {
  'connect-identity': {
    title: 'Votre restaurant, en ligne',
    description: 'Personnalisez votre page et découvrez le résultat.',
  },
  'connect-location': {
    title: 'Où se trouve votre restaurant ?',
    description: 'Vérifiez l’adresse qui aidera vos clients à vous trouver près de chez eux.',
  },
  'connect-cuisine': {
    title: 'Votre cuisine et votre ambiance',
    description: 'Ces repères aideront vos clients à savoir si votre restaurant leur correspond.',
  },
  'connect-activation': {
    title: 'Votre page est prête',
    description: 'Prévisualisez-la, puis choisissez si vous souhaitez la publier maintenant.',
  },
} as const;

/**
 * Modal centré qui héberge une étape d'onboarding.
 * Pilote par `activeStep` dans le OnboardingProvider.
 * - L'utilisateur peut fermer (X / Esc / overlay) : closeStepModal()
 * - À la complétion d'une étape, le step appelle onComplete(nextKey|null)
 *   qui ouvre l'étape suivante ou ferme le modal.
 * - Footer de navigation partagé avec la page dédiée via OnboardingNavFooter.
 */
export function OnboardingModal() {
  const { activeStep, openStepModal, closeStepModal, updateTask } = useOnboarding();

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

  const isIdentity = activeStep === 'connect-identity';
  const isConnect = meta?.group === 'connect';
  const connectCopy = activeStep
    ? CONNECT_STEP_COPY[activeStep as keyof typeof CONNECT_STEP_COPY]
    : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        overlayClassName={isConnect ? 'bg-foreground/40 backdrop-blur-[2px]' : undefined}
        className={cn(
          'flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-3xl flex-col overflow-hidden p-0',
          isConnect &&
            'max-w-5xl md:[&:has([data-review=true])]:max-w-3xl md:[&:has([data-wide-review=true])]:max-w-5xl md:max-h-[calc(100dvh-2rem)] md:gap-0',
          isIdentity && 'md:[&:has([data-review=true])]:max-w-xl',
        )}
      >
        <DialogHeader
          className={cn(
            'shrink-0 border-b border-border px-6 pb-5 pt-6 text-left sm:px-8',
            isConnect && 'md:py-[clamp(8px,calc((100dvh_-_600px)/10_+_8px),20px)]',
          )}
        >
          <DialogTitle className="flex items-center gap-2">
            {meta && (
              <span className="shrink-0 whitespace-nowrap rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-primary">
                {meta.group === 'voice' ? 'Votre restaurant' : 'Connect'} · {meta.index}/
                {STEP_GROUP_SIZE[meta.group]}
              </span>
            )}
            {connectCopy?.title ?? meta?.title ?? 'Mise en service'}
          </DialogTitle>
          <DialogDescription>
            {connectCopy?.description ?? 'Configurez votre restaurant, une étape à la fois.'}
          </DialogDescription>
          {meta && (
            <div
              className={cn('flex gap-1.5 pt-3', isConnect && 'md:pt-1')}
              aria-label={`Étape ${meta.index} sur 5`}
            >
              {Array.from({ length: 5 }, (_, index) => (
                <span
                  key={index}
                  className={cn(
                    'h-1 flex-1 rounded-full bg-muted',
                    index < meta.index && 'bg-primary',
                  )}
                />
              ))}
            </div>
          )}
        </DialogHeader>

        {StepComponent && activeStep && (
          <div
            data-onboarding-body
            className={cn(
              'min-h-0 overflow-y-auto px-6 py-6 sm:px-8',
              isConnect && 'md:py-[clamp(8px,calc((100dvh_-_600px)/10_+_8px),20px)]',
            )}
          >
            <StepComponent onComplete={handleComplete} />
          </div>
        )}

        {isConnect ? (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-background px-6 py-4 sm:px-8 md:py-[clamp(8px,calc((100dvh_-_600px)/15_+_8px),16px)]">
            <div className="flex flex-wrap items-center gap-1">
              {activeStep !== 'connect-identity' && prev && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handlePrev}
                  className="gap-2 transition-all duration-200"
                >
                  <ArrowLeft size={16} />
                  Étape précédente
                </Button>
              )}
            </div>
            <div id="connect-step-actions" className="flex items-center justify-end" />
          </div>
        ) : (
          <div className="shrink-0 px-6 pb-4 sm:px-8">
            <OnboardingNavFooter
              currentStep={activeStep ?? 'restaurant'}
              onPrev={prev ? handlePrev : null}
              onNext={next ? handleNext : null}
              onExit={closeStepModal}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
