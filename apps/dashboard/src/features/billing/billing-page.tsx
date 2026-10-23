'use client';

import Link from 'next/link';
import { ANNUAL_DISCOUNT_PERCENT, VAT_MENTION } from '@sokar/shared';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  CreditCard,
  Download,
  FileText,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { PLANS, DISPLAY_PRICE, billingAmount } from '@/app/constants';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DataFetchError } from '@/components/DataFetchError';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useSiteSelection } from '@/features/sites/site-context';
import { useBillingStatus, TrialRecap, TrialTrack } from './trial';
import type { BillingDetails, BillingInterval, BillingPlan, BillingStatus } from '@/types/api';

const LABELS = { essential: 'Essential', pro: 'Pro', 'multi-site': 'Multi-site' };
const SLUGS: BillingPlan[] = ['essential', 'pro', 'multi-site'];
const STATUS: Record<string, string> = {
  active: 'Abonnement actif',
  trialing: 'Essai gratuit',
  past_due: 'Paiement à régulariser',
  canceled: 'Abonnement terminé',
  unpaid: 'Paiement impayé',
  paused: 'Abonnement en pause',
  incomplete: 'Souscription à finaliser',
  incomplete_expired: 'Souscription expirée',
};
const INVOICE_STATUS: Record<string, string> = {
  paid: 'Payée',
  open: 'À régler',
  void: 'Annulée',
  uncollectible: 'Impayée',
};
const date = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const money = (cents: number, currency = 'eur') =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(cents / 100);
// Invoice URLs are credentials scoped to the owner's invoice, supplied by Stripe only.
export function stripeDocumentUrl(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      ['invoice.stripe.com', 'pay.stripe.com'].includes(url.hostname)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

export function BillingPage() {
  const { orgId } = useApi();
  const { accountId, activeSite, status } = useSiteSelection();
  if (!orgId || status === 'loading' || status === 'idle') return <BillingLoading />;
  if (status === 'error')
    return <p role="alert">Impossible de vérifier vos accès. Rechargez la page pour réessayer.</p>;
  const owner = activeSite?.role === 'OWNER';
  return <BillingWorkspace key={`${orgId}:${accountId ?? ''}:${owner}`} owner={owner} />;
}

function BillingLoading() {
  return (
    <div role="status" aria-label="Chargement de la facturation" className="space-y-6 p-6">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-52 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

/** Remount per tenant: no invoice, URL or pending response survives a site/account switch. */
function BillingWorkspace({ owner }: { owner: boolean }) {
  const { get, post } = useApi();
  const { refresh: refreshShell } = useBillingStatus();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [details, setDetails] = useState<BillingDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [detailsError, setDetailsError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [billing, setBilling] = useState<BillingInterval>('monthly');
  const [siteCount, setSiteCount] = useState(2);
  const [notice] = useState(() => {
    const result =
      typeof window === 'undefined'
        ? null
        : new URLSearchParams(window.location.search).get('billing');
    return !result
      ? ''
      : result === 'canceled'
        ? 'La souscription n’a pas été finalisée.'
        : 'Retour de Stripe : les informations ont été actualisées. La confirmation de votre formule peut prendre quelques instants.';
  });
  const live = useRef(true);
  const actionPending = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('billing');
    if (!result) return;
    params.delete('billing');
    params.delete('session_id');
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${params.size ? `?${params}` : ''}`,
    );
    if (result === 'canceled') return;
    // Read-only polling after hosted actions; URL parameters never grant entitlements.
    let attempts = 0;
    const timer = window.setInterval(() => {
      setVersion((value) => value + 1);
      refreshShell();
      if (++attempts >= 5) window.clearInterval(timer);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [refreshShell]);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    void get<BillingStatus>('billing/status', { signal: controller.signal })
      .then((summary) => {
        if (!alive) return;
        setLoadError('');
        setStatus(summary);
        setBilling((value) => (version === 0 ? (summary.billingInterval ?? value) : value));
      })
      .catch(() => {
        if (alive) setLoadError('Impossible de charger votre abonnement.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    void (
      owner
        ? get<BillingDetails>('billing/details', { signal: controller.signal })
        : Promise.resolve(null)
    )
      .then((extra) => {
        if (alive) {
          setDetails(extra);
          setDetailsError('');
        }
      })
      .catch(() => {
        if (alive) {
          setDetails(null);
          setDetailsError('Les informations Stripe sont momentanément indisponibles.');
        }
      })
      .finally(() => {
        if (alive) setDetailsLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [get, owner, version]);

  const retry = () => setVersion((value) => value + 1);
  const current = details?.subscription;
  const state = current?.status ?? status?.subscriptionStatus;
  const plan = current?.plan ?? status?.plan;
  const periodEnd = current?.currentPeriodEnd ?? status?.currentPeriodEnd;
  const canceling = current?.cancelAtPeriodEnd ?? status?.cancelAtPeriodEnd;
  const subscribed = Boolean(state && !['canceled', 'incomplete_expired'].includes(state));
  const trial = state === 'trialing' ? status?.trial : undefined;

  async function openPortal(
    intent: 'manage' | 'payment_method' | 'subscription_update' | 'subscription_cancel',
  ) {
    if (actionPending.current || !owner) return;
    actionPending.current = true;
    setBusy(intent);
    setActionError('');
    try {
      const result = await post<{ url: string }>('billing/portal-session', {
        intent,
        returnTo: 'billing',
      });
      if (!live.current) return;
      if (!result.url.startsWith('https://billing.stripe.com/'))
        throw new Error('Le portail Stripe est indisponible.');
      window.location.assign(result.url);
    } catch {
      if (live.current) setActionError('Impossible d’ouvrir Stripe. Réessayez dans un instant.');
    } finally {
      actionPending.current = false;
      if (live.current) setBusy(null);
    }
  }

  async function checkout(selected: BillingPlan) {
    if (actionPending.current || !owner) return;
    actionPending.current = true;
    setBusy(selected);
    setActionError('');
    try {
      const result = await post<{ url: string }>('billing/checkout-session', {
        plan: selected,
        billing,
        returnTo: 'billing',
        ...(selected === 'multi-site' ? { siteCount } : {}),
      });
      if (!live.current) return;
      if (!result.url.startsWith('https://checkout.stripe.com/'))
        throw new Error('La page Stripe est indisponible.');
      window.location.assign(result.url);
    } catch {
      if (live.current)
        setActionError(
          'Impossible de préparer la souscription. Actualisez les informations avant de réessayer.',
        );
    } finally {
      actionPending.current = false;
      if (live.current) setBusy(null);
    }
  }

  if (loading) return <BillingLoading />;
  if (loadError && !status) return <DataFetchError message={loadError} onRetry={retry} />;
  return (
    <div className="mx-auto max-w-6xl space-y-8 p-4 sm:p-6 lg:p-8">
      <header className="space-y-3">
        <Link
          href="/dashboard/settings"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-all duration-200 hover:text-foreground"
        >
          <ArrowLeft size={14} />
          Réglages
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Votre espace Sokar
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Mon abonnement</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Votre formule, vos échéances et vos factures, au même endroit.
            </p>
          </div>
          <Button variant="outline" onClick={retry} disabled={Boolean(busy)}>
            Actualiser
          </Button>
        </div>
      </header>
      {notice && (
        <p role="status" className="rounded-2xl border border-border bg-muted/40 p-4 text-sm">
          {notice}
        </p>
      )}
      {loadError && <DataFetchError message={loadError} onRetry={retry} />}
      {!owner && (
        <p className="rounded-2xl border border-border bg-muted/40 p-4 text-sm">
          Seul le propriétaire du compte peut consulter les factures et gérer l’abonnement.
        </p>
      )}
      {actionError && (
        <p
          role="alert"
          className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {actionError}
        </p>
      )}
      <section aria-label="Abonnement actuel" className="grid gap-6 lg:grid-cols-3">
        <Card className="overflow-hidden rounded-3xl lg:col-span-2">
          <CardContent className="space-y-6 p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">Votre formule</p>
              <span
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium',
                  ['active', 'trialing'].includes(state ?? '')
                    ? 'bg-success/10 text-success'
                    : 'bg-muted text-foreground',
                )}
              >
                {state ? (STATUS[state] ?? 'Statut à vérifier') : 'Aucun abonnement Stripe'}
              </span>
            </div>
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">
                {plan ? LABELS[plan] : 'Choisissez votre formule'}
              </h2>
              {current?.recurringAmount != null && (
                <p className="mt-3 text-2xl font-medium">
                  {money(current.recurringAmount, current.currency)}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    /{' '}
                    {current.intervalCount && current.intervalCount > 1
                      ? `${current.intervalCount} `
                      : ''}
                    {current.interval === 'year'
                      ? 'an'
                      : current.interval === 'month'
                        ? 'mois'
                        : 'période'}
                  </span>
                </p>
              )}
              {current?.recurringAmount != null && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Tarif récurrent avant remises, taxes et ajustements. Le montant facturé figure sur
                  chaque facture.
                </p>
              )}
            </div>
            <dl className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">
                  {canceling
                    ? 'Fin de l’accès'
                    : state === 'trialing'
                      ? 'Fin de l’essai'
                      : 'Fin de période en cours'}
                </dt>
                <dd className="mt-1 text-sm font-medium">
                  {periodEnd ? date(periodEnd) : 'Aucune échéance disponible'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Établissements inclus</dt>
                <dd className="mt-1 text-sm font-medium">{status?.entitledSiteCount ?? 1}</dd>
              </div>
            </dl>
            {trial && (
              <>
                <TrialTrack trial={trial} />
                <TrialRecap trial={trial} />
              </>
            )}
            {state === 'trialing' && (
              <p className="text-sm text-muted-foreground">
                {detailsLoading
                  ? 'Vérification du moyen de paiement…'
                  : details?.hasPaymentMethod
                    ? 'Un moyen de paiement est enregistré pour la fin de l’essai.'
                    : 'Ajoutez un moyen de paiement avant la fin de l’essai pour continuer à utiliser Sokar.'}
              </p>
            )}
            {state === 'past_due' && (
              <p role="alert" className="text-sm text-destructive">
                Le dernier paiement a échoué. Mettez à jour votre moyen de paiement dans Stripe.
              </p>
            )}
            {status?.suspended && !['active', 'trialing'].includes(state ?? '') && (
              <p role="alert" className="text-sm text-destructive">
                Votre abonnement est terminé : Sokar ne répond plus aux appels. Choisissez une
                formule pour le réactiver.
              </p>
            )}
            {canceling && (
              <p className="text-sm text-muted-foreground">
                Votre résiliation est programmée. Vous pouvez vérifier les conditions et les options
                disponibles dans Stripe.
              </p>
            )}
            {owner && details?.hasCustomer && (
              <div className="flex flex-wrap gap-3">
                <Button disabled={Boolean(busy)} onClick={() => void openPortal('manage')}>
                  Gérer l’abonnement
                  <ArrowUpRight size={14} />
                </Button>
                {subscribed && current?.canUpdatePlan && (
                  <Button
                    variant="outline"
                    disabled={Boolean(busy)}
                    onClick={() => void openPortal('subscription_update')}
                  >
                    Modifier la formule
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="rounded-3xl">
          <CardHeader>
            <CreditCard size={22} className="mb-2 text-muted-foreground" />
            <CardTitle className="text-lg">Moyen de paiement</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {!owner ? (
              <p className="text-sm text-muted-foreground">
                Informations réservées au propriétaire.
              </p>
            ) : detailsLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : detailsError ? (
              <DataFetchError message={detailsError} onRetry={retry} />
            ) : (
              <>
                {details?.paymentMethod ? (
                  <div>
                    <p className="font-medium capitalize">
                      {details.paymentMethod.brand} ···· {details.paymentMethod.last4}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Expire le {String(details.paymentMethod.expMonth).padStart(2, '0')}/
                      {details.paymentMethod.expYear}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {details?.hasPaymentMethod
                      ? 'Un moyen de paiement est enregistré dans Stripe.'
                      : 'Aucun moyen de paiement enregistré.'}
                  </p>
                )}
                {details?.hasCustomer && (
                  <Button
                    className="w-full"
                    variant="outline"
                    disabled={Boolean(busy)}
                    onClick={() => void openPortal('payment_method')}
                  >
                    {details.hasPaymentMethod ? 'Mettre à jour' : 'Ajouter un moyen de paiement'}
                    <ArrowUpRight size={14} />
                  </Button>
                )}
              </>
            )}
            <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
              <ShieldCheck size={16} className="shrink-0" />
              Les données bancaires sont saisies et conservées chez Stripe.
            </p>
          </CardContent>
        </Card>
      </section>
      {owner && (
        <section aria-labelledby="invoices-title">
          <Card className="rounded-3xl">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle id="invoices-title" className="text-lg">
                Vos factures
              </CardTitle>
              <FileText size={20} className="text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {detailsLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : detailsError ? (
                <DataFetchError message={detailsError} onRetry={retry} />
              ) : details?.invoices.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">Vos 20 dernières factures au maximum</caption>
                    <thead className="border-b border-border text-xs text-muted-foreground">
                      <tr>
                        <th scope="col" className="py-3 pr-4 font-medium">
                          Facture
                        </th>
                        <th scope="col" className="px-3 font-medium">
                          Date
                        </th>
                        <th scope="col" className="px-3 font-medium">
                          Montant
                        </th>
                        <th scope="col" className="px-3 font-medium">
                          Statut
                        </th>
                        <th scope="col">
                          <span className="sr-only">Document</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.invoices.map((invoice, index) => (
                        <tr
                          key={`${invoice.createdAt}:${index}`}
                          className="border-b border-border last:border-0"
                        >
                          <th scope="row" className="py-4 pr-4 font-medium">
                            {invoice.number ?? 'Facture'}
                          </th>
                          <td className="whitespace-nowrap px-3 text-muted-foreground">
                            {date(invoice.createdAt)}
                          </td>
                          <td className="whitespace-nowrap px-3 font-medium">
                            {money(invoice.total, invoice.currency)}
                          </td>
                          <td className="whitespace-nowrap px-3">
                            {INVOICE_STATUS[invoice.status ?? ''] ?? 'À vérifier'}
                          </td>
                          <td className="py-3 text-right">
                            {stripeDocumentUrl(invoice.pdfUrl) ? (
                              <a
                                href={stripeDocumentUrl(invoice.pdfUrl)}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`Télécharger la facture ${invoice.number ?? index + 1}`}
                                className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-2 transition-all duration-200 hover:bg-accent"
                              >
                                <Download size={14} />
                                PDF
                              </a>
                            ) : stripeDocumentUrl(invoice.hostedUrl) ? (
                              <a
                                href={stripeDocumentUrl(invoice.hostedUrl)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline"
                              >
                                Consulter
                              </a>
                            ) : (
                              'Indisponible'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="rounded-2xl bg-muted/40 p-6 text-sm text-muted-foreground">
                  Vos factures apparaîtront ici dès leur émission.
                </p>
              )}
              {details?.hasMoreInvoices && (
                <Button
                  variant="outline"
                  className="mt-4"
                  disabled={Boolean(busy)}
                  onClick={() => void openPortal('manage')}
                >
                  Voir toutes les factures
                  <ArrowUpRight size={14} />
                </Button>
              )}
            </CardContent>
          </Card>
        </section>
      )}
      <section aria-labelledby="plans-title" className="space-y-5">
        {subscribed && current && !current.canUpdatePlan && (
          <p className="rounded-2xl bg-muted/40 p-4 text-sm text-muted-foreground">
            La modification de cette formule nécessite l’intervention de l’équipe Sokar, notamment
            lorsqu’elle regroupe plusieurs établissements. Vous pouvez toujours consulter son
            contrat et gérer son paiement dans Stripe.
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 id="plans-title" className="text-xl font-semibold">
              Une formule pour chaque étape
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">Comparez les offres Sokar.</p>
          </div>
          <div
            role="group"
            aria-label="Cadence de facturation"
            className="inline-flex rounded-full bg-muted p-1"
          >
            {(['monthly', 'annual'] as const).map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={billing === value}
                onClick={() => setBilling(value)}
                className={cn(
                  'rounded-full px-4 py-2 text-sm transition-all duration-200',
                  billing === value
                    ? 'bg-background font-medium shadow-sm'
                    : 'text-muted-foreground',
                )}
              >
                {value === 'monthly' ? 'Mensuel' : `Annuel · −${ANNUAL_DISCOUNT_PERCENT} %`}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {PLANS.map((item, index) => {
            const slug = SLUGS[index];
            return (
              <Card
                key={slug}
                className={cn(
                  'flex min-w-0 flex-col rounded-3xl',
                  slug === plan && 'border-foreground/40',
                )}
              >
                <CardContent className="flex flex-1 flex-col gap-4 p-6">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-lg font-semibold">{item.label}</h3>
                    {slug === plan && (
                      <span className="rounded-full bg-muted px-2 py-1 text-xs">
                        Formule actuelle
                      </span>
                    )}
                  </div>
                  <p className="min-h-10 text-sm text-muted-foreground">{item.description}</p>
                  <div>
                    <p className="text-2xl font-semibold">
                      {DISPLAY_PRICE(item.price, billing === 'annual')} €
                      <span className="text-sm font-normal text-muted-foreground">/mois</span>
                    </p>
                    {billing === 'annual' && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {money(Math.round(billingAmount(item.price, true, true) * 100))} facturés
                        par an
                      </p>
                    )}
                    {item.sitePrice && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        + {DISPLAY_PRICE(item.sitePrice, billing === 'annual')} €/mois par
                        établissement supplémentaire
                      </p>
                    )}
                  </div>
                  <ul className="flex-1 space-y-2 text-sm">
                    {[
                      ...(item.inherits ? [item.inherits] : []),
                      ...item.features
                        .filter((feature) => feature.status === 'disponible')
                        .map((feature) => feature.label),
                    ]
                      .slice(0, 4)
                      .map((feature) => (
                        <li key={feature} className="flex gap-2">
                          <Check size={14} className="mt-1 shrink-0 text-muted-foreground" />
                          {feature}
                        </li>
                      ))}
                  </ul>
                  {slug === 'multi-site' && owner && !subscribed && (
                    <label className="flex items-center justify-between gap-2 text-sm">
                      Établissements
                      <input
                        aria-label="Nombre d’établissements"
                        type="number"
                        min={1}
                        max={100}
                        value={siteCount}
                        onChange={(event) =>
                          setSiteCount(
                            Math.min(100, Math.max(1, Math.trunc(Number(event.target.value)) || 1)),
                          )
                        }
                        className="w-16 rounded-lg border border-border bg-background p-2"
                      />
                    </label>
                  )}
                  {owner && (
                    <Button
                      variant={slug === 'pro' ? 'default' : 'outline'}
                      disabled={Boolean(busy) || detailsLoading || Boolean(detailsError) || !status}
                      onClick={() =>
                        void (subscribed
                          ? openPortal(current?.canUpdatePlan ? 'subscription_update' : 'manage')
                          : checkout(slug))
                      }
                    >
                      {busy === slug ? <Loader2 size={14} className="animate-spin" /> : null}
                      {subscribed
                        ? current?.canUpdatePlan
                          ? 'Comparer dans Stripe'
                          : 'Gérer dans Stripe'
                        : `Choisir ${item.label}`}
                      <ArrowUpRight size={14} />
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {VAT_MENTION}. Le paiement annuel engage douze mois. Les montants exacts, proratas et
          conditions sont présentés dans Stripe avant toute confirmation. Pour un abonnement
          existant, les formules et cadences autorisées dépendent de votre contrat.
        </p>
      </section>
      {owner && details?.hasCustomer && subscribed && (
        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6 text-sm text-muted-foreground">
          <p>Besoin de résilier ? Vérifiez les modalités et la date d’effet avant de confirmer.</p>
          <Button
            variant="ghost"
            disabled={Boolean(busy)}
            onClick={() => void openPortal('subscription_cancel')}
          >
            Gérer la résiliation
            <ArrowUpRight size={14} />
          </Button>
        </footer>
      )}
    </div>
  );
}
