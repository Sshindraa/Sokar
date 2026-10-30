'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useApi } from '../../lib/api';
import { DataFetchError } from '@/components/DataFetchError';
import { getErrorMessage } from '@/types/api';

interface EmptySlotDay {
  date: string;
  dayName: string;
  isOpen: boolean;
  openTime: string | null;
  closeTime: string | null;
  reservationCount: number;
  covers: number;
  isUnderbooked: boolean;
  revenueAtRisk: number;
}

interface EmptySlotsResponse {
  days: EmptySlotDay[];
  summary: {
    underbookedDays: number;
    totalOpenDays: number;
    revenueAtRisk: number;
    avgRevenuePerReservation: number;
    threshold: number;
  };
}

const DAY_LABELS: Record<string, string> = {
  dim: 'Dimanche',
  lun: 'Lundi',
  mar: 'Mardi',
  mer: 'Mercredi',
  jeu: 'Jeudi',
  ven: 'Vendredi',
  sam: 'Samedi',
};

const MAX_VISIBLE_DAYS = 3;

function getLocalDateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function formatShortDate(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return '';

  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
  }).format(parsed);
}

function formatDayName(date: string, fallback: string) {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return DAY_LABELS[fallback] || fallback;

  const dayName = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' }).format(parsed);
  return dayName.charAt(0).toUpperCase() + dayName.slice(1);
}

export default function EmptySlotsWidget() {
  const { get, orgId } = useApi();
  const [data, setData] = useState<EmptySlotsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    let mounted = true;
    async function fetchEmptySlots() {
      setError('');
      setLoading(true);
      try {
        const res = await get<EmptySlotsResponse>('dashboard/empty-slots');
        if (mounted) setData(res);
      } catch (err: unknown) {
        if (mounted) setError(getErrorMessage(err, "Impossible de charger l'analyse des créneaux"));
      } finally {
        if (mounted) setLoading(false);
      }
    }
    fetchEmptySlots();
    return () => {
      mounted = false;
    };
  }, [get, orgId, reloadKey]);

  if (!orgId) return null;
  if (loading) {
    return (
      <section className="rounded-2xl border border-border bg-card p-4 md:p-5">
        <Skeleton className="mb-4 h-6 w-52" />
        <div className="grid gap-2 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      </section>
    );
  }

  // Une panne ne doit pas ressembler à « aucune journée sous le seuil » : le widget l'annonce et propose de réessayer.
  if (error) {
    return (
      <section aria-label="Jours creux">
        <DataFetchError
          message={error}
          onRetry={() => setReloadKey((key) => key + 1)}
          retrying={loading}
        />
      </section>
    );
  }
  if (!data) return null;
  if (data.days.length === 0) return null;

  const { summary } = data;
  const threshold = summary.threshold > 0 ? summary.threshold : 3;
  const days = data.days
    .filter((day) => day.isOpen && day.reservationCount < threshold)
    .slice(0, MAX_VISIBLE_DAYS);
  const remainingDays = Math.max(summary.underbookedDays - days.length, 0);

  return (
    <section
      aria-labelledby="empty-slots-title"
      className="rounded-2xl border border-border bg-card p-4 md:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 id="empty-slots-title" className="text-base font-semibold text-foreground">
              Journées peu remplies
            </h2>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Comprendre le seuil des journées peu remplies"
                    className="inline-flex rounded text-muted-foreground transition-all duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Info className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Ce seuil est un repère fixe. Il ne mesure pas le remplissage du restaurant et ne
                  permet pas de chiffrer un manque à gagner.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            7 prochains jours · journées avec moins de {threshold} réservations
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/reservations">Voir les réservations</Link>
        </Button>
      </div>
      {days.length === 0 ? (
        <p className="mt-3 text-sm text-foreground">
          {summary.totalOpenDays === 0
            ? 'Aucun jour d’ouverture renseigné sur les 7 prochains jours.'
            : `Au moins ${threshold} réservations sur chaque journée ouverte.`}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {days.map((day) => (
            <li
              key={day.date}
              className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-3 text-sm"
            >
              <div>
                <p className="font-medium text-foreground">
                  {formatDayName(day.date, day.dayName)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatShortDate(day.date)}
                  {day.date === getLocalDateKey(new Date()) ? ' · Aujourd’hui' : ''}
                </p>
              </div>
              <span className="tabular-nums text-foreground">
                {day.reservationCount} réservation{day.reservationCount > 1 ? 's' : ''}
              </span>
              <span className="tabular-nums text-muted-foreground">{day.covers} couverts</span>
            </li>
          ))}
        </ul>
      )}
      {remainingDays > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          +{remainingDays} autre{remainingDays > 1 ? 's' : ''} jour{remainingDays > 1 ? 's' : ''}
        </p>
      )}
    </section>
  );
}
