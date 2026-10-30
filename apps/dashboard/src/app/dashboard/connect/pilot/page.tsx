'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, CheckCircle2, Info, RefreshCw, XCircle } from 'lucide-react';
import { StatusBadge, type StatusLevel } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DataFetchError } from '@/components/DataFetchError';
import { useApi } from '@/lib/api';
import { ApiError } from '@/lib/api-error';

// ── Types (mirrors apps/api connect-kpis.service.ts ConnectKpis) ────────────

type ConnectKpiSlo = {
  target: number | boolean;
  met: boolean;
};

type ConnectKpis = {
  timestamp: string;
  holdsTotal: number;
  confirmedTotal: number;
  holdToConfirmRate: number;
  slugP95Ms: number | null;
  piiLeakIncidents: number;
  aggregateRatingSafe: boolean;
  slos: {
    holdToConfirmRateMin: ConnectKpiSlo;
    latencyP95MaxMs: ConnectKpiSlo;
    piiLeakMax: ConnectKpiSlo;
    aggregateRatingSafe: ConnectKpiSlo;
  };
  health: 'GREEN' | 'YELLOW' | 'RED';
};

// Niveau par sens : tous les critères = succès ; 1 échec = à traiter ; 2 échecs ou plus = erreur.
const HEALTH_STYLES: Record<ConnectKpis['health'], { label: string; level: StatusLevel }> = {
  GREEN: { label: 'Tous les critères sont respectés', level: 'done' },
  YELLOW: { label: '1 critère en échec', level: 'action' },
  RED: { label: '2 critères ou plus en échec', level: 'error' },
};

function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className="inline-flex text-muted-foreground transition-all duration-200 hover:text-foreground"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{children}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ── KPI card ────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  hint,
  value,
  target,
  detail,
  met,
}: {
  label: string;
  hint: string;
  value: string;
  target: string;
  detail: string;
  met: boolean;
}) {
  return (
    <article className="rounded-xl border border-border bg-card p-4 transition-all duration-200">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          {label}
          <InfoTip label={`Précision : ${label}`}>{hint}</InfoTip>
        </p>
        {met ? (
          <CheckCircle2 size={18} className="shrink-0 text-success" />
        ) : (
          <XCircle size={18} className="shrink-0 text-destructive" />
        )}
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        Cible <span className="font-medium text-foreground">{target}</span>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </article>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 60_000;

export default function ConnectPilotPage() {
  const { get } = useApi();
  const [kpis, setKpis] = useState<ConnectKpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Page interne : un compte restaurateur reçoit un refus. On le dit une fois, sans réessayer toutes les minutes.
  const [forbidden, setForbidden] = useState(false);
  const forbiddenRef = useRef(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const fetchKpis = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await get<ConnectKpis>('api/internal/connect-kpis');
      setKpis(data);
    } catch (err: unknown) {
      setKpis(null);
      if (err instanceof ApiError && (err.kind === 'forbidden' || err.kind === 'session')) {
        forbiddenRef.current = true;
        setForbidden(true);
      }
      setError(
        err instanceof Error ? err.message : 'Impossible de charger les KPIs du pilote Connect.',
      );
    } finally {
      setLoading(false);
    }
  }, [get]);

  useEffect(() => {
    fetchKpis();
    const id = setInterval(() => {
      if (!forbiddenRef.current) fetchKpis();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchKpis, refreshNonce]);

  const holdRatePct = kpis ? Math.round(kpis.holdToConfirmRate * 100) : 0;
  const healthStyle = kpis ? HEALTH_STYLES[kpis.health] : null;

  return (
    <div className="w-full space-y-6 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Pilote Connect</h1>
          <InfoTip label="Précision sur le pilote">
            Critères de validation pour passer en P2 (10 restaurants réels).
          </InfoTip>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/connect">
            <ArrowLeft className="h-4 w-4" />
            Retour à Connect
          </Link>
        </Button>
      </div>

      {loading && !kpis && (
        <div className="space-y-5" aria-label="Chargement des KPIs pilote Connect">
          <Skeleton className="h-16 w-full rounded-xl" />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[1, 2, 3, 4].map((item) => (
              <Skeleton key={item} className="h-36 rounded-xl" />
            ))}
          </div>
        </div>
      )}

      {!loading && forbidden && (
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="font-semibold">Page réservée à l’équipe Sokar</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Vos statistiques de réservation sont sur la page Pilotage.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-4 transition-all duration-200">
            <Link href="/dashboard">Aller au Pilotage</Link>
          </Button>
        </section>
      )}

      {!loading && error && !forbidden && (
        <DataFetchError
          message={error}
          onRetry={() => setRefreshNonce((value) => value + 1)}
          retrying={loading}
        />
      )}

      {!loading && !error && kpis && healthStyle && (
        <>
          <section
            role="status"
            aria-live="polite"
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge level={healthStyle.level}>{kpis.health}</StatusBadge>
              <p className="text-sm">{healthStyle.label}</p>
              <InfoTip label="Règle de santé">
                GREEN si les 4 critères sont respectés, YELLOW si 1 échoue, RED si 2 ou plus
                échouent. Le pilote passe en P2 uniquement en GREEN sur la période d’observation.
              </InfoTip>
            </div>
            <div className="flex items-center gap-3">
              {kpis.timestamp && (
                <p className="text-xs text-muted-foreground">
                  Mis à jour le{' '}
                  {new Intl.DateTimeFormat('fr-FR', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  }).format(new Date(kpis.timestamp))}
                </p>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRefreshNonce((value) => value + 1)}
                aria-label="Actualiser les KPIs"
                className="transition-all duration-200"
              >
                <RefreshCw size={14} />
                Actualiser
              </Button>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Taux hold → confirm"
              hint="Part des holds transformés en réservations confirmées."
              value={`${holdRatePct} %`}
              target="≥ 30 %"
              detail={`${kpis.holdsTotal} holds → ${kpis.confirmedTotal} confirmés`}
              met={kpis.slos.holdToConfirmRateMin.met}
            />
            <KpiCard
              label="Latence p95"
              hint="Percentile 95 du temps de réponse de la route /public/r/:slug."
              value={kpis.slugP95Ms !== null ? `${kpis.slugP95Ms} ms` : '—'}
              target="< 500 ms"
              detail={kpis.slugP95Ms !== null ? 'Page publique' : 'Aucune mesure disponible'}
              met={kpis.slos.latencyP95MaxMs.met}
            />
            <KpiCard
              label="Fuites de données personnelles"
              hint="Incidents de fuite de données personnelles dans les journaux."
              value={String(kpis.piiLeakIncidents)}
              target="0"
              detail="Incidents dans les journaux"
              met={kpis.slos.piiLeakMax.met}
            />
            <KpiCard
              label="Notes agrégées sûres"
              hint="Aucune page Search Console ne publie une note agrégée inventée (aggregateRating)."
              value={kpis.aggregateRatingSafe ? 'Sûres' : 'À risque'}
              target="Sûres"
              detail="Aucune note inventée"
              met={kpis.slos.aggregateRatingSafe.met}
            />
          </section>
        </>
      )}
    </div>
  );
}
