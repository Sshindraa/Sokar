'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useApi } from '../../lib/api';
import ReservationChannels, {
  demoReservationChannels,
  type ReservationChannelStat,
} from './ReservationChannels';

// recharts pèse ~387 KB — on le charge en dynamic import pour ne pas
// bloquer le First Load JS du dashboard. Les KPIs et le header s'affichent
// immédiatement, les graphiques hydratent en arrière-plan.
const DashboardCharts = dynamic(() => import('./DashboardCharts'), {
  loading: () => (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm md:p-6">
      <Skeleton className="mb-4 h-6 w-52" />
      <Skeleton className="h-[15.5rem] w-full rounded-xl sm:h-[17.5rem]" />
    </section>
  ),
});

const EmptySlotsWidget = dynamic(() => import('./EmptySlotsWidget'), {
  ssr: false,
  loading: () => (
    <section
      aria-label="Chargement des créneaux"
      className="rounded-2xl border border-border bg-card p-3.5 shadow-sm sm:p-4 md:p-5"
    >
      <div className="mb-3 flex items-center gap-2.5">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <Skeleton className="h-5 w-32 rounded-md" />
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background">
        {[1, 2, 3].map((item) => (
          <div key={item} className="grid gap-3 px-3.5 py-3 sm:grid-cols-4 sm:items-center sm:px-4">
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="hidden h-5 w-24 justify-self-end sm:block" />
          </div>
        ))}
      </div>
    </section>
  ),
});

const ServiceCopilotWidget = dynamic(() => import('./ServiceCopilotWidget'), {
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
  call_reservations?: number;
  answered_rate?: number;
  estimated_revenue?: number;
  by_channel?: ReservationChannelStat[];
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
  callReservations: number | null;
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
  callReservations: null,
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
    callReservations: demoReservationChannels(totalReservations, covers).find(
      (row) => row.channel === 'phone',
    )!.reservations,
    answeredRate: 94,
    estimatedRevenue,
  };
}

