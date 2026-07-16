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
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
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
      <section className="flex items-center gap-3 rounded-2xl border border-success/20 bg-success/[0.04] p-5">
        <CheckCircle2 size={20} className="shrink-0 text-success" />
        <div>
          <h2 className="font-bold text-foreground">Semaine bien remplie</h2>
          <p className="text-sm text-muted-foreground">Aucun jour à renforcer.</p>
        </div>
      </section>
    );
  }

  const actionableDays = data.days.filter((day) => day.isOpen && day.isUnderbooked).slice(0, 4);

  return (
    <section className="rounded-2xl border border-warning/25 bg-warning/[0.04] p-4 md:p-5">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <AlertTriangle size={20} className="shrink-0 text-warning" />
          <div>
            <h2 className="text-lg font-bold text-foreground">
              {summary.underbookedDays} jour{summary.underbookedDays > 1 ? 's' : ''} à remplir
            </h2>
            {summary.revenueAtRisk > 0 && (
              <p className="text-sm font-semibold text-warning">
                ~{summary.revenueAtRisk.toLocaleString('fr-FR')} € de CA potentiel
              </p>
            )}
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

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {actionableDays.map((day) => {
          const isToday = day.date === new Date().toISOString().split('T')[0];
          return (
            <div
              key={day.date}
              className={`rounded-xl border border-warning/20 bg-card p-3 ${
                isToday ? 'ring-1 ring-brand/30' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold text-foreground">
                  {DAY_LABELS[day.dayName] || day.dayName}
                </p>
                {isToday && (
                  <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-bold text-brand">
                    Aujourd’hui
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                <span className="font-bold text-foreground">{day.reservationCount}</span> résa
                {day.reservationCount > 1 ? 's' : ''} · {day.covers} couverts
              </p>
              {day.revenueAtRisk > 0 && (
                <p className="mt-1 text-xs font-semibold text-warning">
                  ~{day.revenueAtRisk.toLocaleString('fr-FR')} € à récupérer
                </p>
              )}
            </div>
          );
        })}
      </div>
      {summary.underbookedDays > actionableDays.length && (
        <p className="mt-3 text-xs text-muted-foreground">
          +{summary.underbookedDays - actionableDays.length} autre
          {summary.underbookedDays - actionableDays.length > 1 ? 's' : ''} jour
          {summary.underbookedDays - actionableDays.length > 1 ? 's' : ''} à remplir
        </p>
      )}
    </section>
  );
}
