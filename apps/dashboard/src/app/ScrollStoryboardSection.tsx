'use client';

import { useRef } from 'react';
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from 'framer-motion';
import { Bot, CalendarCheck, MessageSquare, PhoneCall } from 'lucide-react';

const storySteps = [
  {
    kicker: 'Assistant vocal restaurant',
    title: 'Sokar capte chaque appel',
    accent: 'meme pendant le service',
  },
  {
    kicker: 'Controle operationnel',
    title: 'Pilotez votre salle',
    accent: 'sans quitter le tableau de bord',
  },
  {
    kicker: 'Reservations automatiques',
    title: 'Chaque demande devient action',
    accent: 'planning, SMS, client reconnu',
  },
  {
    kicker: 'Croissance mesurable',
    title: 'Visualisez ce que Sokar récupère',
    accent: 'appels, tables, revenus',
  },
];

function FloatingMetric({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-black/70 p-4 shadow-2xl shadow-black/40 ${className}`}
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/38">{label}</p>
      <p className="mt-2 text-2xl font-black tracking-tight text-white font-display">{value}</p>
    </div>
  );
}

function useStoryTextMotion(progress: MotionValue<number>, start: number) {
  const opacityInput =
    start === 0
      ? [0, 0.08, 0.16, 1]
      : [
          0,
          Math.max(0, start - 0.08),
          start + 0.02,
          Math.min(1, start + 0.14),
          Math.min(1, start + 0.24),
          1,
        ];
  const opacityOutput = start === 0 ? [1, 1, 0, 0] : [0, 0, 1, 1, 0, 0];
  const yOutput =
    start === 0
      ? ['0rem', '0rem', '-2.5rem', '-2.5rem']
      : ['2.5rem', '2.5rem', '0rem', '0rem', '-2.5rem', '-2.5rem'];
  const opacity = useTransform(progress, opacityInput, opacityOutput);
  const y = useTransform(progress, opacityInput, yOutput);

  return { opacity, y };
}

export default function ScrollStoryboardSection() {
  const containerRef = useRef<HTMLElement | null>(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end end'],
  });

  const screenScale = useTransform(scrollYProgress, [0, 0.1, 0.9, 1], [0.96, 1, 1, 0.97]);
  const cardRowY = useTransform(scrollYProgress, [0.08, 0.24, 0.48], ['18%', '0%', '-14%']);
  const cardRowOpacity = useTransform(scrollYProgress, [0, 0.12, 0.46, 0.56], [0, 1, 1, 0]);
  const dashboardY = useTransform(scrollYProgress, [0.66, 0.78, 1], ['18%', '0%', '-4%']);
  const dashboardOpacity = useTransform(scrollYProgress, [0, 0.66, 0.78, 1], [0, 0, 1, 1]);

  const textMotion0 = useStoryTextMotion(scrollYProgress, 0);
  const textMotion1 = useStoryTextMotion(scrollYProgress, 0.18);
  const textMotion2 = useStoryTextMotion(scrollYProgress, 0.42);
  const textMotion3 = useStoryTextMotion(scrollYProgress, 0.66);
  const textMotions = [textMotion0, textMotion1, textMotion2, textMotion3];

  if (reduceMotion) {
    return (
      <section className="relative w-full overflow-hidden px-4 py-24 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-6xl p-8 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-cyan-300">
            Experience Sokar
          </p>
          <h2 className="mx-auto mt-4 max-w-3xl text-4xl font-black tracking-tight text-white font-display">
            Une interface qui transforme chaque appel en reservation.
          </h2>
        </div>
      </section>
    );
  }

  return (
    <section ref={containerRef} data-scroll-storyboard className="relative h-[260vh] w-full">
      <div className="sticky top-0 flex h-screen w-full items-center justify-center overflow-hidden px-4 py-16 sm:px-6 lg:px-10">
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.24),transparent_24rem),radial-gradient(circle_at_82%_54%,rgba(255,255,255,0.08),transparent_24rem)]"
          style={{ scale: screenScale }}
        />
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.055)_1px,transparent_1px),linear-gradient(180deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[length:84px_84px] opacity-35"
          style={{ scale: screenScale }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-[18%] h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-cyan-400/10 blur-2xl"
        />
        <motion.div
          data-storyboard-screen
          className="relative h-full w-full overflow-hidden"
          style={{ scale: screenScale }}
        >
          <div className="absolute inset-x-6 top-24 z-20 text-center sm:top-28">
            {storySteps.map((step, index) => (
              <motion.div
                key={step.title}
                data-story-title
                className="absolute inset-x-0"
                style={{ opacity: textMotions[index].opacity, y: textMotions[index].y }}
              >
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-cyan-300">
                  {step.kicker}
                </p>
                <h2 className="mx-auto mt-3 max-w-4xl text-4xl font-black leading-[0.95] tracking-tight text-white font-display sm:text-6xl lg:text-7xl">
                  {step.title}
                </h2>
                <p className="mx-auto mt-4 max-w-xl text-sm font-semibold text-white/50 sm:text-base">
                  {step.accent}
                </p>
              </motion.div>
            ))}
          </div>

          <motion.div
            data-story-cards
            className="absolute inset-x-10 top-[66%] z-0 hidden grid-cols-1 gap-4 md:grid md:grid-cols-3 md:top-[72%]"
            style={{ y: cardRowY, opacity: cardRowOpacity }}
          >
            {[
              { icon: PhoneCall, title: 'Appels entrants', text: 'Sokar répond instantanément' },
              { icon: CalendarCheck, title: 'Tables réservées', text: 'Le planning se met à jour' },
              { icon: MessageSquare, title: 'SMS confirmé', text: 'Le client repart rassuré' },
            ].map(({ icon: Icon, title, text }) => (
              <div
                key={title}
                className="rounded-3xl border border-white/10 bg-black/60 p-4 shadow-2xl shadow-black/30"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full border border-cyan-300/20 bg-cyan-300/10 text-cyan-200">
                  <Icon size={17} />
                </span>
                <h3 className="mt-4 text-lg font-black text-white font-display">{title}</h3>
                <p className="mt-1.5 text-sm text-white/48">{text}</p>
              </div>
            ))}
          </motion.div>

          <motion.div
            className="absolute inset-x-6 bottom-8 z-20 grid gap-4 rounded-[1.7rem] border border-white/10 bg-black/80 p-4 shadow-2xl shadow-black/40 md:inset-x-16 md:grid-cols-[1fr_1.1fr]"
            style={{ y: dashboardY, opacity: dashboardOpacity }}
          >
            <div className="rounded-2xl border border-white/8 bg-white/[0.035] p-5">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-300/10 text-cyan-200">
                  <Bot size={18} />
                </span>
                <div>
                  <p className="text-sm font-bold text-white">Console temps réel</p>
                  <p className="text-xs text-emerald-400">Assistant en communication</p>
                </div>
              </div>
              <div className="mt-5 h-24 rounded-2xl border border-white/8 bg-black/45" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FloatingMetric label="Appels traites" value="412" className="relative inset-auto" />
              <FloatingMetric label="Tables prises" value="189" className="relative inset-auto" />
              <FloatingMetric label="Taux reponse" value="98%" className="relative inset-auto" />
              <FloatingMetric label="Revenus" value="5.4k€" className="relative inset-auto" />
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
