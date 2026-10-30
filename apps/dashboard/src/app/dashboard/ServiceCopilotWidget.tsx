'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { ServiceCopilotAccess } from '@/components/ServiceCopilotAccess';
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
  critical: 'border-foreground bg-secondary',
  high: 'border-foreground bg-secondary',
  medium: 'border-border bg-card',
  low: 'border-border bg-card',
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
  compact = false,
}: {
  rec: ServiceCopilotRecommendation;
  onActionDone: () => void;
  onOpened: (recommendation: ServiceCopilotRecommendation) => void;
  compact?: boolean;
}) {
  const { orgId, post, patch } = useApi();
  const [confirmRebalanceOpen, setConfirmRebalanceOpen] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState('');
  const metric = formatMetric(rec);
  const title = compact ? rec.title.split(' — ')[0] : rec.title;
  const reason = compact && rec.kind === 'late-reservation' ? null : rec.reason;

  async function handleApiAction() {
    if (actionPending || rec.action.type !== 'api' || !rec.action.method || !rec.action.path)
      return;
    setActionPending(true);
    setActionError('');
    onOpened(rec);
    try {
      if (rec.kind === 'server-rebalance' && rec.telemetryToken && orgId) {
        await post(`restaurants/${orgId}/service-copilot/actions/server-rebalance`, {
          token: rec.telemetryToken,
        });
      } else if (rec.action.method === 'PATCH') {
        await patch(rec.action.path, rec.action.body);
      } else if (rec.action.method === 'POST') {
        await post(rec.action.path, rec.action.body);
      }
      onActionDone();
    } catch {
      setActionError('Action non effectuée. Réessayez.');
    } finally {
      setActionPending(false);
    }
  }

  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card transition-all duration-200',
        compact ? 'p-3 shadow-none' : 'p-4 shadow-sm hover:shadow-md',
      )}
    >
      <div className={cn('flex items-start', compact ? 'gap-2.5' : 'gap-3')}>
        <div className="flex-1">
          <h3
            className={cn(
              'leading-tight text-foreground',
              compact ? 'text-sm font-semibold' : 'font-bold',
            )}
          >
            {title}
          </h3>
          {reason && (
            <p
              className={cn(
                'text-muted-foreground',
                compact ? 'mt-1 text-xs leading-snug' : 'mt-1 text-sm',
              )}
            >
              {reason}
            </p>
          )}
          {metric && !compact && (
            <p className="mt-2 text-xs font-semibold tabular-nums text-foreground">{metric}</p>
          )}
          <div className={compact ? 'mt-2' : 'mt-3'}>
            {rec.action.type === 'link' && rec.action.href ? (
              <Link
                href={rec.action.href}
                onClick={() => onOpened(rec)}
                className={cn(
                  'inline-flex min-h-8 items-center gap-1.5 rounded-xl border border-border bg-background text-xs font-bold text-foreground transition-all duration-200 hover:bg-accent',
                  compact ? 'px-2.5 py-1.5' : 'px-3 py-2',
                )}
              >
                {rec.action.label}
              </Link>
            ) : rec.action.type === 'api' ? (
              <button
                type="button"
                disabled={actionPending}
                onClick={() =>
                  rec.kind === 'server-rebalance'
                    ? setConfirmRebalanceOpen(true)
                    : void handleApiAction()
                }
                className={cn(
                  'inline-flex min-h-8 items-center gap-1.5 rounded-xl border border-border bg-background text-xs font-bold text-foreground transition-all duration-200 hover:bg-accent',
                  compact ? 'px-2.5 py-1.5' : 'px-3 py-2',
                )}
              >
                {actionPending ? 'En cours…' : rec.action.label}
              </button>
            ) : rec.action.type === 'call' && rec.action.href ? (
              <a
                href={rec.action.href}
                onClick={() => onOpened(rec)}
                className={cn(
                  'inline-flex min-h-8 items-center gap-1.5 rounded-xl border border-border bg-background text-xs font-bold text-foreground transition-all duration-200 hover:bg-accent',
                  compact ? 'px-2.5 py-1.5' : 'px-3 py-2',
                )}
              >
                {rec.action.label}
              </a>
            ) : null}
            {actionError && (
              <p role="alert" className="mt-2 text-xs text-destructive">
                {actionError}
              </p>
            )}
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

