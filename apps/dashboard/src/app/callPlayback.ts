'use client';

import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';

// Enregistrement d'un appel de démonstration, à poser dans `public/` (ex. '/audio/appel-demo.mp3').
// Tant qu'il est null, le lecteur ne produit aucun son : il suit l'appel avec ses sous-titres.
export const HERO_CALL_AUDIO: string | null = null;

// Durée de l'appel suivi sans enregistrement.
const FALLBACK_DURATION = 18;

export type CallPart = string | { lit: string };
export type CallLine = {
  // Instant d'apparition, en part de la durée : les sous-titres suivent l'enregistrement réel.
  at: number;
  client?: boolean;
  parts: CallPart[];
};

export const CALL_LINES: CallLine[] = [
  { at: 0, parts: ['Bonjour, ici Léa, l’assistante IA du restaurant.'] },
  {
    at: 0.2,
    client: true,
    parts: ['Une table pour ', { lit: 'quatre' }, ', ce soir vers ', { lit: '20 h 30' }, ' ?'],
  },
  { at: 0.42, parts: ['Nous avons de la place. À quel nom ?'] },
  { at: 0.61, client: true, parts: [{ lit: 'Camille Robert' }, '.'] },
  { at: 0.78, parts: ['C’est réservé.'] },
];

export function formatTime(seconds: number) {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function useCallPlayback(audioSrc: string | null) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(FALLBACK_DURATION);
  const [playing, setPlaying] = useState(false);

  const stopTimer = useCallback(() => clearInterval(timerRef.current), []);

  // Quitter la scène (défilement) coupe l'appel : jamais de son qui continue hors de l'écran.
  useEffect(
    () => () => {
      stopTimer();
      audioRef.current?.pause();
    },
    [stopTimer],
  );

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (playing) {
      stopTimer();
      audio?.pause();
      setPlaying(false);
      return;
    }
    if (audioSrc && audio) {
      if (audio.ended) audio.currentTime = 0;
      audio.play().then(
        () => setPlaying(true),
        () => setPlaying(false),
      );
      return;
    }
    setPlaying(true);
    stopTimer();
    timerRef.current = setInterval(() => {
      setTime((current) => {
        if (current + 0.1 >= FALLBACK_DURATION) {
          clearInterval(timerRef.current);
          setPlaying(false);
          return FALLBACK_DURATION;
        }
        return current + 0.1;
      });
    }, 100);
    setTime((current) => (current >= FALLBACK_DURATION ? 0 : current));
  }, [audioSrc, playing, stopTimer]);

  const audioProps = {
    ref: audioRef,
    preload: 'none' as const,
    onTimeUpdate: (event: SyntheticEvent<HTMLAudioElement>) =>
      setTime(event.currentTarget.currentTime),
    onLoadedMetadata: (event: SyntheticEvent<HTMLAudioElement>) =>
      setDuration(event.currentTarget.duration || FALLBACK_DURATION),
    onEnded: () => setPlaying(false),
    onPause: () => setPlaying(false),
  };

  const ended = !playing && time >= duration - 0.05;
  const started = time > 0;
  const current = started
    ? CALL_LINES.reduce<CallLine | null>(
        (line, candidate) => (time >= candidate.at * duration ? candidate : line),
        null,
      )
    : null;

  return { audioProps, toggle, time, duration, playing, ended, started, current };
}
