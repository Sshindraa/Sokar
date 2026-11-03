'use client';

import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
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
        aria-label="Absences"
        className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between md:p-6"
      >
        <p className="text-sm text-muted-foreground">
          Les statistiques d’absence sont momentanément indisponibles.
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
  const lowerWithSms = data.impact !== null && data.impact > 0;

  return (
    <section className="rounded-2xl border border-border bg-card p-5 md:p-6">
      <div className="mb-4 flex items-center gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground">Absences</h2>
          <p className="text-sm text-muted-foreground">
            90 derniers jours · {data.total} réservations
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {/* Taux global */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">Taux</span>
          </div>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-foreground">
            {formatDecimal(data.noShowRate)}&nbsp;%
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.noShows} absence{data.noShows > 1 ? 's' : ''} sur {data.total}
          </p>
        </div>

        {/* Montants associés, sans attribution causale. */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">
              Montant associé aux absences
            </span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Comprendre le montant associé aux absences"
                    className="inline-flex rounded text-muted-foreground transition-all duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Info className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Montants confirmés ou estimés des réservations absentes ; encaissements non
                  vérifiés.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-foreground">
            {data.revenueLost.toLocaleString('fr-FR')} €
          </p>
        </div>

        {/* Écart observé avec / sans SMS : le sens passe par le texte, pas par un signe ni une couleur */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">
              Écart observé avec / sans SMS
            </span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Comprendre la comparaison avec et sans SMS"
                    className="inline-flex rounded text-muted-foreground transition-all duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Info className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  La comparaison porte sur {data.withSms.total} réservations avec SMS et{' '}
                  {data.withoutSms.total} sans rappel connu. Seuls les SMS acceptés par le
                  fournisseur et enregistrés sont comptés ; les rappels connus dont le canal est
                  inconnu sont exclus. Les groupes peuvent différer ; cet écart ne prouve pas un
                  effet du rappel.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          {hasComparison ? (
            <>
              <p
                className={`mt-2 text-3xl font-semibold tabular-nums ${
                  lowerWithSms ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                {data.impact === 0 ? 'Écart nul' : `${formatDecimal(Math.abs(data.impact!))} pts`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {lowerWithSms
                  ? 'd’absences en moins dans le groupe avec SMS'
                  : data.impact === 0
                    ? 'autant d’absences avec et sans SMS'
                    : `${formatDecimal(Math.abs(data.impact!))} pts d’absences en plus dans le groupe avec SMS`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatDecimal(data.withSms.rate)}&nbsp;% avec SMS ·{' '}
                {formatDecimal(data.withoutSms.rate)}
                &nbsp;% sans
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm font-medium text-muted-foreground">
                Données insuffisantes
              </p>
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
