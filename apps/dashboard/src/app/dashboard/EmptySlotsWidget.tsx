'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useApi } from '../../lib/api';
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

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    let mounted = true;
    async function fetchEmptySlots() {
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
  }, [get, orgId]);

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

  if (error || !data) return null;
  if (data.days.length === 0) return null;

  const { summary } = data;
  const hasAlerts = summary.underbookedDays > 0;

  if (!hasAlerts) {
    return (
      <section
        aria-label="Semaine bien remplie"
        className="inline-flex max-w-full items-center gap-3 rounded-xl border border-success/20 bg-success/[0.04] px-4 py-3"
      >
        <CheckCircle2 size={20} className="shrink-0 text-success" />
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h2 className="font-semibold text-foreground">Semaine bien remplie</h2>
          <p className="text-sm text-muted-foreground">Aucun jour à renforcer</p>
        </div>
      </section>
    );
  }

  const threshold = summary.threshold > 0 ? summary.threshold : 3;
  const actionableDays = data.days
    .filter((day) => day.isOpen && day.isUnderbooked)
    .slice(0, MAX_VISIBLE_DAYS);
  const remainingDays = Math.max(summary.underbookedDays - actionableDays.length, 0);

  return (
    <section
      aria-labelledby="empty-slots-title"
      className="rounded-2xl border border-warning/25 bg-card p-3.5 shadow-sm sm:p-4 md:p-5"
    >
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
            <AlertTriangle size={17} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 id="empty-slots-title" className="text-base font-bold text-foreground sm:text-lg">
                Jours creux
              </h2>
              <span className="rounded-full border border-warning/25 bg-warning/5 px-2 py-0.5 text-[11px] font-semibold text-warning">
                {summary.underbookedDays} jour{summary.underbookedDays > 1 ? 's' : ''}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {`Sous le seuil de ${threshold} réservations.`}
              {summary.revenueAtRisk > 0 && (
                <span className="ml-1 font-semibold text-warning">
                  {`Manque à gagner estimé : ${summary.revenueAtRisk.toLocaleString('fr-FR')} €`}
                </span>
              )}
            </p>
          </div>
        </div>
        <Button
          asChild
          variant="outline"
          size="sm"
          className="self-start border-warning/30 bg-background text-xs font-bold hover:bg-accent sm:self-auto"
        >
          <Link href="/dashboard/reservations">
            Voir les réservations
            <ArrowRight size={14} />
          </Link>
        </Button>
      </div>

      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background">
        {actionableDays.map((day) => {
          const isToday = day.date === getLocalDateKey(new Date());
          const progress =
            threshold > 0 ? Math.min(100, Math.round((day.reservationCount / threshold) * 100)) : 0;
          const remaining = Math.max(threshold - day.reservationCount, 0);
          return (
            <article
              key={day.date}
              className={`grid min-w-0 gap-3 px-3.5 py-3 transition-colors duration-200 hover:bg-accent/30 sm:grid-cols-[minmax(8rem,1.1fr)_minmax(9rem,0.9fr)_minmax(10rem,1.4fr)_auto] sm:items-center sm:px-4 ${
                isToday ? 'bg-brand/[0.04]' : ''
              }`}
            >
              <div className="flex min-w-0 items-center justify-between gap-3 sm:block">
                <div>
                  <p className="text-sm font-bold leading-tight text-foreground">
                    {formatDayName(day.date, day.dayName)}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatShortDate(day.date)}</p>
                </div>
                {isToday && (
                  <span className="shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-bold text-brand sm:mt-1 sm:inline-flex">
                    Aujourd’hui
                  </span>
                )}
              </div>

              <div className="flex min-w-0 items-center justify-between gap-3">
                <p className="whitespace-nowrap text-sm text-muted-foreground">
                  <span className="font-bold text-foreground">{day.reservationCount}</span> /{' '}
                  {threshold} réservations
                </p>
              </div>

              <div className="min-w-0">
                <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>Couverts prévus</span>
                  <span className="font-semibold text-foreground">
                    {day.covers} couvert{day.covers > 1 ? 's' : ''}
                  </span>
                </div>
                <div
                  className="h-1.5 overflow-hidden rounded-full bg-secondary"
                  role="progressbar"
                  aria-label={`${formatDayName(day.date, day.dayName)} : ${day.reservationCount} sur ${threshold} réservations`}
                  aria-valuemin={0}
                  aria-valuemax={threshold}
                  aria-valuenow={Math.min(day.reservationCount, threshold)}
                >
                  <span
                    className="block h-full rounded-full bg-warning transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              <div className="flex min-w-0 flex-col items-start gap-1 text-[11px] font-semibold text-warning sm:items-end">
                <span>{remaining > 0 ? `${remaining} à remplir` : 'Seuil atteint'}</span>
                {day.revenueAtRisk > 0 && (
                  <span className="text-right text-xs">
                    {`Manque à gagner : ${day.revenueAtRisk.toLocaleString('fr-FR')} €`}
                  </span>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {remainingDays > 0 && (
        <p className="mt-3 text-xs font-medium text-muted-foreground">
          +{remainingDays} autre{remainingDays > 1 ? 's' : ''} jour
          {remainingDays > 1 ? 's' : ''}
        </p>
      )}
    </section>
  );
}
