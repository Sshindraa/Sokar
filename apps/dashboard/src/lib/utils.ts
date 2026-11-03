import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function triggerHaptic(duration = 15) {
  if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
    try {
      window.navigator.vibrate(duration);
    } catch (e) {
      // Ignore vibration errors silently
    }
  }
}

/** Numéro français lisible (« +33 6 12 34 56 78 ») ; tout autre format reste tel quel. */
export function formatPhone(phone: string): string {
  const match = /^\+33(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(phone);
  return match ? `+33 ${match.slice(1).join(' ')}` : phone;
}
