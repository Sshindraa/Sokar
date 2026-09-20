'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useApi } from '../../../lib/api';
import { getErrorMessage, type Customer } from '@/types/api';
import { useIsMobile } from '@/lib/useMediaQuery';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Users, Search, Star, Phone, Sparkles, StickyNote, X } from 'lucide-react';
import { DataFetchError } from '@/components/DataFetchError';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type CustomerListResponse = Customer[] | { data?: Customer[] };

function formatLastVisit(value: string | null) {
  if (!value) return '—';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
  }).format(date);
}

function customerInitials(name: string | null) {
  return (name || '?')
    .split(' ')
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function CustomerMobileCard({
  customer,
  onToggleVip,
  onCall,
}: {
  customer: Customer;
  onToggleVip: (id: string, current: boolean) => void;
  onCall: (customer: Customer) => void;
}) {
  const name = customer.name || 'Client inconnu';

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card/80 shadow-sm">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-secondary text-sm font-semibold text-foreground"
            >
              {customerInitials(customer.name)}
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-[15px] font-semibold text-foreground">{name}</h2>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{customer.phone}</p>
            </div>
          </div>
          <span
            className={`inline-flex flex-none items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
              customer.isVip
                ? 'border-warning/30 bg-warning/10 text-warning'
                : 'border-border bg-secondary/70 text-muted-foreground'
            }`}
          >
            <Star size={12} className={customer.isVip ? 'fill-current' : ''} />
            {customer.isVip ? 'VIP' : 'Standard'}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 divide-x divide-border border-y border-border/60 py-3">
          <div className="px-2 text-center">
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Visites
            </p>
            <p className="mt-1 text-base font-semibold text-foreground">{customer.visitCount}</p>
          </div>
          <div className="px-2 text-center">
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Fidélité
            </p>
            <p className="mt-1 text-base font-semibold text-foreground">
              {Number(customer.loyaltyScore).toFixed(1)}
            </p>
          </div>
          <div className="min-w-0 px-2 text-center">
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Dernière visite
            </p>
            <p className="mt-1 truncate text-sm font-medium text-foreground">
              {formatLastVisit(customer.lastSeenAt)}
            </p>
          </div>
        </div>

        {customer.notes && (
          <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <StickyNote size={14} className="mt-0.5 flex-none" />
            <span className="line-clamp-2">{customer.notes}</span>
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-border/70 bg-background/20 p-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onToggleVip(customer.id, customer.isVip)}
          className="h-10 min-w-0 px-2 text-xs"
        >
          <Star size={14} className={customer.isVip ? 'fill-current' : ''} />
          <span className="truncate">{customer.isVip ? 'Retirer VIP' : 'Marquer VIP'}</span>
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onCall(customer)}
          className="h-10 min-w-0 px-2 text-xs"
        >
          <Phone size={14} />
          Appeler
        </Button>
      </div>
    </article>
  );
}

