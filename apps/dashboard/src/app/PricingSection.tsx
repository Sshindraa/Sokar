'use client';

import { useState } from 'react';
import { PLANS, DISPLAY_PRICE } from '@/app/constants';

export default function PricingSection() {
  const [yearly, setYearly] = useState(true);

  return (
    <section id="tarifs" className="pricing-section-wrapper w-full py-16 scroll-mt-24 relative">
      <div className="flex flex-col items-center">
        {/* Mini Hero */}
        <div className="text-center mb-6 sm:mb-6 relative px-2">
          <h2 className="pricing-hero-title text-center leading-none">Tarifs</h2>
        </div>

        {/* Toggle Billing */}
        <div className="flex items-center justify-center gap-3 mb-10 relative z-10">
          <span className={`text-sm font-medium transition-colors duration-200 ${!yearly ? 'text-foreground' : 'text-muted-foreground'}`}>Mensuel</span>
          <button
            type="button"
            role="switch"
            aria-checked={yearly}
            onClick={() => setYearly((v) => !v)}
            className="relative h-6 w-11 rounded-full border border-border/40 bg-muted transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span
              className={`pointer-events-none absolute left-[3px] top-[3px] h-[18px] w-[18px] rounded-full bg-primary shadow-sm transition-transform duration-200 ${yearly ? 'translate-x-5' : 'translate-x-0'}`}
            />
          </button>
          <span className={`text-sm font-medium transition-colors duration-200 flex items-center gap-1.5 ${yearly ? 'text-foreground' : 'text-muted-foreground'}`}>
            Annuel
            <span className="px-2 py-0.5 text-xs bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded-full font-bold">
              -20%
            </span>
          </span>
        </div>

        {/* Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-6xl px-4">
          {PLANS.map((plan) => (
            <div
              key={plan.label}
              className={`pricing-card${plan.featured ? ' featured' : ''}`}
            >
              <div>
                <div className="flex justify-between items-start mb-3">
                  <p className="relative z-[1] text-lg font-semibold tracking-wide uppercase text-foreground/90">
                    {plan.label}
                  </p>
                  {plan.featured && (
                    <span className="px-2.5 py-0.5 text-[10px] font-extrabold tracking-wider uppercase bg-[hsl(var(--pricing-accent))] text-black rounded-full shadow-[0_0_12px_hsl(var(--pricing-accent)/0.3)] animate-pulse">
                      Recommandé
                    </span>
                  )}
                </div>

                <div className="relative z-[1] flex items-baseline gap-1.5 py-2 border-b border-border/10 mb-4">
                  <span className="text-[clamp(2.2rem,4vw,3.2rem)] font-extrabold tracking-tight leading-none bg-gradient-to-br from-foreground via-foreground to-muted-foreground bg-clip-text text-transparent">
                    {DISPLAY_PRICE(plan.price, yearly)}
                  </span>
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-foreground/80">€</span>
                    <span className="text-xs text-muted-foreground">/mois</span>
                  </div>
                  {plan.label === 'Multi-site' && (
                    <span className="text-xs text-muted-foreground ml-2 font-medium bg-foreground/5 px-2 py-0.5 rounded-full border border-border/40 self-center">
                      + 99€/site
                    </span>
                  )}
                </div>

                <p className="relative z-[1] text-sm text-foreground/70 leading-relaxed min-h-[40px]">
                  {plan.label === 'Essential' && 'Pour automatiser vos premiers appels et réservations.'}
                  {plan.label === 'Pro' && 'Pour les restaurants qui veulent maximiser chaque service.'}
                  {plan.label === 'Multi-site' && 'Pour piloter plusieurs établissements avec une seule équipe.'}
                </p>
              </div>

              <ul className="pricing-features">
                {plan.features.map((feat) => (
                  <li key={feat} className="pricing-feature-item">
                    <span className="pricing-check-icon">
                      <svg viewBox="0 0 12 12">
                        <polyline points="2,6 5,9 10,3" />
                      </svg>
                    </span>
                    {feat}
                  </li>
                ))}
              </ul>

              <a
                href="#waitlist"
                className={`pricing-cta${plan.featured ? ' featured-cta' : ''}`}
              >
                Rejoindre la Waitlist
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
