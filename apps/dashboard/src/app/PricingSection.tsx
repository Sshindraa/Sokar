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
      className="relative w-full py-20 scroll-mt-24 overflow-hidden"
    >
      {/* Ambient glow behind cards */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/3 h-[600px] w-[900px] rounded-full"
        style={{
          background: 'radial-gradient(circle, hsl(195 100% 55% / 0.18), transparent 70%)',
          filter: 'blur(80px)',
        }}
      />

      <div className="relative z-10 flex flex-col items-center max-w-6xl mx-auto px-4">
        {/* Mini Hero */}
        <div className="text-center mb-12 relative px-2">
          <h2 className="pricing-hero-title text-center leading-none">Tarifs</h2>
        </div>

        {/* Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full">
          {PLANS.map((plan) => (
            <div
              key={plan.label}
              className={cn(
                'group relative flex flex-col rounded-[2rem] border p-7 backdrop-blur-xl transition-all duration-300',
                plan.featured
                  ? 'border-white/25 bg-white/[0.08] shadow-[0_0_40px_rgba(6,182,212,0.15)] hover:shadow-[0_0_60px_rgba(6,182,212,0.25)]'
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
                        'linear-gradient(135deg, hsl(195 100% 55% / 0.15), transparent 40%, transparent 60%, hsl(195 100% 70% / 0.1))',
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
                    <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-cyan-300 border border-cyan-400/30 rounded-full bg-cyan-400/10">
                      Recommandé
                    </span>
                  )}
                </div>

                {/* Price */}
                <div className="flex items-baseline gap-1 mb-3">
                  <span className="text-[2.5rem] font-extrabold tracking-tight text-white leading-none">
                    {DISPLAY_PRICE(plan.price, yearly)}
                  </span>
                  <span className="text-sm font-semibold text-white/60">
                    {plan.period}
                  </span>
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
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-cyan-400/40 bg-cyan-400/10">
                      <Check size={12} className="text-cyan-300" strokeWidth={3} />
                    </span>
                    {feat}
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <a
                href="#waitlist"
                className={cn(
                  'relative z-10 w-full rounded-full py-3 text-sm font-semibold text-center transition-all duration-200',
                  plan.featured
                    ? 'bg-white text-black hover:bg-white/90 hover:shadow-[0_0_30px_rgba(255,255,255,0.2)] active:scale-[0.98]'
                    : 'border border-white/20 text-white hover:bg-white/10 hover:border-white/30 active:scale-[0.98]',
                )}
              >
                {plan.featured ? 'Souscrire' : 'Rejoindre la Waitlist'}
              </a>
            </div>
          ))}
        </div>

        {/* Toggle Billing — bottom left */}
        <div className="flex items-center gap-3 mt-10 self-start">
          <button
            type="button"
            role="switch"
            aria-checked={yearly}
            onClick={() => setYearly((v) => !v)}
            className="relative h-6 w-11 rounded-full border border-white/20 bg-white/10 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
          >
            <span
              className={`pointer-events-none absolute left-[3px] top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform duration-200 ${yearly ? 'translate-x-5' : 'translate-x-0'}`}
            />
          </button>
          <span className="text-sm font-medium text-white/60">
            Annuel
            <span className="ml-1.5 px-2 py-0.5 text-[10px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 rounded-full font-bold">
              -20%
            </span>
          </span>
        </div>
      </div>
    </section>
  );
}