export default function CustomersPage() {
  const { get, post, orgId } = useApi();
  const isMobile = useIsMobile();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchPhone, setSearchPhone] = useState('');
  const [error, setError] = useState('');
  const [callInfo, setCallInfo] = useState<{ name: string; phone: string } | null>(null);

  const fetchCustomers = useCallback(
    async (phone?: string) => {
      setLoading(true);
      setError('');
      try {
        const params = phone ? `?phone=${encodeURIComponent(phone)}` : '';
        const response = await get<CustomerListResponse>(`customers${params}`);
        const rows = Array.isArray(response) ? response : response.data;
        setCustomers(Array.isArray(rows) ? rows : []);
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Impossible de charger les clients'));
      }
      setLoading(false);
    },
    [get],
  );

  useEffect(() => {
    if (!orgId) return;
    void fetchCustomers();
  }, [orgId, fetchCustomers]);

  async function toggleVip(id: string, current: boolean) {
    try {
      await post(`customers/${id}/vip`, { isVip: !current });
      setCustomers((prev) => prev.map((c) => (c.id === id ? { ...c, isVip: !current } : c)));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de modifier le statut VIP'));
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
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="mt-1 text-sm text-muted-foreground">Contacts et historique des visites</p>
        </div>
        <div className="flex flex-none items-center gap-2">
          <span className="whitespace-nowrap text-xs text-muted-foreground sm:text-sm">
            {customers.length} client{customers.length > 1 ? 's' : ''}
          </span>
          <Button asChild variant="outline" size="sm" className="px-2.5 sm:px-3">
            <Link href="/dashboard/customers/crm">
              <Sparkles size={14} />
              CRM Pro
            </Link>
          </Button>
        </div>
      </div>

      {/* Recherche */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void fetchCustomers(searchPhone || undefined);
        }}
        className="flex min-w-0 gap-2"
        role="search"
      >
        <div className="relative min-w-0 flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="text"
            placeholder="Rechercher un téléphone…"
            value={searchPhone}
            onChange={(e) => setSearchPhone(e.target.value)}
            aria-label="Rechercher un client par téléphone"
            className="w-full pl-9 pr-28"
          />
          <Button
            type="submit"
            size="sm"
            disabled={loading}
            className="absolute right-1 top-1 h-8 rounded-md px-2.5 text-xs sm:px-3"
          >
            Rechercher
          </Button>
          {searchPhone && (
            <button
              type="button"
              aria-label="Effacer la recherche"
              onClick={() => {
                setSearchPhone('');
                void fetchCustomers();
              }}
              className="absolute right-[5.75rem] top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </form>

      {/* Contenu */}
      {error && (
        <DataFetchError
          message={error}
          onRetry={() => fetchCustomers(searchPhone || undefined)}
          retrying={loading}
        />
      )}
      {customers.length === 0 ? (
        error ? null : (
          <div className="sokar-empty">
            <Users size={40} className="opacity-30" />
            <p className="text-sm">Aucun client enregistré</p>
            <p className="max-w-sm text-xs opacity-60">
              Les clients apparaîtront après vos premiers appels.
            </p>
            <Button asChild size="sm" variant="outline" className="mt-1">
              <Link href="/dashboard/calls">Voir les appels</Link>
            </Button>
          </div>
        )
      ) : isMobile ? (
        /* ========== MOBILE: Card List ========== */
        <div className="space-y-3">
          {customers.map((customer) => (
            <CustomerMobileCard
              key={customer.id}
              customer={customer}
              onToggleVip={toggleVip}
              onCall={(selected) =>
                setCallInfo({ name: selected.name || 'inconnu', phone: selected.phone })
              }
            />
          ))}
        </div>
      ) : (
        /* ========== DESKTOP: Table ========== */
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
                {customers.map((c) => (
                  <TableRow key={c.id} className="transition-all duration-200 hover:bg-accent">
                    <TableCell className="font-medium">
                      {c.name || <span className="opacity-50">—</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.phone}</TableCell>
                    <TableCell>{c.visitCount}</TableCell>
                    <TableCell>{Number(c.loyaltyScore).toFixed(1)}</TableCell>
                    <TableCell>
                      <button
                        onClick={() => toggleVip(c.id, c.isVip)}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-all duration-200 ${
                          c.isVip
                            ? 'border border-primary/20 bg-secondary text-foreground hover:bg-accent'
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
                      {c.lastSeenAt ? (
                        new Date(c.lastSeenAt).toLocaleDateString('fr-FR')
                      ) : (
                        <span className="opacity-50">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Dialog d'information : appel client */}
      <Dialog open={!!callInfo} onOpenChange={(v) => !v && setCallInfo(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Phone size={18} className="text-primary" />
              Appel du client
            </DialogTitle>
            <DialogDescription>
              {callInfo && `Vous allez appeler ${callInfo.name} au ${callInfo.phone}.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setCallInfo(null)} className="transition-all duration-200">
              Fermer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
