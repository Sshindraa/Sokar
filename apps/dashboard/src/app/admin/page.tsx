'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowUpRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi } from '@/lib/api';

type ProvisioningRestaurant = {
  restaurantId: string;
  steps: {
    assignment: { completed: boolean; voiceAppLink: string | null };
    webhook: { completed: boolean };
    forwarding: { completed: boolean };
    testCall: { completed: boolean };
  };
};

type ProvisioningResponse = {
  count: number;
  restaurants: ProvisioningRestaurant[];
};

type DemoRequestSummary = {
  byStatus: { NEW: number };
  notificationUnconfirmed: number;
};

type OnboardingResponse = {
  funnel: { timeToFirstReservation: { pending: number } };
};

type MarginResponse = {
  rows: Array<{ unpricedEventCount: number }>;
};

type OverviewSnapshot = {
  provisioning: ProvisioningResponse | null;
  demos: DemoRequestSummary | null;
  onboarding: OnboardingResponse | null;
  margin: MarginResponse | null;
};

type WorkItem = {
  href: string;
  title: string;
  value: string;
  detail: string;
};

const DATA_SOURCES = ['Provisioning', 'Demandes de démo', 'Onboarding', 'Coûts'] as const;

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('fr-FR').format(value);
}

function formatClock(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(
    new Date(value),
  );
}

