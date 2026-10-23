'use client';

import {
  ANNUAL_DISCOUNT_PERCENT,
  TRIAL_DAYS,
  VAT_MENTION,
  pricingTotalCents,
  formatMonthlyEquivalent,
} from '@sokar/shared';
import { useState } from 'react';
import Link from 'next/link';
import { PLANS, DISPLAY_PRICE, type PlanFeatureLine } from '@/app/constants';
import { getPlanSignupHref, getPlanDemoHref, type PublicPlan } from '@/app/pricing-links';
import PlanComparison from '@/app/PlanComparison';
import { ArrowUpRight, Check } from 'lucide-react';
import { cn, triggerHaptic } from '@/lib/utils';

/** Espace insécable entre le montant et l'unité (« 89 €/site »), comme en typographie française. */
const euros = (amount: string | number, unit: 'mois' | 'site') => `${amount}\u00a0€/${unit}`;

function FeatureItem({ feature }: { feature: PlanFeatureLine }) {
  const planned = feature.status === 'prévu';
  return (
    <li
      className={cn('flex items-start gap-3 text-sm', planned ? 'text-white/45' : 'text-white/75')}
    >
      <Check
        size={15}
        aria-hidden="true"
        strokeWidth={2.5}
        className={cn('mt-0.5 shrink-0', planned ? 'text-white/25' : 'text-pricing-accent')}
      />
      <span>
        {feature.label}
        {planned && (
          <span className="ml-2 inline-block rounded-full border border-white/15 px-1.5 py-px align-middle text-[10px] font-semibold text-white/50">
            Bientôt
          </span>
        )}
      </span>
    </li>
  );
}

/**
 * Interrupteur Mensuel/Annuel et cartes des formules, partagés par la section
 * « Tarifs » de l'accueil et la page /pricing : une seule mise en page, une
 * seule source de prix (`PLANS`).
 */
