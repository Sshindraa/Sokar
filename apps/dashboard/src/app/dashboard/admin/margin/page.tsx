'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  Info,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useApi } from '@/lib/api';
import {
  AdjustmentReviewDialog,
  CreateAdjustmentDialog,
  type AdjustmentDecision,
  type AdjustmentRow,
  type AdjustmentStatus,
  type CreateAdjustmentInput,
  type UsageDetailsRow,
  UsageDetailsDialog,
} from './adjustment-dialogs';

type MarginStatus = 'PRICED' | 'UNPRICED' | 'MIXED' | 'NO_USAGE';

type UsageCategoryRow = {
  category: string;
  quantity: string;
  estimatedCostEur: string;
  pricedCostEur: string;
  costStatus: Exclude<MarginStatus, 'NO_USAGE'>;
  pricedEvents: number;
  unpricedEvents: number;
};

type MarginRow = {
  restaurantId: string;
  restaurantName: string | null;
  plan: string | null;
  catalogPriceEur: number | null;
  approvedAdjustmentCostEur: string;
  approvedAdjustmentCount: number;
  estimatedCostEur: string;
  adjustedCostEur: string;
  knownAdjustedCostEur: string;
  pricedEventCount: number;
  unpricedEventCount: number;
  costStatus: MarginStatus;
  grossMarginEur: string | null;
  grossMarginPercent: string | null;
  categories: UsageCategoryRow[];
};

type MarginReport = {
  month: string;
  priceSource: 'LOCAL_CATALOG';
  revenueStatus: 'NOT_STRIPE_RECONCILED';
  rows: MarginRow[];
};

type AdjustmentListResponse = {
  data?: AdjustmentRow[];
  hasMore?: boolean;
  nextCursor?: string | null;
};

type AdjustmentFilter = 'ALL' | AdjustmentStatus;

const ADJUSTMENT_PAGE_SIZE = 50;

function currentMonthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function shiftMonthKey(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const shifted = new Date(Date.UTC(year!, monthNumber! - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
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
  const { get, post } = useApi();
  const [month, setMonth] = useState(currentMonthKey);
  const [report, setReport] = useState<MarginReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adjustments, setAdjustments] = useState<AdjustmentRow[]>([]);
  const [adjustmentFilter, setAdjustmentFilter] = useState<AdjustmentFilter>('ALL');
  const [adjustmentCursor, setAdjustmentCursor] = useState<string | null>(null);
  const [adjustmentHasMore, setAdjustmentHasMore] = useState(false);
  const [adjustmentLoading, setAdjustmentLoading] = useState(false);
  const [adjustmentError, setAdjustmentError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedAdjustment, setSelectedAdjustment] = useState<AdjustmentRow | null>(null);
  const [selectedUsage, setSelectedUsage] = useState<UsageDetailsRow | null>(null);
  const reportRequestId = useRef(0);
  const adjustmentRequestId = useRef(0);

  const loadReport = useCallback(async () => {
    const requestId = ++reportRequestId.current;
    setLoading(true);
    setError(null);
    try {
      const nextReport = await get<MarginReport>(`admin/usage/margin?month=${month}`);
      if (requestId !== reportRequestId.current) return;
      setReport(nextReport);
    } catch (err: unknown) {
      if (requestId !== reportRequestId.current) return;
      setError(err instanceof Error ? err.message : 'Impossible de charger le suivi des coûts');
    } finally {
      if (requestId === reportRequestId.current) setLoading(false);
    }
  }, [get, month]);

  const loadAdjustments = useCallback(
    async (cursor: string | null = null, append = false) => {
      const requestId = ++adjustmentRequestId.current;
      setAdjustmentLoading(true);
      setAdjustmentError(null);
      if (!append) {
        setAdjustments([]);
        setAdjustmentCursor(null);
        setAdjustmentHasMore(false);
      }
      const params = new URLSearchParams({ limit: String(ADJUSTMENT_PAGE_SIZE) });
      if (adjustmentFilter !== 'ALL') params.set('status', adjustmentFilter);
      if (cursor) params.set('cursor', cursor);
      try {
        const result = await get<AdjustmentListResponse>(
          `admin/usage/reconciliation-adjustments?${params.toString()}`,
        );
        if (requestId !== adjustmentRequestId.current) return;
        const data = Array.isArray(result.data) ? result.data : [];
        setAdjustments((current) => (append ? [...current, ...data] : data));
        setAdjustmentCursor(result.nextCursor ?? null);
        setAdjustmentHasMore(Boolean(result.hasMore));
      } catch (err: unknown) {
        if (requestId !== adjustmentRequestId.current) return;
        setAdjustmentError(
          err instanceof Error ? err.message : 'Impossible de charger les corrections',
        );
      } finally {
        if (requestId === adjustmentRequestId.current) setAdjustmentLoading(false);
      }
    },
    [adjustmentFilter, get],
  );

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  useEffect(() => {
    void loadAdjustments();
  }, [loadAdjustments]);

  const rows = report?.month === month ? report.rows : [];
  const pricedEventCount = rows.reduce((sum, row) => sum + row.pricedEventCount, 0);
  const unpricedEventCount = rows.reduce((sum, row) => sum + row.unpricedEventCount, 0);
  const affectedRestaurantCount = rows.filter((row) => row.unpricedEventCount > 0).length;
  const knownAdjustedCost = rows.reduce((sum, row) => sum + Number(row.knownAdjustedCostEur), 0);
  const approvedAdjustmentCount = rows.reduce((sum, row) => sum + row.approvedAdjustmentCount, 0);
  const restaurants = useMemo(
    () => rows.map(({ restaurantId, restaurantName }) => ({ restaurantId, restaurantName })),
    [rows],
  );
  const reportIsCurrent = report?.month === month;
  const currentMonth = currentMonthKey();

  async function handleCreateAdjustment(input: CreateAdjustmentInput) {
    await post('admin/usage/reconciliation-adjustments', input);
    await Promise.all([loadReport(), loadAdjustments()]);
  }

  async function handleDecision(id: string, status: AdjustmentDecision, reason: string) {
    await post(`admin/usage/reconciliation-adjustments/${id}/decision`, { status, reason });
    await Promise.all([loadReport(), loadAdjustments()]);
  }

  function refresh() {
    void loadReport();
    void loadAdjustments();
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 md:p-8">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Opérations Sokar
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">Coût opérationnel</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Coûts d’usage tarifés et écarts de facture par établissement. La marge reste indicative
            tant que les revenus Stripe et tous les tarifs fournisseurs ne sont pas rapprochés.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Mois précédent"
            title="Mois précédent"
            onClick={() => setMonth((value) => shiftMonthKey(value, -1))}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Input
            type="month"
            aria-label="Période du rapport"
            className="w-40"
            max={currentMonth}
            value={month}
            onChange={(event) => setMonth(event.target.value || currentMonth)}
          />
          <Button
            variant="outline"
            size="icon"
            aria-label="Mois suivant"
            title="Mois suivant"
            onClick={() => setMonth((value) => shiftMonthKey(value, 1))}
            disabled={month >= currentMonth}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
          {month !== currentMonth && (
            <Button variant="outline" onClick={() => setMonth(currentMonth)}>
              Ce mois-ci
            </Button>
          )}
          <Button asChild variant="outline">
            <a href={`/api/proxy/admin/usage/accounting-export.csv?month=${month}`}>
              <Download aria-hidden="true" />
              Télécharger le suivi interne
            </a>
          </Button>
          <Button variant="outline" onClick={refresh} disabled={loading || adjustmentLoading}>
            <RefreshCw
              className={loading || adjustmentLoading ? 'animate-spin' : undefined}
              aria-hidden="true"
            />
            Actualiser
          </Button>
        </div>
      </header>

      {error && (
        <Card className="border-destructive/30 bg-destructive/5" role="alert">
          <CardContent className="flex items-center justify-between gap-3 pt-6 text-sm text-destructive">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={() => void loadReport()}>
              Réessayer
            </Button>
          </CardContent>
        </Card>
      )}

      {loading && !reportIsCurrent ? (
        <Skeleton className="h-72 rounded-2xl" />
      ) : reportIsCurrent ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Coûts connus + corrections approuvées</CardDescription>
                <CardTitle className="text-3xl">{formatEur(knownAdjustedCost)}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {pricedEventCount} usage(s) tarifé(s) · {approvedAdjustmentCount} correction(s)
                approuvée(s) attribuée(s) à un établissement.
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Usages à rapprocher</CardDescription>
                <CardTitle className="text-3xl">
                  {new Intl.NumberFormat('fr-FR').format(unpricedEventCount)}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {affectedRestaurantCount} établissement(s) concerné(s) · exclus du coût connu.
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-primary" aria-hidden="true" />
                  <div>
                    <CardTitle className="text-lg">Établissements</CardTitle>
                    <CardDescription>
                      Prix de formule indicatif · revenus Stripe non rapprochés · marge indicative.
                    </CardDescription>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aucun usage enregistré pour ce mois.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Établissement</TableHead>
                        <TableHead>Formule</TableHead>
                        <TableHead>Tarif catalogue indicatif</TableHead>
                        <TableHead>Coût connu + corrections</TableHead>
                        <TableHead>État des usages</TableHead>
                        <TableHead>Marge indicative</TableHead>
                        <TableHead className="text-right">Détail</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => {
                        const hasKnownCost =
                          row.pricedEventCount > 0 || row.approvedAdjustmentCount > 0;
                        return (
                          <TableRow key={row.restaurantId}>
                            <TableCell className="font-medium">
                              {row.restaurantName ?? row.restaurantId}
                            </TableCell>
                            <TableCell>{row.plan ?? '—'}</TableCell>
                            <TableCell>{formatEur(row.catalogPriceEur)}</TableCell>
                            <TableCell>
                              {hasKnownCost ? formatEur(row.knownAdjustedCostEur) : 'À rapprocher'}
                              {row.approvedAdjustmentCount > 0 && (
                                <span className="mt-1 block text-xs text-muted-foreground">
                                  {row.approvedAdjustmentCount} correction(s) ·{' '}
                                  {formatEur(row.approvedAdjustmentCostEur)}
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant={statusVariant(row.costStatus)}>
                                {statusLabel(row.costStatus)}
                              </Badge>
                              {row.unpricedEventCount > 0 && (
                                <span className="mt-1 block text-xs text-muted-foreground">
                                  {row.unpricedEventCount} usage(s) à rapprocher
                                </span>
                              )}
                            </TableCell>
                            <TableCell>{formatEur(row.grossMarginEur)}</TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label={`Détail de ${row.restaurantName ?? row.restaurantId}`}
                                onClick={() => setSelectedUsage(row)}
                              >
                                <Eye aria-hidden="true" />
                                Voir
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      {reportIsCurrent && (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-lg">Corrections de rapprochement</CardTitle>
                <CardDescription>
                  Les corrections restent séparées du registre d’usage et nécessitent une décision.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={adjustmentFilter}
                  onValueChange={(value) => setAdjustmentFilter(value as AdjustmentFilter)}
                >
                  <SelectTrigger className="w-40" aria-label="Filtrer les corrections">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Tous les états</SelectItem>
                    <SelectItem value="OPEN">À valider</SelectItem>
                    <SelectItem value="APPROVED">Approuvées</SelectItem>
                    <SelectItem value="REJECTED">Rejetées</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus aria-hidden="true" />
                  Nouvelle correction
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {adjustmentError ? (
              <div
                className="flex flex-wrap items-center justify-between gap-3 text-sm text-destructive"
                role="alert"
              >
                <span>{adjustmentError}</span>
                <Button variant="outline" size="sm" onClick={() => void loadAdjustments()}>
                  Réessayer
                </Button>
              </div>
            ) : adjustments.length === 0 && adjustmentLoading ? (
              <Skeleton className="h-20" />
            ) : adjustments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune correction dans ce filtre.</p>
            ) : (
              <>
                <p className="mb-3 text-xs text-muted-foreground">
                  {adjustments.length} correction(s) affichée(s)
                  {adjustmentHasMore ? ' · d’autres résultats sont disponibles' : ''}
                </p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Portée</TableHead>
                        <TableHead>Dimension</TableHead>
                        <TableHead>Période</TableHead>
                        <TableHead>Delta coût</TableHead>
                        <TableHead>État</TableHead>
                        <TableHead className="text-right">Action</TableHead>
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
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedAdjustment(adjustment)}
                            >
                              Examiner
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {adjustmentHasMore && (
                  <div className="mt-4 flex justify-center">
                    <Button
                      variant="outline"
                      onClick={() => void loadAdjustments(adjustmentCursor, true)}
                      disabled={adjustmentLoading || !adjustmentCursor}
                    >
                      {adjustmentLoading ? 'Chargement…' : 'Charger plus'}
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {reportIsCurrent && (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <p>
            Les coûts connus comprennent uniquement les usages tarifés et les corrections approuvées
            attribuées à un établissement. La marge compare ces coûts au tarif catalogue indicatif ;
            elle ne remplace pas le rapprochement Stripe ou fournisseur et ne limite aucun
            restaurant.
          </p>
        </div>
      )}

      <CreateAdjustmentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        month={month}
        restaurants={restaurants}
        onSubmit={handleCreateAdjustment}
      />
      <AdjustmentReviewDialog
        adjustment={selectedAdjustment}
        restaurantName={
          rows.find((row) => row.restaurantId === selectedAdjustment?.restaurantId)
            ?.restaurantName ?? null
        }
        onClose={() => setSelectedAdjustment(null)}
        onDecision={handleDecision}
      />
      <UsageDetailsDialog
        row={selectedUsage}
        month={month}
        onClose={() => setSelectedUsage(null)}
      />
    </div>
  );
}