function formatPlural(value: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(value)} ${value === 1 ? singular : plural}`;
}

function getProvisioningSummary(restaurants: ProvisioningRestaurant[]) {
  const pending = {
    assignment: 0,
    webhook: 0,
    forwarding: 0,
    testCall: 0,
    voiceLink: 0,
  };

  for (const restaurant of restaurants) {
    if (!restaurant.steps.assignment.completed) pending.assignment += 1;
    if (!restaurant.steps.webhook.completed) pending.webhook += 1;
    if (!restaurant.steps.forwarding.completed) pending.forwarding += 1;
    if (!restaurant.steps.testCall.completed) pending.testCall += 1;
    if (
      restaurant.steps.assignment.completed &&
      restaurant.steps.assignment.voiceAppLink !== 'linked'
    ) {
      pending.voiceLink += 1;
    }
  }

  const needsReview = restaurants.filter(
    (restaurant) =>
      Object.values(restaurant.steps).some((step) => !step.completed) ||
      (restaurant.steps.assignment.completed &&
        restaurant.steps.assignment.voiceAppLink !== 'linked'),
  ).length;

  const detail = [
    pending.assignment > 0 ? formatPlural(pending.assignment, 'numéro') : null,
    pending.webhook > 0 ? formatPlural(pending.webhook, 'webhook') : null,
    pending.forwarding > 0 ? formatPlural(pending.forwarding, 'renvoi') : null,
    pending.testCall > 0 ? formatPlural(pending.testCall, 'appel de test', 'appels de test') : null,
    pending.voiceLink > 0 ? formatPlural(pending.voiceLink, 'lien voix', 'liens voix') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return { needsReview, detail };
}

function makeWorkItems(snapshot: OverviewSnapshot): WorkItem[] {
  const items: WorkItem[] = [];
  const demoCount = snapshot.demos?.byStatus.NEW ?? 0;
  const notificationCount = snapshot.demos?.notificationUnconfirmed ?? 0;

  if (demoCount > 0 || notificationCount > 0) {
    items.push({
      href: '/admin/demo-requests',
      title: 'Demandes de démo',
      value:
        demoCount > 0
          ? formatPlural(demoCount, 'nouvelle demande', 'nouvelles demandes')
          : formatPlural(notificationCount, 'notification'),
      detail: [
        demoCount > 0 ? 'à qualifier' : null,
        notificationCount > 0
          ? `${formatPlural(notificationCount, 'notification')} sans confirmation`
          : null,
      ]
        .filter(Boolean)
        .join(' · '),
    });
  }

  if (snapshot.provisioning) {
    const summary = getProvisioningSummary(snapshot.provisioning.restaurants);
    if (summary.needsReview > 0) {
      items.push({
        href: '/admin/provisioning',
        title: 'Mise en service',
        value: formatPlural(summary.needsReview, 'établissement'),
        detail: summary.detail,
      });
    }
  }

  const pendingReservations = snapshot.onboarding?.funnel.timeToFirstReservation.pending ?? 0;
  if (pendingReservations > 0) {
    items.push({
      href: '/admin/onboarding',
      title: 'Première réservation',
      value: formatPlural(pendingReservations, 'parcours', 'parcours'),
      detail: 'démarré sans réservation enregistrée',
    });
  }

  const unpricedUsages =
    snapshot.margin?.rows.reduce((sum, row) => sum + row.unpricedEventCount, 0) ?? 0;
  if (unpricedUsages > 0) {
    items.push({
      href: '/admin/margin',
      title: 'Tarifs fournisseurs',
      value: formatPlural(unpricedUsages, 'usage'),
      detail: 'sans tarif · mois en cours',
    });
  }

  return items;
}

export default function AdminHomePage() {
  const { get } = useApi();
  const [snapshot, setSnapshot] = useState<OverviewSnapshot | null>(null);
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const currentRequestId = ++requestId.current;
    setLoading(true);
    const results = await Promise.allSettled([
      get<ProvisioningResponse>('admin/provisioning/restaurants'),
      get<DemoRequestSummary>('admin/demo-requests/summary'),
      get<OnboardingResponse>('admin/onboarding-funnel/cohort'),
      get<MarginResponse>(`admin/usage/margin?month=${currentMonthKey()}`),
    ] as const);

    if (currentRequestId !== requestId.current) return;

    setSnapshot({
      provisioning: results[0].status === 'fulfilled' ? results[0].value : null,
      demos: results[1].status === 'fulfilled' ? results[1].value : null,
      onboarding: results[2].status === 'fulfilled' ? results[2].value : null,
      margin: results[3].status === 'fulfilled' ? results[3].value : null,
    });
    setFailedSources(
      results.flatMap((result, index) =>
        result.status === 'rejected' ? [DATA_SOURCES[index] ?? 'Données'] : [],
      ),
    );
    setUpdatedAt(new Date().toISOString());
    setLoading(false);
  }, [get]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const workItems = useMemo(() => (snapshot ? makeWorkItems(snapshot) : []), [snapshot]);
  const allSourcesUnavailable = failedSources.length === DATA_SOURCES.length;
  const restaurantCount = snapshot?.provisioning?.count;

  return (
    <div className="mx-auto max-w-6xl space-y-8" aria-busy={loading}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Vue générale</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {restaurantCount === undefined
              ? 'État des opérations'
              : `${formatPlural(restaurantCount, 'établissement')} suivi${restaurantCount === 1 ? '' : 's'}`}
            {updatedAt ? ` · Actualisé à ${formatClock(updatedAt)}` : ''}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Actualiser les données"
          title="Actualiser les données"
          onClick={() => void refresh()}
          disabled={loading}
        >
          <RefreshCw className={loading ? 'animate-spin' : undefined} aria-hidden="true" />
        </Button>
      </header>

      {failedSources.length > 0 && (
        <div
          role="alert"
          className="flex items-start gap-2 border-l-2 border-destructive py-1 pl-3"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            Indisponible : {failedSources.join(', ')}.{' '}
            {failedSources.length === DATA_SOURCES.length
              ? 'Aucune source n’a répondu.'
              : 'Les résultats ci-dessous sont partiels.'}
          </p>
        </div>
      )}

      <section aria-labelledby="work-heading">
        <div className="mb-3">
          <h3 id="work-heading" className="text-lg font-semibold">
            À traiter
          </h3>
        </div>

        {loading && !snapshot ? (
          <div className="space-y-4" aria-label="Chargement des opérations">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : workItems.length > 0 ? (
          <ul className="divide-y divide-border border-y border-border">
            {workItems.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="group grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 gap-y-1 py-4 transition-all duration-200 hover:bg-accent/30 sm:grid-cols-[minmax(12rem,1fr)_minmax(0,2fr)_auto_auto]"
                >
                  <span className="font-medium text-foreground">{item.title}</span>
                  <span className="col-span-3 row-start-2 text-sm text-muted-foreground sm:col-span-1 sm:col-start-2 sm:row-start-1">
                    {item.detail}
                  </span>
                  <span className="whitespace-nowrap text-right text-sm font-medium tabular-nums text-foreground/90">
                    {item.value}
                  </span>
                  <ArrowUpRight
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            ))}
          </ul>
        ) : allSourcesUnavailable ? (
          <div className="border-y border-border py-6">
            <p className="font-medium">Données indisponibles</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Aucun résultat exploitable pour le moment. Réessayez après le rétablissement des
              sources.
            </p>
          </div>
        ) : failedSources.length > 0 ? (
          <div className="border-y border-border py-6">
            <p className="font-medium">Aucune action remontée par les sources disponibles</p>
            <p className="mt-1 text-sm text-muted-foreground">
              La vue reste partielle tant que toutes les sources ne répondent pas.
            </p>
          </div>
        ) : (
          <div className="border-y border-border py-6">
            <p className="font-medium">Aucune action en attente</p>
          </div>
        )}
      </section>
    </div>
  );
}
