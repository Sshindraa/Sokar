'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Check, Loader2, Lock } from 'lucide-react';
import { TRIAL_DAYS, ANNUAL_DISCOUNT_PERCENT } from '@sokar/shared';
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
  'Multi-restaurant': 'multi-site',
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
 * la formule choisie sur la page Tarifs (gardée pendant l'inscription). Un seul bouton démarre
 * l'essai gratuit sur cette formule, sans carte et sans passer par Stripe : la carte s'ajoute plus
 * tard depuis le dashboard. Aucun compte n'utilise donc Sokar hors essai ou abonnement.
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
  const [startingTrial, setStartingTrial] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Le choix de la page Tarifs (adresse, sinon mémoire du navigateur) préremplit l'écran.
  useEffect(() => {
    const choice = parsePlanChoice(window.location.search) ?? readStoredPlanChoice();
    if (choice) {
      setPlan(choice.plan);
      setBilling(choice.billing);
      if (choice.siteCount) setSiteCount(choice.siteCount);
    }
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

  async function handleStartTrial() {
    if (startingTrial) return;
    setStartingTrial(true);
    setError(null);
    try {
      await post('billing/trial', {
        plan,
        billing,
        ...(plan === 'multi-site' ? { siteCount } : {}),
      });
    } catch (reason: unknown) {
      const status = (reason as { status?: number }).status;
      // 409 : un abonnement ou un essai existe déjà. Rien à démarrer, on continue.
      if (status !== 409) {
        setError(
          reason instanceof Error && reason.message
            ? reason.message
            : 'Impossible de démarrer l’essai. Réessayez dans un instant.',
        );
        setStartingTrial(false);
        return;
      }
    }
    clearStoredPlanChoice();
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
            {cadence === 'monthly' ? 'Mensuel' : `Annuel · -${ANNUAL_DISCOUNT_PERCENT} %`}
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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button
          type="button"
          onClick={() => void handleStartTrial()}
          disabled={startingTrial}
          className="h-11 rounded-full px-6 transition-all duration-200"
        >
          {startingTrial ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null}
          {startingTrial ? 'Démarrage de l’essai…' : 'Démarrer mon essai gratuit'}
          {!startingTrial && <ArrowRight size={15} aria-hidden="true" />}
        </Button>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock size={12} aria-hidden="true" />
          Sans carte bancaire. Formule modifiable à tout moment pendant l’essai.
        </p>
      </div>
    </div>
  );
}
