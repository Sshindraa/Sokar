'use client';

import { useEffect, useState } from 'react';
import { UserX, TrendingDown, MessageSquare, Euro } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useApi } from '../../lib/api';

interface NoShowStats {
  total: number;
  noShows: number;
  noShowRate: number;
  revenueLost: number;
  withSms: { total: number; noShows: number; rate: number };
  withoutSms: { total: number; noShows: number; rate: number };
  impact: number | null;
}

/** Nombre à la française : « 12,5 », jamais « 12.5 ». */
const formatDecimal = (value: number) =>
  value.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export default function NoShowWidget() {
  const { get, orgId } = useApi();
  const [data, setData] = useState<NoShowStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    let mounted = true;
    async function fetchStats() {
      setFailed(false);
      setLoading(true);
      try {
        const res = await get<NoShowStats>('dashboard/no-show-stats');
        if (mounted) setData(res);
      } catch {
        // Le widget n'est pas critique, mais une panne ne doit pas ressembler à « aucun no-show ».
        if (mounted) setFailed(true);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    fetchStats();
    return () => {
      mounted = false;
    };
  }, [get, orgId, reloadKey]);

  if (!orgId) return null;
  if (loading) {
    return (
      <section className="rounded-2xl border border-border bg-card p-5 md:p-6">
        <Skeleton className="mb-4 h-6 w-40" />
        <div className="grid gap-3 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      </section>
    );
  }

  if (failed) {
    return (
      <section
        aria-label="No-shows"
        className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between md:p-6"
      >
        <p className="text-sm text-muted-foreground">
          Les statistiques de no-show sont momentanément indisponibles.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setReloadKey((key) => key + 1)}
          className="w-fit transition-all duration-200"
        >
          Réessayer
        </Button>
      </section>
    );
  }

  if (!data || data.total === 0) return null;

  const hasComparison = data.impact !== null;
  const smsWorks = data.impact !== null && data.impact > 0;

  return (
    <section className="rounded-2xl border border-border bg-card p-5 md:p-6">
      <div className="mb-4 flex items-center gap-3">
        <UserX size={20} className="text-destructive" />
        <div>
          <h2 className="text-lg font-bold text-foreground">No-shows</h2>
          <p className="text-sm text-muted-foreground">
            90 derniers jours · {data.total} réservations
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {/* Taux global */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <TrendingDown size={14} className="text-destructive" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Taux
            </span>
          </div>
          <p className="mt-2 text-3xl font-black text-foreground">
            {formatDecimal(data.noShowRate)}&nbsp;%
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.noShows} no-show{data.noShows > 1 ? 's' : ''} sur {data.total}
          </p>
        </div>

        {/* CA perdu */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <Euro size={14} className="text-destructive" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              CA estimé perdu
            </span>
          </div>
          <p className="mt-2 text-3xl font-black text-destructive">
            {data.revenueLost.toLocaleString('fr-FR')} €
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.noShows} absence{data.noShows > 1 ? 's' : ''}
          </p>
        </div>

        {/* Effet du rappel SMS : le sens passe par le texte, pas par un signe ni une couleur */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <MessageSquare size={14} className="text-muted-foreground" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Effet du rappel SMS
            </span>
          </div>

          {hasComparison ? (
            <>
              <p
                className={`mt-2 text-3xl font-black ${
                  smsWorks ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                {smsWorks
                  ? `${formatDecimal(Math.abs(data.impact!))} pts`
                  : data.impact === 0
                    ? 'Écart nul'
                    : 'Aucun gain mesuré'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {smsWorks
                  ? 'de no-shows en moins grâce au SMS'
                  : data.impact === 0
                    ? 'autant de no-shows avec et sans SMS'
                    : `${formatDecimal(Math.abs(data.impact!))} pts de no-shows en plus avec le SMS`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatDecimal(data.withSms.rate)}&nbsp;% avec SMS ·{' '}
                {formatDecimal(data.withoutSms.rate)}
                &nbsp;% sans
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm font-medium text-muted-foreground">Pas encore mesurable</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.withSms.total < 5
                  ? `${data.withSms.total}/5 réservations avec SMS`
                  : `${data.withoutSms.total}/5 réservations sans SMS`}
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
