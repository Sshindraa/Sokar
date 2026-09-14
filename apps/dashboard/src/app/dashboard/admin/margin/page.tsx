'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Download, Info, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useApi } from '@/lib/api';

type MarginStatus = 'PRICED' | 'UNPRICED' | 'MIXED' | 'NO_USAGE';

type MarginRow = {
  restaurantId: string;
  restaurantName: string | null;
  plan: string | null;
  catalogPriceEur: number | null;
  approvedAdjustmentCostEur?: string;
  approvedAdjustmentCount?: number;
  estimatedCostEur: string;
  adjustedCostEur?: string;
  costStatus: MarginStatus;
  grossMarginEur: string | null;
  grossMarginPercent: string | null;
};

type MarginReport = {
  month: string;
  priceSource: 'LOCAL_CATALOG';
  revenueStatus: 'NOT_STRIPE_RECONCILED';
  rows: MarginRow[];
};

type AdjustmentStatus = 'OPEN' | 'APPROVED' | 'REJECTED';

type AdjustmentRow = {
  id: string;
  reportHash: string;
  evidenceRef: string;
  scopeKey: string;
  restaurantId: string | null;
  category: string;
  provider: string;
  unit: string;
  periodStart: string;
  periodEnd: string;
  quantityDelta: string;
  costDeltaEur: string;
  status: AdjustmentStatus;
  reason: string;
  decisionReason: string | null;
  createdAt: string;
  updatedAt: string;
};

function currentMonthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatEur(value: number | string | null): string {
  if (value === null) return 'À rapprocher';
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 'À rapprocher';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(numeric);
}

function statusLabel(status: MarginStatus): string {
  if (status === 'PRICED') return 'Tarifé';
  if (status === 'MIXED') return 'Partiel';
  if (status === 'UNPRICED') return 'Non tarifé';
  return 'Aucun usage';
}

function statusVariant(status: MarginStatus): 'default' | 'secondary' | 'destructive' {
  if (status === 'PRICED') return 'default';
  if (status === 'MIXED' || status === 'NO_USAGE') return 'secondary';
  return 'destructive';
}

function adjustmentStatusLabel(status: AdjustmentStatus): string {
  if (status === 'OPEN') return 'À valider';
  if (status === 'APPROVED') return 'Approuvée';
  return 'Rejetée';
}

function adjustmentStatusVariant(
  status: AdjustmentStatus,
): 'default' | 'secondary' | 'destructive' {
  if (status === 'APPROVED') return 'default';
  if (status === 'REJECTED') return 'destructive';
  return 'secondary';
}

