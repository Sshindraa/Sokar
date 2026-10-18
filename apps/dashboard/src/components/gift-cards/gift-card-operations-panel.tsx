'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { GiftCardCashier } from './gift-card-cashier';
import { formatEuro } from '@sokar/shared';
import { getErrorMessage } from '@/types/api';

type Overview = {
  canExport: boolean;
  capturedAmount: number;
  refundedAmount: number;
  availableBalance: number;
  blockedBalance: number;
  manuallyIssuedAmount: number;
  untrackedLegacyPayments: number;
  pendingRefunds: number;
};
export function GiftCardOperationsPanel({
  revision,
  onChanged,
}: {
  revision: number;
  onChanged: () => void;
}) {
  const { get, post, orgId } = useApi();
  const currentOrg = useRef(orgId);
  currentOrg.current = orgId;
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [lookupError, setLookupError] = useState('');
  const [loading, setLoading] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [cardId, setCardId] = useState<string | null>(null);
  const [exportFrom, setExportFrom] = useState(() => new Date().toISOString().slice(0, 7) + '-01');
  const [exportUntil, setExportUntil] = useState(() => new Date().toISOString().slice(0, 10));
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  async function download() {
    if (!orgId || exporting) return;
    setExporting(true);
    setExportError('');
    try {
      const result = await get<{ csv: string; filename: string }>(
        `restaurants/${orgId}/gift-cards/operations/export?from=${encodeURIComponent(exportFrom)}&until=${encodeURIComponent(exportUntil)}`,
      );
      if (currentOrg.current !== orgId) return;
      const url = URL.createObjectURL(new Blob([result.csv], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setExportError(getErrorMessage(e, 'Export indisponible.'));
    } finally {
      setExporting(false);
    }
  }
  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const next = await get<Overview>(`restaurants/${orgId}/gift-cards/operations/overview`);
      if (currentOrg.current !== orgId) return;
      setOverview(next);
      setError('');
    } catch (e) {
      setError(getErrorMessage(e, 'Bilan financier indisponible.'));
    } finally {
      setLoading(false);
    }
  }, [get, orgId]);
  useEffect(() => {
    setOverview(null);
    setCardId(null);
    setCode('');
  }, [orgId]);
  useEffect(() => {
    void load();
  }, [load, revision]);
  async function lookup() {
    if (!orgId || !code.trim() || busy) return;
    setBusy(true);
    setLookupError('');
    try {
      const card = await post<{ id: string }>(`restaurants/${orgId}/gift-cards/operations/lookup`, {
        code: code.trim(),
      });
      if (currentOrg.current === orgId) setCardId(card.id);
    } catch (e) {
      setLookupError(getErrorMessage(e, 'Carte introuvable.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h2 className="font-semibold">Encaisser une carte</h2>
        <p className="text-sm text-muted-foreground">
          Saisissez le code présenté par votre client pour consulter son solde et déduire le montant
          de l’addition.
        </p>
        <form
          id="gift-card-cashier"
          className="scroll-mt-6 flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void lookup();
          }}
        >
          <div className="flex-1">
            <Label htmlFor="cashier-code">Code de la carte présentée en salle</Label>
            <Input
              id="cashier-code"
              value={code}
              maxLength={128}
              onChange={(e) => setCode(e.target.value)}
              placeholder="SKR-…"
            />
          </div>
          <Button disabled={!orgId || busy || !code.trim()} className="transition-all duration-200">
            {busy ? 'Recherche…' : 'Utiliser cette carte'}
          </Button>
        </form>
        <details className="group rounded-lg border border-border">
          <summary className="cursor-pointer p-3 text-sm font-medium transition-all duration-200 hover:bg-muted/50">
            Bilan des paiements et export
          </summary>
          <div className="space-y-4 border-t border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Bilan des paiements</h3>
              <Button
                variant="outline"
                disabled={loading}
                onClick={() => void load()}
                className="transition-all duration-200"
              >
                Actualiser le bilan
              </Button>
            </div>
            {error ? (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            ) : loading && !overview ? (
              <p role="status">Chargement du bilan…</p>
            ) : overview ? (
              <>
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  {[
                    ['Paiements enregistrés', overview.capturedAmount],
                    ['Remboursements enregistrés', overview.refundedAmount],
                    ['Solde disponible', overview.availableBalance],
                    ['Solde bloqué', overview.blockedBalance],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="font-semibold">{formatEuro(Number(value))}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Montants du registre de paiements, actualisés par les événements Stripe. Cartes
                  émises manuellement : {formatEuro(overview.manuallyIssuedAmount)}.
                </p>
                {overview.untrackedLegacyPayments > 0 && (
                  <p className="text-sm">
                    {overview.untrackedLegacyPayments} ancien(s) paiement(s) à rapprocher : exclus
                    des encaissements enregistrés.
                  </p>
                )}
                {overview.pendingRefunds > 0 && (
                  <p className="text-sm">
                    {overview.pendingRefunds} remboursement(s) en attente ou à vérifier.
                  </p>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">
                Sélectionnez un établissement pour consulter son bilan.
              </p>
            )}
            {overview?.canExport && (
              <div className="space-y-2 border-t border-border pt-4">
                <p className="text-sm font-medium">
                  Export du registre — propriétaire et responsable
                </p>
                <p className="text-xs text-muted-foreground">
                  Paiements créés et débits effectués sur la période. Les remboursements sont leur
                  cumul actuel ; cet export ne remplace pas votre comptabilité.
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <Label htmlFor="gift-export-from">Du</Label>
                    <Input
                      id="gift-export-from"
                      type="date"
                      value={exportFrom}
                      onChange={(e) => setExportFrom(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="gift-export-until">Au</Label>
                    <Input
                      id="gift-export-until"
                      type="date"
                      value={exportUntil}
                      onChange={(e) => setExportUntil(e.target.value)}
                    />
                  </div>
                  <Button
                    variant="outline"
                    disabled={exporting || !orgId || !exportFrom || !exportUntil}
                    onClick={() => void download()}
                    className="transition-all duration-200"
                  >
                    {exporting ? 'Export…' : 'Exporter en CSV'}
                  </Button>
                </div>
                {exportError && (
                  <p role="alert" className="text-destructive">
                    {exportError}
                  </p>
                )}
              </div>
            )}
          </div>
        </details>
        {lookupError && (
          <p role="alert" className="text-destructive">
            {lookupError}
          </p>
        )}
        <Dialog
          open={Boolean(cardId)}
          onOpenChange={(open) => {
            if (!open) setCardId(null);
          }}
        >
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Règlement par carte cadeau</DialogTitle>
            </DialogHeader>
            {cardId && (
              <GiftCardCashier
                key={`${orgId}:${cardId}`}
                giftCardId={cardId}
                onChanged={() => {
                  void load();
                  onChanged();
                }}
              />
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