export default function DashboardPage() {
  const { get, orgId } = useApi();
  const [period, setPeriod] = useState<Period>('7d');
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [analytics, setAnalytics] = useState<AnalyticsPoint[]>([]);
  const [channels, setChannels] = useState<ReservationChannelStat[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshNonce, setRefreshNonce] = useState(0);
  // Mode demo local/staging : sans Clerk, NEXT_PUBLIC_DEMO_RESTAURANT_ID
  // agit comme un orgId forcé. On affiche les données de démo pour que le
  // dashboard reste utilisable sans session réelle ; les widgets qui appellent l'API restent masqués.
  const isDemo = !orgId || orgId === process.env.NEXT_PUBLIC_DEMO_RESTAURANT_ID;

  useEffect(() => {
    if (isDemo) {
      const demoAnalytics = DEMO_ANALYTICS_BY_PERIOD[period];
      const demoStats = summarizeAnalytics(demoAnalytics);
      setStats(demoStats);
      setChannels(demoReservationChannels(demoStats.totalReservations, demoStats.covers));
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
          callReservations: statsResponse.call_reservations ?? null,
          answeredRate: statsResponse.answered_rate ?? 0,
          estimatedRevenue: statsResponse.estimated_revenue ?? 0,
        });
        setAnalytics(analyticsResponse.data ?? []);
        setChannels(statsResponse.by_channel ?? []);
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
  }, [get, isDemo, orgId, period, refreshNonce]);

  const hasData = useMemo(
    () =>
      stats.totalCalls > 0 ||
      stats.totalReservations > 0 ||
      stats.covers > 0 ||
      stats.estimatedRevenue > 0,
    [stats],
  );
  // Les chiffres comptent les réservations PRISES sur la période (date d'enregistrement), pas celles
  // du service du jour : « 2 réservations » peut coexister avec 25 tables attendues ce soir.
  const averagePartySize =
    stats.totalReservations > 0
      ? `${(stats.covers / stats.totalReservations).toLocaleString('fr-FR', {
          maximumFractionDigits: 1,
        })} / résa`
      : 'sur la période';
  const averageReservationRevenue =
    stats.totalReservations > 0
      ? `${Math.round(stats.estimatedRevenue / stats.totalReservations).toLocaleString('fr-FR')} € / résa`
      : 'sur la période';

  return (
    <div className="space-y-5 md:space-y-7">
      <header className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
            Pilotage
          </h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/calls">Voir les appels</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/dashboard/reservations">Réservations</Link>
            </Button>
          </div>
        </div>
        <div className="relative shrink-0 sm:hidden">
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value as Period)}
            aria-label="Période d’analyse"
            className="h-11 appearance-none rounded-lg border border-border bg-card py-0 pl-3 pr-8 text-xs font-semibold text-foreground shadow-sm outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-ring"
          >
            {PERIOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={13}
            aria-hidden="true"
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
        </div>

        <div
          role="group"
          className="hidden shrink-0 grid-cols-3 gap-1 rounded-xl border border-border bg-card p-1 sm:grid"
          aria-label="Période d’analyse"
        >
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setPeriod(option.value)}
              aria-pressed={period === option.value}
              className={`min-h-11 rounded-lg px-4 py-2 text-center text-xs font-medium transition-all duration-200 ${
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
      {!isDemo && <ServiceCopilotWidget key={orgId} density="overview" accessFallback={null} />}

      <section
        aria-label="Synthèse de la période"
        aria-busy={isLoading}
        className="space-y-6 md:space-y-8"
      >
        {isLoading && <DashboardSkeleton />}
        {!isLoading && error && (
          <ErrorState message={error} onRetry={() => setRefreshNonce((nonce) => nonce + 1)} />
        )}

        {!isLoading && !error && hasData && (
          <section
            aria-label="Indicateurs clés"
            className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-border py-3 sm:grid-cols-4 sm:gap-x-8"
          >
            <KpiCard
              label="Réservations"
              value={stats.totalReservations}
              caption="confirmées"
              description="Réservations enregistrées sur la période, confirmées, installées ou honorées. Annulations et absences exclues. La date retenue est celle de la prise de réservation, pas celle du repas."
              historyHref={isDemo ? undefined : '/dashboard/reservations'}
            />
            <KpiCard
              label="Couverts"
              value={stats.covers}
              caption={averagePartySize}
              description="Nombre de personnes associé aux réservations comptées sur la période. Ce n’est pas le nombre de personnes attendues au service du jour."
              historyHref={isDemo ? undefined : '/dashboard/reservations'}
            />
            <KpiCard
              label="CA estimé"
              value={`${stats.estimatedRevenue.toLocaleString('fr-FR')} €`}
              caption={averageReservationRevenue}
              description="Somme des montants associés aux réservations : montant confirmé s’il est renseigné, sinon estimation disponible. Les montants inconnus ne contribuent pas au total. Ce chiffre ne mesure ni les encaissements ni le revenu supplémentaire apporté par Sokar."
              historyHref={isDemo ? undefined : '/dashboard/reservations'}
            />
            <KpiCard
              label="Réservations téléphone"
              description={
                stats.callReservations === null
                  ? 'Le nombre de réservations rattachées à un appel est indisponible.'
                  : `${stats.callReservations.toLocaleString('fr-FR')} réservations de la période sont rattachées à un appel. ${stats.totalCalls.toLocaleString('fr-FR')} appels ont été reçus sur la période. Les appels peuvent aussi concerner des renseignements ou une modification ; une absence de réservation ne signifie pas un échec.`
              }
              historyHref={isDemo ? undefined : '/dashboard/calls'}
              value={stats.callReservations ?? '—'}
              caption={
                stats.callReservations === null
                  ? 'donnée indisponible'
                  : `sur ${stats.totalCalls.toLocaleString('fr-FR')} appels reçus`
              }
            />
          </section>
        )}

        {!isLoading && !error && !hasData && <EmptyDashboardState />}

        {!isLoading && !error && hasData && (
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(22rem,1fr)]">
            <DashboardCharts analytics={analytics} />
            <ReservationChannels stats={channels} />
          </div>
        )}
      </section>

      {!isDemo && (
        <details className="group border-t border-border pt-4">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-muted-foreground transition-all duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <ChevronDown
              aria-hidden="true"
              className="h-4 w-4 shrink-0 transition-all duration-200 group-open:rotate-180"
            />
            Prévisions sur 7 jours et absences sur 90 jours
          </summary>
          <div className="mt-4 space-y-4">
            <EmptySlotsWidget />
            <NoShowWidget />
          </div>
        </details>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  caption,
  description,
  historyHref,
}: {
  label: string;
  value: number | string;
  caption: string;
  description: string;
  historyHref?: string;
}) {
  return (
    <article aria-label={`Indicateur ${label}`} className="min-w-0 py-2">
      <div className="flex min-h-10 items-center justify-between gap-1">
        <p className="text-xs font-medium leading-snug text-muted-foreground sm:text-sm">{label}</p>
        <Dialog>
          <DialogTrigger asChild>
            <button
              type="button"
              aria-label={`Comprendre ${label}`}
              className="-my-2 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Info size={13} aria-hidden="true" />
            </button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{label}</DialogTitle>
              <DialogDescription className="pt-2 leading-relaxed">{description}</DialogDescription>
            </DialogHeader>
            {historyHref ? (
              <Link
                href={historyHref}
                className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4 transition-all duration-200 hover:text-primary"
              >
                Ouvrir l’historique
              </Link>
            ) : (
              <p className="text-xs text-muted-foreground">
                Données de démonstration, sans dossier associé.
              </p>
            )}
          </DialogContent>
        </Dialog>
      </div>
      <p className="mt-3 break-words text-3xl font-semibold tabular-nums tracking-tight text-foreground md:text-4xl">
        {typeof value === 'number' ? value.toLocaleString('fr-FR') : value}
      </p>
      <p className="mt-2 text-xs leading-snug text-muted-foreground">{caption}</p>
    </article>
  );
}

function EmptyDashboardState() {
  return <p className="text-sm text-muted-foreground">Aucune activité sur cette période.</p>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-destructive/50 bg-destructive/10 p-5 text-destructive">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <p className="text-sm font-semibold">{message}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="border-destructive/30 text-xs font-bold text-destructive transition-all duration-200 hover:bg-destructive/10 hover:text-destructive"
        >
          Réessayer
        </Button>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-8 w-24 rounded-lg md:h-9 md:w-32 md:rounded-xl" />
        <Skeleton className="h-9 w-52 rounded-lg sm:w-72 md:h-11 md:rounded-xl" />
      </div>
      <Skeleton className="h-40 rounded-2xl border border-border" />
      <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-border sm:gap-3 sm:overflow-visible sm:rounded-none sm:border-0 lg:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <Skeleton
            key={item}
            className={cn(
              'h-24 rounded-none border-border sm:h-32 sm:rounded-2xl sm:border',
              item <= 2 && 'border-b',
              item % 2 === 1 && 'border-r',
            )}
          />
        ))}
      </div>
      <Skeleton className="h-[360px] rounded-2xl border border-border" />
    </div>
  );
}
