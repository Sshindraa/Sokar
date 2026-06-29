/**
 * Sokar Connect — lib/utils.ts
 * Helper `cn()` pour composer les classNames (cf. AGENTS.md "Shadcn UI from
 * @/components/ui/*; class composition via `cn()`").
 */
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
