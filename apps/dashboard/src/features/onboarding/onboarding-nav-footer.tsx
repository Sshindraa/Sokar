'use client';

import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { STEP_KEYS } from './steps';
import type { OnboardingTaskKey } from './types';

/**
 * Footer de navigation partagé entre la page dédiée (/onboarding/[step])
 * et le modal in-dashboard. Garantit une UX cohérente : prev/next/progress
 * identiques quel que soit le point d'entrée.
 *
 * @param currentStep  étape actuellement affichée
 * @param onPrev       callback pour aller à l'étape précédente (ou null si désactivé)
 * @param onNext       callback pour aller à l'étape suivante (ou null si désactivé)
 * @param onExit       callback optionnel pour revenir au dashboard
 * @param completedCount/totalCount/progress  métriques de progression
 */
export function OnboardingNavFooter({
  currentStep,
  onPrev,
  onNext,
  onExit,
  completedCount,
  totalCount,
  progress,
}: {
  currentStep: OnboardingTaskKey;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onExit?: () => void;
  completedCount: number;
  totalCount: number;
  progress: number;
}) {
  const idx = STEP_KEYS.indexOf(currentStep);
  const hasPrev = idx > 0;
  const hasNext = idx >= 0 && idx < STEP_KEYS.length - 1;

  return (
    <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
      <Button
        type="button"
        variant="ghost"
        disabled={!hasPrev}
        onClick={() => onPrev?.()}
        className="transition-all duration-200"
      >
        <ArrowLeft size={16} />
        Étape précédente
      </Button>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {completedCount}/{totalCount} étapes validées · {progress}% prêt
        </span>
        {onExit && (
          <Button
            type="button"
            variant="outline"
            onClick={onExit}
            className="transition-all duration-200"
          >
            Retour au dashboard
          </Button>
        )}
        {hasNext && onNext && (
          <Button
            type="button"
            variant="ghost"
            onClick={onNext}
            className="transition-all duration-200"
          >
            Étape suivante
            <ArrowRight size={16} />
          </Button>
        )}
      </div>
    </div>
  );
}
