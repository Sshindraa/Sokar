/**
 * Styles et constantes partagés entre les sous-composants gift-card.
 *
 * Extrait de gift-card-purchase.tsx pour éviter la duplication.
 */

import type { CSSProperties } from 'react';
import { formatEuro } from '@sokar/shared';

export const reservationTheme: CSSProperties & Record<`--${string}`, string> = {
  '--reservation-bg': '34 32% 92%',
  '--reservation-wash': '34 38% 96%',
  '--reservation-panel': '0 0% 100%',
  '--reservation-ink': '24 10% 10%',
  '--reservation-soft': '24 6% 42%',
  '--reservation-muted': '24 5% 64%',
  '--reservation-line': '28 20% 88%',
  '--reservation-glow': '31 92% 62%',
  '--reservation-success': '142 70% 38%',
};

// Shared button classes — palette Sokar : ink (near-black) pour primary, pas orange
export const primaryBtnClass =
  'flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[hsl(var(--reservation-ink))] text-[17px] font-extrabold text-white shadow-lg shadow-black/10 transition-all duration-200 active:scale-[0.97] hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0';

export const secondaryBtnClass =
  'flex h-12 w-full items-center justify-center gap-1.5 rounded-full border border-[hsl(var(--reservation-line))] bg-white/70 text-[14px] font-bold text-[hsl(var(--reservation-ink))] shadow-sm transition-all duration-200 hover:bg-white active:scale-[0.98]';

// Shared input class — focus ring blue comme le widget résa
export const inputClass =
  'w-full rounded-xl border border-[hsl(var(--reservation-line))] bg-white/70 px-4 py-3 text-[15px] font-medium text-[hsl(var(--reservation-ink))] placeholder:text-[hsl(var(--reservation-muted))] transition-all duration-200 focus:border-white/80 focus:bg-white/62 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--reservation-blue)/0.18)]';

// Shared panel class (glassmorphism)
export const panelClass =
  'rounded-[1.25rem] border border-white/70 bg-white/60 p-5 backdrop-blur-2xl shadow-sm';

// Shared section heading
export const headingClass =
  'font-display text-[1.5rem] font-black leading-tight tracking-[-0.03em] text-[hsl(var(--reservation-ink))]';

export const labelClass =
  'block text-[10px] font-bold uppercase tracking-[0.18em] text-[hsl(var(--reservation-soft))]';

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export { formatEuro };
