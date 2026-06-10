'use client';

import { useRef } from 'react';
import Image from 'next/image';
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from 'framer-motion';
import { Bot, CalendarCheck, MessageSquare, PhoneCall, Sparkles, Utensils } from 'lucide-react';

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
    title: 'Visualisez ce que Sokar recupere',
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
      : [0, Math.max(0, start - 0.08), start + 0.02, Math.min(1, start + 0.14), Math.min(1, start + 0.24), 1];
  const opacityOutput = start === 0 ? [1, 1, 0, 0] : [0, 0, 1, 1, 0, 0];
  const yOutput =
    start === 0
      ? ['0rem', '0rem', '-2.5rem', '-2.5rem']
      : ['2.5rem', '2.5rem', '0rem', '0rem', '-2.5rem', '-2.5rem'];
  const opacity = useTransform(
    progress,
    opacityInput,
    opacityOutput,
  );
  const y = useTransform(
    progress,
    opacityInput,
    yOutput,
  );

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
  const phoneY = useTransform(scrollYProgress, [0, 0.34, 0.66, 1], ['18%', '0%', '-18%', '-8%']);
  const phoneRotate = useTransform(scrollYProgress, [0, 0.36, 0.68, 1], [-8, -2, 4, -5]);
  const phoneScale = useTransform(scrollYProgress, [0, 0.48, 1], [0.96, 0.86, 0.92]);
  const phoneOpacity = useTransform(scrollYProgress, [0, 0.08, 0.78, 0.94], [0.55, 1, 1, 0.35]);
  const cardRowY = useTransform(scrollYProgress, [0.08, 0.24, 0.52], ['18%', '0%', '-10%']);
  const cardRowOpacity = useTransform(scrollYProgress, [0, 0.12, 0.52, 0.6], [0, 1, 1, 0]);
  const dashboardY = useTransform(scrollYProgress, [0.62, 0.74, 1], ['18%', '0%', '-4%']);
  const dashboardOpacity = useTransform(scrollYProgress, [0, 0.62, 0.74, 1], [0, 0, 1, 1]);

  const textMotion0 = useStoryTextMotion(scrollYProgress, 0);
  const textMotion1 = useStoryTextMotion(scrollYProgress, 0.18);
  const textMotion2 = useStoryTextMotion(scrollYProgress, 0.42);
  const textMotion3 = useStoryTextMotion(scrollYProgress, 0.66);
  const textMotions = [textMotion0, textMotion1, textMotion2, textMotion3];

  if (reduceMotion) {
    return (
      <section className="relative w-full overflow-hidden px-4 py-24 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-6xl p-8 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-cyan-300">Experience Sokar</p>
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
          <div className="absolute left-1/2 top-5 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-2 shadow-2xl shadow-black/30">
            <Image src="/logo-nav.png" alt="" width={24} height={24} className="h-6 w-6" />
            {['Appels', 'Planning', 'Clients', 'Revenus'].map((item) => (
              <span key={item} className="hidden rounded-full px-3 py-1 text-[11px] font-semibold text-white/60 sm:inline">
                {item}
              </span>
            ))}
          </div>

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
            className="absolute left-1/2 top-[42%] z-10 h-[24rem] w-[13rem] -translate-x-1/2 rounded-[2rem] border border-white/18 bg-white/[0.08] p-3 shadow-[0_22px_64px_rgba(0,0,0,0.55)]"
            style={{ y: phoneY, rotate: phoneRotate, scale: phoneScale, opacity: phoneOpacity }}
          >
            <div className="h-full overflow-hidden rounded-[1.55rem] border border-white/10 bg-black/80 p-4">
              <div className="mx-auto mb-5 h-5 w-24 rounded-full bg-white/10" />
              <p className="text-xs font-bold text-white/58">Assistant Sokar</p>
              <p className="mt-2 text-3xl font-black leading-none text-white font-display">89%</p>
              <p className="mt-1 text-[10px] uppercase tracking-widest text-cyan-300">demandes resolues</p>
              <div className="mt-6 space-y-3">
                {['Reservation 20h30', 'SMS envoye', 'Client reconnu'].map((item) => (
                  <div key={item} className="rounded-2xl border border-white/8 bg-white/[0.04] p-3">
                    <p className="text-[11px] font-semibold text-white/68">{item}</p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          <motion.div
            className="absolute inset-x-10 top-[48%] z-0 hidden grid-cols-1 gap-4 md:grid md:grid-cols-3"
            style={{ y: cardRowY, opacity: cardRowOpacity }}
          >
            {[
              { icon: PhoneCall, title: 'Appels entrants', text: 'Sokar repond instantanement' },
              { icon: CalendarCheck, title: 'Tables reservees', text: 'Le planning se met a jour' },
              { icon: MessageSquare, title: 'SMS confirme', text: 'Le client repart rassure' },
            ].map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-3xl border border-white/10 bg-black/60 p-5 shadow-2xl shadow-black/30">
                <span className="flex h-11 w-11 items-center justify-center rounded-full border border-cyan-300/20 bg-cyan-300/10 text-cyan-200">
                  <Icon size={18} />
                </span>
                <h3 className="mt-5 text-lg font-black text-white font-display">{title}</h3>
                <p className="mt-2 text-sm text-white/48">{text}</p>
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
                  <p className="text-sm font-bold text-white">Console temps reel</p>
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

          <div className="absolute bottom-5 left-6 z-30 hidden items-center gap-2 text-xs font-semibold text-white/42 md:flex">
            <Utensils size={14} />
            Service fluide
          </div>
          <div className="absolute bottom-5 right-6 z-30 hidden items-center gap-2 text-xs font-semibold text-white/42 md:flex">
            Simulation au scroll
            <Sparkles size={14} />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
