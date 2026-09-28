'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PLANS, DISPLAY_PRICE } from '@/app/constants';
import { getPlanSignupHref, type PublicPlan } from '@/app/pricing-links';
import { ArrowUpRight, Check } from 'lucide-react';
import { cn, triggerHaptic } from '@/lib/utils';

/** Espace insécable entre le montant et l'unité (« 159 €/mois »), comme en typographie française. */
const euros = (amount: string | number, unit: 'mois' | 'site') => `${amount}\u00a0€/${unit}`;

/**
 * Interrupteur Mensuel/Annuel et cartes des formules, partagés par la section
 * « Tarifs » de l'accueil et la page /pricing : une seule mise en page, une
 * seule source de prix (`PLANS`).
 */
export default function PricingPlans({ haptic = false }: { haptic?: boolean }) {
  const [yearly, setYearly] = useState(true);

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
            -20%
          </span>
        </span>
      </div>

      {/*
      Cards Grid. En md+, chaque carte est une sous-grille de 5 lignes
      (en-tête, prix, description, bouton, avantages) : les lignes sont
      partagées entre les cartes, donc les boutons et les listes restent
      alignés quelle que soit la longueur des textes.
    */}
      <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-3 md:gap-y-0">
        {PLANS.map((plan) => {
          const yearlyPrice = DISPLAY_PRICE(plan.price, yearly);
          const yearlySitePrice = plan.sitePrice ? DISPLAY_PRICE(plan.sitePrice, yearly) : null;

          return (
            <div
              key={plan.label}
              className={cn(
                'group relative flex flex-col rounded-[2rem] border p-7 transition-all duration-300 md:row-span-5 md:grid md:grid-rows-subgrid',
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

              {/* 1. Header */}
              <div className="relative z-10 mb-6 flex min-h-7 items-center justify-between">
                <p className="text-sm font-semibold tracking-wide text-white/80">{plan.label}</p>
                {plan.featured && (
                  <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-pricing-accent border border-pricing-accent/30 rounded-full bg-pricing-accent/10">
                    Recommandé
                  </span>
                )}
              </div>

              {/* 2. Price */}
              <div className="relative z-10 mb-3">
                {yearly && (
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-pricing-accent/30 bg-pricing-accent/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-pricing-accent">
                      -20% annuel
                    </span>
                    <span className="text-xs font-semibold text-white/45 line-through">
                      {euros(plan.price, 'mois')}
                      {plan.sitePrice ? ` + ${euros(plan.sitePrice, 'site')}` : ''}
                    </span>
                  </div>
                )}
                <div className="flex flex-wrap items-baseline gap-x-1 gap-y-1">
                  <span className="text-[2.5rem] font-extrabold tracking-tight text-white leading-none">
                    {yearlyPrice}
                  </span>
                  <span className="text-sm font-semibold text-white/60">€/mois</span>
                  {yearlySitePrice && (
                    <span className="text-sm font-semibold text-white/60">
                      + {euros(yearlySitePrice, 'site')}
                    </span>
                  )}
                </div>
              </div>

              {/* 3. Description */}
              <p className="relative z-10 mb-8 text-sm leading-relaxed text-white/50">
                {plan.description}
              </p>

              {/* 4. CTA */}
              <Link
                href={getPlanSignupHref(plan.label as PublicPlan, yearly)}
                aria-label={`Souscrire ${plan.label}`}
                className={cn(
                  'relative z-10 inline-flex h-fit w-full items-center justify-center gap-2 self-start rounded-full py-3 text-sm font-semibold text-center transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pricing-accent/60 active:scale-[0.98]',
                  plan.featured
                    ? 'bg-white text-black hover:bg-white/90 hover:shadow-[0_0_30px_rgba(255,255,255,0.2)]'
                    : 'border border-white/20 text-white hover:bg-white/10 hover:border-white/30',
                )}
              >
                Souscrire
                <ArrowUpRight size={14} />
              </Link>

              {/* 5. Features */}
              <ul className="relative z-10 mt-8 flex-1 space-y-4">
                {plan.features.map((feat) => (
                  <li key={feat} className="flex items-start gap-3 text-sm text-white/70">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-pricing-accent/40 bg-pricing-accent/10">
                      <Check size={12} className="text-pricing-accent" strokeWidth={3} />
                    </span>
                    {feat}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </>
  );
}
