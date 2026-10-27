'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useApi } from '../../../lib/api';
import { ApiError } from '@/lib/api-error';
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
import { CustomerLifecycleBadge } from '@/components/CustomerLifecycleBadge';

type CustomerListResponse = Customer[] | { data?: Customer[]; total?: number };

const PAGE_SIZE = 50;

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
}: {
  customer: Customer;
  onToggleVip: (id: string, current: boolean) => void;
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
              <h2 className="truncate text-[15px] font-semibold text-foreground">
                <Link
                  href={`/dashboard/customers/crm/${customer.id}`}
                  className="transition-all duration-200 hover:underline"
                >
                  {name}
                </Link>
              </h2>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{customer.phone}</p>
            </div>
          </div>
          <span
            className={`inline-flex flex-none items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
              customer.isVip
                ? 'border-primary/20 bg-secondary text-foreground'
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
            <p className="mt-1 text-base font-semibold text-foreground">
              {customer.visitSummary?.visits ?? '—'}
            </p>
          </div>
          <div className="px-2 text-center">
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Statut
            </p>
            <div className="mt-1 flex justify-center">
              <CustomerLifecycleBadge lifecycle={customer.lifecycle} />
            </div>
          </div>
          <div className="min-w-0 px-2 text-center">
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Dernière visite
            </p>
            <p className="mt-1 truncate text-sm font-medium text-foreground">
              {formatLastVisit(customer.visitSummary?.lastVisitAt ?? null)}
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
        {/* Sur téléphone, le numéro se compose d'un geste : lien tel:, pas une fenêtre sans action. */}
        <Button asChild variant="secondary" size="sm" className="h-10 min-w-0 px-2 text-xs">
          <a href={`tel:${customer.phone}`} aria-label={`Appeler ${name}`}>
            <Phone size={14} />
            Appeler
          </a>
        </Button>
      </div>
    </article>
  );
}

export default function CustomersPage() {
  const { get, post, orgId } = useApi();
  const isMobile = useIsMobile();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState('');
  // Saisie en cours, et recherche réellement appliquée (celle que « Afficher plus » doit continuer).
  const [searchText, setSearchText] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [error, setError] = useState('');
  // Le premier chargement affiche des squelettes ; une recherche garde la page et le champ en place.
  const [loadedOnce, setLoadedOnce] = useState(false);
  // « CRM Pro » n'est proposé que s'il est ouvert (ou à débloquer par la formule), jamais quand il est fermé.
  const [crmEntry, setCrmEntry] = useState(false);

  const customersUrl = useCallback((search: string, offset: number) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    // Un nom ou un numéro tel qu'on le tape (« 06 12 34 56 78 »), entier ou en partie.
    if (search) params.set('search', search);
    return `customers?${params.toString()}`;
  }, []);

  const fetchCustomers = useCallback(
    async (search = '') => {
      setLoading(true);
      setError('');
      setMoreError('');
      try {
        const response = await get<CustomerListResponse>(customersUrl(search, 0));
        const rows = Array.isArray(response) ? response : response.data;
        const list = Array.isArray(rows) ? rows : [];
        setCustomers(list);
        setTotal(
          !Array.isArray(response) && typeof response.total === 'number'
            ? response.total
            : list.length,
        );
        setAppliedSearch(search);
        setLoadedOnce(true);
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Impossible de charger les clients'));
      }
      setLoading(false);
    },
    [get, customersUrl],
  );

  // Sans suite, la liste s'arrêtait aux 50 premiers clients et l'en-tête annonçait « 50 clients ».
  async function loadMore() {
    setLoadingMore(true);
    setMoreError('');
    try {
      const response = await get<CustomerListResponse>(
        customersUrl(appliedSearch, customers.length),
      );
      const rows = Array.isArray(response) ? response : response.data;
      const next = Array.isArray(rows) ? rows : [];
      setCustomers((current) => {
        const known = new Set(current.map((customer) => customer.id));
        return [...current, ...next.filter((customer) => !known.has(customer.id))];
      });
      if (!Array.isArray(response) && typeof response.total === 'number') setTotal(response.total);
    } catch (err: unknown) {
      setMoreError(getErrorMessage(err, 'Impossible de charger les clients suivants'));
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    if (!orgId) return;
    void fetchCustomers();
  }, [orgId, fetchCustomers]);

  // Une seule sonde, une fois la liste chargée : elle ne doit ni ralentir ni perturber le chargement des clients.
  const crmProbed = useRef(false);
  useEffect(() => {
    if (!orgId || !loadedOnce || crmProbed.current) return;
    crmProbed.current = true;
    Promise.resolve(get('crm/customers?limit=1'))
      .then(() => setCrmEntry(true))
      // Hors formule : on montre le bouton, la page CRM explique la formule. Fermé ou en panne : on le cache.
      .catch((err: unknown) => setCrmEntry(err instanceof ApiError && err.kind === 'not-included'));
  }, [orgId, get, loadedOnce]);

  async function toggleVip(id: string, current: boolean) {
    try {
      await post(`customers/${id}/vip`, { isVip: !current });
      setCustomers((prev) => prev.map((c) => (c.id === id ? { ...c, isVip: !current } : c)));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de modifier le statut VIP'));
    }
  }

  if (loading && !loadedOnce) {
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
            {total} client{total > 1 ? 's' : ''}
          </span>
          {crmEntry ? (
            <Button asChild variant="outline" size="sm" className="px-2.5 sm:px-3">
              <Link href="/dashboard/customers/crm">
                <Sparkles size={14} />
                CRM Pro
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      {/* Recherche */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void fetchCustomers(searchText.trim());
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
            placeholder="Rechercher un nom, un téléphone ou un email…"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            aria-label="Rechercher un client par nom ou téléphone"
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
          {searchText && (
            <button
              type="button"
              aria-label="Effacer la recherche"
              onClick={() => {
                setSearchText('');
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
          onRetry={() => fetchCustomers(appliedSearch)}
          retrying={loading}
        />
      )}
      {customers.length === 0 ? (
        error ? null : (
          <div className="sokar-empty">
            <Users size={40} className="opacity-30" />
            <p className="text-sm">
              {appliedSearch
                ? 'Aucun client ne correspond à cette recherche'
                : 'Aucun client enregistré'}
            </p>
            <p className="max-w-sm text-xs opacity-60">
              {appliedSearch
                ? 'Essayez un autre nom, ou seulement quelques chiffres du numéro.'
                : 'Les clients apparaîtront après vos premiers appels.'}
            </p>
            {!appliedSearch && (
              <Button asChild size="sm" variant="outline" className="mt-1">
                <Link href="/dashboard/calls">Voir les appels</Link>
              </Button>
            )}
          </div>
        )
      ) : isMobile ? (
        /* ========== MOBILE: Card List ========== */
        <div className="space-y-3">
          {customers.map((customer) => (
            <CustomerMobileCard key={customer.id} customer={customer} onToggleVip={toggleVip} />
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
                  <TableHead>Statut</TableHead>
                  <TableHead>VIP</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Dernière visite</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((c) => (
                  <TableRow key={c.id} className="transition-all duration-200 hover:bg-accent">
                    <TableCell className="font-medium">
                      <Link
                        href={`/dashboard/customers/crm/${c.id}`}
                        className="transition-all duration-200 hover:underline"
                      >
                        {c.name || <span className="opacity-50">Client sans nom</span>}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.phone}</TableCell>
                    <TableCell>{c.visitSummary?.visits ?? '—'}</TableCell>
                    <TableCell className="max-w-[220px]">
                      <CustomerLifecycleBadge lifecycle={c.lifecycle} showReason />
                    </TableCell>
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
                    <TableCell className="text-muted-foreground">
                      <span className="block max-w-[200px] truncate" title={c.notes ?? undefined}>
                        {c.notes || <span className="opacity-50">—</span>}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.visitSummary?.lastVisitAt ? (
                        new Date(c.visitSummary.lastVisitAt).toLocaleDateString('fr-FR')
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

      {customers.length > 0 && customers.length < total && (
        <div className="flex flex-col items-center gap-2">
          {moreError && <p className="text-sm text-destructive">{moreError}</p>}
          <Button
            type="button"
            variant="outline"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="transition-all duration-200"
          >
            {loadingMore
              ? 'Chargement…'
              : `Afficher plus de clients (${customers.length} sur ${total})`}
          </Button>
        </div>
      )}
    </div>
  );
}
