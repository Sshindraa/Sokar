'use client';

import { Calendar, Check, CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useOnboarding } from '../onboarding-provider';
import { StepHeader, OnboardingAction, OnboardingPreview } from '../ui';
import type { StepProps } from '../types';

export function CalendarStep({ onComplete }: StepProps) {
  const { state, updateTask } = useOnboarding();
  const connected = Boolean(state?.restaurant.googleConnected);

  async function handleComplete() {
    const updated = await updateTask('complete', 'calendar');
    if (updated) onComplete('phone');
  }

  async function handleManualPlanning() {
    const updated = await updateTask('complete', 'calendar', {
      metadata: { planningMode: 'sokar' },
    });
    if (updated) onComplete('phone');
  }

  return (
    <div className="space-y-3">
      <StepHeader
        icon={Calendar}
        title="Choisissez votre planning"
        body="Retrouvez vos réservations et préparez chaque service depuis un même endroit."
      />
      <div className="grid max-w-6xl items-start gap-10 lg:grid-cols-2 lg:gap-12">
        <div className="space-y-5 py-1">
          <div className="rounded-2xl border border-foreground/25 bg-background p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
                <CalendarDays size={20} />
              </span>
              <div className="flex-1">
                <h3 className="text-base font-semibold">Planning Sokar</h3>
                <p className="mt-1 text-xs text-muted-foreground">Inclus, prêt à utiliser</p>
              </div>
              <Check size={18} aria-hidden="true" />
            </div>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              Vos réservations et vos arrivées réunies dans l’onglet Réservations.
            </p>
          </div>
          <div role="status" className="rounded-2xl border border-border p-5">
            <p className="text-sm font-medium">
              {connected ? 'Google Calendar est connecté' : 'Google Calendar'}
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {connected
                ? 'Votre connexion existante est conservée.'
                : 'La connexion n’est pas disponible dans cet écran. Vous pouvez continuer avec Sokar ; votre agenda Google ne sera pas synchronisé.'}
            </p>
          </div>
        </div>
        <OnboardingPreview
          eyebrow="Chaque service, bien préparé"
          title="Une vue claire de vos réservations"
          icon={CalendarDays}
        >
          <div className="grid grid-cols-3 gap-2 border-b border-background/15 pb-4 text-xs text-background/60">
            <span>Réservations</span>
            <span>Arrivées</span>
            <span>Disponibilités</span>
          </div>
          <p className="text-xl font-medium leading-8">
            Du premier appel à l’arrivée de vos clients.
          </p>
          <p className="text-sm leading-6 text-background/60">
            Sokar prend les réservations. Vous les retrouvez dans votre planning pour organiser
            votre accueil.
          </p>
        </OnboardingPreview>
      </div>
      <OnboardingAction>
        {connected ? (
          <Button onClick={handleComplete} className="transition-all duration-200">
            Continuer vers les appels
          </Button>
        ) : (
          <Button onClick={handleManualPlanning} className="transition-all duration-200">
            Utiliser le planning manuel (Sokar OS)
          </Button>
        )}
      </OnboardingAction>
    </div>
  );
}
