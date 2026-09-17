'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
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
      className="rounded-2xl border border-warning/25 bg-warning/[0.04] p-4 md:p-5"
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <AlertTriangle size={20} className="shrink-0 text-warning" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 id="empty-slots-title" className="text-lg font-bold text-foreground">
                Jours creux
              </h2>
              <span className="rounded-full border border-warning/25 bg-card px-2 py-0.5 text-[11px] font-semibold text-warning">
                {summary.underbookedDays} jour{summary.underbookedDays > 1 ? 's' : ''}
              </span>
              {summary.revenueAtRisk > 0 && (
                <span className="text-xs font-semibold text-warning">
                  {`CA estimé : ${summary.revenueAtRisk.toLocaleString('fr-FR')} €`}
                </span>
              )}
            </div>
          </div>
        </div>
        <Link
          href="/dashboard/reservations"
          className="inline-flex items-center gap-1.5 self-start rounded-xl border border-warning/30 bg-card px-3 py-2 text-xs font-bold text-foreground transition-all duration-200 hover:bg-accent sm:self-auto"
        >
          Voir les réservations
          <ArrowRight size={14} />
        </Link>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        {actionableDays.map((day) => {
          const isToday = day.date === getLocalDateKey(new Date());
          return (
            <div
              key={day.date}
              className={`rounded-xl border border-warning/20 bg-card p-3 ${
                isToday ? 'ring-1 ring-brand/30' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-foreground">
                    {formatDayName(day.date, day.dayName)}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatShortDate(day.date)}</p>
                </div>
                {isToday && (
                  <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-bold text-brand">
                    Aujourd’hui
                  </span>
                )}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                <span className="font-bold text-foreground">{day.reservationCount}</span> /{' '}
                {threshold} réservations
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {day.covers} couvert{day.covers > 1 ? 's' : ''} prévu
                {day.covers > 1 ? 's' : ''}
              </p>
              {day.revenueAtRisk > 0 && (
                <p className="mt-1 text-xs font-semibold text-warning">
                  {`CA estimé : ${day.revenueAtRisk.toLocaleString('fr-FR')} €`}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {remainingDays > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          +{remainingDays} autre{remainingDays > 1 ? 's' : ''} jour
          {remainingDays > 1 ? 's' : ''}
        </p>
      )}
    </section>
  );
}
