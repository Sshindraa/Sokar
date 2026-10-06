'use client';
import { GiftCardTestJourney } from '@/components/gift-cards/gift-card-test-journey';

import { GiftCardOperationsPanel } from '@/components/gift-cards/gift-card-operations-panel';
import { GiftCardCashier } from '@/components/gift-cards/gift-card-cashier';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Euro, Gift, Plus, Save, Search, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useGiftCardApi } from '@/lib/api/gift-cards';
import { useApi } from '@/lib/api';
import { getErrorMessage, type Restaurant } from '@/types/api';
import { formatEuro } from '@sokar/shared';
import type { GiftCardListItem, GiftCardPack, GiftCardStats } from '@/lib/api/gift-cards';
import GiftCardList from '@/components/gift-cards/gift-card-list';
import GiftCardForm from '@/components/gift-cards/gift-card-form';
import { GiftCardStripeConnect } from '@/components/gift-cards/gift-card-stripe-connect';
import { GiftCardSectionNav } from '@/components/gift-cards/GiftCardSectionNav';
import { DataFetchError } from '@/components/DataFetchError';
import { SAVED_NOTIFICATION_RESET_MS } from '@/constants/ui';

const PAGE_SIZE = 20;

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <Card className="bg-card">
      <CardContent className="p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-foreground/70">{label}</p>
            <p className="mt-1 text-lg md:text-xl font-semibold tracking-tight">{value}</p>
          </div>
          <div className="text-muted-foreground">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function GiftCardsPage() {
  const createRequested = useSearchParams().get('create') === '1';
  const {
    listGiftCards,
    getGiftCardStats,
    cancelGiftCard,
    closeCrowdfunding,
    listGiftCardPacks,
    orgId,
  } = useGiftCardApi();
  const { get, patch } = useApi();

  const [operationsRevision, setOperationsRevision] = useState(0);
  const [cards, setCards] = useState<GiftCardListItem[]>([]);
  const [stats, setStats] = useState<GiftCardStats | null>(null);
  const [packs, setPacks] = useState<GiftCardPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'SINGLE' | 'CROWDFUNDED'>('SINGLE');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [detailCard, setDetailCard] = useState<GiftCardListItem | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState<GiftCardListItem | null>(null);
  const [closeConfirm, setCloseConfirm] = useState<GiftCardListItem | null>(null);

  useEffect(() => {
    setDetailCard(null);
  }, [orgId]);

  // Montant minimum carte cadeau
  const [minAmount, setMinAmount] = useState<number | ''>(10);
  const [commissionRate, setCommissionRate] = useState(5);
  const [savingMin, setSavingMin] = useState(false);
  const [savedMin, setSavedMin] = useState(false);
  const [stripeReady, setStripeReady] = useState<boolean | null>(null);

  const handleStripeReadinessChange = useCallback((ready: boolean | null) => {
    setStripeReady(ready);
  }, []);

  const openStripeSettings = useCallback(() => {
    const settings = document.getElementById('gift-card-stripe-connect');
    if (!settings) return;
    settings.setAttribute('open', '');
    settings.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const fetchAll = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError('');
    try {
      const [list, statsData, packsData, restaurant] = await Promise.all([
        listGiftCards({
          status: statusFilter !== 'ALL' ? statusFilter : undefined,
          type: tab,
          search: search || undefined,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        }),
        getGiftCardStats(),
        listGiftCardPacks(),
        get<Restaurant>(`restaurants/${orgId}`),
      ]);
      setCards(list.items);
      setTotal(list.total);
      setStats(statsData);
      setPacks(packsData);
      setMinAmount(restaurant.giftCardMinimumAmount ?? 10);
      setCommissionRate(
        restaurant.giftCardCommissionRate != null
          ? Number(restaurant.giftCardCommissionRate) * 100
          : 5,
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de charger les cartes cadeaux'));
    } finally {
      setLoading(false);
    }
  }, [
    orgId,
    statusFilter,
    search,
    page,
    tab,
    listGiftCards,
    getGiftCardStats,
    listGiftCardPacks,
    get,
  ]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (!createRequested || loading || error) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('create') !== '1') return;
    url.searchParams.delete('create');
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
    setFormOpen(true);
  }, [createRequested, error, loading]);

  async function handleCancel(card: GiftCardListItem) {
    setCancelConfirm(card);
  }

  async function confirmCancelGiftCard() {
    const card = cancelConfirm;
    if (!card) return;
    setCancelConfirm(null);
    try {
      setError('');
      const updated = await cancelGiftCard(card.id);
      setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, ...updated } : c)));
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Impossible d'annuler la carte cadeau"));
    }
  }

  async function handleCloseCrowdfunding(card: GiftCardListItem) {
    setCloseConfirm(card);
  }

  async function confirmCloseCrowdfunding() {
    const card = closeConfirm;
    if (!card) return;
    setCloseConfirm(null);
    setClosingId(card.id);
    try {
      setError('');
      const updated = await closeCrowdfunding(card.id);
      setCards((prev) => prev.map((c) => (c.id === card.id ? updated : c)));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de clôturer la cagnotte'));
    } finally {
      setClosingId(null);
    }
  }

  async function handleSaveMin(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setSavingMin(true);
    setSavedMin(false);
    setError('');
    try {
      const minimum = minAmount === '' ? 10 : Number(minAmount);
      await patch(`restaurants/${orgId}`, { giftCardMinimumAmount: minimum });
      setMinAmount(minimum);
      setSavedMin(true);
      setTimeout(() => setSavedMin(false), SAVED_NOTIFICATION_RESET_MS);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de sauvegarder le montant minimum'));
    } finally {
      setSavingMin(false);
    }
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPage(0);
    fetchAll();
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  if (loading && cards.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Skeleton className="h-8 w-36 rounded-full" />
          <Skeleton className="h-10 w-24 rounded-lg" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Cartes cadeaux</h1>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setFormOpen(true)} size="sm" variant="outline">
            <Plus size={16} />
            Créer une carte
          </Button>
          <Button
            size="sm"
            onClick={() => {
              const cashierCode = document.getElementById('cashier-code');
              cashierCode?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              cashierCode?.focus({ preventScroll: true });
            }}
            className="transition-all duration-200"
          >
            Encaisser une carte
          </Button>
        </div>
      </div>

      {stripeReady === false && !settingsExpanded && (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/50 p-4"
        >
          <div>
            <p className="font-medium">Paiements à configurer</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Connectez Stripe pour vendre des cartes cadeaux en ligne.
            </p>
          </div>
          <Button onClick={openStripeSettings} size="sm" className="transition-all duration-200">
            Configurer
          </Button>
        </div>
      )}

      <GiftCardSectionNav />
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard
            label="Valeur totale émise"
            value={formatEuro(stats.totalSoldAmount)}
            icon={<Euro size={20} />}
          />
          <StatCard
            label="Solde en circulation"
            value={formatEuro(stats.totalRemainingAmount)}
            icon={<Wallet size={20} />}
          />
          <StatCard
            label="Cartes actives"
            value={`${stats.activeCount}`}
            icon={<Gift size={20} />}
          />
        </div>
      )}

      <GiftCardOperationsPanel
        revision={operationsRevision}
        onChanged={() => {
          setOperationsRevision((v) => v + 1);
          void fetchAll();
        }}
      />

      {error && <DataFetchError message={error} onRetry={fetchAll} retrying={loading} />}

      <div>
        <h2 className="font-semibold">Vos cartes</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Retrouvez une carte et consultez son solde et son historique.
        </p>
      </div>

      {/* Onglets SINGLE / CROWDFUNDED */}
      <div className="flex gap-1 rounded-lg border border-border bg-muted p-1">
        <button
          type="button"
          onClick={() => {
            setTab('SINGLE');
            setStatusFilter('ALL');
            setPage(0);
          }}
          className={`flex-1 rounded-md px-4 py-1.5 text-sm font-medium transition-all duration-200 ${
            tab === 'SINGLE'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Cartes cadeaux
        </button>
        <button
          type="button"
          onClick={() => {
            setTab('CROWDFUNDED');
            setStatusFilter('ALL');
            setPage(0);
          }}
          className={`flex-1 rounded-md px-4 py-1.5 text-sm font-medium transition-all duration-200 ${
            tab === 'CROWDFUNDED'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Cagnottes
        </button>
      </div>

      {/* Filtres */}
      <div className="flex flex-col sm:flex-row gap-2">
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-full sm:w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Tous les statuts</SelectItem>
            <SelectItem value="ACTIVE">Actives</SelectItem>
            {tab === 'CROWDFUNDED' && <SelectItem value="CLOSED">Clôturées</SelectItem>}
            <SelectItem value="REDEEMED">Utilisées</SelectItem>
            <SelectItem value="EXPIRED">Expirées</SelectItem>
            <SelectItem value="CANCELLED">Annulées</SelectItem>
          </SelectContent>
        </Select>
        <form onSubmit={handleSearchSubmit} className="relative flex-1 min-w-0">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="text"
            placeholder="Rechercher par nom ou email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 w-full"
          />
        </form>
      </div>

      {/* Liste */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      ) : error && cards.length === 0 ? null : (
        <GiftCardList
          items={cards}
          isCrowdfunding={tab === 'CROWDFUNDED'}
          onView={setDetailCard}
          onCancel={handleCancel}
          onClose={handleCloseCrowdfunding}
          closingId={closingId}
        />
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} sur {total}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft size={16} />
              Précédent
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Suivant
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      )}

      <details
        id="gift-card-stripe-connect"
        className="group scroll-mt-6 rounded-xl border border-border bg-card"
        onToggle={(event) => setSettingsExpanded(event.currentTarget.open)}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 transition-all duration-200 hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
          <div>
            <h2 className="font-semibold">Réglages</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Paiements et montants des cartes cadeaux.
            </p>
          </div>
          <ChevronRight
            size={18}
            className="shrink-0 text-muted-foreground transition-all duration-200 group-open:rotate-90"
          />
        </summary>
        <div className="space-y-4 border-t border-border p-4 md:p-6">
          <GiftCardStripeConnect onReadinessChange={handleStripeReadinessChange} />
          <Card>
            <CardContent className="p-4 md:p-5">
              <form
                onSubmit={handleSaveMin}
                className="flex flex-col gap-4 sm:flex-row sm:items-end"
              >
                <div className="grid flex-1 gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="minAmount" className="text-sm font-medium">
                      Montant minimum
                    </Label>
                    <div className="relative mt-1.5">
                      <Input
                        id="minAmount"
                        type="number"
                        min={0}
                        step={1}
                        value={minAmount}
                        onChange={(e) =>
                          setMinAmount(e.target.value === '' ? '' : Number(e.target.value))
                        }
                        className="pr-10"
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                        €
                      </span>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Commission Sokar</p>
                    <div className="mt-1.5 flex h-10 items-center justify-between rounded-lg border border-border bg-muted/30 px-3">
                      <span className="font-medium">
                        {new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(
                          commissionRate,
                        )}{' '}
                        %
                      </span>
                      <span className="text-sm text-muted-foreground">par vente</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Button type="submit" size="sm" disabled={savingMin}>
                    <Save size={16} />
                    {savingMin ? 'Enregistrement...' : 'Enregistrer'}
                  </Button>
                  {savedMin && <span className="text-sm text-primary">Enregistré</span>}
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </details>
      <GiftCardTestJourney />

      {/* Formulaire de création */}
      <GiftCardForm
        open={formOpen}
        onOpenChange={setFormOpen}
        packs={packs}
        onCreated={() => fetchAll()}
      />

      {/* Dialog détail */}
      <Dialog open={!!detailCard} onOpenChange={(v) => !v && setDetailCard(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Détail de la carte cadeau</DialogTitle>
          </DialogHeader>
          {detailCard && (
            <GiftCardCashier
              key={`${orgId}:${detailCard.id}`}
              giftCardId={detailCard.id}
              onChanged={() => {
                setOperationsRevision((v) => v + 1);
                void fetchAll();
              }}
            />
          )}
          {detailCard && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-xs text-muted-foreground">Code</p>
                  <p className="font-mono">{detailCard.code}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Statut</p>
                  <p>{detailCard.status}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Montant</p>
                  <p className="font-medium">{formatEuro(detailCard.amount)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Solde restant</p>
                  <p className="font-medium">{formatEuro(detailCard.remainingAmount)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Type</p>
                  <p>
                    {detailCard.type === 'CROWDFUNDED'
                      ? 'Cagnotte'
                      : detailCard.packName
                        ? `Pack : ${detailCard.packName}`
                        : 'Montant libre'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Créée par</p>
                  <p>{detailCard.createdBy}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Destinataire</p>
                  <p>{detailCard.recipientName ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Email destinataire</p>
                  <p>{detailCard.recipientEmail ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Téléphone destinataire</p>
                  <p>{detailCard.recipientPhone ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Expéditeur</p>
                  <p>{detailCard.senderName ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Occasion</p>
                  <p>{detailCard.occasion ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Achetée le</p>
                  <p>{new Date(detailCard.purchasedAt).toLocaleDateString('fr-FR')}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Expire le</p>
                  <p>
                    {detailCard.expiresAt
                      ? new Date(detailCard.expiresAt).toLocaleDateString('fr-FR')
                      : '—'}
                  </p>
                </div>
              </div>
              {detailCard.message && (
                <div>
                  <p className="text-xs text-muted-foreground">Message</p>
                  <p className="rounded-lg border border-border p-3 bg-card">
                    {detailCard.message}
                  </p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirmation : annulation carte cadeau */}
      <ConfirmDialog
        open={!!cancelConfirm}
        onConfirm={confirmCancelGiftCard}
        onCancel={() => setCancelConfirm(null)}
        title="Annuler la carte cadeau"
        description={
          cancelConfirm
            ? cancelConfirm.type === 'CROWDFUNDED'
              ? `Annuler la cagnotte ${cancelConfirm.code} et rembourser ses contributions ? Une cagnotte déjà utilisée nécessite l’intervention du support. Vérifiez ensuite le statut des remboursements.`
              : `Annuler la carte cadeau ${cancelConfirm.code} ? Le solde inutilisé sera remboursé si la carte a été payée. Consultez ensuite le statut du remboursement dans le détail de la carte.`
            : ''
        }
        confirmLabel="Annuler la carte"
        variant="destructive"
      />

      {/* Confirmation : clôture cagnotte */}
      <ConfirmDialog
        open={!!closeConfirm}
        onConfirm={confirmCloseCrowdfunding}
        onCancel={() => setCloseConfirm(null)}
        title="Clôturer la cagnotte"
        description={
          closeConfirm
            ? `Clôturer la cagnotte « ${closeConfirm.occasion ?? closeConfirm.code} » ?\n\nLe montant total collecté sera transformé en carte cadeau pour ${closeConfirm.recipientName ?? 'le destinataire'}.`
            : ''
        }
        confirmLabel="Clôturer"
      />
    </div>
  );
}
