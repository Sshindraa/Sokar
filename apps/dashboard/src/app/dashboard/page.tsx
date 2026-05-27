'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, ArrowUpRight, CalendarCheck, MessageSquare, PhoneCall, TrendingUp } from 'lucide-react';
import { useApi } from '../../lib/api';
import { Skeleton } from '@/components/ui/skeleton';

type DashboardStats = {
  totalCalls: number;
  totalReservations: number;
  answeredRate: number;
  revenueRecovered: number;
};

export default function DashboardPage() {
  const { get, orgId } = useApi();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activity, setActivity] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!orgId) return;

    async function fetchData() {
      try {
        const [s, a] = await Promise.all([
          get(`dashboard/stats?restaurantId=${orgId}`),
          get(`dashboard/recent-activity?restaurantId=${orgId}`),
        ]);

        setStats({
          totalCalls: s.total_calls ?? 0,
          totalReservations: s.total_reservations ?? 0,
          answeredRate: s.answered_rate ?? 0,
          revenueRecovered: s.revenue_recovered ?? 0,
        });
        setActivity(a);
      } catch (err: any) {
        setError(err.message || 'Erreur de chargement');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [orgId, get]);

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (error) {
    return (
      <div className="sokar-error">
        <AlertCircle size={18} />
        {error}
      </div>
    );
  }

  const recentReservations = Array.isArray(activity?.reservations)
    ? activity.reservations.slice(0, 4)
    : [];

  return (
    <div className="space-y-8">
      <section className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <div className="rounded-2xl border border-border bg-secondary/70 p-6">
          <p className="text-sm text-muted-foreground">Bon retour,</p>
          <h2 className="mt-3 max-w-lg text-4xl font-semibold leading-none tracking-tight md:text-5xl">
            Votre salle reste joignable, même quand l&apos;équipe est prise.
          </h2>
          <p className="mt-5 text-sm leading-6 text-muted-foreground">
            Suivez les appels traités, réservations captées et revenus récupérés en temps réel.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <MetricCard label="Appels traités" value={formatNum(stats?.totalCalls ?? 0)} icon={PhoneCall} />
          <MetricCard
            label="Réservations"
            value={formatNum(stats?.totalReservations ?? 0)}
            icon={CalendarCheck}
          />
          <MetricCard label="Taux réponse" value={`${stats?.answeredRate ?? 0}%`} icon={TrendingUp} featured />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold tracking-tight">Activité hebdomadaire</h3>
              <p className="mt-1 text-sm text-muted-foreground">Répartition des demandes reçues</p>
            </div>
            <button className="sokar-icon-button" aria-label="Voir les rapports">
              <ArrowUpRight size={16} />
            </button>
          </div>
          <div className="grid h-64 grid-cols-7 items-end gap-3">
            {[44, 58, 36, 72, 64, 88, 52].map((height, index) => (
              <div key={index} className="flex h-full flex-col justify-end gap-3">
                <div
                  className="rounded-t-2xl border border-border bg-primary/80 transition-all duration-200 hover:bg-primary"
                  style={{ height: `${height}%` }}
                />
                <span className="text-center text-xs text-muted-foreground">
                  {['L', 'M', 'M', 'J', 'V', 'S', 'D'][index]}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold tracking-tight">Dernières réservations</h3>
              <p className="mt-1 text-sm text-muted-foreground">Les tables créées par l&apos;assistant</p>
            </div>
            <MessageSquare size={18} className="text-muted-foreground" />
          </div>

          {recentReservations.length === 0 ? (
            <div className="sokar-empty min-h-48">
              <CalendarCheck size={38} className="opacity-30" />
              <p className="text-sm">Aucune réservation récente</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentReservations.map((reservation: any) => (
                <div
                  key={reservation.id}
                  className="grid grid-cols-[1fr_auto] gap-3 rounded-xl border border-border bg-secondary/40 p-4 transition-all duration-200 hover:bg-accent"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{reservation.customerName}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {reservation.partySize} couverts · {reservation.status?.toLowerCase() || 'nouveau'}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(reservation.reservedAt).toLocaleTimeString('fr-FR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  featured,
}: {
  label: string;
  value: string;
  icon: typeof PhoneCall;
  featured?: boolean;
}) {
  return (
    <div className="sokar-card sokar-card-hover p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="sokar-icon-button h-9 w-9">
          <Icon size={16} />
        </span>
        {featured && <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">Live</span>}
      </div>
      <p className="mt-8 text-3xl font-semibold tracking-tight">{value}</p>
      <p className="mt-2 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-8">
      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <Skeleton className="h-64 rounded-2xl" />
        <div className="grid gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-64 rounded-2xl" />
          ))}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Skeleton className="h-80 rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    </div>
  );
}

function formatNum(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString('fr-FR');
}
