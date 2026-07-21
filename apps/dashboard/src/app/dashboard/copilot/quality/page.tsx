'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, BarChart3, CheckCircle2, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi } from '@/lib/api';
import type {
  ServiceCopilotRecommendationKind,
  ServiceCopilotTelemetryStatus,
  ServiceCopilotTelemetrySummary,
  ServiceCopilotTelemetryTotals,
} from '@/types/api';

const PERIODS = [
  { days: 7, label: '7 jours' },
  { days: 30, label: '30 jours' },
  { days: 90, label: '90 jours' },
] as const;

const statusLabels: Record<ServiceCopilotTelemetryStatus, string> = {
  observed: 'À examiner',
  opened: 'Ouvertes',
  applied: 'Appliquées',
  reverted: 'Annulées',
  conflicted: 'En conflit',
  expired: 'Expirées',
  ignored: 'Ignorées',
};

const statusClasses: Record<ServiceCopilotTelemetryStatus, string> = {
  observed: 'border-info/30 bg-info/10 text-info',
  opened: 'border-info/30 bg-info/10 text-info',
  applied: 'border-success/30 bg-success/10 text-success',
  reverted: 'border-warning/30 bg-warning/10 text-warning',
  conflicted: 'border-destructive/30 bg-destructive/10 text-destructive',
  expired: 'border-border bg-secondary text-muted-foreground',
  ignored: 'border-border bg-secondary text-muted-foreground',
};

const kindLabels: Record<ServiceCopilotRecommendationKind, string> = {
  'reported-delay': 'Retard signalé',
  'late-reservation': 'Réservation en retard',
  'table-soon-free': 'Table bientôt libre',
  'waiting-list-compatible': 'Liste d’attente compatible',
  'server-rebalance': 'Rééquilibrage de service',
};

const statusOrder: ServiceCopilotTelemetryStatus[] = [
  'applied',
  'reverted',
  'conflicted',
  'opened',
  'observed',
  'expired',
  'ignored',
];

function total(totals: ServiceCopilotTelemetryTotals): number {
  return Object.values(totals).reduce((sum, count) => sum + count, 0);
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date));
}

function QualityMetric({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string;
  value: number | string;
  detail: string;
  tone?: 'default' | 'success' | 'warning' | 'destructive';
}) {
  const toneClass = {
    default: 'text-foreground',
    success: 'text-success',
    warning: 'text-warning',
    destructive: 'text-destructive',
  }[tone];

  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-2 text-3xl font-black tracking-tight ${toneClass}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </article>
  );
}

function SummarySkeleton() {
  return (
    <div className="space-y-5" aria-label="Chargement de la qualité Copilot">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <Skeleton key={item} className="h-32 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-56 rounded-2xl" />
    </div>
  );
}

export default function CopilotQualityPage() {
  const { get, orgId } = useApi();
  const [days, setDays] = useState<(typeof PERIODS)[number]['days']>(30);
  const [summary, setSummary] = useState<ServiceCopilotTelemetrySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    get<ServiceCopilotTelemetrySummary>(
      `restaurants/${orgId}/service-copilot/telemetry-summary?days=${days}`,
      { signal: controller.signal },
    )
      .then((result) => setSummary(result))
      .catch((requestError: unknown) => {
        if ((requestError as { name?: string }).name !== 'AbortError') {
          setError('Impossible de charger les indicateurs Copilot pour le moment.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [days, get, orgId, refreshNonce]);

  const metrics = useMemo(() => {
    if (!summary) return null;
    const recommendations = total(summary.totals);
    const actions = summary.totals.applied + summary.totals.reverted;
    const withoutAction = summary.totals.ignored + summary.totals.expired;
    return {
      recommendations,
      actions,
      withoutAction,
      actionRate: recommendations > 0 ? Math.round((actions / recommendations) * 100) : 0,
    };
  }, [summary]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 pb-10">
      <header className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm md:flex-row md:items-start md:justify-between md:p-6">
        <div className="flex gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles size={19} />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Copilot
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-foreground">
              Qualité des recommandations
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Une lecture après le service : aucune alerte ni action n’est ajoutée à la Salle.
            </p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link href="/dashboard">
            <ArrowLeft /> Retour au Copilot
          </Link>
        </Button>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="inline-flex rounded-xl border border-border bg-card p-1"
          aria-label="Période analysée"
        >
          {PERIODS.map((period) => (
            <button
              key={period.days}
              type="button"
              onClick={() => setDays(period.days)}
              aria-pressed={days === period.days}
              className={`rounded-lg px-3 py-2 text-sm font-bold transition-all duration-200 ${
                days === period.days
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              {period.label}
            </button>
          ))}
        </div>
        {summary && (
          <p className="text-xs text-muted-foreground">
            Données du {formatDate(summary.from)} au {formatDate(summary.to)}
          </p>
        )}
      </div>

      {loading && <SummarySkeleton />}

      {!loading && error && (
        <section className="flex flex-col gap-4 rounded-2xl border border-destructive/25 bg-destructive/[0.04] p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 shrink-0 text-destructive" size={20} />
            <div>
              <h2 className="font-bold text-foreground">Indicateurs indisponibles</h2>
              <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setRefreshNonce((value) => value + 1)}
          >
            <RefreshCw /> Réessayer
          </Button>
        </section>
      )}

      {!loading && !error && summary && metrics && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <QualityMetric
              label="Recommandations suivies"
              value={metrics.recommendations}
              detail="signaux distincts sur la période"
            />
            <QualityMetric
              label="Décisions appliquées"
              value={metrics.actions}
              detail={`${metrics.actionRate} % des recommandations suivies`}
              tone="success"
            />
            <QualityMetric
              label="Conflits"
              value={summary.totals.conflicted}
              detail="refusés car le service avait changé"
              tone={summary.totals.conflicted > 0 ? 'destructive' : 'default'}
            />
            <QualityMetric
              label="Sans suite"
              value={metrics.withoutAction}
              detail="ignorées ou expirées avant décision"
              tone={metrics.withoutAction > 0 ? 'warning' : 'default'}
            />
          </section>

          {metrics.recommendations === 0 ? (
            <section className="flex flex-col items-center rounded-2xl border border-border bg-card px-5 py-12 text-center shadow-sm">
              <CheckCircle2 size={28} className="text-success" />
              <h2 className="mt-3 font-bold text-foreground">Pas encore de signal à analyser</h2>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Les recommandations du Copilot apparaîtront ici après leur utilisation, sans
                alourdir la vue de service.
              </p>
            </section>
          ) : (
            <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <div className="flex items-center gap-3 border-b border-border px-5 py-4">
                <BarChart3 size={19} className="text-primary" />
                <div>
                  <h2 className="font-bold text-foreground">
                    Résultats par type de recommandation
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Les statuts décrivent le dernier résultat connu pour chaque recommandation.
                  </p>
                </div>
              </div>
              <div className="divide-y divide-border">
                {summary.byKind.map((item) => (
                  <article
                    key={item.kind}
                    className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <h3 className="font-semibold text-foreground">
                      {kindLabels[item.kind as ServiceCopilotRecommendationKind] ?? item.kind}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {statusOrder
                        .filter((status) => item.totals[status] > 0)
                        .map((status) => (
                          <span
                            key={status}
                            className={`rounded-full border px-2.5 py-1 text-xs font-bold ${statusClasses[status]}`}
                          >
                            {item.totals[status]} {statusLabels[status]}
                          </span>
                        ))}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
