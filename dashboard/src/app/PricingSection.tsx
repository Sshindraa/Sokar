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
          <p className="pricing-hero-kicker mt-1 sm:absolute sm:left-1/2 sm:-translate-x-1/2 sm:top-[clamp(1rem,2vw,1.5rem)]">Sokar AI</p>
        </div>

        {/* Toggle Billing */}
        <div className="flex items-center justify-center gap-3 mb-10 relative z-10">
          <span className={`pricing-toggle-text ${!yearly ? '!text-white' : ''}`}>Mensuel</span>
          <label className="pricing-toggle-label" aria-label="Toggle yearly billing">
            <div
              className={`pricing-toggle-track${yearly ? ' active' : ''}`}
              role="switch"
              aria-checked={yearly}
              tabIndex={0}
              onClick={() => setYearly(!yearly)}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  setYearly(!yearly);
                }
              }}
            />
          </label>
          <span className={`pricing-toggle-text ${yearly ? '!text-white' : ''} flex items-center gap-1.5`}>
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
                <div className="flex justify-between items-center">
                  <p className="pricing-card-label">{plan.label}</p>
                  {plan.featured && (
                    <span className="px-2 py-0.5 text-xs font-bold tracking-wide uppercase bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 rounded-full">
                      Recommandé
                    </span>
                  )}
                </div>
                <p className="pricing-card-price">
                  {DISPLAY_PRICE(plan.price, yearly)}
                  <span className="period"> {plan.period === '€' ? '€/mois' : plan.period}</span>
                </p>
                <p className="pricing-card-desc">
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
