'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowUpRight, Check } from 'lucide-react';
import MobileNav from '@/components/MobileNav';
import { cn, triggerHaptic } from '@/lib/utils';

/* ===== DATA ===== */

const plans = [
  {
    label: 'Essential',
    price: '149',
    period: '€/mois',
    description: 'Pour automatiser vos premiers appels et réservations.',
    features: [
      'Répond à chaque appel, 24h/24',
      'Réservations prises sans intervention',
      'Ton adapté à votre établissement',
      'Rapport quotidien de vos appels',
      '1 numéro dédié inclus',
    ],
  },
  {
    label: 'Pro',
    price: '249',
    period: '€/mois',
    description: 'Pour les restaurants qui veulent maximiser chaque service.',
    features: [
      "Tout l'Essential, sans limite",
      'Vos clients reconnus à chaque appel',
      'No-shows anticipés et gérés automatiquement',
      'Revenus récupérés visibles en temps réel',
      'Réservable depuis ChatGPT, Claude et les IA du marché',
      'Support prioritaire 7j/7',
    ],
    featured: true,
  },
  {
    label: 'Multi-site',
    price: '249',
    sitePrice: '99',
    period: '€/mois + 99€/site',
    description: 'Pour piloter plusieurs établissements avec une seule équipe.',
    features: [
      'Plan Pro sur tous vos établissements',
      'Un seul dashboard pour tout piloter',
      'Un numéro et un agent par site',
      'Une seule facture pour tout le groupe',
    ],
  },
];

/* ===== COMPONENT ===== */

