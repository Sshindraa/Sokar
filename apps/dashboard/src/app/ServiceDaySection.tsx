import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

type Screen = {
  name: string;
  alt: string;
  desktop: [width: number, height: number];
  mobile: [width: number, height: number];
  narrow?: boolean;
};

type Moment = {
  hour: string;
  title: string;
  text: string;
  tone: 'day-paper' | 'day-dusk' | 'day-night';
  note?: string;
  screens: Screen[];
};

const MOMENTS: Moment[] = [
  {
    hour: '11 h',
    title: 'Avant le service, vous savez ce qui vous attend.',
    text: 'Le briefing rassemble les réservations du jour, les couverts, les allergies et les habitués.',
    tone: 'day-paper',
    screens: [
      {
        name: 'briefing',
        alt: 'Briefing du service : cinq réservations, quatorze couverts et la liste du jour avec habitués et allergies',
        desktop: [2350, 1146],
        mobile: [780, 1413],
      },
    ],
  },
  {
    hour: '12 h 40',
    title: 'Le téléphone sonne. Vous avez les mains prises.',
    text: 'Camille Robert appelle pour ce soir. Léa, l’assistante IA, répond à l’appel et la réservation s’ajoute au carnet, avec la transcription de l’échange.',
    tone: 'day-paper',
    note: 'Exemple : scène et transcription fictives.',
    screens: [
      {
        name: 'appel',
        alt: 'Fiche de l’appel : Léa prend la réservation de Camille Robert pour quatre personnes à 20 h 30',
        desktop: [1344, 908],
        mobile: [780, 1088],
        narrow: true,
      },
      {
        name: 'carnet',
        alt: 'Le carnet du jour : la réservation de Camille Robert, 20 h 30, quatre couverts, prise par téléphone',
        desktop: [2300, 694],
        mobile: [780, 431],
      },
    ],
  },
  {
    hour: '20 h',
    title: 'La salle se remplit. Chaque table a sa place.',
    text: 'Camille est installée à la table 9. Le plan montre d’un coup d’œil les tables occupées, celles qui arrivent et celles qui restent libres.',
    tone: 'day-dusk',
    screens: [
      {
        name: 'plan',
        alt: 'Plan de salle pendant le service : la table 9 sélectionnée, occupée par Camille Robert et quatre personnes',
        desktop: [2317, 900],
        mobile: [780, 781],
      },
    ],
  },
  {
    hour: '23 h 30',
    title: 'Le dernier client est parti. Ce que vous avez appris reste.',
    text: 'Votre équipe a noté l’anniversaire de Camille et son régime sans noix. Sa fiche les garde pour sa prochaine visite.',
    tone: 'day-night',
    screens: [
      {
        name: 'fiche',
        alt: 'Fiche de Camille Robert : occasion, régime alimentaire et table préférée',
        desktop: [2350, 1062],
        mobile: [780, 991],
      },
    ],
  },
];

function ScreenImage({ screen, eager }: { screen: Screen; eager: boolean }) {
  const base = `/marketing/journee-${screen.name}`;
  return (
    <picture className={`block w-full ${screen.narrow ? 'sm:max-w-2xl' : ''}`}>
      <source
        media="(max-width: 639px)"
        srcSet={`${base}-mobile.webp`}
        width={screen.mobile[0]}
        height={screen.mobile[1]}
      />
      <img
        src={`${base}-desktop.webp`}
        alt={screen.alt}
        width={screen.desktop[0]}
        height={screen.desktop[1]}
        loading={eager ? 'eager' : 'lazy'}
        fetchPriority={eager ? 'high' : 'auto'}
        decoding="async"
        className="day-screen block h-auto w-full rounded-xl"
      />
    </picture>
  );
}

function MomentBlock({ moment, eager }: { moment: Moment; eager: boolean }) {
  return (
    <article
      className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${
        eager ? 'pb-16 pt-8 lg:pb-24 lg:pt-10' : 'py-16 lg:py-24'
      }`}
    >
      <div className="grid gap-4 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:items-end md:gap-12">
        <p className="font-brand text-7xl font-medium leading-none tracking-tight sm:text-8xl lg:text-9xl">
          {moment.hour}
        </p>
        <div>
          <h2 className="text-balance font-brand text-2xl font-medium leading-tight sm:text-3xl">
            {moment.title}
          </h2>
          <p className="day-muted mt-3 max-w-xl text-base leading-relaxed">{moment.text}</p>
        </div>
      </div>
      <div className={`flex flex-col items-center gap-4 ${eager ? 'mt-8' : 'mt-10 lg:mt-14'}`}>
        {moment.screens.map((screen, index) => (
          <ScreenImage key={screen.name} screen={screen} eager={eager && index === 0} />
        ))}
        {moment.note && <p className="day-muted text-xs">{moment.note}</p>}
      </div>
    </article>
  );
}

export default function ServiceDaySection() {
  return (
    <div id="services" className="w-full scroll-mt-24">
      {MOMENTS.map((moment, index) => (
        <section key={moment.hour} className={`${moment.tone} w-full`}>
          <MomentBlock moment={moment} eager={index === 0} />
          {index === 1 && <div aria-hidden="true" className="day-to-dusk h-40 sm:h-56" />}
          {index === 2 && <div aria-hidden="true" className="day-to-night h-32 sm:h-40" />}
        </section>
      ))}

      <section className="day-night day-halo-night w-full px-5 pb-24 pt-16 text-center sm:px-8 lg:pb-32 lg:pt-24">
        <h2 className="font-brand text-6xl font-medium leading-none tracking-tight sm:text-8xl">
          Demain, 11 h.
        </h2>
        <p className="day-muted mx-auto mt-6 max-w-xl text-balance text-lg leading-relaxed">
          Un nouveau service commence. Voyez ce que Suppernote peut faire pour le vôtre.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/demo"
            className="day-cta-night inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] sm:w-auto"
          >
            Demander une démonstration
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
          <Link
            href="/register"
            className="day-cta-night-secondary inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] sm:w-auto"
          >
            Essayer 14 jours gratuits
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
        <p className="day-muted mt-4 text-xs">Sans carte bancaire</p>
        <p className="day-muted mt-16 text-xs">
          Écrans réels de Suppernote, simplifiés. Scène et données fictives, à titre d’exemple.
        </p>
      </section>
    </div>
  );
}
