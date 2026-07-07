'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CalendarCheck,
  ChevronRight,
  PhoneCall,
  RefreshCw,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi } from '../../lib/api';

const EmptySlotsWidget = dynamic(() => import('./EmptySlotsWidget'), {
  ssr: false,
});

const NoShowWidget = dynamic(() => import('./NoShowWidget'), {
  ssr: false,
});

type Period = 'today' | '7d' | '30d';

interface DashboardStatsResponse {
  period?: Period;
  total_calls?: number;
  total_reservations?: number;
  covers?: number;
  conversion_rate?: number;
  answered_rate?: number;
  estimated_revenue?: number;
}

export interface AnalyticsPoint {
  label: string;
  calls: number;
  reservations: number;
  covers: number;
  revenue: number;
}

interface AnalyticsResponse {
  data?: AnalyticsPoint[];
}

interface DashboardStats {
  totalCalls: number;
  totalReservations: number;
  covers: number;
  conversionRate: number;
  answeredRate: number;
  estimatedRevenue: number;
}

const PERIOD_OPTIONS: Array<{ value: Period; label: string; description: string }> = [
  { value: 'today', label: 'Aujourd’hui', description: 'Vue horaire' },
  { value: '7d', label: '7j', description: '7 derniers jours' },
  { value: '30d', label: '30j', description: '30 derniers jours' },
];

const EMPTY_STATS: DashboardStats = {
  totalCalls: 0,
  totalReservations: 0,
  covers: 0,
  conversionRate: 0,
  answeredRate: 0,
  estimatedRevenue: 0,
};

const DEMO_ANALYTICS_BY_PERIOD: Record<Period, AnalyticsPoint[]> = {
  today: [
    { label: '09h', calls: 2, reservations: 1, covers: 2, revenue: 86 },
    { label: '10h', calls: 3, reservations: 2, covers: 5, revenue: 215 },
    { label: '11h', calls: 5, reservations: 3, covers: 8, revenue: 344 },
    { label: '12h', calls: 7, reservations: 4, covers: 11, revenue: 473 },
    { label: '13h', calls: 4, reservations: 2, covers: 6, revenue: 258 },
    { label: '18h', calls: 6, reservations: 4, covers: 10, revenue: 430 },
    { label: '19h', calls: 8, reservations: 5, covers: 14, revenue: 602 },
    { label: '20h', calls: 5, reservations: 3, covers: 7, revenue: 301 },
  ],
  '7d': [
    { label: 'lun. 13', calls: 12, reservations: 7, covers: 18, revenue: 774 },
    { label: 'mar. 14', calls: 16, reservations: 10, covers: 26, revenue: 1118 },
    { label: 'mer. 15', calls: 14, reservations: 9, covers: 22, revenue: 946 },
    { label: 'jeu. 16', calls: 21, reservations: 13, covers: 34, revenue: 1462 },
    { label: 'ven. 17', calls: 28, reservations: 18, covers: 49, revenue: 2107 },
    { label: 'sam. 18', calls: 31, reservations: 21, covers: 57, revenue: 2451 },
    { label: 'dim. 19', calls: 18, reservations: 11, covers: 29, revenue: 1247 },
  ],
  '30d': [
    { label: '01/06', calls: 44, reservations: 27, covers: 71, revenue: 3053 },
    { label: '05/06', calls: 58, reservations: 36, covers: 96, revenue: 4128 },
    { label: '10/06', calls: 63, reservations: 41, covers: 112, revenue: 4816 },
    { label: '15/06', calls: 72, reservations: 46, covers: 128, revenue: 5504 },
    { label: '20/06', calls: 69, reservations: 44, covers: 119, revenue: 5117 },
    { label: '25/06', calls: 76, reservations: 51, covers: 141, revenue: 6063 },
    { label: '30/06', calls: 84, reservations: 56, covers: 154, revenue: 6622 },
  ],
};

function summarizeAnalytics(data: AnalyticsPoint[]): DashboardStats {
  const totalCalls = data.reduce((sum, item) => sum + item.calls, 0);
  const totalReservations = data.reduce((sum, item) => sum + item.reservations, 0);
  const covers = data.reduce((sum, item) => sum + item.covers, 0);
  const estimatedRevenue = data.reduce((sum, item) => sum + item.revenue, 0);

  return {
    totalCalls,
    totalReservations,
    covers,
    conversionRate: totalCalls > 0 ? Math.round((totalReservations / totalCalls) * 100) : 0,
    answeredRate: 94,
    estimatedRevenue,
  };
}

