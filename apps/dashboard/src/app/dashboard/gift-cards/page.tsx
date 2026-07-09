'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, Gift, Plus, Save, Search } from 'lucide-react';
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
import { SAVED_NOTIFICATION_RESET_MS } from '@/constants/ui';

const PAGE_SIZE = 20;

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <Card className="bg-card">
      <CardContent className="p-4 md:p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-lg md:text-xl font-semibold tracking-tight">{value}</p>
          </div>
          <div className="text-muted-foreground/50">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function GiftCardsPage() {
  const {
    listGiftCards,
    getGiftCardStats,
    cancelGiftCard,
    closeCrowdfunding,
    listGiftCardPacks,
    orgId,
  } = useGiftCardApi();
  const { get, patch } = useApi();

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
  const [detailCard, setDetailCard] = useState<GiftCardListItem | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState<GiftCardListItem | null>(null);
  const [closeConfirm, setCloseConfirm] = useState<GiftCardListItem | null>(null);

  // Montant minimum carte cadeau
  const [minAmount, setMinAmount] = useState<number | ''>('');
  const [commissionRate, setCommissionRate] = useState<number | ''>('');
  const [savingMin, setSavingMin] = useState(false);
  const [savedMin, setSavedMin] = useState(false);

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
      setMinAmount(restaurant.giftCardMinimumAmount ?? '');
      setCommissionRate(
        restaurant.giftCardCommissionRate != null
          ? Number(restaurant.giftCardCommissionRate) * 100
          : '',
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de charger les cartes cadeaux'));
    } finally {
      setLoading(false);
    }
  }, [orgId, statusFilter, search, page, tab, listGiftCards, getGiftCardStats, listGiftCardPacks]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function handleCancel(card: GiftCardListItem) {
    setCancelConfirm(card);
  }

  async function confirmCancelGiftCard() {
    const card = cancelConfirm;
    if (!card) return;
    setCancelConfirm(null);
    try {
      setError('');
      await cancelGiftCard(card.id);
      setCards((prev) =>
        prev.map((c) => (c.id === card.id ? { ...c, status: 'CANCELLED', remainingAmount: 0 } : c)),
      );
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
      const payload: Record<string, unknown> = {};
      if (minAmount !== '') {
        payload.giftCardMinimumAmount = Number(minAmount);
      }
      if (commissionRate !== '') {
        payload.giftCardCommissionRate = Number(commissionRate) / 100;
      }
      await patch(`restaurants/${orgId}`, payload);
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
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-36 rounded-full" />
          <Skeleton className="h-10 w-24 rounded-lg" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
      <div className="flex items-center justify-between">
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Cartes cadeaux</h1>
        <Button onClick={() => setFormOpen(true)} size="sm">
          <Plus size={16} />
          Créer
        </Button>
      </div>

      {error && (
        <div className="sokar-error">
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      {/* Configuration du montant minimum + commission */}
      <Card>
        <CardContent className="p-4 md:p-5">
          <form onSubmit={handleSaveMin} className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Label htmlFor="minAmount" className="text-sm font-medium">
                Montant minimum d&apos;une carte cadeau (€)
              </Label>
              <Input
                id="minAmount"
                type="number"
                min={0}
                step={1}
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="10"
                className="mt-1.5"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Laisser vide pour utiliser le montant par défaut de 10€.
              </p>
            </div>
            <div className="flex-1">
              <Label htmlFor="commissionRate" className="text-sm font-medium">
                Commission Sokar (%)
              </Label>
              <Input
                id="commissionRate"
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={commissionRate}
                onChange={(e) =>
                  setCommissionRate(e.target.value === '' ? '' : Number(e.target.value))
                }
                placeholder="5"
                className="mt-1.5"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Pourcentage prélevé par Sokar sur chaque vente. 5% par défaut.
              </p>
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

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="CA total vendu"
            value={formatEuro(stats.totalSoldAmount)}
            icon={<Gift size={20} />}
          />
          <StatCard
            label="Solde restant"
            value={formatEuro(stats.totalRemainingAmount)}
            icon={<Gift size={20} />}
          />
          <StatCard
            label="Cartes actives"
            value={`${stats.activeCount} / ${stats.totalCount}`}
            icon={<Gift size={20} />}
          />
          <StatCard
            label="Montant moyen"
            value={formatEuro(stats.averageAmount)}
            icon={<Gift size={20} />}
          />
        </div>
      )}

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
      ) : (
        <GiftCardList
          items={cards}
          onView={setDetailCard}
          onCancel={handleCancel}
          onClose={handleCloseCrowdfunding}
          closingId={closingId}
        />
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
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

      {/* Formulaire de création */}
      <GiftCardForm
        open={formOpen}
        onOpenChange={setFormOpen}
        packs={packs}
        onCreated={() => fetchAll()}
      />

      {/* Dialog détail */}
      <Dialog open={!!detailCard} onOpenChange={(v) => !v && setDetailCard(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Détail de la carte cadeau</DialogTitle>
          </DialogHeader>
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
            ? `Annuler la carte cadeau ${cancelConfirm.code} ? Cette action est irréversible.`
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
