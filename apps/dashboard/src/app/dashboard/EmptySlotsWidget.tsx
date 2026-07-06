'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarOff, Clock, TrendingDown } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi } from '../../lib/api';

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
      } catch (err: any) {
        if (mounted) setError(err.message || "Impossible de charger l'analyse des créneaux");
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
      <section className="rounded-2xl border border-warning/15 bg-warning/[0.03] p-5 md:p-6">
        <Skeleton className="mb-4 h-6 w-48" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      </section>
    );
  }

  if (error || !data) return null;
  if (data.days.length === 0) return null;

  const { summary } = data;
  const hasAlerts = summary.underbookedDays > 0;

  return (
    <section
      className={`rounded-2xl border p-5 md:p-6 ${
        hasAlerts ? 'border-warning/25 bg-warning/[0.04]' : 'border-success/15 bg-success/[0.03]'
      }`}
    >
      <div className="mb-4 flex items-center gap-3">
        {hasAlerts ? (
          <AlertTriangle size={20} className="text-warning" />
        ) : (
          <Clock size={20} className="text-success" />
        )}
        <div>
          <h2 className="text-lg font-bold text-foreground">
            {hasAlerts
              ? `${summary.underbookedDays} jour${summary.underbookedDays > 1 ? 's' : ''} sous-réservé${summary.underbookedDays > 1 ? 's' : ''} cette semaine`
              : 'Semaine bien remplie'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {hasAlerts ? (
              <>
                <span className="font-semibold text-warning">
                  ~{summary.revenueAtRisk.toLocaleString('fr-FR')} €
                </span>{' '}
                de CA potentiel non réalisé · ticket moyen :{' '}
                {summary.avgRevenuePerReservation.toLocaleString('fr-FR')} €
              </>
            ) : (
              `Tous vos jours d'ouverture ont au moins ${summary.threshold} réservations.`
            )}
          </p>
        </div>
      </div>

      {/* Grille 7 jours */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {data.days.map((day) => {
          const isToday = day.date === new Date().toISOString().split('T')[0];
          return (
            <div
              key={day.date}
              className={`rounded-xl border p-3 text-center transition-all duration-200 ${
                !day.isOpen
                  ? 'border-border bg-card/40 opacity-50'
                  : day.isUnderbooked
                    ? 'border-warning/30 bg-warning/[0.06]'
                    : 'border-success/15 bg-success/[0.04]'
              } ${isToday ? 'ring-1 ring-brand/30' : ''}`}
            >
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {DAY_LABELS[day.dayName] || day.dayName}
              </p>

              {!day.isOpen ? (
                <div className="mt-2 flex flex-col items-center gap-1">
                  <CalendarOff size={16} className="text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground">Fermé</span>
                </div>
              ) : (
                <>
                  <p className="mt-2 text-2xl font-black text-foreground">{day.reservationCount}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {day.reservationCount > 1 ? 'réservations' : 'réservation'}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">{day.covers} couverts</p>
                  {day.isUnderbooked && (
                    <p className="mt-2 flex items-center justify-center gap-1 text-[10px] font-semibold text-warning">
                      <TrendingDown size={10} />
                      {day.revenueAtRisk > 0
                        ? `~${day.revenueAtRisk.toLocaleString('fr-FR')} € manquant`
                        : 'Sous-réservé'}
                    </p>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