export default function DashboardPage() {
  const { get, orgId } = useApi();
  const [period, setPeriod] = useState<Period>('7d');
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [analytics, setAnalytics] = useState<AnalyticsPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    if (!orgId) {
      const demoAnalytics = DEMO_ANALYTICS_BY_PERIOD[period];
      setStats(summarizeAnalytics(demoAnalytics));
      setAnalytics(demoAnalytics);
      setError('');
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    async function fetchAnalytics() {
      setIsLoading(true);
      setError('');

      try {
        const [statsResponse, analyticsResponse] = await Promise.all([
          get<DashboardStatsResponse>(`dashboard/stats?period=${period}`),
          get<AnalyticsResponse>(`dashboard/analytics?period=${period}`),
        ]);

        if (!isMounted) return;

        setStats({
          totalCalls: statsResponse.total_calls ?? 0,
          totalReservations: statsResponse.total_reservations ?? 0,
          covers: statsResponse.covers ?? 0,
          conversionRate: statsResponse.conversion_rate ?? 0,
          answeredRate: statsResponse.answered_rate ?? 0,
          estimatedRevenue: statsResponse.estimated_revenue ?? 0,
        });
        setAnalytics(analyticsResponse.data ?? []);
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Impossible de charger les analytics');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    fetchAnalytics();

    return () => {
      isMounted = false;
    };
  }, [get, orgId, period, refreshNonce]);

  const hasData = useMemo(
    () =>
      stats.totalCalls > 0 ||
      stats.totalReservations > 0 ||
      stats.covers > 0 ||
      stats.estimatedRevenue > 0,
    [stats],
  );

  if (isLoading) return <DashboardSkeleton />;

  return (
    <div className="select-none space-y-3">
      <h1 className="sr-only">Tableau de bord Sokar</h1>
      {error && (
        <ErrorState message={error} onRetry={() => setRefreshNonce((nonce) => nonce + 1)} />
      )}

      {!error && !hasData && (
        <p className="rounded-[1.15rem] border border-warning/25 bg-warning/10 px-4 py-3 text-sm text-warning">
          Pas encore de données pour cette période — les KPI apparaîtront dès que Sokar reçoit des
          appels ou confirme des réservations.
        </p>
      )}

      {!error && hasData && (
        <section className="grid gap-3 lg:grid-cols-[1.2fr_0.88fr]">
          <div className="space-y-3">
            <article className="rounded-[1.35rem] border border-border bg-card p-4 shadow-sm md:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-brand">
                      <PhoneCall size={15} />
                    </span>
                    <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                      Suivi des réservations
                    </h2>
                  </div>
                  <p className="mt-1 max-w-md text-[11px] leading-5 text-muted-foreground">
                    Réservations générées par Sokar et progression des appels transformés.
                  </p>
                </div>
                <PeriodSelect period={period} onChange={setPeriod} />
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-[9rem_1fr] md:items-end">
                <div>
                  <p className="text-3xl font-semibold tracking-tight text-foreground">
                    +{stats.conversionRate}%
                  </p>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                    Taux appels vers réservations sur la période.
                  </p>
                </div>
                <TrackerChart analytics={analytics} />
              </div>
            </article>

            <div className="grid gap-3 md:grid-cols-[0.8fr_1fr]">
              <article className="rounded-[1.2rem] border border-border bg-card/90 p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">Clients récents</h3>
                  <span className="text-[10px] font-medium text-muted-foreground">Voir tout</span>
                </div>
                <div className="space-y-2">
                  <ContactRow name="Pierre Dubois" label="VIP" meta="Table pour 4 ce soir" />
                  <ContactRow name="Claire Martin" label="Nouveau" meta="Demande terrasse" />
                </div>
              </article>

              <article className="relative overflow-hidden rounded-[1.2rem] border border-border bg-card/90 p-4 shadow-sm">
                <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[repeating-linear-gradient(110deg,hsl(var(--border))_0,hsl(var(--border))_1px,transparent_1px,transparent_7px)] opacity-40" />
                <div className="relative z-10 max-w-[72%]">
                  <h3 className="text-sm font-semibold text-foreground">
                    Optimisation automatique
                  </h3>
                  <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                    Sokar priorise les créneaux à fort potentiel et relance les demandes utiles.
                  </p>
                  <button
                    type="button"
                    className="mt-4 inline-flex h-8 w-full max-w-44 items-center justify-between rounded-full bg-primary px-4 text-[11px] font-semibold text-primary-foreground transition-all duration-200 hover:opacity-90"
                  >
                    Voir les actions
                    <ChevronRight size={13} />
                  </button>
                </div>
              </article>
            </div>
          </div>

          <div className="space-y-3">
            <article className="rounded-[1.25rem] border border-border bg-card/85 p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Activité récente</h3>
                <span className="text-[10px] font-medium text-muted-foreground">Tout voir</span>
              </div>
              <div className="space-y-3">
                <ActivityRow
                  icon={PhoneCall}
                  title="Appels reçus"
                  value={`${stats.totalCalls.toLocaleString('fr-FR')}`}
                  badge="Live"
                  tone="brand"
                />
                <ActivityRow
                  icon={CalendarCheck}
                  title="Réservations confirmées"
                  value={`${stats.totalReservations.toLocaleString('fr-FR')}`}
                  badge="Auto"
                  tone="success"
                />
                <ActivityRow
                  icon={Users}
                  title="Couverts générés"
                  value={`${stats.covers.toLocaleString('fr-FR')}`}
                  badge="Service"
                  tone="blue"
                />
              </div>
            </article>

            <article className="rounded-[1.25rem] border border-border bg-card/85 p-4 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Progression commerciale</h3>
                <span className="text-[10px] font-medium text-muted-foreground">
                  Période active
                </span>
              </div>
              <div className="grid grid-cols-3 divide-x divide-border rounded-2xl border border-border bg-secondary/45">
                <MetricCell
                  label="Revenu"
                  value={`${Math.round(stats.estimatedRevenue / 1000)}k€`}
                />
                <MetricCell label="Réserv." value={stats.totalReservations} />
                <MetricCell label="Réponse" value={`${stats.answeredRate}%`} />
              </div>
              <div className="mt-4 flex h-16 items-end gap-1">
                {[
                  38, 46, 44, 52, 48, 60, 55, 68, 62, 74, 66, 78, 72, 82, 76, 88, 80, 92, 84, 90,
                ].map((height, index) => (
                  <span
                    key={index}
                    className="flex-1 rounded-full bg-brand/45"
                    style={{ height }}
                  />
                ))}
              </div>
            </article>
          </div>
        </section>
      )}

      {!error && hasData && (
        <section className="grid gap-3 lg:grid-cols-2">
          <EmptySlotsWidget />
          <NoShowWidget />
        </section>
      )}
    </div>
  );
}

function PeriodSelect({
  period,
  onChange,
}: {
  period: Period;
  onChange: (period: Period) => void;
}) {
  return (
    <div className="grid w-28 grid-cols-1 rounded-full border border-border bg-secondary/70 p-1 md:w-24">
      <select
        value={period}
        onChange={(event) => onChange(event.target.value as Period)}
        className="h-8 rounded-full border-0 bg-card px-3 text-[11px] font-semibold text-foreground shadow-sm outline-none transition-all duration-200"
        aria-label="Choisir la période"
      >
        {PERIOD_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function TrackerChart({ analytics }: { analytics: AnalyticsPoint[] }) {
  const maxReservations = Math.max(...analytics.map((item) => item.reservations), 1);
  const maxCalls = Math.max(...analytics.map((item) => item.calls), 1);

  return (
    <div className="relative min-h-48 rounded-[1.1rem] bg-gradient-to-b from-transparent to-secondary/40 px-2 pb-2 pt-6">
      <div className="absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground shadow-sm">
        {analytics.reduce((sum, item) => sum + item.revenue, 0).toLocaleString('fr-FR')} €
      </div>
      <div className="flex h-40 items-end justify-between gap-2">
        {analytics.map((item, index) => {
          const reservationHeight = Math.max(24, (item.reservations / maxReservations) * 112);
          const callTop = Math.max(10, 128 - (item.calls / maxCalls) * 112);
          const active = index === Math.floor(analytics.length / 2);

          return (
            <div key={item.label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <div className="relative h-32 w-full">
                <span className="absolute bottom-0 left-1/2 h-full w-px -translate-x-1/2 bg-border" />
                <span
                  className="absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-accent-cyan shadow-sm"
                  style={{ top: callTop }}
                />
                <span
                  className="absolute bottom-0 left-1/2 w-1 -translate-x-1/2 rounded-full bg-brand/55"
                  style={{ height: reservationHeight }}
                />
              </div>
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ${
                  active
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-secondary text-muted-foreground'
                }`}
              >
                {item.label.charAt(0).toUpperCase()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActivityRow({
  icon: Icon,
  title,
  value,
  badge,
  tone,
}: {
  icon: LucideIcon;
  title: string;
  value: string;
  badge: string;
  tone: 'brand' | 'success' | 'blue';
}) {
  const toneClass =
    tone === 'brand'
      ? 'bg-brand/12 text-brand'
      : tone === 'success'
        ? 'bg-success/12 text-success'
        : 'bg-accent-cyan/12 text-accent-cyan';

  return (
    <div className="rounded-[1rem] border border-border bg-secondary/35 p-3">
      <div className="flex items-start gap-3">
        <span
          className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${toneClass}`}
        >
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-semibold text-foreground">{title}</p>
            <span className="rounded-full bg-card px-2 py-0.5 text-[9px] font-bold text-foreground shadow-sm">
              {badge}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            Donnée consolidée depuis les appels et réservations Sokar.
          </p>
          <p className="mt-2 text-xs font-semibold text-foreground">{value}</p>
        </div>
        <button
          type="button"
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-card text-muted-foreground shadow-sm transition-all duration-200 hover:text-foreground"
          aria-label={`Ouvrir ${title}`}
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

function ContactRow({ name, label, meta }: { name: string; label: string; meta: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[1rem] bg-secondary/35 p-2">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-xs font-semibold text-foreground shadow-sm">
        {name
          .split(' ')
          .map((part) => part[0])
          .join('')}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-xs font-semibold text-foreground">{name}</p>
          <span className="rounded-full bg-brand/10 px-1.5 py-0.5 text-[8px] font-bold uppercase text-brand">
            {label}
          </span>
        </div>
        <p className="truncate text-[10px] text-muted-foreground">{meta}</p>
      </div>
      <button
        type="button"
        className="flex h-6 w-6 items-center justify-center rounded-full bg-card text-muted-foreground shadow-sm transition-all duration-200 hover:text-foreground"
        aria-label={`Ouvrir ${name}`}
      >
        <ChevronRight size={12} />
      </button>
    </div>
  );
}

function MetricCell({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="p-3">
      <p className="text-[10px] leading-4 text-muted-foreground">{label}</p>
      <p className="mt-1 text-base font-semibold text-foreground">{value}</p>
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
  featured = false,
  className = '',
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  featured?: boolean;
  className?: string;
}) {
  return (
    <article
      className={`group relative overflow-hidden rounded-[1.35rem] border p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 ${
        featured
          ? 'border-brand/25 bg-brand/[0.08] shadow-[0_20px_40px_hsl(var(--brand)/0.10)]'
          : 'border-border bg-card/85 hover:border-foreground/15'
      } ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-full border ${
            featured
              ? 'border-brand/25 bg-brand/10 text-brand'
              : 'border-border bg-secondary text-muted-foreground'
          }`}
        >
          <Icon size={18} />
        </span>
        <span className="h-2 w-2 rounded-full bg-muted-foreground/30 transition-all duration-200 group-hover:bg-brand" />
      </div>
      <p
        className={`mt-6 truncate text-2xl font-black tracking-tight md:text-3xl ${
          featured ? 'text-brand' : 'text-foreground'
        }`}
      >
        {typeof value === 'number' ? value.toLocaleString('fr-FR') : value}
      </p>
      <p className="mt-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {featured && (
        <div className="absolute bottom-4 right-4 hidden h-20 items-end gap-1.5 sm:flex">
          {[30, 44, 36, 58, 48, 72, 54, 82, 62, 76, 50, 68].map((height, index) => (
            <span key={index} className="w-1 rounded-full bg-brand/40" style={{ height }} />
          ))}
        </div>
      )}
    </article>
  );
}

function MiniSignal({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-[1rem] border border-border bg-card/75 p-3 shadow-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon size={13} />
        <span className="truncate text-[10px] font-bold uppercase tracking-[0.16em]">{label}</span>
      </div>
      <p className="mt-2 truncate text-sm font-black text-foreground">{value}</p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-destructive/50 bg-destructive/10 p-5 text-destructive">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <AlertCircle size={20} />
          <p className="text-sm font-semibold">{message}</p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-destructive/30 px-3 py-2 text-xs font-bold transition-all duration-200 hover:bg-destructive/10"
        >
          <RefreshCw size={14} />
          Réessayer
        </button>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-[1.2fr_0.88fr]">
        <div className="space-y-3">
          <Skeleton className="h-[18rem] rounded-[1.35rem] border border-border" />
          <div className="grid gap-3 md:grid-cols-2">
            <Skeleton className="h-32 rounded-[1.2rem] border border-border" />
            <Skeleton className="h-32 rounded-[1.2rem] border border-border" />
          </div>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-[16rem] rounded-[1.25rem] border border-border" />
          <Skeleton className="h-[12rem] rounded-[1.25rem] border border-border" />
        </div>
      </div>
    </div>
  );
}
