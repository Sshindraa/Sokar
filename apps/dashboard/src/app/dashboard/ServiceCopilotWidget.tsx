'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, BarChart3, CheckCircle2, Clock, Phone, Scale } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { cn } from '@/lib/utils';
import { useApi } from '../../lib/api';
import type {
  ServiceCopilotPriority,
  ServiceCopilotRecommendation,
  ServiceCopilotRecommendationsResponse,
} from '@/types/api';

const priorityRank: Record<ServiceCopilotPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const containerClasses: Record<ServiceCopilotPriority, string> = {
  critical: 'border-destructive/25 bg-destructive/[0.04]',
  high: 'border-destructive/25 bg-destructive/[0.04]',
  medium: 'border-warning/25 bg-warning/[0.04]',
  low: 'border-info/25 bg-info/[0.04]',
};

const iconColorClasses: Record<ServiceCopilotPriority, string> = {
  critical: 'text-destructive',
  high: 'text-destructive',
  medium: 'text-warning',
  low: 'text-info',
};

const kindIcon = {
  'reported-delay': Phone,
  'late-reservation': Phone,
  'table-soon-free': Clock,
  'waiting-list-compatible': AlertCircle,
  'server-rebalance': Scale,
};

function highestPriority(recommendations: ServiceCopilotRecommendation[]): ServiceCopilotPriority {
  return recommendations.reduce<ServiceCopilotPriority>(
    (best, rec) => (priorityRank[rec.priority] < priorityRank[best] ? rec.priority : best),
    recommendations[0].priority,
  );
}

function formatMetric(rec: ServiceCopilotRecommendation): string | null {
  if (
    (rec.kind === 'late-reservation' || rec.kind === 'reported-delay') &&
    typeof rec.metrics?.minutesLate === 'number'
  ) {
    return `${rec.metrics.minutesLate} min de retard`;
  }
  if (rec.kind === 'table-soon-free' && rec.metrics?.estimatedFreeAt) {
    const d = new Date(rec.metrics.estimatedFreeAt);
    const time = d.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    if (rec.metrics.predictionSource === 'scheduled')
      return `libération estimée ${time} · durée configurée`;
    return `libération estimée ${time} · confiance ${
      rec.metrics.predictionConfidence === 'high'
        ? 'élevée'
        : rec.metrics.predictionConfidence === 'medium'
          ? 'moyenne'
          : 'faible'
    }`;
  }
  if (rec.kind === 'waiting-list-compatible') {
    return `${rec.metrics?.covers ?? 0} couverts`;
  }
  if (rec.kind === 'server-rebalance') {
    return `${rec.metrics?.fromServer ?? '—'} → ${rec.metrics?.toServer ?? '—'}`;
  }
  return null;
}

