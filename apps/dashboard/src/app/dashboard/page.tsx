'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CalendarCheck,
  CheckCircle2,
  Clock3,
  Euro,
  MessageCircle,
  PhoneCall,
  RefreshCw,
  TrendingUp,
  Utensils,
  Users,
  Waves,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi } from '../../lib/api';
import GaugeDial from '@/components/GaugeDial';

// recharts pèse ~387 KB — on le charge en dynamic import pour ne pas
// bloquer le First Load JS du dashboard. Les KPIs et le header s'affichent
// immédiatement, les graphiques hydratent en arrière-plan.
const DashboardCharts = dynamic(() => import('./DashboardCharts'), {
  loading: () => (
    <section className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm md:p-6">
        <Skeleton className="mb-5 h-6 w-48" />
        <Skeleton className="h-[320px] w-full rounded-xl" />
      </div>
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm md:p-6">
        <Skeleton className="mb-5 h-6 w-40" />
        <Skeleton className="h-[320px] w-full rounded-xl" />
      </div>
    </section>
  ),
});

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
    <div className="select-none space-y-4 md:space-y-5">
      <header className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-center">
        <div className="min-w-0 rounded-[1.35rem] border border-border bg-card/75 p-4 shadow-sm md:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/20 bg-brand/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-brand">
              <Activity size={12} />
              Analytics restaurant
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-success/20 bg-success/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-success">
              <CheckCircle2 size={12} />
              Agent actif
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-black leading-[1.08] tracking-tight text-foreground md:text-4xl font-display">
            Ce que Sokar vous rapporte
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground font-sans">
            Appels captés, réservations confirmées, couverts générés et revenu estimé sur la
            période, présentés comme un cockpit opérationnel pour votre restaurant.
          </p>
          {!error && !hasData && (
            <p className="mt-3 text-sm text-warning">
              Pas encore de données pour cette période — les KPI apparaîtront dès que Sokar reçoit
              des appels ou confirme des réservations.
            </p>
          )}
        </div>

        <div className="grid w-full grid-cols-3 gap-1.5 rounded-full border border-border bg-card/75 p-1.5 shadow-sm lg:justify-self-end">
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setPeriod(option.value)}
              className={`min-w-0 rounded-full px-3 py-2 text-center transition-all duration-200 ${
                period === option.value
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              <span className="block truncate text-xs font-black uppercase tracking-wider">
                {option.label}
              </span>
              <span className="hidden text-[10px] font-medium leading-tight md:block">
                {option.description}
              </span>
            </button>
          ))}
        </div>
      </header>

      {error && (
        <ErrorState message={error} onRetry={() => setRefreshNonce((nonce) => nonce + 1)} />
      )}

      {!error && hasData && (
        <section className="grid gap-3 xl:grid-cols-[1.05fr_1.55fr]">
          <article className="relative min-h-[28rem] overflow-hidden rounded-[1.6rem] border border-border bg-card p-5 shadow-sm md:p-6">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_32%_22%,hsl(var(--accent-cyan)/0.20),transparent_28%),radial-gradient(circle_at_86%_8%,hsl(var(--brand)/0.14),transparent_26%)]" />
            <div className="relative z-10 flex h-full flex-col justify-between gap-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
                    Agent vocal
                  </p>
                  <h2 className="mt-2 text-3xl font-black tracking-tight text-foreground md:text-4xl">
                    Réception augmentée
                  </h2>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-success/20 bg-success/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-success">
                  <span className="h-1.5 w-1.5 rounded-full bg-success" />
                  En ligne
                </span>
              </div>

              <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
                <div className="relative min-h-52 rounded-[1.4rem] border border-border bg-secondary/50 p-4">
                  <div className="absolute left-5 top-5 flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-2 shadow-sm">
                    <PhoneCall size={15} className="text-brand" />
                    <span className="text-xs font-bold text-foreground">Appel entrant</span>
                  </div>
                  <div className="absolute bottom-5 left-5 right-5 rounded-[1.1rem] border border-border bg-card/85 p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                          Conversion
                        </p>
                        <p className="mt-1 text-2xl font-black text-foreground">
                          {stats.conversionRate}%
                        </p>
                      </div>
                      <div className="flex h-12 items-end gap-1">
                        {[32, 48, 36, 62, 44, 70, 54, 82].map((height, index) => (
                          <span
                            key={index}
                            className="w-1.5 rounded-full bg-brand/70"
                            style={{ height }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="absolute right-7 top-20 flex h-24 w-24 items-center justify-center rounded-full border border-border bg-card/70 shadow-sm">
                    <Waves size={34} className="text-accent-cyan" />
                  </div>
                </div>

                <GaugeDial
                  value={stats.answeredRate}
                  label="Taux de réponse"
                  sublabel="des appels reçus"
                  size={190}
                  strokeWidth={12}
                  accentClassName="text-brand"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <MiniSignal icon={Clock3} label="Latence" value="< 3 s" />
                <MiniSignal icon={MessageCircle} label="Rappels" value="SMS" />
                <MiniSignal icon={Utensils} label="Service" value="Midi & soir" />
              </div>
            </div>
          </article>

          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard label="Appels reçus" value={stats.totalCalls} icon={PhoneCall} />
            <KpiCard
              label="Réservations confirmées"
              value={stats.totalReservations}
              icon={CalendarCheck}
            />
            <KpiCard label="Couverts" value={stats.covers} icon={Users} />
            <KpiCard
              label="Taux appels → résa"
              value={`${stats.conversionRate}%`}
              icon={TrendingUp}
            />
            <KpiCard
              label="Revenu estimé"
              value={`${stats.estimatedRevenue.toLocaleString('fr-FR')} €`}
              icon={Euro}
              featured
              className="col-span-2 sm:col-span-4"
            />
          </section>
        </section>
      )}

      <section className="space-y-4">
        <EmptySlotsWidget />
        <NoShowWidget />
      </section>

      <DashboardCharts analytics={analytics} />
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
    <div className="space-y-6 md:space-y-8">
      <div className="grid gap-5 pb-2 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] lg:items-start">
        <div className="min-w-0 space-y-3">
          <Skeleton className="h-4 w-40 rounded-full" />
          <Skeleton className="h-10 w-80 rounded-xl" />
          <Skeleton className="h-4 w-96 max-w-full rounded-full" />
        </div>
        <Skeleton className="h-14 w-full rounded-2xl lg:justify-self-end" />
      </div>
      <div className="grid gap-3 xl:grid-cols-[0.9fr_1.6fr]">
        <Skeleton className="h-64 rounded-2xl border border-border" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[1, 2, 3, 4].map((item) => (
            <Skeleton key={item} className="h-36 rounded-2xl border border-border" />
          ))}
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <Skeleton className="h-[420px] rounded-2xl border border-border" />
        <Skeleton className="h-[420px] rounded-2xl border border-border" />
      </div>
    </div>
  );
}
