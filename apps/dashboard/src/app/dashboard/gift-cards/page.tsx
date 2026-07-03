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
import { useGiftCardApi } from '@/lib/api/gift-cards';
import { useApi } from '@/lib/api';
import type { GiftCardListItem, GiftCardPack, GiftCardStats } from '@/lib/api/gift-cards';
import GiftCardList from '@/components/gift-cards/gift-card-list';
import GiftCardForm from '@/components/gift-cards/gift-card-form';

const PAGE_SIZE = 20;

function formatEuro(amount: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(amount);
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <Card className="bg-card/80">
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
  const { listGiftCards, getGiftCardStats, cancelGiftCard, listGiftCardPacks, orgId } =
    useGiftCardApi();
  const { get, patch } = useApi();

  const [cards, setCards] = useState<GiftCardListItem[]>([]);
  const [stats, setStats] = useState<GiftCardStats | null>(null);
  const [packs, setPacks] = useState<GiftCardPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [detailCard, setDetailCard] = useState<GiftCardListItem | null>(null);

  // Montant minimum carte cadeau
  const [minAmount, setMinAmount] = useState<number | ''>('');
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
          search: search || undefined,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        }),
        getGiftCardStats(),
        listGiftCardPacks(),
        get<any>(`restaurants/${orgId}`),
      ]);
      setCards(list.items);
      setTotal(list.total);
      setStats(statsData);
      setPacks(packsData);
      setMinAmount(restaurant.giftCardMinimumAmount ?? '');
    } catch (err: any) {
      setError(err.message || 'Impossible de charger les cartes cadeaux');
    } finally {
      setLoading(false);
    }
  }, [orgId, statusFilter, search, page, listGiftCards, getGiftCardStats, listGiftCardPacks]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function handleCancel(card: GiftCardListItem) {
    if (!confirm(`Annuler la carte cadeau ${card.code} ? Cette action est irréversible.`)) return;
    try {
      setError('');
      await cancelGiftCard(card.id);
      setCards((prev) =>
        prev.map((c) => (c.id === card.id ? { ...c, status: 'CANCELLED', remainingAmount: 0 } : c)),
      );
    } catch (err: any) {
      setError(err.message || "Impossible d'annuler la carte cadeau");
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
      await patch(`restaurants/${orgId}`, payload);
      setSavedMin(true);
      setTimeout(() => setSavedMin(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Impossible de sauvegarder le montant minimum');
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

      {/* Configuration du montant minimum */}
      <Card>
        <CardContent className="p-4 md:p-5">
          <form onSubmit={handleSaveMin} className="flex flex-col sm:flex-row sm:items-end gap-3">
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
        <GiftCardList items={cards} onView={setDetailCard} onCancel={handleCancel} />
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
                  <p>{detailCard.packName ? `Pack : ${detailCard.packName}` : 'Montant libre'}</p>
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
                  <p className="rounded-lg border border-border p-3 bg-card/50">
                    {detailCard.message}
                  </p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
