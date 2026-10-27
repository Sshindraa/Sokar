'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useApi } from '../../../lib/api';
import { ApiError } from '@/lib/api-error';
import { getErrorMessage, type Customer, type CustomerLifecycleStatus } from '@/types/api';
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
import { Users, Search, Star, Phone, Copy, Lock, StickyNote, X } from 'lucide-react';
import { DataFetchError } from '@/components/DataFetchError';
import { CustomerLifecycleBadge, LIFECYCLE_LABELS } from '@/components/CustomerLifecycleBadge';

type CustomerListResponse = Customer[] | { data?: Customer[]; total?: number };

const PAGE_SIZE = 50;

type Filters = {
  search: string;
  isVip: 'all' | 'true' | 'false';
  lifecycle: 'all' | CustomerLifecycleStatus;
  minVisits: string;
};
const NO_FILTERS: Filters = { search: '', isVip: 'all', lifecycle: 'all', minVisits: '' };

/** La fiche détaillée est une fonction de CRM Pro : sans la formule, le nom reste un simple texte. */
function ProfileLink({
  id,
  linked,
  children,
}: {
  id: string;
  linked: boolean;
  children: React.ReactNode;
}) {
  if (!linked) return <>{children}</>;
  return (
    <Link
      href={`/dashboard/customers/crm/${id}`}
      className="transition-all duration-200 hover:underline"
    >
      {children}
    </Link>
  );
}

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
  profileLinked,
}: {
  customer: Customer;
  onToggleVip: (id: string, current: boolean) => void;
  profileLinked: boolean;
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
                <ProfileLink id={customer.id} linked={profileLinked}>
                  {name}
                </ProfileLink>
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
  // Saisie en cours, et filtres réellement appliqués (ceux que « Afficher plus » doit continuer).
  const [draft, setDraft] = useState<Filters>(NO_FILTERS);
  const [applied, setApplied] = useState<Filters>(NO_FILTERS);
  const [error, setError] = useState('');
  // Le premier chargement affiche des squelettes ; une recherche garde la page et le champ en place.
  const [loadedOnce, setLoadedOnce] = useState(false);
  // CRM Pro : « open » = filtres et fiches ouverts, « locked » = hors formule (CRM de base), « hidden » = fermé ou en panne.
  const [crmState, setCrmState] = useState<'open' | 'locked' | 'hidden'>('hidden');

  const customersUrl = useCallback((filters: Filters, offset: number) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    // Un nom ou un numéro tel qu'on le tape (« 06 12 34 56 78 »), entier ou en partie.
    if (filters.search) params.set('search', filters.search);
    if (filters.isVip !== 'all') params.set('isVip', filters.isVip);
    if (filters.lifecycle !== 'all') params.set('lifecycle', filters.lifecycle);
    if (filters.minVisits) params.set('minHonored365d', filters.minVisits);
    return `customers?${params.toString()}`;
  }, []);

  const fetchCustomers = useCallback(
    async (filters: Filters = NO_FILTERS) => {
      setLoading(true);
      setError('');
      setMoreError('');
      try {
        const response = await get<CustomerListResponse>(customersUrl(filters, 0));
        const rows = Array.isArray(response) ? response : response.data;
        const list = Array.isArray(rows) ? rows : [];
        setCustomers(list);
        setTotal(
          !Array.isArray(response) && typeof response.total === 'number'
            ? response.total
            : list.length,
        );
        setApplied(filters);
        setDraft(filters);
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
      const response = await get<CustomerListResponse>(customersUrl(applied, customers.length));
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
      .then(() => setCrmState('open'))
      // Hors formule : les filtres avancés sont présentés comme inclus dans CRM Pro. Fermé ou en panne : on les cache.
      .catch((err: unknown) =>
        setCrmState(err instanceof ApiError && err.kind === 'not-included' ? 'locked' : 'hidden'),
      );
  }, [orgId, get, loadedOnce]);

  const hasFilters = JSON.stringify(applied) !== JSON.stringify(NO_FILTERS);

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
          {crmState === 'open' ? (
            <Button asChild variant="outline" size="sm" className="px-2.5 sm:px-3">
              <Link href="/dashboard/customers/crm/duplicates">
                <Copy size={14} />
                Doublons
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      {/* Recherche */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void fetchCustomers({ ...draft, search: draft.search.trim() });
        }}
        className="flex min-w-0 flex-wrap gap-2"
        role="search"
      >
        <div className="relative min-w-[16rem] flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="text"
            placeholder="Rechercher un nom, un téléphone ou un email…"
            value={draft.search}
            onChange={(e) => setDraft((current) => ({ ...current, search: e.target.value }))}
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
          {draft.search && (
            <button
              type="button"
              aria-label="Effacer la recherche"
              onClick={() => {
                void fetchCustomers({ ...applied, search: '' });
              }}
              className="absolute right-[5.75rem] top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X size={15} />
            </button>
          )}
        </div>
        <label>
          <span className="sr-only">Filtre VIP</span>
          <select
            aria-label="Filtre VIP"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
            value={draft.isVip}
            onChange={(event) => {
              void fetchCustomers({ ...applied, isVip: event.target.value as Filters['isVip'] });
            }}
          >
            <option value="all">Tous les clients</option>
            <option value="true">VIP uniquement</option>
            <option value="false">Hors VIP</option>
          </select>
        </label>
        {crmState === 'open' ? (
          <>
            <label>
              <span className="sr-only">Filtre statut</span>
              <select
                aria-label="Filtre statut"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
                value={draft.lifecycle}
                onChange={(event) => {
                  void fetchCustomers({
                    ...applied,
                    lifecycle: event.target.value as Filters['lifecycle'],
                  });
                }}
              >
                <option value="all">Tous les statuts</option>
                {(Object.keys(LIFECYCLE_LABELS) as CustomerLifecycleStatus[]).map((status) => (
                  <option key={status} value={status}>
                    {LIFECYCLE_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Visites honorées minimum</span>
              <Input
                type="number"
                min={0}
                max={10000}
                className="w-40"
                value={draft.minVisits}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, minVisits: event.target.value }))
                }
                placeholder="Visites min. (365 j)"
              />
            </label>
          </>
        ) : null}
      </form>
      {crmState === 'locked' ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock size={12} aria-hidden="true" />
          Filtres par statut et par visites, fiches détaillées et doublons : inclus dans CRM Pro.
          <Link
            href="/pricing"
            className="underline underline-offset-4 transition-all duration-200 hover:text-foreground"
          >
            Voir les formules
          </Link>
        </p>
      ) : null}

      {/* Contenu */}
      {error && (
        <DataFetchError
          message={error}
          onRetry={() => fetchCustomers(applied)}
          retrying={loading}
        />
      )}
      {customers.length === 0 ? (
        error ? null : (
          <div className="sokar-empty">
            <Users size={40} className="opacity-30" />
            <p className="text-sm">
              {hasFilters
                ? 'Aucun client ne correspond à cette recherche'
                : 'Aucun client enregistré'}
            </p>
            <p className="max-w-sm text-xs opacity-60">
              {hasFilters
                ? 'Essayez un autre nom, seulement quelques chiffres du numéro, ou retirez un filtre.'
                : 'Les clients apparaîtront après vos premiers appels.'}
            </p>
            {hasFilters ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-1"
                onClick={() => void fetchCustomers(NO_FILTERS)}
              >
                Effacer les filtres
              </Button>
            ) : (
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
            <CustomerMobileCard
              key={customer.id}
              customer={customer}
              onToggleVip={toggleVip}
              profileLinked={crmState === 'open'}
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
                  <TableHead>365 jours</TableHead>
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
                      <ProfileLink id={c.id} linked={crmState === 'open'}>
                        {c.name || <span className="opacity-50">Client sans nom</span>}
                      </ProfileLink>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <span className="block">{c.phone}</span>
                      {c.emailNormalized ? (
                        <span className="block max-w-[220px] truncate text-xs opacity-70">
                          {c.emailNormalized}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>{c.visitSummary?.visits ?? '—'}</TableCell>
                    <TableCell>{c.visitSummary?.visits365d ?? '—'}</TableCell>
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