export default function PricingPage() {
  const [yearly, setYearly] = useState(true);

  const toggleBilling = () => {
    triggerHaptic(15);
    setYearly((v) => !v);
  };

  return (
    <div className="pricing-root">
      {/* Floating navbar */}
      <div className="fixed left-1/2 top-5 z-50 -translate-x-1/2 flex items-center">
        <nav className="flex items-center gap-2 rounded-full border border-border/40 bg-background/80 px-3 py-2 shadow-2xl backdrop-blur-xl">
          {/* Logo inside navbar on mobile */}
          <Link
            href="/"
            className="flex items-center gap-1.5 md:hidden pl-1 hover:opacity-80 transition-opacity"
          >
            <Image src="/logo-nav.png" alt="Sokar" width={28} height={28} className="h-7 w-7" />
          </Link>

          <div className="hidden items-center gap-1 md:flex">
            {[
              { label: 'Accueil', href: '/' },
              { label: 'Services', href: '/#services' },
              { label: "Cas d'usage", href: '/#demo' },
              { label: 'Tarifs', href: '/pricing' },
              { label: "S'inscrire", href: '/register' },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'rounded-full px-3 py-1.5 text-sm transition-colors duration-200',
                  item.href === '/pricing'
                    ? 'text-foreground bg-foreground/10'
                    : 'text-foreground/60 hover:bg-foreground/5 hover:text-foreground',
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>
          <Link
            href="/register"
            className="hidden md:inline-flex items-center gap-2 rounded-full border border-border/40 bg-foreground/5 px-4 py-1.5 text-sm font-medium transition-all duration-300 hover:-translate-y-0.5 hover:bg-foreground hover:text-background hover:shadow-[0_0_15px_rgba(255,255,255,0.1)] active:scale-[0.98]"
          >
            Essai gratuit
            <ArrowUpRight size={14} />
          </Link>

          {/* Mobile hamburger inside the navbar */}
          <MobileNav buttonStyle="flat" />
        </nav>
      </div>

      {/* ---- HERO ---- */}
      <section className="pricing-hero">
        <h1 className="pricing-hero-title">Tarifs</h1>
      </section>

      {/* ---- CARDS ---- */}
      <section
        className="relative z-[2] mx-auto max-w-[1180px] px-5 pb-28 md:px-8 md:pb-8 md:-mt-7"
        aria-label="Pricing plans"
      >
        {/* Ambient glow behind cards */}
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/3 h-[600px] w-[900px] rounded-full -z-10"
          style={{
            background: 'radial-gradient(circle, hsl(195 100% 55% / 0.18), transparent 70%)',
            filter: 'blur(80px)',
          }}
        />
        <div className="grid grid-cols-1 gap-5 pb-8 md:grid-cols-3 md:gap-6 md:pb-10">
          {plans.map((plan) => {
            const monthlyPrice = parseInt(plan.price, 10);
            const yearlyPrice = displayPrice(plan.price, yearly);
            const monthlySitePrice = plan.sitePrice ? parseInt(plan.sitePrice, 10) : null;
            const yearlySitePrice = plan.sitePrice ? displayPrice(plan.sitePrice, yearly) : null;
            const monthlySavings = monthlyPrice - parseInt(yearlyPrice, 10);
            const siteSavings =
              monthlySitePrice && yearlySitePrice
                ? monthlySitePrice - parseInt(yearlySitePrice, 10)
                : null;

            return (
              <div
                key={plan.label}
                className={cn(
                  'group relative flex w-full flex-col rounded-[2rem] border p-6 backdrop-blur-xl transition-all duration-300 md:p-7',
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
                  <div className="mb-3">
                    {yearly && (
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-cyan-300">
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
                      <p className="mt-2 text-xs font-medium text-cyan-200/80">
                        Économisez {monthlySavings}€/mois
                        {siteSavings ? ` + ${siteSavings}€/site` : ''} avec la facturation annuelle.
                      </p>
                    )}
                  </div>

                  {/* Description */}
                  <p className="text-sm text-white/50 leading-relaxed mb-8">{plan.description}</p>
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
                <Link
                  href="/register"
                  className={cn(
                    'relative z-10 w-full rounded-full py-3 text-sm font-semibold text-center transition-all duration-200',
                    plan.featured
                      ? 'bg-white text-black hover:bg-white/90 hover:shadow-[0_0_30px_rgba(255,255,255,0.2)] active:scale-[0.98]'
                      : 'border border-white/20 text-white hover:bg-white/10 hover:border-white/30 active:scale-[0.98]',
                  )}
                >
                  S'inscrire
                </Link>
              </div>
            );
          })}
        </div>

        {/* Toggle Billing — bottom left */}
        <div className="flex items-center gap-3 mt-2 md:mt-6">
          <button
            type="button"
            role="switch"
            aria-checked={yearly}
            onClick={toggleBilling}
            className={cn(
              'relative h-6 w-11 rounded-full border transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50',
              yearly ? 'border-cyan-300/50 bg-cyan-400/30' : 'border-white/20 bg-white/10',
            )}
          >
            <span
              className={cn(
                'pointer-events-none absolute left-[3px] top-[3px] flex h-[18px] w-[18px] items-center justify-center rounded-full shadow-sm transition-all duration-200',
                yearly ? 'translate-x-5 bg-white' : 'translate-x-0 bg-black',
              )}
            >
              {yearly && <Check size={11} className="text-cyan-500" strokeWidth={3.5} />}
            </span>
          </button>
          <span className="text-sm font-medium text-white/60">
            Annuel
            <span className="ml-1.5 px-2 py-0.5 text-[10px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 rounded-full font-bold">
              -20%
            </span>
          </span>
        </div>
      </section>

      {/* Mobile closing CTA */}
      <div className="relative z-[2] mx-5 mb-8 flex items-center justify-between gap-4 rounded-3xl border border-border/40 bg-background/80 p-4 shadow-2xl backdrop-blur-lg md:hidden">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--pricing-accent))] font-bold">
            Sokar AI
          </span>
          <span className="text-xs font-semibold text-foreground">Essai gratuit de 7 jours</span>
        </div>
        <Link
          href="/register"
          className="flex-1 max-w-[180px] text-center inline-flex items-center justify-center gap-1.5 rounded-full bg-[hsl(var(--pricing-accent))] text-black px-4 py-2.5 text-xs font-bold shadow-[0_0_15px_hsl(var(--pricing-accent)/0.35)] transition-all duration-150 active:scale-95 active:brightness-90"
        >
          Essai gratuit
          <ArrowUpRight size={14} />
        </Link>
      </div>

      {/* ---- FOOTER ---- */}
      <footer className="border-t border-border py-6 text-center text-sm text-muted-foreground">
        &copy; {new Date().getFullYear()} Sokar. Tous droits réservés.
      </footer>
    </div>
  );
}

/* Helpers */

function displayPrice(price: string, yearly: boolean) {
  const num = parseInt(price, 10);
  return yearly ? Math.round(num * 0.8).toString() : price;
}
