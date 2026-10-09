'use client';

import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { STEP_KEYS } from './steps';
import type { OnboardingTaskKey } from './types';

const NEXT_STEP_LABEL: Record<OnboardingTaskKey, string> = {
  restaurant: 'votre restaurant',
  hours: 'les horaires',
  floor: 'votre salle et vos règles',
  knowledge: 'les consignes de l’assistant',
  phone: 'les appels',
  channels: 'vos canaux de réservation',
  'connect-identity': 'Sokar Connect',
  'connect-location': 'votre adresse',
  'connect-cuisine': 'la cuisine et l’ambiance',
  'connect-activation': 'la publication',
};

/**
 * Footer de navigation partagé entre la page dédiée (/onboarding/[step])
 * et le modal in-dashboard. Garantit une navigation cohérente quel que soit le point d'entrée.
 *
 * @param currentStep  étape actuellement affichée
 * @param onPrev       callback pour aller à l'étape précédente (ou null si désactivé)
 * @param onNext       callback pour aller à l'étape suivante (ou null si désactivé)
 * @param onExit       callback optionnel pour revenir au dashboard
 */
export function OnboardingNavFooter({
  currentStep,
  onPrev,
  onNext,
  onExit,
}: {
  currentStep: OnboardingTaskKey;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onExit?: () => void;
}) {
  const idx = STEP_KEYS.indexOf(currentStep);
  const hasPrev = idx > 0;
  const hasNext = idx >= 0 && idx < STEP_KEYS.length - 1;
  const nextStep = hasNext ? STEP_KEYS[idx + 1] : null;

  return (
    <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
      {hasPrev && onPrev ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => onPrev()}
          className="transition-all duration-200"
        >
          <ArrowLeft size={16} />
          Étape précédente
        </Button>
      ) : null}
      <div className="flex items-center gap-2 sm:ml-auto">
        {onExit && (
          <Button
            type="button"
            variant="outline"
            onClick={onExit}
            className="transition-all duration-200"
          >
            Retour à la mise en service
          </Button>
        )}
        {hasNext && onNext && (
          <Button
            type="button"
            variant="ghost"
            onClick={onNext}
            className="transition-all duration-200"
          >
            {nextStep ? `Continuer vers ${NEXT_STEP_LABEL[nextStep]}` : 'Continuer'}
            <ArrowRight size={16} />
          </Button>
        )}
      </div>
    </div>
  );
}
