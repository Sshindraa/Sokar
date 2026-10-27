'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  GitMerge,
  RefreshCw,
  Search,
  Sparkles,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { FeatureLockCard } from '@/components/FeatureLockCard';
import { useApi } from '@/lib/api';
import { featureLockFromError, type FeatureLock } from '@/lib/api-error';
import {
  getErrorMessage,
  type CustomerLifecycle,
  type CustomerLifecycleStatus,
  type CustomerVisitSummary,
} from '@/types/api';
import { CustomerLifecycleBadge, LIFECYCLE_LABELS } from '@/components/CustomerLifecycleBadge';

type CustomerMetricSnapshot = {
  honored365d: number;
  cancelled365d: number;
  noShow365d: number;
  covers365d: number;
  actualLifetimeSpend: number | string | null;
  lastHonoredAt: string | null;
};

type CrmCustomer = {
  id: string;
  name: string | null;
  phone: string;
  emailNormalized: string | null;
  isVip: boolean;
  updatedAt: string;
  metricSnapshot: CustomerMetricSnapshot | null;
  lifecycle?: CustomerLifecycle | null;
  visitSummary?: CustomerVisitSummary | null;
};

type CrmListResponse = {
  data: CrmCustomer[];
  nextCursor: string | null;
};

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('fr-FR');
}

function formatSpend(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return 'Non raccordé';
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
    : '—';
}

function LoadingRows() {
  return (
    <div className="space-y-2">
      {[1, 2, 3, 4, 5].map((row) => (
        <Skeleton key={row} className="h-14 w-full rounded-xl" />
      ))}
    </div>
  );
}

