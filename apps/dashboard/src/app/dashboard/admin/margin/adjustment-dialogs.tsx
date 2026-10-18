'use client';

import { adjustmentScopeLabel, adjustmentStatusText, usageDimensionLabel } from './margin-labels';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export type AdjustmentStatus = 'OPEN' | 'APPROVED' | 'REJECTED';
export type AdjustmentDecision = 'APPROVED' | 'REJECTED';

export type AdjustmentRow = {
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

export type CreateAdjustmentInput = {
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
  reason: string;
};

type RestaurantOption = { restaurantId: string; restaurantName: string | null };

export type UsageDetailsRow = {
  restaurantId: string;
  restaurantName: string | null;
  plan: string | null;
  knownAdjustedCostEur: string;
  approvedAdjustmentCostEur: string;
  approvedAdjustmentCount: number;
  pricedEventCount: number;
  unpricedEventCount: number;
  categories: Array<{
    category: string;
    quantity: string;
    pricedCostEur: string;
    costStatus: string;
    pricedEvents: number;
    unpricedEvents: number;
  }>;
};

const USAGE_CATEGORIES = [
  'TELEPHONY_SECONDS',
  'STT_SECONDS',
  'TTS_CHARACTERS',
  'LLM_INPUT_TOKENS',
  'LLM_OUTPUT_TOKENS',
  'SMS_SEGMENTS',
  'WHATSAPP_MESSAGES',
  'EMAIL_MESSAGES',
  'RECORDING_BYTE_DAYS',
] as const;

function monthBounds(month: string): { start: string; end: string } {
  const [year, monthNumber] = month.split('-').map(Number);
  const nextMonth = new Date(Date.UTC(year!, monthNumber!, 1));
  return {
    start: `${month}-01`,
    end: `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, '0')}-01`,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Une erreur est survenue.';
}

export function CreateAdjustmentDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: string;
  restaurants: RestaurantOption[];
  onSubmit: (input: CreateAdjustmentInput) => Promise<void>;
}) {
  const { open, onOpenChange, month, restaurants, onSubmit } = props;
  const [reportHash, setReportHash] = useState('');
  const [evidenceRef, setEvidenceRef] = useState('');
  const [scopeSelection, setScopeSelection] = useState('');
  const [category, setCategory] = useState<(typeof USAGE_CATEGORIES)[number]>('TELEPHONY_SECONDS');
  const [provider, setProvider] = useState('');
  const [unit, setUnit] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [quantityDelta, setQuantityDelta] = useState('0');
  const [costDeltaEur, setCostDeltaEur] = useState('0');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const bounds = monthBounds(month);
    setReportHash('');
    setEvidenceRef('');
    setScopeSelection('');
    setCategory('TELEPHONY_SECONDS');
    setProvider('');
    setUnit('');
    setPeriodStart(bounds.start);
    setPeriodEnd(bounds.end);
    setQuantityDelta('0');
    setCostDeltaEur('0');
    setReason('');
    setError(null);
  }, [open, month]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!/^[a-f\d]{64}$/i.test(reportHash)) {
      setError('Le hash du rapport doit contenir exactement 64 caractères hexadécimaux.');
      return;
    }
    if (!scopeSelection) {
      setError('Sélectionnez une portée pour cette correction.');
      return;
    }
    if (Number(quantityDelta) === 0 && Number(costDeltaEur) === 0) {
      setError('Le delta de quantité ou de coût doit être différent de zéro.');
      return;
    }
    if (new Date(periodEnd).getTime() <= new Date(periodStart).getTime()) {
      setError('La date de fin doit être postérieure à la date de début.');
      return;
    }

    const restaurantId = scopeSelection.startsWith('site:')
      ? scopeSelection.slice('site:'.length)
      : null;
    setSubmitting(true);
    try {
      await onSubmit({
        reportHash,
        evidenceRef,
        scopeKey: restaurantId ? `restaurant:${restaurantId}` : 'global',
        restaurantId,
        category,
        provider,
        unit,
        periodStart: new Date(`${periodStart}T00:00:00.000Z`).toISOString(),
        periodEnd: new Date(`${periodEnd}T00:00:00.000Z`).toISOString(),
        quantityDelta,
        costDeltaEur,
        reason,
      });
      onOpenChange(false);
    } catch (submitError: unknown) {
      setError(errorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Enregistrer une correction</DialogTitle>
          <DialogDescription>
            La correction restera à valider et ne modifiera pas le registre d’usage.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="adjustment-report-hash">Hash SHA-256 du rapport</Label>
              <Input
                id="adjustment-report-hash"
                value={reportHash}
                onChange={(event) => setReportHash(event.target.value)}
                minLength={64}
                maxLength={64}
                pattern="[A-Fa-f0-9]{64}"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adjustment-evidence">Référence de preuve</Label>
              <Input
                id="adjustment-evidence"
                value={evidenceRef}
                onChange={(event) => setEvidenceRef(event.target.value)}
                maxLength={191}
                placeholder="facture fournisseur · référence interne"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adjustment-scope">Portée</Label>
              <select
                id="adjustment-scope"
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={scopeSelection}
                onChange={(event) => setScopeSelection(event.target.value)}
                required
              >
                <option value="">Choisir une portée</option>
                <option value="global">Globale, non attribuée</option>
                {restaurants.map((restaurant) => (
                  <option key={restaurant.restaurantId} value={`site:${restaurant.restaurantId}`}>
                    {restaurant.restaurantName ?? restaurant.restaurantId}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="adjustment-category">Catégorie</Label>
              <select
                id="adjustment-category"
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value as (typeof USAGE_CATEGORIES)[number])
                }
              >
                {USAGE_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="adjustment-provider">Fournisseur</Label>
              <Input
                id="adjustment-provider"
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
                maxLength={64}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adjustment-unit">Unité</Label>
              <Input
                id="adjustment-unit"
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
                maxLength={32}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adjustment-period-start">Début de période</Label>
              <Input
                id="adjustment-period-start"
                type="date"
                value={periodStart}
                onChange={(event) => setPeriodStart(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adjustment-period-end">Fin de période (exclusive)</Label>
              <Input
                id="adjustment-period-end"
                type="date"
                value={periodEnd}
                onChange={(event) => setPeriodEnd(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adjustment-quantity">Delta de quantité</Label>
              <Input
                id="adjustment-quantity"
                type="number"
                step="0.000001"
                value={quantityDelta}
                onChange={(event) => setQuantityDelta(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adjustment-cost">Delta de coût (€)</Label>
              <Input
                id="adjustment-cost"
                type="number"
                step="0.000001"
                value={costDeltaEur}
                onChange={(event) => setCostDeltaEur(event.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="adjustment-reason">Motif</Label>
            <textarea
              id="adjustment-reason"
              className="min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={512}
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Enregistrement…' : 'Enregistrer à valider'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AdjustmentReviewDialog(props: {
  adjustment: AdjustmentRow | null;
  restaurantName: string | null;
  onClose: () => void;
  onDecision: (id: string, status: AdjustmentDecision, reason: string) => Promise<void>;
}) {
  const { adjustment, restaurantName, onClose, onDecision } = props;
  const [decision, setDecision] = useState<AdjustmentDecision | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDecision(null);
    setReason('');
    setError(null);
  }, [adjustment?.id]);

  async function handleDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adjustment || !decision) return;
    setSubmitting(true);
    setError(null);
    try {
      await onDecision(adjustment.id, decision, reason);
      setDecision(null);
      onClose();
    } catch (decisionError: unknown) {
      setError(errorMessage(decisionError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Dialog
        open={Boolean(adjustment && !decision)}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Détail de la correction</DialogTitle>
            <DialogDescription>
              {adjustment ? adjustmentScopeLabel(adjustment.scopeKey, restaurantName) : ''} ·{' '}
              {adjustment ? adjustmentStatusText(adjustment.status) : ''}
            </DialogDescription>
          </DialogHeader>
          {adjustment && (
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Dimension</dt>
                <dd className="mt-1 break-words font-medium">
                  {usageDimensionLabel(adjustment.category, adjustment.provider)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Période</dt>
                <dd className="mt-1 font-medium">
                  {adjustment.periodStart.slice(0, 10)} → {adjustment.periodEnd.slice(0, 10)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Delta de quantité</dt>
                <dd className="mt-1 font-medium">{adjustment.quantityDelta}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Delta de coût</dt>
                <dd className="mt-1 font-medium">{adjustment.costDeltaEur} €</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Motif de la correction</dt>
                <dd className="mt-1 whitespace-pre-wrap">{adjustment.reason}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Référence de preuve</dt>
                <dd className="mt-1 break-all font-mono text-xs">{adjustment.evidenceRef}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Hash du rapport</dt>
                <dd className="mt-1 break-all font-mono text-xs">{adjustment.reportHash}</dd>
              </div>
              {adjustment.decisionReason && (
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">Motif de décision</dt>
                  <dd className="mt-1 whitespace-pre-wrap">{adjustment.decisionReason}</dd>
                </div>
              )}
            </dl>
          )}
          <DialogFooter>
            {adjustment?.status === 'OPEN' && (
              <>
                <Button variant="destructive" onClick={() => setDecision('REJECTED')}>
                  Rejeter
                </Button>
                <Button onClick={() => setDecision('APPROVED')}>Approuver</Button>
              </>
            )}
            <Button variant="outline" onClick={onClose}>
              Fermer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(adjustment && decision)}
        onOpenChange={(open) => {
          if (!open) setDecision(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {decision === 'APPROVED' ? 'Approuver la correction' : 'Rejeter la correction'}
            </DialogTitle>
            <DialogDescription>Indiquez le motif de votre décision.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleDecision} className="space-y-4">
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <textarea
              aria-label="Motif de la décision"
              className="min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={512}
              required
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDecision(null)}>
                Retour
              </Button>
              <Button
                type="submit"
                variant={decision === 'REJECTED' ? 'destructive' : 'default'}
                disabled={submitting}
              >
                {submitting ? 'Enregistrement…' : 'Confirmer la décision'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function UsageDetailsDialog(props: {
  row: UsageDetailsRow | null;
  month: string;
  onClose: () => void;
}) {
  const { row, month, onClose } = props;

  return (
    <Dialog open={Boolean(row)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{row?.restaurantName ?? row?.restaurantId}</DialogTitle>
          <DialogDescription>
            Détail des usages · {month} · Formule {row?.plan ?? 'non renseignée'}
          </DialogDescription>
        </DialogHeader>
        {row && row.categories.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Catégorie</TableHead>
                  <TableHead>Volume</TableHead>
                  <TableHead>Coût tarifé</TableHead>
                  <TableHead>État</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {row.categories.map((category) => (
                  <TableRow key={category.category}>
                    <TableCell className="font-medium">{category.category}</TableCell>
                    <TableCell className="tabular-nums">{category.quantity}</TableCell>
                    <TableCell className="tabular-nums">
                      {category.pricedEvents > 0
                        ? `${new Intl.NumberFormat('fr-FR', {
                            style: 'currency',
                            currency: 'EUR',
                          }).format(Number(category.pricedCostEur))}`
                        : 'À rapprocher'}
                    </TableCell>
                    <TableCell>
                      {category.costStatus === 'PRICED'
                        ? 'Tarifé'
                        : category.costStatus === 'MIXED'
                          ? `${category.unpricedEvents} à rapprocher`
                          : 'Non tarifé'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Aucun usage enregistré pour ce mois.</p>
        )}
        <div className="rounded-lg border border-border p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span>Coût connu, corrections approuvées incluses</span>
            <span className="font-semibold tabular-nums">
              {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(
                Number(row?.knownAdjustedCostEur ?? 0),
              )}
            </span>
          </div>
          {row && row.approvedAdjustmentCount > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {row.approvedAdjustmentCount} correction(s) ·{' '}
              {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(
                Number(row.approvedAdjustmentCostEur),
              )}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
