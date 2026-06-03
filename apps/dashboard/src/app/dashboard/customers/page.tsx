'use client';

import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../../../lib/api';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertCircle, Users, Search, RotateCcw, Star } from 'lucide-react';

export default function CustomersPage() {
  const { get, patch, orgId } = useApi();

  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchPhone, setSearchPhone] = useState('');
  const [error, setError] = useState('');

  const fetchCustomers = useCallback(async (phone?: string) => {
    setLoading(true);
    setError('');
    try {
      const params = phone ? `?phone=${encodeURIComponent(phone)}` : '';
      const data = await get(`customers${params}`);
      setCustomers(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || 'Impossible de charger les clients');
    }
    setLoading(false);
  }, [get]);

  useEffect(() => {
    if (!orgId) return;
    fetchCustomers();
  }, [orgId, fetchCustomers]);

  async function toggleVip(id: string, current: boolean) {
    try {
      await patch(`customers/${id}/vip`, { isVip: !current });
      setCustomers((prev) =>
        prev.map((c) => (c.id === id ? { ...c, isVip: !current } : c)),
      );
    } catch (err: any) {
      setError(err.message || 'Impossible de modifier le statut VIP');
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-10 w-24" />
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
        <span className="text-sm text-muted-foreground">
          {customers.length} client{customers.length > 1 ? 's' : ''}
        </span>
      </div>

      {/* Recherche */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-0 max-w-full sm:max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Rechercher par téléphone..."
            value={searchPhone}
            onChange={(e) => setSearchPhone(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchCustomers(searchPhone || undefined)}
            className="pl-9 w-full"
          />
        </div>
        <Button onClick={() => fetchCustomers(searchPhone || undefined)} className="flex-shrink-0">
          Rechercher
        </Button>
        {searchPhone && (
          <Button variant="outline" onClick={() => { setSearchPhone(''); fetchCustomers(); }} className="flex-shrink-0">
            <RotateCcw size={14} className="mr-1" />
            Réinitialiser
          </Button>
        )}
      </div>

      {/* Tableau */}
      {error ? (
        <div className="sokar-error">
          <AlertCircle size={18} />
          {error}
        </div>
      ) : customers.length === 0 ? (
        <div className="sokar-empty">
          <Users size={40} className="opacity-30" />
          <p className="text-sm">Aucun client enregistré</p>
          <p className="text-xs opacity-60">
            Les clients apparaîtront quand votre assistant prendra des appels.
          </p>
        </div>
      ) : (
        <div className="sokar-card overflow-hidden">
          <div className="mobile-table-wrapper">
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Téléphone</TableHead>
                <TableHead>Visites</TableHead>
                <TableHead>Score fidélité</TableHead>
                <TableHead>VIP</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Dernière visite</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((c: any) => (
                <TableRow key={c.id} className="transition-all duration-200 hover:bg-accent">
                  <TableCell className="font-medium">{c.name || <span className="opacity-50">—</span>}</TableCell>
                  <TableCell className="text-muted-foreground">{c.phone}</TableCell>
                  <TableCell>{c.visitCount}</TableCell>
                  <TableCell>{Number(c.loyaltyScore).toFixed(1)}</TableCell>
                  <TableCell>
                    <button
                      onClick={() => toggleVip(c.id, c.isVip)}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-all duration-200 ${
                        c.isVip
                          ? 'border border-primary/20 bg-primary/10 text-foreground hover:bg-primary/15'
                          : 'bg-muted text-muted-foreground hover:bg-accent'
                      }`}
                    >
                      <Star size={12} className={c.isVip ? 'fill-current' : ''} />
                      {c.isVip ? 'VIP' : 'Ajouter'}
                    </button>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-muted-foreground">
                    {c.notes || <span className="opacity-50">—</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.lastSeenAt
                      ? new Date(c.lastSeenAt).toLocaleDateString('fr-FR')
                      : <span className="opacity-50">—</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </div>
      )}
    </div>
  );
}
