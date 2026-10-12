'use client';

import type { ReactNode } from 'react';
import { ArrowRight, Check, DoorOpen, Globe, PhoneCall, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { trackProgress, type OnboardingTrack, type TrackProgress } from './tracks';
import type { OnboardingStep, OnboardingTaskKey, ReservationReadiness } from './types';

type ChannelTrack = Exclude<OnboardingTrack, 'socle'>;

const CHANNELS: Record<
  ChannelTrack,
  { title: string; body: string; icon: typeof PhoneCall; includes: ReactNode[] }
> = {
  phone: {
    title: 'Téléphone',
    body: 'Un agent répond à vos appels et prend les réservations, même en plein service.',
    icon: PhoneCall,
    includes: ['La voix et les consignes de votre restaurant', 'Le renvoi de votre ligne'],
  },
  online: {
    title: 'En ligne',
    body: 'Vos clients réservent seuls, à toute heure, aux mêmes conditions qu’au téléphone.',
    icon: Globe,
    includes: [
      'Votre page de réservation',
      'Un bouton de réservation pour votre site',
      <span key="ai" className="inline-flex items-center gap-1.5">
        Les assistants IA (ChatGPT, Claude…)
        <Sparkles size={12} aria-hidden="true" className="text-foreground/60" />
      </span>,
    ],
  },
};

function statusLabel(progress: TrackProgress) {
  if (progress.done) return 'Prêt';
  if (progress.completed > 0)
    return `${progress.completed} étape sur ${progress.steps.length} terminée`;
  return `${progress.steps.length} étapes`;
}

function actionLabel(progress: TrackProgress) {
  if (progress.done) return 'Revoir';
  if (progress.completed > 0) return 'Reprendre';
  return 'Configurer';
}

function ChannelCard({
  track,
  progress,
  onOpen,
}: {
  track: ChannelTrack;
  progress: TrackProgress;
  onOpen: (key: OnboardingTaskKey) => void;
}) {
  const channel = CHANNELS[track];
  const Icon = channel.icon;
  const titleId = `onboarding-channel-${track}`;
  return (
    <article
      aria-labelledby={titleId}
      className="flex min-w-0 flex-col gap-5 rounded-[1.75rem] bg-muted/50 p-6 transition-all duration-200"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-background text-foreground">
          <Icon size={19} aria-hidden="true" />
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
            progress.done ? 'bg-foreground text-background' : 'bg-background text-foreground/70',
          )}
        >
          {progress.done && <Check size={12} aria-hidden="true" />}
          {statusLabel(progress)}
        </span>
      </div>
      <div>
        <h3 id={titleId} className="text-lg font-semibold tracking-tight">
          {channel.title}
        </h3>
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{channel.body}</p>
      </div>
      <ul className="space-y-2 text-sm text-foreground/80">
        {channel.includes.map((item, position) => (
          <li key={position} className="flex items-start gap-2">
            <Check size={14} aria-hidden="true" className="mt-1 shrink-0 text-foreground/50" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant={progress.done ? 'outline' : 'default'}
        onClick={() => onOpen(progress.target)}
        aria-label={`${actionLabel(progress)} : ${channel.title}`}
        className="mt-auto h-11 w-full rounded-full transition-all duration-200"
      >
        {actionLabel(progress)}
        <ArrowRight size={15} aria-hidden="true" />
      </Button>
    </article>
  );
}

/** Écran pivot : la salle est prête, le restaurateur active ses canaux dans l'ordre de son choix. */
export function OnboardingChannels({
  steps,
  readiness,
  onOpen,
}: {
  steps: OnboardingStep[];
  readiness?: ReservationReadiness;
  onOpen: (key: OnboardingTaskKey) => void;
}) {
  const phone = trackProgress(steps, 'phone');
  const online = trackProgress(steps, 'online');
  const remaining = [phone, online].filter((progress) => !progress.done).length;

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      <section
        aria-label="Votre salle"
        className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-full bg-muted/50 px-5 py-3 text-sm"
      >
        <span className="inline-flex items-center gap-2 font-medium">
          <span className="flex size-6 items-center justify-center rounded-full bg-foreground text-background">
            <Check size={12} aria-hidden="true" />
          </span>
          Votre salle est prête
        </span>
        {readiness && readiness.tableCount > 0 && (
          <span className="text-muted-foreground">
            {readiness.tableCount} {readiness.tableCount > 1 ? 'tables' : 'table'} ·{' '}
            {readiness.seatCount} couverts, partagés entre tous vos canaux
          </span>
        )}
        <button
          type="button"
          onClick={() => onOpen('floor')}
          className="ml-auto rounded-full px-3 py-1 text-xs font-medium text-foreground/70 transition-all duration-200 hover:bg-foreground/10 hover:text-foreground"
        >
          Modifier
        </button>
      </section>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <ChannelCard track="phone" progress={phone} onOpen={onOpen} />
        <ChannelCard track="online" progress={online} onOpen={onOpen} />
      </div>

      <section
        aria-labelledby="onboarding-channel-floor"
        className="flex min-w-0 items-start gap-4 rounded-[1.75rem] border border-dashed border-border p-5"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted/60 text-foreground/70">
          <DoorOpen size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-foreground/60">
            Avant votre premier service
          </p>
          <h3 id="onboarding-channel-floor" className="mt-1.5 text-base font-semibold">
            En salle
          </h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Placez les clients sans réservation sur votre plan de salle : la table n’est plus
            proposée au téléphone ni en ligne. Vous le retrouverez dans votre espace, une fois vos
            canaux activés.
          </p>
        </div>
      </section>

      <p role="status" className="text-xs text-muted-foreground">
        {remaining === 0
          ? 'Vos canaux sont prêts.'
          : remaining === 1
            ? 'Encore un canal à activer pour ouvrir votre espace.'
            : 'Activez vos deux canaux, dans l’ordre de votre choix, pour ouvrir votre espace.'}
      </p>
    </div>
  );
}