export default function CrmPage() {
  const { get, orgId } = useApi();
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [search, setSearch] = useState('');
  const [isVip, setIsVip] = useState<'all' | 'true' | 'false'>('all');
  const [minHonored365d, setMinHonored365d] = useState('');
  const [lifecycle, setLifecycle] = useState<'all' | CustomerLifecycleStatus>('all');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [lock, setLock] = useState<FeatureLock | null>(null);
  // Filtres réellement envoyés au serveur : ils ne changent qu'au clic sur « Rechercher » ou au choix VIP,
  // pas à chaque frappe (sinon le tableau clignote et la liste se recharge pour rien).
  const [applied, setApplied] = useState({
    search: '',
    isVip: 'all',
    minHonored365d: '',
    lifecycle: 'all',
  });

  const load = useCallback(
    async (cursor?: string) => {
      if (!orgId) {
        setLoading(false);
        return;
      }
      if (cursor) setLoadingMore(true);
      else setLoading(true);
      setError('');
      setLock(null);
      const params = new URLSearchParams();
      if (applied.search.trim()) params.set('search', applied.search.trim());
      if (applied.isVip !== 'all') params.set('isVip', applied.isVip);
      if (applied.minHonored365d.trim())
        params.set('minHonored365d', applied.minHonored365d.trim());
      if (applied.lifecycle !== 'all') params.set('lifecycle', applied.lifecycle);
      params.set('limit', '50');
      if (cursor) params.set('cursor', cursor);
      try {
        const response = await get<CrmListResponse>(`crm/customers?${params.toString()}`);
        const page = Array.isArray(response.data) ? response.data : [];
        setCustomers((previous) => (cursor ? [...previous, ...page] : page));
        setNextCursor(response.nextCursor ?? null);
      } catch (err: unknown) {
        setLock(featureLockFromError(err));
        setError(getErrorMessage(err, 'Impossible de charger le CRM Pro.'));
        if (!cursor) setCustomers([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [applied, get, orgId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApplied({ search, isVip, minHonored365d, lifecycle });
  }

  function clearFilters() {
    setSearch('');
    setIsVip('all');
    setMinHonored365d('');
    setLifecycle('all');
    setApplied({ search: '', isVip: 'all', minHonored365d: '', lifecycle: 'all' });
  }

  const hasFilters =
    applied.search.trim() !== '' ||
    applied.isVip !== 'all' ||
    applied.minHonored365d.trim() !== '' ||
    applied.lifecycle !== 'all';

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="text-primary" size={20} />
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">CRM Pro</h1>
            <Badge variant="secondary">Données client</Badge>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Retrouver les habitudes, la valeur estimée et les signaux utiles avant le prochain
            service.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard/customers/crm/duplicates">
            <GitMerge size={16} />
            Doublons à traiter
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Filtres CRM</CardTitle>
          <CardDescription>
            La recherche reste limitée à votre établissement et aux profils actifs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_170px_170px_170px_auto]"
            onSubmit={submit}
          >
            <label className="relative">
              <span className="sr-only">Rechercher un client</span>
              <Search
                aria-hidden="true"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                size={16}
              />
              <Input
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Nom, téléphone ou email"
              />
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm">
              <span className="sr-only">Filtre VIP</span>
              <select
                aria-label="Filtre VIP"
                className="h-10 w-full bg-transparent text-foreground outline-none"
                value={isVip}
                onChange={(event) => {
                  const value = event.target.value as 'all' | 'true' | 'false';
                  setIsVip(value);
                  setApplied((previous) => ({ ...previous, isVip: value }));
                }}
              >
                <option value="all">Tous les clients</option>
                <option value="true">VIP uniquement</option>
                <option value="false">Hors VIP</option>
              </select>
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm">
              <span className="sr-only">Filtre statut</span>
              <select
                aria-label="Filtre statut"
                className="h-10 w-full bg-transparent text-foreground outline-none"
                value={lifecycle}
                onChange={(event) => {
                  const value = event.target.value as 'all' | CustomerLifecycleStatus;
                  setLifecycle(value);
                  setApplied((previous) => ({ ...previous, lifecycle: value }));
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
                value={minHonored365d}
                onChange={(event) => setMinHonored365d(event.target.value)}
                placeholder="Visites min. (365 j)"
              />
            </label>
            <Button type="submit" disabled={loading}>
              <Search size={16} />
              Rechercher
            </Button>
          </form>
        </CardContent>
      </Card>

      {lock ? (
        <div className="space-y-3">
          <FeatureLockCard lock={lock} feature="CRM Pro" />
          <Button asChild variant="outline" size="sm" className="transition-all duration-200">
            <Link href="/dashboard/customers">
              <ArrowRight size={14} />
              Retour aux clients
            </Link>
          </Button>
        </div>
      ) : error ? (
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-3 pt-6 text-sm text-destructive">
            <AlertCircle className="mt-0.5 shrink-0" size={18} />
            <div className="space-y-2">
              <p role="alert">{error}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="transition-all duration-200"
                onClick={() => void load()}
              >
                <RefreshCw size={14} />
                Réessayer
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : loading && customers.length === 0 ? (
        <LoadingRows />
      ) : customers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <Users className="text-muted-foreground" size={36} />
            {hasFilters ? (
              <>
                <p className="font-medium">Aucun profil ne correspond à ces filtres</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2 transition-all duration-200"
                  onClick={clearFilters}
                >
                  Effacer les filtres
                </Button>
              </>
            ) : (
              <>
                <p className="font-medium">Aucun profil CRM pour le moment</p>
                <p className="text-sm text-muted-foreground">
                  Les profils s&apos;enrichissent après les appels et les visites honorées.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between border-b border-border pb-4">
            <div>
              <CardTitle className="text-base">Profils actifs</CardTitle>
              <CardDescription>{customers.length} profil(s) chargé(s)</CardDescription>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>
              <RefreshCw size={14} />
              Actualiser
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-6 py-3 font-medium">Client</th>
                    <th className="px-4 py-3 font-medium">Visites</th>
                    <th className="px-4 py-3 font-medium">Statut</th>
                    <th className="px-4 py-3 font-medium">365 derniers jours</th>
                    <th className="px-4 py-3 font-medium">Dépense caisse</th>
                    <th className="px-4 py-3 font-medium">Dernière visite</th>
                    <th className="px-6 py-3 text-right font-medium"> </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {customers.map((customer) => {
                    const metrics = customer.metricSnapshot;
                    return (
                      <tr
                        key={customer.id}
                        className="transition-all duration-200 hover:bg-accent/50"
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/dashboard/customers/crm/${customer.id}`}
                              className="font-medium transition-all duration-200 hover:underline"
                            >
                              {customer.name || 'Client sans nom'}
                            </Link>
                            {customer.isVip ? <Badge variant="outline">VIP</Badge> : null}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {customer.phone}
                            {customer.emailNormalized ? ` · ${customer.emailNormalized}` : ''}
                          </p>
                        </td>
                        <td className="px-4 py-4 font-medium">
                          {customer.visitSummary?.visits ?? '—'}
                        </td>
                        <td className="px-4 py-4">
                          <CustomerLifecycleBadge lifecycle={customer.lifecycle} />
                        </td>
                        <td className="px-4 py-4 text-muted-foreground">
                          {customer.visitSummary ? (
                            <span>
                              {customer.visitSummary.visits365d} visite(s) ·{' '}
                              {customer.visitSummary.noShows365d} no-show
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-4 text-muted-foreground">
                          {formatSpend(metrics?.actualLifetimeSpend)}
                        </td>
                        <td className="px-4 py-4 text-muted-foreground">
                          {formatDate(customer.visitSummary?.lastVisitAt)}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <Button asChild variant="ghost" size="sm">
                            <Link href={`/dashboard/customers/crm/${customer.id}`}>
                              Ouvrir
                              <ArrowRight size={14} />
                            </Link>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {nextCursor ? (
              <div className="flex justify-center border-t border-border p-4">
                <Button
                  type="button"
                  variant="outline"
                  disabled={loadingMore}
                  onClick={() => void load(nextCursor)}
                >
                  {loadingMore ? 'Chargement…' : 'Charger davantage'}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
