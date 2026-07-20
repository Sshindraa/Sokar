'use client';

import { useState } from 'react';
import { PLANS, DISPLAY_PRICE } from '@/app/constants';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function PricingSection() {
  const [yearly, setYearly] = useState(true);

  return (
    <section
      id="tarifs"
      className="relative flex min-h-screen w-full scroll-mt-24 items-center overflow-hidden px-4 py-20 sm:px-6 lg:px-10"
    >
      {/* Ambient glow behind cards */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/3 h-[600px] w-[900px] rounded-full"
        style={{
          background: 'radial-gradient(circle, hsl(var(--pricing-accent) / 0.18), transparent 70%)',
          filter: 'blur(80px)',
        }}
      />

      <div className="relative z-10 mx-auto flex w-full flex-col items-center">
        {/* Mini Hero */}
        <div className="text-center mb-12 relative px-2">
          <h2 className="pricing-hero-title text-center leading-none">Tarifs</h2>
        </div>

        {/* Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full">
          {PLANS.map((plan) => {
            const monthlyPrice = parseInt(plan.price, 10);
            const yearlyPrice = DISPLAY_PRICE(plan.price, yearly);
            const sitePrice = plan.label === 'Multi-site' ? '99' : null;
            const yearlySitePrice = sitePrice ? DISPLAY_PRICE(sitePrice, yearly) : null;
            const monthlySavings = monthlyPrice - parseInt(yearlyPrice, 10);
            const siteSavings =
              sitePrice && yearlySitePrice
                ? parseInt(sitePrice, 10) - parseInt(yearlySitePrice, 10)
                : null;

            return (
              <div
                key={plan.label}
                className={cn(
                  'group relative flex flex-col rounded-[2rem] border p-7 transition-all duration-300',
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

                {/* Header */}
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-6">
                    <p className="text-sm font-semibold tracking-wide text-white/80">
                      {plan.label}
                    </p>
                    {plan.featured && (
                      <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-pricing-accent border border-pricing-accent/30 rounded-full bg-pricing-accent/10">
                        Recommandé
                      </span>
                    )}
                  </div>

                  {/* Price */}
                  <div className="mb-3">
                    {yearly && (
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-pricing-accent/30 bg-pricing-accent/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-pricing-accent">
                          -20% annuel
                        </span>
                        <span className="text-xs font-semibold text-white/45 line-through">
                          {plan.price} {plan.period}
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
                          + {yearlySitePrice}€/site
                        </span>
                      )}
                    </div>
                    {yearly && (
                      <p className="mt-2 text-xs font-medium text-pricing-accent/80">
                        Économisez {monthlySavings}€/mois
                        {siteSavings ? ` + ${siteSavings}€/site` : ''} avec la facturation annuelle.
                      </p>
                    )}
                  </div>

                  {/* Description */}
                  <p className="text-sm text-white/50 leading-relaxed mb-8">
                    {plan.label === 'Essential' &&
                      'Pour automatiser vos premiers appels et réservations.'}
                    {plan.label === 'Pro' &&
                      'Pour les restaurants qui veulent maximiser chaque service.'}
                    {plan.label === 'Multi-site' &&
                      'Pour piloter plusieurs établissements avec une seule équipe.'}
                  </p>
                </div>

                {/* Features */}
                <ul className="relative z-10 flex-1 space-y-4 mb-8">
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

        {/* Toggle Billing — bottom left */}
        <div className="flex items-center gap-3 mt-10 self-start">
          <button
            type="button"
            role="switch"
            aria-checked={yearly}
            onClick={() => setYearly((v) => !v)}
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
          <span className="text-sm font-medium text-white/60">
            Annuel
            <span className="ml-1.5 px-2 py-0.5 text-[10px] bg-pricing-accent/20 text-pricing-accent border border-pricing-accent/30 rounded-full font-bold">
              -20%
            </span>
          </span>
        </div>
      </div>
    </section>
  );
}
