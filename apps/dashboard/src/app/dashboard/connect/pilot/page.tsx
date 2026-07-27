'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Gauge,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';

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

// ── Health badge ────────────────────────────────────────────────────────────

const HEALTH_STYLES: Record<ConnectKpis['health'], { label: string; className: string }> = {
  GREEN: {
    label: 'GREEN — Tous les critères sont respectés',
    className: 'border-success/30 bg-success/10 text-success',
  },
  YELLOW: {
    label: 'YELLOW — 1 critère en échec',
    className: 'border-warning/30 bg-warning/10 text-warning',
  },
  RED: {
    label: 'RED — 2 critères ou plus en échec',
    className: 'border-destructive/30 bg-destructive/10 text-destructive',
  },
};

// ── KPI card ────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  target,
  detail,
  met,
  icon: Icon,
}: {
  label: string;
  value: string;
  target: string;
  detail: string;
  met: boolean;
  icon: typeof Gauge;
}) {
  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-sm transition-all duration-200">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
        <Icon size={16} className="text-muted-foreground" />
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <p
          className={cn(
            'text-3xl font-black tracking-tight',
            met ? 'text-success' : 'text-destructive',
          )}
        >
          {value}
        </p>
        {met ? (
          <CheckCircle2 size={20} className="shrink-0 text-success" />
        ) : (
          <XCircle size={20} className="shrink-0 text-destructive" />
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Cible&nbsp;: <span className="font-medium text-foreground">{target}</span>
      </p>
      <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
    </article>
  );
}

// ── Skeleton ────────────────────────────────────────────────────────────────

function PilotSkeleton() {
  return (
    <div className="space-y-5" aria-label="Chargement des KPIs pilote Connect">
      <Skeleton className="h-16 w-full rounded-2xl" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <Skeleton key={item} className="h-36 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 60_000;

export default function ConnectPilotPage() {
  const { get } = useApi();
  const [kpis, setKpis] = useState<ConnectKpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const fetchKpis = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await get<ConnectKpis>('api/internal/connect-kpis');
      setKpis(data);
    } catch (err: unknown) {
      setKpis(null);
      setError(
        err instanceof Error ? err.message : 'Impossible de charger les KPIs du pilote Connect.',
      );
    } finally {
      setLoading(false);
    }
  }, [get]);

  useEffect(() => {
    fetchKpis();
    const id = setInterval(fetchKpis, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchKpis, refreshNonce]);

  const holdRatePct = kpis ? Math.round(kpis.holdToConfirmRate * 100) : 0;
  const healthStyle = kpis ? HEALTH_STYLES[kpis.health] : null;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 pb-10">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm md:flex-row md:items-start md:justify-between md:p-6">
        <div className="flex gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles size={19} />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Sokar Connect
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-foreground">
              Pilote Sokar Connect — KPIs Go/No-Go
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Critères de validation pour passer en P2 (10 restaurants réels).
            </p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link href="/dashboard/connect">
            <ArrowLeft /> Retour à Connect
          </Link>
        </Button>
      </header>

      {/* ── Health global ───────────────────────────────────────────────── */}
      {loading && !kpis && <PilotSkeleton />}

      {!loading && error && (
        <section className="flex flex-col gap-4 rounded-2xl border border-destructive/25 bg-destructive/[0.04] p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 shrink-0 text-destructive" size={20} />
            <div>
              <h2 className="font-bold text-foreground">KPIs indisponibles</h2>
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

      {!loading && !error && kpis && healthStyle && (
        <>
          {/* Indicateur de santé global */}
          <section
            className={cn(
              'flex flex-col gap-3 rounded-2xl border p-5 sm:flex-row sm:items-center sm:justify-between',
              healthStyle.className,
            )}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-3">
              {kpis.health === 'GREEN' ? (
                <CheckCircle2 size={24} className="shrink-0" />
              ) : (
                <AlertCircle size={24} className="shrink-0" />
              )}
              <div>
                <p className="text-sm font-bold uppercase tracking-wider">Santé du pilote</p>
                <p className="mt-0.5 text-sm font-medium">{healthStyle.label}</p>
              </div>
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
                <RefreshCw size={14} /> Actualiser
              </Button>
            </div>
          </section>

          {/* ── 4 KPI cards ──────────────────────────────────────────────── */}
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Taux hold → confirm"
              value={`${holdRatePct} %`}
              target="≥ 30 %"
              detail={`${kpis.holdsTotal} holds → ${kpis.confirmedTotal} confirmés`}
              met={kpis.slos.holdToConfirmRateMin.met}
              icon={Gauge}
            />
            <KpiCard
              label="p95 latence /public/r/:slug"
              value={kpis.slugP95Ms !== null ? `${kpis.slugP95Ms} ms` : '—'}
              target="< 500 ms"
              detail={
                kpis.slugP95Ms !== null
                  ? 'Percentile 95 sur la route slug'
                  : 'Aucune mesure disponible'
              }
              met={kpis.slos.latencyP95MaxMs.met}
              icon={Clock}
            />
            <KpiCard
              label="Fuites PII"
              value={String(kpis.piiLeakIncidents)}
              target="0"
              detail="Incidents de fuite PII dans les logs"
              met={kpis.slos.piiLeakMax.met}
              icon={ShieldCheck}
            />
            <KpiCard
              label="aggregateRating safe"
              value={kpis.aggregateRatingSafe ? 'Safe' : 'At risk'}
              target="Safe"
              detail="Aucune page Search Console avec aggregateRating inventé"
              met={kpis.slos.aggregateRatingSafe.met}
              icon={ShieldCheck}
            />
          </section>

          {/* ── Légende ──────────────────────────────────────────────────── */}
          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="font-bold text-foreground">Critères go/no-go P1</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Le pilote passe en P2 (10 restaurants réels) uniquement si les 4 critères sont
              respectés sur la période d&apos;observation. La santé globale est{' '}
              <span className="font-medium text-success">GREEN</span> si tous sont respectés,{' '}
              <span className="font-medium text-warning">YELLOW</span> si 1 échoue,{' '}
              <span className="font-medium text-destructive">RED</span> si 2 ou plus échouent.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
