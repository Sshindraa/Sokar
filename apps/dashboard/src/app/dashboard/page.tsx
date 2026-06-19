'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CalendarCheck,
  Euro,
  PhoneCall,
  RefreshCw,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi } from '../../lib/api';

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

interface AnalyticsPoint {
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
    <div className="space-y-6 md:space-y-8 select-none">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-cyan-400">
            Analytics restaurant
          </p>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-white md:text-4xl font-display">
            Ce que Sokar vous rapporte
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-white/45 font-sans">
            Appels captés, réservations confirmées, couverts générés et revenu estimé sur la
            période.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-2xl border border-white/5 bg-white/[0.02] p-1.5">
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setPeriod(option.value)}
              className={`rounded-xl px-3 py-2 text-left transition-all duration-200 ${
                period === option.value
                  ? 'bg-cyan-500 text-white shadow-[0_0_24px_rgba(6,182,212,0.16)]'
                  : 'text-white/45 hover:bg-white/[0.04] hover:text-white'
              }`}
            >
              <span className="block text-xs font-black uppercase tracking-wider">
                {option.label}
              </span>
              <span className="hidden text-[10px] font-medium md:block">{option.description}</span>
            </button>
          ))}
        </div>
      </header>

      {error && (
        <ErrorState message={error} onRetry={() => setRefreshNonce((nonce) => nonce + 1)} />
      )}

      {!error && !hasData && <EmptyState />}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Appels reçus" value={stats.totalCalls} icon={PhoneCall} />
        <KpiCard
          label="Réservations confirmées"
          value={stats.totalReservations}
          icon={CalendarCheck}
        />
        <KpiCard label="Couverts" value={stats.covers} icon={Users} />
        <KpiCard
          label="Taux appels → réservations"
          value={`${stats.conversionRate}%`}
          icon={TrendingUp}
        />
        <KpiCard
          label="Revenu estimé"
          value={`${stats.estimatedRevenue.toLocaleString('fr-FR')} €`}
          icon={Euro}
          featured
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <ChartCard
          title="Appels et réservations"
          subtitle="Le volume entrant comparé aux réservations confirmées."
        >
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={analytics} margin={{ left: -18, right: 10, top: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="callsGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="reservationsGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#34d399" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="rgba(255,255,255,0.35)"
                tickLine={false}
                axisLine={false}
              />
              <YAxis stroke="rgba(255,255,255,0.35)" tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Area
                type="monotone"
                dataKey="calls"
                name="Appels"
                stroke="#22d3ee"
                fill="url(#callsGradient)"
                strokeWidth={2.5}
              />
              <Area
                type="monotone"
                dataKey="reservations"
                name="Réservations"
                stroke="#34d399"
                fill="url(#reservationsGradient)"
                strokeWidth={2.5}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Couverts générés" subtitle="Nombre de personnes réservées via Sokar.">
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={analytics} margin={{ left: -18, right: 10, top: 10, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="rgba(255,255,255,0.35)"
                tickLine={false}
                axisLine={false}
              />
              <YAxis stroke="rgba(255,255,255,0.35)" tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="covers" name="Couverts" fill="#22d3ee" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </section>

      <section className="rounded-2xl border border-cyan-500/15 bg-cyan-500/[0.04] p-5 md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-black text-white font-display">Lecture rapide</h2>
            <p className="mt-1 text-sm text-white/45">
              Sokar transforme {stats.totalCalls.toLocaleString('fr-FR')} appels en{' '}
              {stats.totalReservations.toLocaleString('fr-FR')} réservations confirmées, soit{' '}
              {stats.covers.toLocaleString('fr-FR')} couverts et environ{' '}
              {stats.estimatedRevenue.toLocaleString('fr-FR')} € de revenu attribuable.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-right">
            <p className="text-[10px] font-bold uppercase tracking-wider text-white/35">
              Réponse appels
            </p>
            <p className="text-2xl font-black text-cyan-400">{stats.answeredRate}%</p>
          </div>
        </div>
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
  featured = false,
}: {
  label: string;
  value: number | string;
  icon: typeof PhoneCall;
  featured?: boolean;
}) {
  return (
    <article
      className={`rounded-2xl border p-4 shadow-xl transition-all duration-200 hover:-translate-y-0.5 ${
        featured
          ? 'border-cyan-500/25 bg-cyan-500/[0.05] shadow-[0_0_28px_rgba(6,182,212,0.08)]'
          : 'border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-full border ${
            featured
              ? 'border-cyan-500/25 bg-cyan-500/10 text-cyan-400'
              : 'border-white/5 bg-white/5 text-white/50'
          }`}
        >
          <Icon size={18} />
        </span>
      </div>
      <p
        className={`mt-5 truncate text-2xl font-black tracking-tight ${featured ? 'text-cyan-400' : 'text-white'}`}
      >
        {typeof value === 'number' ? value.toLocaleString('fr-FR') : value}
      </p>
      <p className="mt-1 text-[11px] font-bold uppercase tracking-wider text-white/40">{label}</p>
    </article>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <article className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 shadow-xl md:p-6">
      <div className="mb-5">
        <h2 className="text-lg font-black tracking-tight text-white font-display">{title}</h2>
        <p className="mt-1 text-xs font-medium text-white/40">{subtitle}</p>
      </div>
      {children}
    </article>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-black/90 px-3 py-2 shadow-2xl">
      <p className="mb-1 text-xs font-bold text-white">{label}</p>
      <div className="space-y-1">
        {payload.map((item) => (
          <p key={item.name} className="text-[11px] font-medium text-white/60">
            <span style={{ color: item.color }}>●</span> {item.name}:{' '}
            {item.value?.toLocaleString('fr-FR') ?? 0}
          </p>
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.015] p-8 text-center">
      <PhoneCall size={34} className="mx-auto text-white/25" />
      <h2 className="mt-4 text-lg font-black text-white">
        Pas encore de données sur cette période
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-white/40">
        Les KPI se rempliront automatiquement dès que Sokar reçoit des appels ou confirme des
        réservations.
      </p>
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
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <Skeleton className="h-4 w-40 rounded-full bg-white/5" />
          <Skeleton className="h-10 w-80 rounded-xl bg-white/5" />
          <Skeleton className="h-4 w-96 max-w-full rounded-full bg-white/5" />
        </div>
        <Skeleton className="h-14 w-full rounded-2xl bg-white/5 md:w-80" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[1, 2, 3, 4, 5].map((item) => (
          <Skeleton key={item} className="h-36 rounded-2xl border border-white/5 bg-white/5" />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <Skeleton className="h-[420px] rounded-2xl border border-white/5 bg-white/5" />
        <Skeleton className="h-[420px] rounded-2xl border border-white/5 bg-white/5" />
      </div>
    </div>
  );
}
