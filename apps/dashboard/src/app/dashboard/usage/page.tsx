'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Gauge,
  Info,
  MessageSquare,
  Phone,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi } from '@/lib/api';

type UsageCategory = 'TELEPHONY_SECONDS' | 'SMS_SEGMENTS' | string;
type UsageState = 'NOT_CONFIGURED' | 'WITHIN_LIMIT' | 'EXCEEDED';

type UsageQuantity = {
  category: UsageCategory;
  quantity: string;
};

type UsageSnapshot = {
  used: string;
  included: number | null;
  remaining: string | null;
  state: UsageState;
};

type UsageCurrent = {
  month: string;
  usage: UsageQuantity[];
  included?: {
    voiceMinutes: number | null;
    smsSegments: number | null;
  };
  quotas?: {
    voiceMinutes?: UsageSnapshot;
    smsSegments?: UsageSnapshot;
  };
};

type UsageHistory = {
  from: string;
  to: string;
  months: Array<{
    month: string;
    categories: UsageQuantity[];
  }>;
};

const EMPTY_USAGE: UsageSnapshot = {
  used: '0.000000',
  included: null,
  remaining: null,
  state: 'NOT_CONFIGURED',
};

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function historyRange(now = new Date()): { from: string; to: string } {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  return { from: monthKey(from), to: monthKey(now) };
}

function quantityFor(rows: UsageQuantity[], category: UsageCategory): string {
  return rows.find((row) => row.category === category)?.quantity ?? '0.000000';
}

function minutesFromSeconds(rows: UsageQuantity[]): string {
  const seconds = Number(quantityFor(rows, 'TELEPHONY_SECONDS'));
  return Number.isFinite(seconds) ? (seconds / 60).toFixed(6) : '0.000000';
}

function formatQuantity(value: string, maximumFractionDigits = 2): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits }).format(numeric);
}

function formatMonth(value: string): string {
  const parsed = new Date(`${value}-01T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(parsed);
}

function stateLabel(state: UsageState): string {
  if (state === 'EXCEEDED') return 'À vérifier';
  if (state === 'WITHIN_LIMIT') return 'Suivi';
  return 'Sans quota';
}

function stateVariant(state: UsageState): 'default' | 'secondary' | 'destructive' {
  if (state === 'EXCEEDED') return 'destructive';
  if (state === 'WITHIN_LIMIT') return 'default';
  return 'secondary';
}

function UsageCard({
  icon: Icon,
  title,
  unit,
  usage,
}: {
  icon: LucideIcon;
  title: string;
  unit: string;
  usage: UsageSnapshot;
}) {
  const used = Number(usage.used);
  const percentage =
    usage.included && usage.included > 0 && Number.isFinite(used)
      ? Math.min(100, Math.max(0, (used / usage.included) * 100))
      : 0;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription>{unit}</CardDescription>
          </div>
        </div>
        <Badge variant={stateVariant(usage.state)}>{stateLabel(usage.state)}</Badge>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-black tracking-tight">{formatQuantity(usage.used)}</span>
          <span className="text-sm text-muted-foreground">utilisés</span>
        </div>
        {usage.included === null ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Aucun plafond de consommation n&apos;est appliqué à votre formule. Ce compteur est
            informatif.
          </p>
        ) : (
          <>
            <div
              className="mt-4 h-2 overflow-hidden rounded-full bg-muted"
              aria-label="Progression indicative"
            >
              <div
                className="h-full rounded-full bg-primary transition-all duration-200"
                style={{ width: `${percentage}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span>{formatQuantity(String(usage.included))} inclus</span>
              <span>{formatQuantity(usage.remaining ?? '0')} restants</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function UsageSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Skeleton className="h-56 rounded-2xl" />
      <Skeleton className="h-56 rounded-2xl" />
    </div>
  );
}

