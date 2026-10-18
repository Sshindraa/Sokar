'use client';

import { useEffect, useState } from 'react';
import { Check, Circle, LockKeyhole, ArrowRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useApi } from '@/lib/api';

type Context = {
  enabled: boolean;
  purchaseUrl: string;
  beneficiaryBaseUrl: string;
  giftCardEnabled: boolean;
  emailConfigured: boolean;
  smsConfigured: boolean;
};

function ProviderStatus({ label, configured }: { label: string; configured: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm">{label}</span>
      <Badge variant={configured ? 'secondary' : 'outline'}>
        {configured ? 'Livraison à vérifier' : 'Non configuré'}
      </Badge>
    </div>
  );
}

export function GiftCardTestJourney() {
  const { get, orgId } = useApi();
  const [context, setContext] = useState<Context | null>(null);
  const [code, setCode] = useState('');
  const [stripeReady, setStripeReady] = useState<boolean | null>(null);
  const [stripeError, setStripeError] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [reviewStep, setReviewStep] = useState<number | null>(null);

  useEffect(() => {
    setStripeReady(null);
    setStripeError(false);
    setCompleted(0);
    setReviewStep(null);
    if (!orgId || !context?.enabled) return;
    const controller = new AbortController();
    const refresh = () => {
      void get<{ chargesEnabled: boolean; payoutsEnabled: boolean }>(
        `restaurants/${orgId}/gift-cards/stripe-connect`,
        { signal: controller.signal },
      )
        .then((status) => {
          if (!controller.signal.aborted) {
            setStripeReady(status.chargesEnabled && status.payoutsEnabled);
            setStripeError(false);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setStripeError(true);
        });
    };
    refresh();
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      controller.abort();
      window.removeEventListener('focus', refresh);
      window.clearInterval(timer);
    };
  }, [get, orgId, context?.enabled]);

  useEffect(() => {
    setContext(null);
    setCode('');
    if (!orgId) return;
    const controller = new AbortController();
    void get<Context>(`restaurants/${orgId}/gift-cards/test-context`, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setContext(value);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [get, orgId]);

  if (!context?.enabled) return null;

  return (
    <details className="rounded-xl border border-border bg-card">
      <summary className="cursor-pointer p-4 text-sm font-medium transition-all duration-200 hover:bg-muted/50">
        Mode test · Ouvrir le parcours de vérification
      </summary>
      <Card className="border-0 border-t rounded-none shadow-none">
        <CardContent className="space-y-5 p-5 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Tester les cartes cadeaux</h2>
              <p className="text-sm text-muted-foreground">
                Suivez une carte de l’achat jusqu’au remboursement.
              </p>
            </div>
            <Badge variant="secondary" className="shrink-0">
              Mode test Stripe · aucun débit bancaire réel
            </Badge>
          </div>

          {!context.giftCardEnabled && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
            >
              La vente de cartes cadeaux n’est pas activée sur ce restaurant.
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            Stripe est vérifié automatiquement. Validez les autres étapes après avoir contrôlé leur
            résultat. La progression est conservée uniquement dans cet onglet, jusqu’au
            rechargement.
          </p>
          <ol className="space-y-2" aria-label="Étapes de vérification">
            {[
              'Propriétaire · activer Stripe',
              'Client · acheter une carte',
              'Bénéficiaire · consulter le solde',
              'Restaurant · encaisser l’addition',
              'Contrôler puis rembourser',
            ].map((title, index) => {
              const active = !stripeReady ? 0 : completed + 1;
              const done = index === 0 ? stripeReady === true : index <= completed;
              const blocked =
                !done && (index > active || (index === 1 && !context.giftCardEnabled));
              const current = !done && !blocked && index === active;
              const expanded = current || reviewStep === index;
              const reason =
                index === 1 && !context.giftCardEnabled
                  ? 'Activez la vente dans les réglages de l’établissement.'
                  : !stripeReady
                    ? 'En attente de l’activation de Stripe.'
                    : index === 2
                      ? 'Validez l’achat et la réception du code.'
                      : index === 3
                        ? 'Vérifiez d’abord le solde de la carte.'
                        : 'Validez d’abord l’encaissement de 40 €.';
              const Icon = done ? Check : blocked ? LockKeyhole : current ? ArrowRight : Circle;
              return (
                <li
                  key={title}
                  className={cn(
                    'rounded-xl border bg-background',
                    current ? 'border-primary/40' : 'border-border',
                  )}
                >
                  <button
                    type="button"
                    disabled={blocked || current}
                    aria-expanded={expanded}
                    aria-current={current ? 'step' : undefined}
                    onClick={() => setReviewStep(expanded ? null : index)}
                    className="flex w-full items-center gap-3 p-4 text-left transition-all duration-200 hover:bg-muted/30 disabled:cursor-default"
                  >
                    <span
                      className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                        done
                          ? 'bg-primary/10 text-primary'
                          : current
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground',
                      )}
                    >
                      <Icon size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {index + 1}. {title}
                      </span>
                      {blocked && (
                        <span className="mt-1 block text-xs text-muted-foreground">{reason}</span>
                      )}
                    </span>
                    <Badge variant={current ? 'default' : 'outline'}>
                      {done
                        ? 'Terminé'
                        : blocked
                          ? 'Bloqué'
                          : current
                            ? 'Action requise'
                            : 'Non commencé'}
                    </Badge>
                    {done && (
                      <ChevronDown
                        size={16}
                        className={cn(
                          'shrink-0 transition-all duration-200',
                          expanded && 'rotate-180',
                        )}
                      />
                    )}
                  </button>
                  {expanded && (
                    <div className="space-y-3 border-t border-border p-4 text-sm text-muted-foreground">
                      {index === 0 && (
                        <>
                          <p>
                            {stripeError
                              ? 'Statut Stripe indisponible. Consultez les réglages pour réessayer.'
                              : stripeReady === null
                                ? 'Vérification du compte Stripe…'
                                : stripeReady
                                  ? 'Les encaissements et les versements sont activés.'
                                  : 'Terminez la configuration et attendez l’activation des encaissements et des versements.'}
                          </p>
                          <Button asChild variant={current ? 'default' : 'outline'} size="sm">
                            <a
                              href="#gift-card-stripe-connect"
                              onClick={() =>
                                document
                                  .getElementById('gift-card-stripe-connect')
                                  ?.setAttribute('open', '')
                              }
                            >
                              Voir le statut Stripe
                            </a>
                          </Button>
                        </>
                      )}
                      {index === 1 && (
                        <>
                          <p>
                            Achetez une carte classique de 100 € avec une carte de test Stripe.
                            Attendez la confirmation et le code de la carte.
                          </p>
                          <Button asChild variant={current ? 'default' : 'outline'} size="sm">
                            <a href={context.purchaseUrl} target="_blank" rel="noreferrer">
                              Ouvrir le parcours d’achat
                            </a>
                          </Button>
                        </>
                      )}
                      {index === 2 && (
                        <>
                          <p>
                            Saisissez le code reçu, ouvrez la carte et vérifiez que son solde est de
                            100 €.
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Input
                              aria-label="Code de la carte de test"
                              placeholder="Code de la carte"
                              value={code}
                              onChange={(event) => setCode(event.target.value)}
                              className="min-w-0 flex-1"
                            />
                            {code.trim() ? (
                              <Button asChild variant={current ? 'default' : 'outline'} size="sm">
                                <a
                                  href={`${context.beneficiaryBaseUrl}${encodeURIComponent(code.trim())}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Voir le solde
                                </a>
                              </Button>
                            ) : (
                              <Button size="sm" disabled>
                                Voir le solde
                              </Button>
                            )}
                          </div>
                        </>
                      )}
                      {index === 3 && (
                        <>
                          <p>Utilisez le code en caisse et débitez une addition de 40 €.</p>
                          <p className="rounded-md bg-muted p-3 font-medium text-foreground">
                            Solde attendu : 100 € − 40 € = 60 €
                          </p>
                          <Button asChild variant={current ? 'default' : 'outline'} size="sm">
                            <a href="#gift-card-cashier">Aller à l’encaissement</a>
                          </Button>
                        </>
                      )}
                      {index === 4 && (
                        <>
                          <p>
                            Vérifiez le débit dans l’historique, puis annulez la carte pour
                            rembourser les 60 € restants. Attendez le statut final du remboursement.
                          </p>
                          <Button asChild variant={current ? 'default' : 'outline'} size="sm">
                            <a href="#gift-card-cashier">Consulter la carte en caisse</a>
                          </Button>
                        </>
                      )}
                      {current && index > 0 && (
                        <div className="border-t border-border pt-3">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={index === 2 && !code.trim()}
                            onClick={() => {
                              setCompleted(index);
                              setReviewStep(null);
                            }}
                          >
                            {index === 1
                              ? 'Achat confirmé et code reçu'
                              : index === 2
                                ? 'Solde de 100 € vérifié'
                                : index === 3
                                  ? 'Débit de 40 € et solde de 60 € vérifiés'
                                  : 'Remboursement confirmé'}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {completed === 4 && stripeReady && (
            <p
              role="status"
              className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm"
            >
              ✓ Parcours validé par vos contrôles. Vérifiez également les notifications ci-dessous.
            </p>
          )}

          <section className="space-y-2 rounded-lg border border-border bg-muted/30 p-4">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
              <h3 className="text-sm font-medium">Notifications · contrôle séparé</h3>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                <ProviderStatus label="E-mail" configured={context.emailConfigured} />
                <ProviderStatus label="SMS" configured={context.smsConfigured} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Stripe test ne simule pas l’envoi. Un fournisseur configuré ne garantit pas la
              réception : vérifiez aussi le détail de livraison de la carte.
            </p>
          </section>
        </CardContent>
      </Card>
    </details>
  );
}