function RecommendationCard({
  rec,
  onActionDone,
  onOpened,
}: {
  rec: ServiceCopilotRecommendation;
  onActionDone: () => void;
  onOpened: (recommendation: ServiceCopilotRecommendation) => void;
}) {
  const { orgId, post, patch } = useApi();
  const [confirmRebalanceOpen, setConfirmRebalanceOpen] = useState(false);
  const Icon = kindIcon[rec.kind];
  const metric = formatMetric(rec);

  async function handleApiAction() {
    if (rec.action.type !== 'api' || !rec.action.method || !rec.action.path) return;
    onOpened(rec);
    try {
      if (rec.kind === 'server-rebalance' && rec.telemetryToken && orgId) {
        await post(`restaurants/${orgId}/service-copilot/actions/server-rebalance`, {
          token: rec.telemetryToken,
        });
        return;
      }
      if (rec.action.method === 'PATCH') {
        await patch(rec.action.path, rec.action.body);
      } else if (rec.action.method === 'POST') {
        await post(rec.action.path, rec.action.body);
      }
    } finally {
      onActionDone();
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm transition-all duration-200 hover:shadow-md">
      <div className="flex items-start gap-3">
        <Icon size={18} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="flex-1">
          <h3 className="font-bold leading-tight text-foreground">{rec.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{rec.reason}</p>
          {metric && (
            <p className="mt-2 text-xs font-semibold tabular-nums text-foreground">{metric}</p>
          )}
          <div className="mt-3">
            {rec.action.type === 'link' && rec.action.href ? (
              <Link
                href={rec.action.href}
                onClick={() => onOpened(rec)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-xs font-bold text-foreground transition-all duration-200 hover:bg-accent"
              >
                {rec.action.label}
              </Link>
            ) : rec.action.type === 'api' ? (
              <button
                type="button"
                onClick={() =>
                  rec.kind === 'server-rebalance'
                    ? setConfirmRebalanceOpen(true)
                    : void handleApiAction()
                }
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-xs font-bold text-foreground transition-all duration-200 hover:bg-accent"
              >
                {rec.action.label}
              </button>
            ) : rec.action.type === 'call' && rec.action.href ? (
              <a
                href={rec.action.href}
                onClick={() => onOpened(rec)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-xs font-bold text-foreground transition-all duration-200 hover:bg-accent"
              >
                {rec.action.label}
              </a>
            ) : null}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={confirmRebalanceOpen}
        onCancel={() => setConfirmRebalanceOpen(false)}
        onConfirm={() => {
          setConfirmRebalanceOpen(false);
          void handleApiAction();
        }}
        title="Confier cette table à un autre serveur ?"
        description={`Cette action affectera ${rec.metrics?.tableName ?? 'la table'} à ${rec.metrics?.toServer ?? 'un autre serveur'}. Vérifiez que l’équipe est prévenue avant de confirmer.`}
        confirmLabel="Confirmer l’affectation"
      />
    </div>
  );
}

export default function ServiceCopilotWidget({ showCalm = true }: { showCalm?: boolean }) {
  const { get, orgId, post, patch } = useApi();
  const [data, setData] = useState<ServiceCopilotRecommendationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const api = useMemo(() => ({ get, post, patch }), [get, post, patch]);

  const trackTelemetry = useCallback(
    (recommendation: ServiceCopilotRecommendation, event: 'VIEWED' | 'OPENED') => {
      if (!recommendation.telemetryToken || !orgId) return;
      void post(`restaurants/${orgId}/service-copilot/telemetry`, {
        token: recommendation.telemetryToken,
        event,
        idempotencyKey: `copilot:${event.toLowerCase()}:${recommendation.occurrenceKey}`,
        clientTime: new Date().toISOString(),
      }).catch(() => {
        // La télémétrie est volontairement invisible et ne doit jamais perturber
        // l’action de salle si le réseau est instable.
      });
    },
    [orgId, post],
  );

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }

    let mounted = true;
    async function fetchRecommendations() {
      setLoading(true);
      try {
        const res = await api.get<ServiceCopilotRecommendationsResponse>(
          `restaurants/${orgId}/service-copilot/recommendations`,
        );
        if (mounted) {
          setData(res);
          for (const recommendation of res.recommendations) {
            trackTelemetry(recommendation, 'VIEWED');
          }
        }
      } catch {
        // En mode démo/E2E, l’endpoint peut ne pas être joignable ; on ignore
        // silencieusement pour ne pas polluer le cockpit avec un bandeau d’erreur.
        if (mounted) setData(null);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchRecommendations();
    return () => {
      mounted = false;
    };
  }, [api, orgId, refreshNonce, trackTelemetry]);

  if (!orgId) return null;

  if (loading) {
    // Le widget est optionnel sur le plan Live (`showCalm={false}`). Ne pas
    // réserver d’espace pendant sa requête évite un saut de mise en page sur
    // mobile, puis le plan reste ancré au même endroit quand la réponse arrive.
    if (!showCalm) return null;

    return (
      <section className="inline-flex max-w-full items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
        <Skeleton className="h-4 w-4 rounded-full" />
        <Skeleton className="h-4 w-36" />
        <Skeleton className="hidden h-4 w-44 sm:block" />
      </section>
    );
  }

  // En cas d’erreur ou de données vides, on ne bloque pas le cockpit : on affiche
  // l’état “service fluide” pour éviter un bandeau d’erreur visible en mode démo/E2E.
  if (!data || data.recommendations.length === 0) {
    if (!showCalm) return null;

    return (
      <section
        aria-label="État du Copilot"
        aria-live="polite"
        className="inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-success/20 bg-success/[0.04] px-3 py-2.5"
      >
        <div className="flex min-w-0 items-center gap-2">
          <CheckCircle2 size={18} className="shrink-0 text-success" />
          <span className="text-sm font-semibold text-foreground">Copilot opérationnel</span>
          <span className="truncate text-sm text-muted-foreground">Aucune action à traiter</span>
        </div>
        <Link
          href="/dashboard/copilot/quality"
          className="inline-flex shrink-0 items-center gap-1.5 text-xs font-bold text-foreground transition-all duration-200 hover:text-primary"
        >
          Qualité Copilot <BarChart3 size={14} />
        </Link>
      </section>
    );
  }

  const recs = data.recommendations.slice(0, 3);
  const priority = highestPriority(recs);

  return (
    <section
      className={cn(
        'rounded-2xl border p-4 md:p-5 transition-all duration-200',
        containerClasses[priority],
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <AlertCircle size={20} className={cn('shrink-0', iconColorClasses[priority])} />
          <h2 className="text-lg font-bold text-foreground">Actions recommandées</h2>
        </div>
        <Link
          href="/dashboard/copilot/quality"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground"
        >
          Qualité <BarChart3 size={14} />
        </Link>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {recs.map((rec) => (
          <RecommendationCard
            key={rec.id}
            rec={rec}
            onActionDone={() => setRefreshNonce((n) => n + 1)}
            onOpened={(recommendation) => trackTelemetry(recommendation, 'OPENED')}
          />
        ))}
      </div>
    </section>
  );
}