function ServiceCopilotWidgetContent({
  showCalm = true,
  density = 'default',
}: {
  showCalm?: boolean;
  density?: 'default' | 'service' | 'overview';
}) {
  const { get, orgId, post, patch } = useApi();
  const [data, setData] = useState<ServiceCopilotRecommendationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
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
      setLoadError(false);
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
        if (mounted) {
          setData(null);
          setLoadError(true);
        }
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

  if (loadError) {
    return (
      <section
        aria-label="État du Copilot"
        role={density === 'overview' ? 'alert' : 'status'}
        className="inline-flex max-w-full flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-warning"
      >
        {density === 'overview' ? 'Suivi de salle indisponible' : 'Recommandations indisponibles'}
        <button
          type="button"
          onClick={() => setRefreshNonce((n) => n + 1)}
          className="min-h-11 rounded-lg px-3 font-medium text-foreground underline-offset-2 transition-all duration-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Réessayer
        </button>
      </section>
    );
  }

  if (density === 'overview') {
    const attention = (data?.recommendations ?? []).filter(
      (rec) => rec.kind === 'reported-delay' || rec.kind === 'late-reservation',
    );
    if (attention.length === 0) {
      return null;
    }
    return (
      <details className="group rounded-xl border border-border px-4">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 py-3 text-sm font-medium text-foreground transition-all duration-200 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <ChevronDown
            aria-hidden="true"
            className="h-4 w-4 shrink-0 transition-all duration-200 group-open:rotate-180"
          />
          {attention.length} point{attention.length > 1 ? 's' : ''} à vérifier dans Salle
        </summary>
        <ul className="divide-y divide-border border-t border-border pb-3">
          {attention.slice(0, 3).map((rec) => (
            <li
              key={rec.id}
              className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
            >
              <div className="min-w-0">
                <h3 className="text-sm font-medium text-foreground">
                  {rec.kind === 'late-reservation'
                    ? `Arrivée à vérifier${rec.metrics?.customerName ? ` · ${rec.metrics.customerName}` : ''}`
                    : rec.title}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {rec.kind === 'late-reservation'
                    ? `L’arrivée n’est pas enregistrée dans Salle.${typeof rec.metrics?.minutesLate === 'number' ? ` Créneau commencé il y a ${rec.metrics.minutesLate} min.` : ''}`
                    : rec.reason}
                </p>
              </div>
              {rec.action.href ? (
                <Button asChild className="min-h-11 shrink-0 self-start sm:self-center">
                  <a href={rec.action.href} onClick={() => trackTelemetry(rec, 'OPENED')}>
                    {rec.action.label}
                  </a>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {attention.length > 3 && (
          <Link
            href="/dashboard/floor-plan"
            className="mt-3 inline-flex min-h-10 items-center text-sm font-medium text-foreground underline-offset-4 transition-all duration-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Voir le suivi dans Salle
          </Link>
        )}
      </details>
    );
  }

  if (!data || data.recommendations.length === 0) {
    if (!showCalm) return null;

    return (
      <section
        aria-label="État du Copilot"
        aria-live="polite"
        className="inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-success/20 bg-success/[0.04] px-3 py-2.5"
      >
        <p className="text-sm text-muted-foreground">Aucune action à traiter</p>
      </section>
    );
  }

  const recs = data.recommendations.slice(0, 3);
  const priority = highestPriority(recs);
  const compact = density === 'service';

  return (
    <section
      className={cn(
        'rounded-2xl border transition-all duration-200',
        compact ? 'p-3 md:p-4' : 'p-4 md:p-5',
        containerClasses[priority],
      )}
    >
      <div className={cn('flex items-center justify-between gap-3', compact ? 'mb-2' : 'mb-3')}>
        <div className="flex items-center gap-3">
          <h2
            className={cn(
              'font-bold text-foreground',
              compact ? 'text-sm sm:text-base' : 'text-lg',
            )}
          >
            Actions recommandées
          </h2>
        </div>
        <Link
          href="/dashboard/copilot/quality"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground"
        >
          Qualité
        </Link>
      </div>
      <div
        className={cn(
          'grid',
          compact
            ? 'gap-2 md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3'
            : 'gap-3 md:grid-cols-2 xl:grid-cols-3',
          compact && recs.length === 1 && 'lg:grid-cols-1 xl:grid-cols-1',
        )}
      >
        {recs.map((rec) => (
          <RecommendationCard
            key={rec.id}
            rec={rec}
            onActionDone={() => setRefreshNonce((n) => n + 1)}
            onOpened={(recommendation) => trackTelemetry(recommendation, 'OPENED')}
            compact={compact}
          />
        ))}
      </div>
    </section>
  );
}

export default function ServiceCopilotWidget({
  accessFallback,
  ...props
}: {
  showCalm?: boolean;
  density?: 'default' | 'service' | 'overview';
  /** Rendu quand l'accès au copilote n'est pas accordé ; `null` pour ne rien afficher. */
  accessFallback?: ReactNode;
}) {
  return (
    <ServiceCopilotAccess fallback={accessFallback}>
      <ServiceCopilotWidgetContent {...props} />
    </ServiceCopilotAccess>
  );
}