export default function AdminMarginPage() {
  const { get } = useApi();
  const month = useMemo(() => currentMonthKey(), []);
  const [report, setReport] = useState<MarginReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adjustments, setAdjustments] = useState<AdjustmentRow[]>([]);
  const [adjustmentError, setAdjustmentError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await get<MarginReport>(`admin/usage/margin?month=${month}`));
      try {
        const adjustmentResponse = await get<{ data?: AdjustmentRow[] }>(
          'admin/usage/reconciliation-adjustments?limit=100',
        );
        setAdjustments(Array.isArray(adjustmentResponse.data) ? adjustmentResponse.data : []);
        setAdjustmentError(null);
      } catch (err: unknown) {
        setAdjustmentError(
          err instanceof Error ? err.message : 'Impossible de charger les corrections',
        );
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Impossible de charger la marge interne');
    } finally {
      setLoading(false);
    }
  }, [get, month]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = report?.rows ?? [];
  const catalogMrr = rows.reduce((sum, row) => sum + (row.catalogPriceEur ?? 0), 0);
  const pricedCost = rows.reduce(
    (sum, row) =>
      row.costStatus === 'PRICED' ? sum + Number(row.adjustedCostEur ?? row.estimatedCostEur) : sum,
    0,
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 md:p-8">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Opérations Sokar
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">Coût opérationnel</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Vue réservée aux opérateurs : coûts observés par établissement, corrections de facture
            et marge calculable à partir du catalogue local. Les données restent dans Sokar pour le
            pilotage interne ; le raccordement comptable sera traité séparément.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <a href={`/api/proxy/admin/usage/accounting-export.csv?month=${month}`}>
              <Download aria-hidden="true" />
              Télécharger le suivi interne
            </a>
          </Button>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? 'animate-spin' : undefined} aria-hidden="true" />
            Actualiser
          </Button>
        </div>
      </header>

      {error && (
        <Card className="border-destructive/30 bg-destructive/5" role="alert">
          <CardContent className="flex items-center justify-between gap-3 pt-6 text-sm text-destructive">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Réessayer
            </Button>
          </CardContent>
        </Card>
      )}

      {loading && !report ? (
        <Skeleton className="h-72 rounded-2xl" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>MRR catalogue local</CardDescription>
                <CardTitle className="text-3xl">{formatEur(catalogMrr)}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Essential 199 €, Pro 299 €, Multi-site 249 € de base.
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Coûts tarifés après corrections</CardDescription>
                <CardTitle className="text-3xl">{formatEur(pricedCost)}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Les corrections approuvées sont appliquées sans réécrire le ledger.
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" aria-hidden="true" />
                <CardTitle className="text-lg">Établissements — {report?.month ?? month}</CardTitle>
              </div>
              <CardDescription>
                Source prix : catalogue applicatif local · état revenu : Stripe non rapproché.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aucun événement d’usage tarifé pour ce mois.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Établissement</TableHead>
                        <TableHead>Formule</TableHead>
                        <TableHead>MRR catalogue</TableHead>
                        <TableHead>Coût opérationnel</TableHead>
                        <TableHead>État</TableHead>
                        <TableHead className="text-right">Marge</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => (
                        <TableRow key={row.restaurantId}>
                          <TableCell className="font-medium">
                            {row.restaurantName ?? row.restaurantId}
                          </TableCell>
                          <TableCell>{row.plan ?? '—'}</TableCell>
                          <TableCell>{formatEur(row.catalogPriceEur)}</TableCell>
                          <TableCell>
                            {formatEur(row.adjustedCostEur ?? row.estimatedCostEur)}
                            {row.approvedAdjustmentCount ? (
                              <span className="mt-1 block text-xs text-muted-foreground">
                                {row.approvedAdjustmentCount} correction(s) ·{' '}
                                {formatEur(row.approvedAdjustmentCostEur ?? '0')}
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusVariant(row.costStatus)}>
                              {statusLabel(row.costStatus)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <span>{formatEur(row.grossMarginEur)}</span>
                            {row.grossMarginPercent && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                ({row.grossMarginPercent} %)
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg">Corrections de rapprochement</CardTitle>
                  <CardDescription>
                    Écarts conservés séparément du ledger, avec preuve et décision opérateur.
                  </CardDescription>
                </div>
                <Badge variant="secondary">{adjustments.length} enregistrée(s)</Badge>
              </div>
            </CardHeader>
            <CardContent>
              {adjustmentError ? (
                <p className="text-sm text-muted-foreground">{adjustmentError}</p>
              ) : adjustments.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune correction enregistrée.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Portée</TableHead>
                        <TableHead>Dimension</TableHead>
                        <TableHead>Période</TableHead>
                        <TableHead>Delta coût</TableHead>
                        <TableHead>État</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {adjustments.map((adjustment) => (
                        <TableRow key={adjustment.id}>
                          <TableCell className="font-medium">{adjustment.scopeKey}</TableCell>
                          <TableCell>
                            {adjustment.category}/{adjustment.provider}/{adjustment.unit}
                          </TableCell>
                          <TableCell>
                            {adjustment.periodStart.slice(0, 10)} →{' '}
                            {adjustment.periodEnd.slice(0, 10)}
                          </TableCell>
                          <TableCell>{formatEur(adjustment.costDeltaEur)}</TableCell>
                          <TableCell>
                            <Badge variant={adjustmentStatusVariant(adjustment.status)}>
                              {adjustmentStatusLabel(adjustment.status)}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <p>
              Cette vue ne constitue pas une facture : les montants Stripe et les tarifs
              fournisseurs doivent encore être rapprochés avant toute décision de marge. Elle sert
              au suivi interne et n&apos;impose aucune limite au restaurant.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