export default function PricingPlans({
  haptic = false,
  showComparison = false,
}: {
  haptic?: boolean;
  showComparison?: boolean;
}) {
  const [yearly, setYearly] = useState(true);
  const [siteCount, setSiteCount] = useState(2);

  const toggleBilling = () => {
    if (haptic) triggerHaptic(15);
    setYearly((v) => !v);
  };

  return (
    <>
      {/* Toggle Billing — au-dessus des cartes, là où les prix changent */}
      <div className="mb-10 flex items-center gap-3">
        <span
          className={cn(
            'text-sm font-medium transition-all duration-200',
            yearly ? 'text-white/45' : 'text-white',
          )}
        >
          Mensuel
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={yearly}
          aria-label="Facturation annuelle"
          onClick={toggleBilling}
          className={cn(
            'relative h-6 w-11 rounded-full border transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pricing-accent/50',
            yearly
              ? 'border-pricing-accent/50 bg-pricing-accent/30'
              : 'border-white/20 bg-white/10',
          )}
        >
          <span
            className={cn(
              'pointer-events-none absolute left-[3px] top-[3px] flex h-[18px] w-[18px] items-center justify-center rounded-full shadow-sm transition-all duration-200',
              yearly ? 'translate-x-5 bg-white' : 'translate-x-0 bg-black',
            )}
          >
            {yearly && <Check size={11} className="text-pricing-accent" strokeWidth={3.5} />}
          </span>
        </button>
        <span
          className={cn(
            'text-sm font-medium transition-all duration-200',
            yearly ? 'text-white' : 'text-white/45',
          )}
        >
          Annuel
          <span className="ml-1.5 px-2 py-0.5 text-[10px] bg-pricing-accent/20 text-pricing-accent border border-pricing-accent/30 rounded-full font-bold">
            -{ANNUAL_DISCOUNT_PERCENT}%
          </span>
        </span>
      </div>

      <p className="mb-10 text-center text-sm text-white/60">
        {TRIAL_DAYS} jours offerts, sans carte bancaire · {VAT_MENTION}
      </p>
      {/*
      Cards Grid. En md+, chaque carte est une sous-grille de 4 lignes
      (en-tête, prix, bouton, avantages) : les lignes sont
      partagées entre les cartes, donc les boutons et les listes restent
      alignés quelle que soit la longueur des textes.
    */}
      <div className="grid w-full grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-y-0">
        {PLANS.map((plan) => {
          const yearlyPrice = DISPLAY_PRICE(plan.price, yearly);
          const yearlySitePrice = plan.sitePrice ? DISPLAY_PRICE(plan.sitePrice, yearly) : null;

          return (
            <div
              key={plan.label}
              className={cn(
                'group relative flex flex-col rounded-[2rem] border p-7 transition-all duration-300 md:p-8 lg:row-span-4 lg:grid lg:grid-rows-subgrid',
                plan.featured
                  ? 'border-pricing-accent/25 bg-white/[0.08] shadow-[0_0_40px_hsl(var(--pricing-accent)_/_0.15)] hover:shadow-[0_0_60px_hsl(var(--pricing-accent)_/_0.25)]'
                  : 'border-white/15 bg-white/[0.06] hover:border-white/25 hover:bg-white/[0.10]',
              )}
            >
              {/* Corner glow for featured */}
              {plan.featured && (
                <div className="pointer-events-none absolute -inset-px rounded-[2rem] opacity-0 group-hover:opacity-100 transition-opacity duration-500">
                  <div
                    className="absolute inset-0 rounded-[2rem]"
                    style={{
                      background:
                        'linear-gradient(135deg, hsl(var(--pricing-accent) / 0.15), transparent 40%, transparent 60%, hsl(var(--pricing-accent-glow) / 0.1))',
                    }}
                  />
                </div>
              )}

              {/* 1. En-tête */}
              <div className="relative z-10 mb-6">
                <p className="text-sm font-semibold uppercase tracking-[0.14em] text-white/55">
                  {plan.label}
                </p>
                <p className="mt-3 text-xl font-semibold leading-snug text-white">{plan.promise}</p>
              </div>

              {/* 2. Prix */}
              <div className="relative z-10 mb-6">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-5xl font-extrabold leading-none tracking-tight text-white">
                    {yearlyPrice}
                  </span>
                  <span className="text-sm font-semibold text-white/60">€/mois</span>
                </div>
                <p className="mt-2 text-xs text-white/50">
                  {yearly ? 'Engagement 12 mois' : 'Sans engagement'}
                </p>
              </div>

              {/* 3. CTA */}
              <Link
                href={(plan.demoFirst ? getPlanDemoHref : getPlanSignupHref)(
                  plan.label as PublicPlan,
                  yearly,
                  siteCount,
                )}
                aria-label={`${plan.demoFirst ? 'Découvrir' : 'Choisir'} ${plan.label}`}
                className={cn(
                  'relative z-10 inline-flex h-fit w-full items-center justify-center gap-2 self-start rounded-full py-3 text-center text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pricing-accent/60 active:scale-[0.98]',
                  plan.featured
                    ? 'bg-white text-black hover:bg-white/90 hover:shadow-[0_0_30px_rgba(255,255,255,0.2)]'
                    : 'border border-white/20 text-white hover:border-white/30 hover:bg-white/10',
                )}
              >
                {plan.demoFirst ? 'Découvrir' : 'Choisir'} {plan.label}
                <ArrowUpRight size={14} />
              </Link>

              {/* 4. Contenu : formule précédente, puis ce que la formule ajoute ; le non livré en dernier */}
              <div className="relative z-10 mt-7 border-t border-white/10 pt-6">
                {plan.sitePrice && yearlySitePrice && (
                  <div className="mb-6 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white/70">
                    <p>+ {euros(yearlySitePrice, 'site')} par adresse supplémentaire</p>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <label htmlFor="pricing-sites" className="text-white/60">
                        Nombre d’établissements
                      </label>
                      <select
                        id="pricing-sites"
                        value={siteCount}
                        onChange={(event) => setSiteCount(Number(event.target.value))}
                        className="rounded-lg border border-white/20 bg-black px-2 py-1 text-white transition-all duration-200"
                      >
                        {Array.from({ length: 100 }, (_, i) => i + 1).map((count) => (
                          <option key={count} value={count}>
                            {count}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className="mt-2 font-semibold text-white">
                      Total pour {siteCount} {siteCount === 1 ? 'établissement' : 'établissements'}{' '}
                      :{' '}
                      {formatMonthlyEquivalent(
                        pricingTotalCents('multi-site', yearly, siteCount),
                        yearly,
                      )}{' '}
                      €/mois
                    </p>
                  </div>
                )}
                {plan.inherits && (
                  <p className="mb-4 text-sm font-semibold text-white">{plan.inherits}</p>
                )}
                <ul className="space-y-3">
                  {[...plan.features]
                    .sort((a, b) => Number(a.status === 'prévu') - Number(b.status === 'prévu'))
                    .map((feature) => (
                      <FeatureItem key={feature.label} feature={feature} />
                    ))}
                </ul>
                {plan.note && <p className="mt-5 text-xs text-white/45">{plan.note}</p>}
              </div>
            </div>
          );
        })}
      </div>

      {showComparison && (
        <div className="mt-20 w-full">
          <PlanComparison />
        </div>
      )}
    </>
  );
}
