'use client';

import { useEffect, useState } from 'react';
import { UserX, TrendingDown, MessageSquare, Euro } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
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

export default function NoShowWidget() {
  const { get, orgId } = useApi();
  const [data, setData] = useState<NoShowStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    let mounted = true;
    async function fetchStats() {
      try {
        const res = await get<NoShowStats>('dashboard/no-show-stats');
        if (mounted) setData(res);
      } catch {
        // silent fail — widget is non-critical
      } finally {
        if (mounted) setLoading(false);
      }
    }
    fetchStats();
    return () => {
      mounted = false;
    };
  }, [get, orgId]);

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
          <p className="mt-2 text-3xl font-black text-foreground">{data.noShowRate.toFixed(1)}%</p>
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

        {/* Impact du rappel SMS */}
        <div
          className={`rounded-xl border p-4 ${
            hasComparison
              ? smsWorks
                ? 'border-success/20 bg-success/[0.04]'
                : 'border-warning/20 bg-warning/[0.04]'
              : 'border-border bg-card'
          }`}
        >
          <div className="flex items-center gap-2">
            <MessageSquare
              size={14}
              className={
                hasComparison
                  ? smsWorks
                    ? 'text-success'
                    : 'text-warning'
                  : 'text-muted-foreground'
              }
            />
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Réservations sauvées par SMS
            </span>
          </div>

          {hasComparison ? (
            <>
              <p
                className={`mt-2 text-3xl font-black ${smsWorks ? 'text-success' : 'text-warning'}`}
              >
                {smsWorks ? '-' : '+'}
                {Math.abs(data.impact!).toFixed(1)} pts
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {smsWorks ? (
                  <>
                    <span className="text-success">{data.withSms.rate.toFixed(1)}%</span> avec SMS
                    vs <span className="text-destructive">{data.withoutSms.rate.toFixed(1)}%</span>{' '}
                    sans
                  </>
                ) : (
                  <>
                    <span className="text-warning">{data.withSms.rate.toFixed(1)}%</span> avec SMS
                    vs <span>{data.withoutSms.rate.toFixed(1)}%</span> sans
                  </>
                )}
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
