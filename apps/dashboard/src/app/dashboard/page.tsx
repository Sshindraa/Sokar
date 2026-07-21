'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  CalendarCheck,
  Euro,
  RefreshCw,
  TrendingUp,
  Users,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi } from '../../lib/api';

// recharts pèse ~387 KB — on le charge en dynamic import pour ne pas
// bloquer le First Load JS du dashboard. Les KPIs et le header s'affichent
// immédiatement, les graphiques hydratent en arrière-plan.
const DashboardCharts = dynamic(() => import('./DashboardCharts'), {
  loading: () => (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm md:p-6">
      <Skeleton className="mb-4 h-6 w-52" />
      <Skeleton className="h-[280px] w-full rounded-xl" />
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

const PERIOD_OPTIONS: Array<{ value: Period; label: string }> = [
  { value: 'today', label: 'Aujourd’hui' },
  { value: '7d', label: '7 jours' },
  { value: '30d', label: '30 jours' },
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
    // Mode demo local/staging : sans Clerk, NEXT_PUBLIC_DEMO_RESTAURANT_ID
    // agit comme un orgId forcé. On affiche les données de démo pour que le
    // dashboard reste utilisable sans session réelle.
    if (!orgId || orgId === process.env.NEXT_PUBLIC_DEMO_RESTAURANT_ID) {
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
    <div className="space-y-4 select-none md:space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-black tracking-tight text-foreground font-display md:text-3xl">
          Pilotage
        </h1>

        <div
          className="grid shrink-0 grid-cols-3 gap-1 rounded-xl border border-border bg-card p-1 shadow-sm"
          aria-label="Période d’analyse"
        >
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setPeriod(option.value)}
              aria-pressed={period === option.value}
              className={`rounded-lg px-3 py-2 text-center text-xs font-bold transition-all duration-200 ${
                period === option.value
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <ErrorState message={error} onRetry={() => setRefreshNonce((nonce) => nonce + 1)} />
      )}

      {!error && hasData && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Réservations" value={stats.totalReservations} icon={CalendarCheck} />
          <KpiCard label="Couverts" value={stats.covers} icon={Users} />
          <KpiCard
            label="CA estimé"
            value={`${stats.estimatedRevenue.toLocaleString('fr-FR')} €`}
            icon={Euro}
          />
          <KpiCard label="Conversion appels" value={`${stats.conversionRate}%`} icon={TrendingUp} />
        </section>
      )}

      {!error && !hasData && <EmptyDashboardState />}

      <EmptySlotsWidget />

      {!error && hasData && <DashboardCharts analytics={analytics} />}

      <NoShowWidget />
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  icon: typeof CalendarCheck;
}) {
  return (
    <article
      aria-label={`Indicateur ${label}`}
      className="rounded-2xl border border-border bg-card p-4 shadow-sm"
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon size={16} />
        <p className="text-xs font-bold uppercase tracking-wider">{label}</p>
      </div>
      <p className="mt-3 truncate text-2xl font-black tracking-tight text-foreground md:text-3xl">
        {typeof value === 'number' ? value.toLocaleString('fr-FR') : value}
      </p>
    </article>
  );
}

function EmptyDashboardState() {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <BarChart3 size={18} />
        </span>
        <div>
          <h2 className="font-bold text-foreground">Aucune activité sur cette période</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Les résultats apparaîtront après un appel ou une réservation confirmée.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-2 pl-[52px] sm:pl-0">
        <Link
          href="/dashboard/calls"
          className="rounded-xl border border-border px-3 py-2 text-xs font-bold text-foreground transition-all duration-200 hover:bg-accent"
        >
          Voir les appels
        </Link>
        <Link
          href="/dashboard/reservations"
          className="rounded-xl bg-primary px-3 py-2 text-xs font-bold text-primary-foreground transition-all duration-200 hover:opacity-90"
        >
          Réservations
        </Link>
      </div>
    </section>
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-9 w-32 rounded-xl" />
        <Skeleton className="h-11 w-full rounded-xl sm:w-72" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <Skeleton key={item} className="h-32 rounded-2xl border border-border" />
        ))}
      </div>
      <Skeleton className="h-[360px] rounded-2xl border border-border" />
    </div>
  );
}
