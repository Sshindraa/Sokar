'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Check, Loader2, Lock } from 'lucide-react';
import { TRIAL_DAYS } from '@sokar/shared';
import { TrialStartTimeline } from '@/features/billing/trial';
import { PLANS, DISPLAY_PRICE } from '@/app/constants';
import { Button } from '@/components/ui/button';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  clearStoredPlanChoice,
  dismissPlanPrompt,
  parsePlanChoice,
  readStoredPlanChoice,
  type BillingCadence,
  type PlanSlug,
} from './pending-plan';

const SLUG_BY_LABEL: Record<(typeof PLANS)[number]['label'], PlanSlug> = {
  Essential: 'essential',
  Pro: 'pro',
  'Multi-site': 'multi-site',
};

/**
 * Trois points forts par carte : la formule précédente, puis les fonctionnalités disponibles. Une fonctionnalité
 * prévue n'est jamais présentée comme incluse dans un parcours d'achat.
 */
function planHighlights(item: (typeof PLANS)[number]): string[] {
  const available = item.features
    .filter((feature) => feature.status === 'disponible')
    .map((feature) => feature.label);
  return [...(item.inherits ? [item.inherits] : []), ...available].slice(0, 3);
}

const ACTIVE_STATUSES = ['active', 'trialing', 'past_due'];
const DEFAULT_PLAN: PlanSlug = 'pro';

type BillingStatus = { plan?: string | null; subscriptionStatus?: string | null };

/** Espace insécable entre le montant et l'unité, comme sur la page Tarifs. */
const euros = (amount: string | number, unit: string) => `${amount} €/${unit}`;

/**
 * Écran « Choisissez votre formule », proposé juste après la validation de l'appel test. Il reprend
 * la formule choisie sur la page Tarifs (gardée pendant l'inscription), mène à Stripe, qui ramène
 * ici. Le paiement n'est pas imposé : « Plus tard » mène à l'écran des canaux.
 */
