'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Package, Pencil, Plus, Power } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useGiftCardApi } from '@/lib/api/gift-cards';
import type { GiftCardPack } from '@/lib/api/gift-cards';
import GiftCardPackForm from '@/components/gift-cards/gift-card-pack-form';

function formatEuro(amount: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(amount);
}

export default function GiftCardPacksPage() {
  const { listGiftCardPacks, toggleGiftCardPack, orgId } = useGiftCardApi();

  const [packs, setPacks] = useState<GiftCardPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editPack, setEditPack] = useState<GiftCardPack | null>(null);

  const fetchPacks = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError('');
    try {
      const data = await listGiftCardPacks();
      setPacks(data);
    } catch (err: any) {
      setError(err.message || 'Impossible de charger les packs');
    } finally {
      setLoading(false);
    }
  }, [orgId, listGiftCardPacks]);

  useEffect(() => {
    fetchPacks();
  }, [fetchPacks]);

  async function handleToggle(pack: GiftCardPack) {
    try {
      setError('');
      const updated = await toggleGiftCardPack(pack.id);
      setPacks((prev) => prev.map((p) => (p.id === pack.id ? updated : p)));
    } catch (err: any) {
      setError(err.message || 'Impossible de modifier le statut du pack');
    }
  }

  function handleEdit(pack: GiftCardPack) {
    setEditPack(pack);
    setFormOpen(true);
  }

  function handleCreate() {
    setEditPack(null);
    setFormOpen(true);
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-36 rounded-full" />
          <Skeleton className="h-10 w-24 rounded-lg" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Packs expérience</h1>
        <Button onClick={handleCreate} size="sm">
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

      {packs.length === 0 ? (
        <div className="sokar-empty">
          <Package size={40} className="opacity-30" />
          <p className="text-sm">Aucun pack expérience pour le moment</p>
          <p className="text-xs opacity-60">
            Créez votre premier pack pour proposer des expériences clés en main à vos clients.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {packs.map((pack) => (
            <Card
              key={pack.id}
              className={`transition-all duration-200 hover:border-primary/30 ${
                !pack.isActive ? 'opacity-60' : ''
              }`}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-base font-semibold truncate">{pack.name}</CardTitle>
                    {pack.description && (
                      <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                        {pack.description}
                      </p>
                    )}
                  </div>
                  <Badge
                    variant={pack.isActive ? 'default' : 'secondary'}
                    className={
                      pack.isActive
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                        : 'border-border bg-secondary text-muted-foreground'
                    }
                  >
                    {pack.isActive ? 'Actif' : 'Inactif'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Montant</p>
                      <p className="font-semibold">{formatEuro(pack.amount)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Convives</p>
                      <p className="font-medium">
                        {pack.minPartySize === pack.maxPartySize
                          ? `${pack.minPartySize} pers.`
                          : `${pack.minPartySize}–${pack.maxPartySize} pers.`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEdit(pack)}
                      title="Modifier le pack"
                      className="transition-all duration-200"
                    >
                      <Pencil size={16} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleToggle(pack)}
                      title={pack.isActive ? 'Désactiver le pack' : 'Activer le pack'}
                      className="transition-all duration-200"
                    >
                      <Power size={16} className={pack.isActive ? 'text-emerald-400' : ''} />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <GiftCardPackForm
        open={formOpen}
        onOpenChange={setFormOpen}
        pack={editPack}
        onSaved={() => fetchPacks()}
      />
    </div>
  );
}
