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
import { Users, Search, RotateCcw, Star } from 'lucide-react';

export default function CustomersPage() {
  const { get, patch, orgId } = useApi();

  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchPhone, setSearchPhone] = useState('');

  const fetchCustomers = useCallback(async (phone?: string) => {
    setLoading(true);
    try {
      const params = phone ? `?phone=${encodeURIComponent(phone)}` : '';
      const data = await get(`customers${params}`);
      setCustomers(Array.isArray(data) ? data : []);
    } catch {
      // silent
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
    } catch {
      // silent
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-10 w-24" />
        </div>
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
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
      <div className="flex gap-2">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Rechercher par téléphone..."
            value={searchPhone}
            onChange={(e) => setSearchPhone(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchCustomers(searchPhone || undefined)}
            className="w-64 pl-9"
          />
        </div>
        <Button onClick={() => fetchCustomers(searchPhone || undefined)}>
          Rechercher
        </Button>
        {searchPhone && (
          <Button variant="outline" onClick={() => { setSearchPhone(''); fetchCustomers(); }}>
            <RotateCcw size={14} className="mr-1" />
            Réinitialiser
          </Button>
        )}
      </div>

      {/* Tableau */}
      {customers.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
          <Users size={40} className="opacity-30" />
          <p className="text-sm">Aucun client enregistré</p>
          <p className="text-xs opacity-60">
            Les clients apparaîtront quand votre assistant prendra des appels.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border">
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
                          ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                          : 'bg-muted text-muted-foreground hover:bg-accent'
                      }`}
                    >
                      <Star size={12} className={c.isVip ? 'fill-yellow-500' : ''} />
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
      )}
    </div>
  );
}