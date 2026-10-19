'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

// Halo flouté qui monte du bas de page quand le pied de page devient visible.
// Inspiré du « Ruixen Gradient Footer » de 21st.dev.
export default function FooterGlow() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold: 0.2,
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} aria-hidden="true" className="pointer-events-none relative h-48 w-full sm:h-64">
      <div
        className={cn(
          'absolute inset-x-[-10%] bottom-0 h-full origin-bottom blur-2xl transition-all duration-1000 ease-out motion-reduce:transition-none',
          visible ? 'scale-y-100 opacity-100' : 'scale-y-0 opacity-0',
        )}
        style={{
          background:
            // Palette Sokar : bleu nuit, bleu ardoise, gris-bleu pâle.
            'radial-gradient(70% 120% at 50% 100%, hsl(210 30% 92%), hsl(212 30% 72%) 25%, hsl(213 28% 46%) 50%, hsl(216 42% 20%) 75%, transparent 95%)',
          maskImage: 'linear-gradient(to top, black 65%, transparent)',
          WebkitMaskImage: 'linear-gradient(to top, black 65%, transparent)',
        }}
      />
    </div>
  );
}
