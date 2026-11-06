'use client';

import { useEffect } from 'react';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';

export default function HomeSmoothScroll() {
  useEffect(() => {
    const nativeScroll = window.matchMedia(
      '(prefers-reduced-motion: reduce), (width < 768px) and (pointer: coarse)',
    );
    let lenis: Lenis | undefined;

    const update = () => {
      lenis?.destroy();
      lenis = nativeScroll.matches
        ? undefined
        : new Lenis({ autoRaf: true, lerp: /Mac/.test(navigator.userAgent) ? 0.1 : 0.08 });
    };

    update();
    nativeScroll.addEventListener('change', update);
    return () => {
      nativeScroll.removeEventListener('change', update);
      lenis?.destroy();
    };
  }, []);

  return null;
}
