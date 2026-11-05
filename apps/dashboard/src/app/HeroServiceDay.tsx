'use client';

import { useEffect, useRef, useState } from 'react';
import { Cake, Check, NutOff, PhoneIncoming, Pause, Play, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FEATURES } from '@/app/features';
import { HERO_CALL_AUDIO, formatTime, useCallPlayback, type CallLine } from '@/app/callPlayback';

type Scene = { hour: string; situation: string; steps: number };

const SCENES: Scene[] = [
  { hour: '11 h', situation: 'Avant le service, vous savez ce qui vous attend.', steps: 3 },
  { hour: '12 h 40', situation: 'Le téléphone sonne. Vous avez les mains prises.', steps: 4 },
  { hour: '20 h', situation: 'La salle se remplit. Chaque table a sa place.', steps: 3 },
  {
    hour: '23 h 30',
    situation: 'Le dernier client est parti. Ce que vous avez appris reste.',
    steps: 3,
  },
];

const fade = (visible: boolean) =>
  cn('transition-opacity duration-300', !visible && 'opacity-[0.16]');

const BRIEFING_STATS = [
  { label: 'Réservations', value: '9' },
  { label: 'Couverts', value: '28' },
  { label: 'Allergies', value: '1' },
];

const BRIEFING_ROWS = [
  { time: '12:15', name: 'Théo Petit', covers: 2, tag: 'Habitué' },
  { time: '12:45', name: 'Zoé Martin', covers: 4, tag: 'Sans noix', alert: true },
  { time: '13:30', name: 'Sarah Faure', covers: 2, tag: 'Habituée' },
];

