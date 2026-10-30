import { format, isToday, isYesterday } from 'date-fns';
import { fr } from 'date-fns/locale';

// Formats partagés des écrans du dashboard (fr-FR). Une valeur absente ou invalide donne le repli, jamais une exception.

const eurFormat = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const percentFormat = new Intl.NumberFormat('fr-FR', { style: 'percent' });

export function formatEUR(value: number | string | null | undefined, fallback = '—'): string {
  if (value === null || value === undefined || value === '') return fallback;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? eurFormat.format(numeric) : fallback;
}

// Ratio entre 0 et 1 : 0.45 → « 45 % ».
export function formatPercent(ratio: number | null | undefined, fallback = '—'): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return fallback;
  return percentFormat.format(ratio);
}

// Secondes → « 3 min 12 s », « 45 s ». Zéro ou absent : repli.
export function formatDuration(seconds: number | null | undefined, fallback = '—'): string {
  if (!seconds || seconds <= 0) return fallback;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes} min${rest ? ` ${rest} s` : ''}` : `${rest} s`;
}

// « Aujourd’hui, 09:05 », « Hier, 18:30 », sinon « 20 oct., 10:00 » (année ajoutée hors année courante).
export function formatRelativeDateTime(
  value: string | Date | null | undefined,
  fallback = '—',
): string {
  if (!value) return fallback;
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return fallback;
  const time = format(date, 'HH:mm');
  if (isToday(date)) return `Aujourd’hui, ${time}`;
  if (isYesterday(date)) return `Hier, ${time}`;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return format(date, sameYear ? 'd MMM, HH:mm' : 'd MMM yyyy, HH:mm', { locale: fr });
}
