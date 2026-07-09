'use client';

import { Calendar, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useOnboarding } from '../onboarding-provider';
import { StepHeader } from '../ui';
import type { StepProps } from '../types';

export function CalendarStep({ onComplete }: StepProps) {
  const { state, updateTask } = useOnboarding();
  const connected = Boolean(state?.restaurant.googleConnected);
  const calendarId = state?.restaurant.googleCalendarId;

  async function handleComplete() {
    await updateTask('complete', 'calendar');
    onComplete('phone');
  }

  async function handleSkip() {
    await updateTask('skip', 'calendar', { reason: 'Agenda manuel' });
    onComplete('phone');
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
      <StepHeader
        icon={Calendar}
        title="Connexion au planning"
        body="Google Calendar nous permet de vérifier la disponibilité en temps réel avant d'attribuer une table."
      />
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-background/60 p-4 transition-colors duration-200">
          <p className="text-sm text-muted-foreground font-semibold">Statut de la connexion</p>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={cn(
                'h-2.5 w-2.5 rounded-full',
                connected ? 'bg-success animate-pulse' : 'bg-muted',
              )}
            />
            <span className="text-sm font-medium">
              {connected ? `Connecté · ID : ${calendarId}` : 'Non connecté'}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          {!connected && (
            <Button variant="outline" className="transition-colors duration-200" disabled>
              <Globe size={16} />
              Connexion Google Calendar (Aperçu)
            </Button>
          )}
          {connected ? (
            <Button onClick={handleComplete}>Continuer</Button>
          ) : (
            <Button onClick={handleSkip} variant="outline">
              Utiliser le planning manuel (Sokar OS)
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          En choisissant le planning manuel, vous gérez les arrivées depuis l&apos;onglet
          Réservations.
        </p>
      </div>
    </div>
  );
}