export function OnboardingPlan({
  restaurantId,
  onContinue,
}: {
  restaurantId: string;
  onContinue: () => void;
}) {
  const { get, post } = useApi();
  const [plan, setPlan] = useState<PlanSlug>(DEFAULT_PLAN);
  const [billing, setBilling] = useState<BillingCadence>('annual');
  const [siteCount, setSiteCount] = useState(2);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [cancelled, setCancelled] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Le choix de la page Tarifs (adresse, sinon mémoire du navigateur) préremplit l'écran.
  useEffect(() => {
    const choice = parsePlanChoice(window.location.search) ?? readStoredPlanChoice();
    if (choice) {
      setPlan(choice.plan);
      setBilling(choice.billing);
      if (choice.siteCount) setSiteCount(choice.siteCount);
    }
    setCancelled(new URLSearchParams(window.location.search).get('billing') === 'cancelled');
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const result = await get<BillingStatus>('billing/status');
        if (alive) setStatus(result);
      } catch {
        // Statut illisible : on propose quand même le choix, Stripe refusera un doublon.
      } finally {
        if (alive) setStatusLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [get]);

  const subscribed = ACTIVE_STATUSES.includes(status?.subscriptionStatus ?? '');
  const yearly = billing === 'annual';

  async function handlePay() {
    if (paying) return;
    setPaying(true);
    setError(null);
    try {
      const session = await post<{ url?: string }>('billing/checkout-session', {
        plan,
        billing,
        returnTo: 'onboarding',
        ...(plan === 'multi-site' ? { siteCount } : {}),
      });
      if (!session.url) throw new Error('La page de paiement est indisponible.');
      clearStoredPlanChoice();
      window.location.assign(session.url);
    } catch (reason: unknown) {
      setError(
        reason instanceof Error && reason.message
          ? reason.message
          : 'Impossible de préparer le paiement. Réessayez ou continuez, vous pourrez payer plus tard.',
      );
      setPaying(false);
    }
  }

  function handleLater() {
    dismissPlanPrompt(restaurantId);
    onContinue();
  }

  if (statusLoading) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={15} className="animate-spin" aria-hidden="true" />
        Vérification de votre formule…
      </p>
    );
  }

  if (subscribed) {
    return (
      <div className="flex w-full min-w-0 flex-col gap-5">
        <section
          aria-label="Votre formule"
          className="flex flex-wrap items-center gap-3 rounded-full bg-muted/50 px-5 py-3 text-sm"
        >
          <span className="flex size-6 items-center justify-center rounded-full bg-foreground text-background">
            <Check size={12} aria-hidden="true" />
          </span>
          <span className="font-medium">Votre formule est active.</span>
        </section>
        <div>
          <Button
            type="button"
            onClick={onContinue}
            className="h-11 rounded-full transition-all duration-200"
          >
            Continuer <ArrowRight size={15} aria-hidden="true" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      {cancelled && (
        <p
          role="status"
          className="rounded-2xl bg-muted/50 px-5 py-3 text-sm text-muted-foreground"
        >
          Le paiement a été annulé : rien n’a été débité. Vous pouvez réessayer ou continuer.
        </p>
      )}

      <div
        role="group"
        aria-label="Cadence de facturation"
        className="inline-flex w-fit rounded-full bg-muted/50 p-1 text-sm"
      >
        {(['monthly', 'annual'] as const).map((cadence) => (
          <button
            key={cadence}
            type="button"
            aria-pressed={billing === cadence}
            onClick={() => setBilling(cadence)}
            className={cn(
              'rounded-full px-4 py-1.5 font-medium transition-all duration-200',
              billing === cadence ? 'bg-foreground text-background' : 'text-foreground/70',
            )}
          >
            {cadence === 'monthly' ? 'Mensuel' : 'Annuel · -20 %'}
          </button>
        ))}
      </div>

      <div role="radiogroup" aria-label="Formule" className="grid min-w-0 gap-4 lg:grid-cols-3">
        {PLANS.map((item) => {
          const slug = SLUG_BY_LABEL[item.label];
          const selected = plan === slug;
          return (
            <button
              key={slug}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setPlan(slug)}
              className={cn(
                'flex min-w-0 flex-col gap-4 rounded-[1.75rem] p-6 text-left transition-all duration-200',
                selected
                  ? 'bg-background ring-2 ring-foreground'
                  : 'bg-muted/50 hover:bg-foreground/5',
              )}
            >
              <span className="flex items-center justify-between gap-3">
                <span className="text-lg font-semibold tracking-tight">{item.label}</span>
                {selected && (
                  <span className="flex size-6 items-center justify-center rounded-full bg-foreground text-background">
                    <Check size={12} aria-hidden="true" />
                  </span>
                )}
              </span>
              <span className="text-sm text-muted-foreground">{item.description}</span>
              <span className="text-2xl font-semibold tracking-tight">
                {euros(DISPLAY_PRICE(item.price, yearly), 'mois')}
                {item.sitePrice && (
                  <span className="block text-sm font-normal text-muted-foreground">
                    + {euros(DISPLAY_PRICE(item.sitePrice, yearly), 'site supplémentaire')}
                  </span>
                )}
              </span>
              <ul className="space-y-2 text-sm text-foreground/80">
                {planHighlights(item).map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check
                      size={14}
                      aria-hidden="true"
                      className="mt-1 shrink-0 text-foreground/50"
                    />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      {plan === 'multi-site' && (
        <label className="flex w-fit items-center gap-3 text-sm">
          <span className="font-medium">Nombre d’établissements</span>
          <input
            type="number"
            inputMode="numeric"
            min={2}
            max={100}
            value={siteCount}
            onChange={(event) => {
              const value = Math.trunc(Number(event.target.value));
              if (Number.isFinite(value)) setSiteCount(Math.min(100, Math.max(2, value)));
            }}
            className="h-10 w-20 rounded-full border border-border bg-background px-4 text-center transition-all duration-200"
          />
        </label>
      )}

      <div className="max-w-xl rounded-2xl border border-border bg-card p-5">
        <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Comment se passe l’essai
        </p>
        <TrialStartTimeline totalDays={TRIAL_DAYS} />
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={() => void handlePay()}
          disabled={paying}
          className="h-11 rounded-full transition-all duration-200"
        >
          {paying ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null}
          {paying ? 'Redirection…' : `Commencer l’essai gratuit de ${TRIAL_DAYS} jours`}
          {!paying && <ArrowRight size={15} aria-hidden="true" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={handleLater}
          disabled={paying}
          className="h-11 rounded-full text-muted-foreground transition-all duration-200"
        >
          Plus tard
        </Button>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock size={12} aria-hidden="true" />
          Paiement sécurisé par Stripe. Formule modifiable à tout moment dans vos réglages.
        </p>
      </div>
    </div>
  );
}
