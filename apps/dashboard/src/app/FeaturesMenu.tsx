'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FEATURES } from '@/app/features';

export default function FeaturesMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // Se ferme au clic en dehors ou sur Échap.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-all duration-200 hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Fonctionnalités
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={cn('transition-transform duration-200', open && 'rotate-180')}
        />
      </button>
      {open && (
        <ul
          id={panelId}
          className="day-menu absolute left-0 top-[calc(100%+1.1rem)] w-80 rounded-2xl border p-2 shadow-2xl"
        >
          {FEATURES.map((feature) => (
            <li key={feature.id}>
              <Link
                href={`/#${feature.id}`}
                onClick={() => setOpen(false)}
                className="flex items-baseline justify-between gap-4 rounded-xl px-3 py-2.5 transition-all duration-200 hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{feature.label}</span>
                  <span className="day-muted mt-0.5 block text-xs">{feature.text}</span>
                </span>
                <span className="day-accent shrink-0 font-brand text-sm [word-spacing:0]">
                  {feature.hour}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