function BriefingVisual() {
  return (
    <div className="w-full max-w-2xl">
      <div className="grid grid-cols-3 gap-4">
        {BRIEFING_STATS.map((stat) => (
          <div key={stat.label}>
            <p className="font-brand text-5xl leading-none lg:text-6xl">{stat.value}</p>
            <p className="day-hero-muted mt-2 text-sm">{stat.label}</p>
          </div>
        ))}
      </div>
      <ol className="day-hero-card mt-6 divide-y divide-white/10 rounded-md">
        {BRIEFING_ROWS.map((row) => (
          <li key={row.time} className="flex items-center gap-4 px-4 py-3 lg:px-5">
            <span className="font-brand text-lg">{row.time}</span>
            <span className="min-w-0 flex-1 truncate text-sm">
              {row.name}
              <span className="day-hero-muted"> · {row.covers}</span>
            </span>
            <span
              className={cn(
                'whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium',
                row.alert ? 'day-hero-lit' : 'day-hero-muted border border-white/15',
              )}
            >
              {row.tag}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const WAVE = [28, 52, 36, 72, 100, 60, 84, 44, 68, 32, 56, 24];

function CaptionParts({ line }: { line: CallLine }) {
  return line.parts.map((part, index) =>
    typeof part === 'string' ? (
      part
    ) : (
      <span key={index} className="day-hero-lit whitespace-nowrap rounded-sm px-[0.14em]">
        {part.lit}
      </span>
    ),
  );
}

function CallVisual({ step }: { step: number }) {
  const answered = step >= 2;
  const call = useCallPlayback(HERO_CALL_AUDIO);
  const label = call.playing
    ? 'Pause'
    : call.ended
      ? HERO_CALL_AUDIO
        ? 'Réécouter'
        : 'Revoir l’appel'
      : call.started
        ? 'Reprendre'
        : HERO_CALL_AUDIO
          ? 'Écouter l’appel'
          : 'Suivre l’appel';
  const Icon = call.playing ? Pause : call.ended ? RotateCcw : Play;

  return (
    <div className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-4 lg:gap-6">
      {HERO_CALL_AUDIO && <audio src={HERO_CALL_AUDIO} {...call.audioProps} />}
      <div className="flex w-full min-h-0 flex-col items-center justify-center gap-4 lg:flex-row lg:gap-8">
        <div className="day-hero-card flex h-[clamp(13rem,38svh,30rem)] w-full max-w-60 shrink-0 flex-col items-center justify-between rounded-[2rem] border border-white/15 px-5 py-6 lg:h-[clamp(20rem,52vh,30rem)]">
          <p className="day-hero-muted text-sm">
            {answered ? 'Léa, l’assistante IA' : 'Appel entrant'}
          </p>
          {answered ? (
            <div
              aria-hidden="true"
              className={cn(
                'day-hero-lit-text flex h-16 items-center gap-1 lg:h-20',
                call.started && 'max-lg:hidden',
              )}
            >
              {WAVE.map((height, index) => (
                <span
                  key={index}
                  className="w-1 rounded-full bg-current motion-safe:animate-pulse"
                  style={{ height: `${height}%`, animationDelay: `${index * 90}ms` }}
                />
              ))}
            </div>
          ) : (
            <span className="relative flex h-20 w-20 items-center justify-center">
              <span className="day-hero-lit absolute inset-2 rounded-full opacity-40 motion-safe:animate-ping" />
              <span className="day-hero-lit relative flex h-16 w-16 items-center justify-center rounded-full">
                <PhoneIncoming size={26} aria-hidden="true" />
              </span>
            </span>
          )}
          {answered && (
            <div className="flex flex-col items-center gap-1.5">
              <button
                type="button"
                aria-label={label}
                onClick={call.toggle}
                className="day-hero-lit flex h-12 w-12 items-center justify-center rounded-full transition-all duration-200 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
              >
                <Icon size={20} aria-hidden="true" />
              </button>
              <p className="text-sm font-semibold">{label}</p>
              <div className="h-[3px] w-28 rounded-full bg-white/15">
                <div
                  className="day-hero-lit h-[3px] rounded-full"
                  style={{ width: `${Math.min(100, (call.time / call.duration) * 100)}%` }}
                />
              </div>
              <p className="day-hero-muted text-xs">
                {call.started ? `${formatTime(call.time)} / ` : ''}
                {formatTime(call.duration)}
              </p>
            </div>
          )}
          <p className={cn('font-brand text-xl', call.current && 'max-lg:hidden')}>
            {step >= 3 ? 'Camille Robert' : 'Une cliente appelle'}
          </p>
          {call.current && (
            <p
              className={cn(
                'min-h-[4.5rem] text-center font-brand text-lg leading-snug [word-spacing:0] lg:hidden',
                call.current.client && 'italic',
              )}
            >
              <CaptionParts line={call.current} />
            </p>
          )}
        </div>
        <div className={cn('day-hero-card w-full max-w-60 rounded-md p-4 lg:p-5', fade(step >= 3))}>
          <p className="day-hero-muted text-sm">Au carnet</p>
          <p className="mt-1 font-brand text-2xl">20 h 30</p>
          <p className="mt-0.5 text-sm">4 couverts</p>
          <p
            className={cn(
              'mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
              step >= 4 ? 'day-hero-lit' : 'day-hero-muted border border-white/15',
            )}
          >
            {step >= 4 && <Check size={13} aria-hidden="true" />}
            {step >= 4 ? 'Confirmée' : 'En cours'}
          </p>
        </div>
      </div>
      <p
        aria-live="polite"
        className={cn(
          'hidden min-h-[3rem] max-w-xl text-center font-brand text-xl leading-snug [word-spacing:0] lg:block lg:text-2xl',
          call.current?.client && 'italic',
        )}
      >
        {call.current && <CaptionParts line={call.current} />}
      </p>
    </div>
  );
}

// x, y, rond ou rectangulaire, occupée ou libre. La table 9 est dessinée à part.
const ROOM_TABLES = [
  { x: 70, y: 60, round: true, busy: true },
  { x: 220, y: 60, round: false, busy: false },
  { x: 370, y: 60, round: true, busy: true },
  { x: 530, y: 60, round: false, busy: true },
  { x: 70, y: 190, round: false, busy: true },
  { x: 220, y: 190, round: true, busy: false },
  { x: 530, y: 190, round: true, busy: true },
  { x: 145, y: 310, round: true, busy: true },
  { x: 300, y: 310, round: false, busy: true },
  { x: 460, y: 310, round: true, busy: false },
];

// Chaises : un seul petit trait droit par chaise, posé contre la table.
const CHAIR_GAP = 8;
const CHAIR_LENGTH = 18;

function bar(x: number, y: number, horizontal: boolean) {
  const half = CHAIR_LENGTH / 2;
  return horizontal ? `M${x - half} ${y}h${CHAIR_LENGTH}` : `M${x} ${y - half}v${CHAIR_LENGTH}`;
}

function roundChairs(x: number, y: number) {
  const reach = 34 + CHAIR_GAP;
  return (
    bar(x, y - reach, true) +
    bar(x, y + reach, true) +
    bar(x - reach, y, false) +
    bar(x + reach, y, false)
  );
}

// Une chaise par côté pour une petite table carrée.
function squareChairs(x: number, y: number) {
  return (
    bar(x, y - (28 + CHAIR_GAP), true) +
    bar(x, y + (28 + CHAIR_GAP), true) +
    bar(x - (34 + CHAIR_GAP), y, false) +
    bar(x + (34 + CHAIR_GAP), y, false)
  );
}

// Table 9 (120 × 80) : deux chaises sur chaque grand côté, pour quatre personnes.
const TABLE_NINE_CHAIRS =
  bar(350, 150 - CHAIR_GAP, true) +
  bar(410, 150 - CHAIR_GAP, true) +
  bar(350, 230 + CHAIR_GAP, true) +
  bar(410, 230 + CHAIR_GAP, true);

function RoomVisual({ step }: { step: number }) {
  return (
    <div className="flex w-full max-w-2xl flex-col items-center gap-4">
      <svg viewBox="0 0 620 370" aria-hidden="true" className="w-full max-h-[46svh]">
        {ROOM_TABLES.map((table) => {
          const className = cn(
            'day-hero-table transition-all duration-300',
            table.busy && 'day-hero-table-busy',
            !table.busy && step >= 3 && 'day-hero-table-free',
          );
          const chairClassName = cn(
            'day-hero-chair transition-all duration-300',
            !table.busy && step >= 3 && 'day-hero-chair-free',
          );
          return (
            <g key={table.x + table.y}>
              <path
                d={table.round ? roundChairs(table.x, table.y) : squareChairs(table.x, table.y)}
                className={chairClassName}
              />
              {table.round ? (
                <circle cx={table.x} cy={table.y} r={34} className={className} />
              ) : (
                <rect
                  x={table.x - 34}
                  y={table.y - 28}
                  width={68}
                  height={56}
                  rx={6}
                  className={className}
                />
              )}
            </g>
          );
        })}
        <path
          d={TABLE_NINE_CHAIRS}
          className={cn(
            'day-hero-chair transition-all duration-300',
            step >= 2 && 'day-hero-chair-lit',
          )}
        />
        <rect
          x={320}
          y={150}
          width={120}
          height={80}
          rx={8}
          strokeDasharray={step >= 2 ? undefined : '6 5'}
          className={cn(
            'day-hero-table transition-all duration-300',
            step >= 2 && 'day-hero-table-lit',
          )}
        />
        <text
          x={380}
          y={200}
          textAnchor="middle"
          className={cn('day-hero-table-label font-brand', step >= 2 && 'day-hero-table-label-lit')}
        >
          9
        </text>
      </svg>
      <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
        <p className={cn('day-hero-lit rounded-full px-3 py-1 font-medium', fade(step >= 2))}>
          Camille Robert · 4 personnes
        </p>
        <p
          className={cn(
            'day-hero-muted rounded-full border border-white/15 px-3 py-1',
            fade(step >= 3),
          )}
        >
          3 tables libres
        </p>
      </div>
    </div>
  );
}

function GuestVisual({ step }: { step: number }) {
  return (
    <div className="day-hero-card w-full max-w-md rounded-md p-6 lg:p-8">
      <div className="flex items-center gap-4">
        <span className="day-hero-lit flex h-16 w-16 shrink-0 items-center justify-center rounded-full font-brand text-2xl">
          CR
        </span>
        <div className="min-w-0">
          <p className="font-brand text-2xl lg:text-3xl">Camille Robert</p>
          <p className="day-hero-muted mt-0.5 text-sm">Fiche client</p>
        </div>
      </div>
      <ul className="mt-6 flex flex-col gap-3">
        <li className={cn('flex items-center gap-3 text-lg', fade(step >= 1))}>
          <Cake size={20} aria-hidden="true" className="day-hero-lit-text" />
          Anniversaire
        </li>
        <li className={cn('flex items-center gap-3 text-lg', fade(step >= 2))}>
          <NutOff size={20} aria-hidden="true" className="day-hero-lit-text" />
          Sans noix
        </li>
      </ul>
      <p className={cn('day-hero-muted mt-6 text-sm', fade(step >= 3))}>
        Noté par votre équipe, gardé pour sa prochaine visite.
      </p>
    </div>
  );
}

// Chaque image de la frise occupe un peu moins d'un quart d'écran de défilement.
export const FRAME_VH = 24;

type Position = { scene: number; step: number };

// 11 h s'affiche complet dès l'arrivée ; les autres heures se construisent étape par étape.
// La dernière étape de chaque heure est répétée : c'est le temps de lecture avant la suivante.
export const TIMELINE: Position[] = SCENES.flatMap((scene, index) =>
  index === 0
    ? [
        { scene: 0, step: scene.steps },
        { scene: 0, step: scene.steps },
      ]
    : [
        ...Array.from({ length: scene.steps }, (_, step) => ({ scene: index, step: step + 1 })),
        { scene: index, step: scene.steps },
      ],
);

const SCROLL_SPAN_SVH = TIMELINE.length * FRAME_VH;

export default function HeroServiceDay() {
  // Le premier rendu montre 11 h complet : la scène reste lisible sans JavaScript.
  const [frame, setFrame] = useState(0);
  const trackRef = useRef<HTMLElement>(null);
  const position = TIMELINE[frame];

  // La journée reste collée à l'écran : seul le défilement fait avancer l'heure.
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const start = trackRef.current;
      if (!start) return;
      const span = (TIMELINE.length * FRAME_VH * window.innerHeight) / 100;
      const progress = Math.min(1, Math.max(0, -start.getBoundingClientRect().top / span));
      setFrame(Math.min(TIMELINE.length - 1, Math.floor(progress * TIMELINE.length)));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, []);

  const goTo = (scene: number) => {
    const start = trackRef.current;
    if (!start) return;
    const first = TIMELINE.findIndex((item) => item.scene === scene);
    const frameHeight = (FRAME_VH * window.innerHeight) / 100;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({
      top: window.scrollY + start.getBoundingClientRect().top + (first + 0.5) * frameHeight,
      behavior: reduced ? 'auto' : 'smooth',
    });
  };

  const scene = SCENES[position.scene];

  return (
    <section
      ref={trackRef}
      id="services"
      aria-label="Exemple : une journée de service"
      className="relative w-full scroll-mt-0"
      style={{ height: `${100 + SCROLL_SPAN_SVH}svh` }}
    >
      {/* Ancres du menu Fonctionnalités : chacune amène le panneau collé sur son heure. */}
      {FEATURES.map((feature) => (
        <span
          key={feature.id}
          id={feature.id}
          aria-hidden="true"
          className="pointer-events-none absolute left-0 h-px w-px"
          style={{
            top: `${(TIMELINE.findIndex((item) => item.scene === feature.scene) + 0.5) * FRAME_VH}svh`,
          }}
        />
      ))}
      <div className="day-hero-panel sticky top-0 h-svh w-full overflow-hidden px-5 pb-6 pt-20 [word-spacing:0.06em] sm:px-8 lg:px-14 lg:pb-10 lg:pt-24">
        <div className="mx-auto flex h-full w-full max-w-[90rem] flex-col gap-5 lg:gap-8">
          <div className="flex items-stretch gap-1">
            {SCENES.map((item, index) => (
              <button
                key={item.hour}
                type="button"
                aria-pressed={index === position.scene}
                onClick={() => goTo(index)}
                className={cn(
                  'day-hero-hour min-h-12 flex-1 border-t-2 pt-2.5 text-left font-brand text-lg [word-spacing:0] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  index === position.scene && 'day-hero-hour-active',
                )}
              >
                {item.hour}
              </button>
            ))}
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-5 lg:grid lg:grid-cols-[5fr_7fr] lg:items-center lg:gap-16">
            <div>
              <p className="day-hero-lit-text whitespace-nowrap font-brand text-7xl font-normal leading-[0.95] tracking-tight [word-spacing:-0.04em] lg:text-[clamp(5rem,9vw,9rem)]">
                {scene.hour}
              </p>
              <p className="mt-2 text-lg font-medium leading-snug lg:mt-5 lg:max-w-[22em] lg:text-2xl">
                {scene.situation}
              </p>
            </div>

            <div className="flex min-h-0 flex-1 items-center justify-center lg:h-full">
              {position.scene === 0 && <BriefingVisual />}
              {position.scene === 1 && <CallVisual step={position.step} />}
              {position.scene === 2 && <RoomVisual step={position.step} />}
              {position.scene === 3 && <GuestVisual step={position.step} />}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