export default function UsagePage() {
  const { get } = useApi();
  const [current, setCurrent] = useState<UsageCurrent | null>(null);
  const [history, setHistory] = useState<UsageHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => historyRange(), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [currentResponse, historyResponse] = await Promise.all([
        get<UsageCurrent>('usage/current'),
        get<UsageHistory>(`usage/history?from=${range.from}&to=${range.to}`),
      ]);
      setCurrent(currentResponse);
      setHistory(historyResponse);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Impossible de charger la consommation');
    } finally {
      setLoading(false);
    }
  }, [get, range.from, range.to]);

  useEffect(() => {
    void load();
  }, [load]);

  const voiceUsage = current?.quotas?.voiceMinutes ?? {
    ...EMPTY_USAGE,
    used: minutesFromSeconds(current?.usage ?? []),
    included: current?.included?.voiceMinutes ?? null,
  };
  const smsUsage = current?.quotas?.smsSegments ?? {
    ...EMPTY_USAGE,
    used: quantityFor(current?.usage ?? [], 'SMS_SEGMENTS'),
    included: current?.included?.smsSegments ?? null,
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Pilotage
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">Consommation</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Suivez les volumes de voix et de messages observés par votre établissement. Aucun quota
            ni blocage de service n&apos;est appliqué ; les coûts internes restent réservés aux
            opérations.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : undefined} aria-hidden="true" />
          Actualiser
        </Button>
      </header>

      {error && (
        <Card className="border-destructive/30 bg-destructive/5" role="alert">
          <CardContent className="flex items-center gap-3 pt-6 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
            <Button variant="outline" size="sm" className="ml-auto" onClick={() => void load()}>
              Réessayer
            </Button>
          </CardContent>
        </Card>
      )}

      {loading && !current ? (
        <UsageSkeleton />
      ) : current ? (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <UsageCard
              icon={Phone}
              title="Voix"
              unit="Minutes de conversation"
              usage={voiceUsage}
            />
            <UsageCard
              icon={MessageSquare}
              title="Messages"
              unit="Segments SMS acceptés"
              usage={smsUsage}
            />
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Gauge className="h-5 w-5 text-primary" aria-hidden="true" />
                <CardTitle className="text-lg">Mois courant</CardTitle>
              </div>
              <CardDescription>{formatMonth(current.month)}</CardDescription>
            </CardHeader>
            <CardContent>
              {current.usage.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aucune consommation enregistrée pour le moment.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {current.usage.map((row) => (
                    <div
                      key={row.category}
                      className="rounded-xl border border-border bg-muted/20 p-4"
                    >
                      <p className="text-xs font-medium text-muted-foreground">
                        {row.category === 'TELEPHONY_SECONDS'
                          ? 'Téléphonie'
                          : row.category === 'SMS_SEGMENTS'
                            ? 'SMS'
                            : row.category}
                      </p>
                      <p className="mt-1 text-xl font-bold">{formatQuantity(row.quantity)}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Historique</CardTitle>
              <CardDescription>
                Volumes agrégés sur les six derniers mois ({history?.from ?? range.from} →{' '}
                {history?.to ?? range.to}).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!history || history.months.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucun historique disponible.</p>
              ) : (
                <div className="space-y-3">
                  {history.months.map((month) => (
                    <div
                      key={month.month}
                      className="flex flex-col gap-2 rounded-xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <p className="font-medium capitalize">{formatMonth(month.month)}</p>
                      <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                        {month.categories.map((row) => (
                          <span key={`${month.month}-${row.category}`}>
                            {row.category === 'TELEPHONY_SECONDS'
                              ? 'Voix'
                              : row.category === 'SMS_SEGMENTS'
                                ? 'SMS'
                                : row.category}
                            :{' '}
                            <strong className="font-semibold text-foreground">
                              {formatQuantity(row.quantity)}
                            </strong>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <p>
              Sokar suit ces volumes pour assurer la qualité et piloter ses coûts opérationnels.
              Votre formule reste sans quota : aucun appel ou message n&apos;est coupé depuis cet
              écran. Aucun coût ou taux de marge n&apos;est exposé dans cet espace.
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
