'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { SignedIn, SignedOut } from '@clerk/nextjs';
import { ArrowUpRight } from 'lucide-react';
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

function CheckIcon() {
  return (
    <span className="check-icon">
      <svg viewBox="0 0 12 12">
        <polyline points="2,6 5,9 10,3" />
      </svg>
    </span>
  );
}

/* ===== COMPONENT ===== */

export default function PricingPage() {
  const [yearly, setYearly] = useState(true);

  // Fix toggle ::after via CSS custom properties
  useEffect(() => {
    const track = document.getElementById('toggle-track');
    if (track) {
      track.style.setProperty('--tx', yearly ? '20px' : '0px');
      track.style.setProperty('--handle-bg', yearly ? 'hsl(var(--background))' : 'hsl(var(--primary))');
    }
  }, [yearly]);

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
          <Link href="/" className="flex items-center gap-1.5 md:hidden pl-1 hover:opacity-80 transition-opacity">
            <Image src="/logo-nav.png" alt="Sokar" width={28} height={28} className="h-7 w-7" />
          </Link>
          <span className="h-4 w-px bg-border md:hidden mx-1" />

          <div className="hidden items-center gap-1 md:flex">
            {[
              { label: 'Accueil', href: '/' },
              { label: 'Services', href: '/#services' },
              { label: "Cas d'usage", href: '/#demo' },
              { label: 'Tarifs', href: '/pricing' },
              { label: 'Contact', href: '/#waitlist' },
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
          <SignedOut>
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-full border border-border/40 bg-foreground/5 px-4 py-1.5 text-sm font-medium transition-all duration-300 hover:-translate-y-0.5 hover:bg-foreground hover:text-background hover:shadow-[0_0_15px_rgba(255,255,255,0.1)] active:scale-[0.98]"
            >
              Essai gratuit
              <ArrowUpRight size={14} />
            </Link>
          </SignedOut>
          <SignedIn>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-full border border-border/40 bg-foreground/5 px-4 py-1.5 text-sm font-medium transition-all duration-300 hover:-translate-y-0.5 hover:bg-foreground hover:text-background hover:shadow-[0_0_15px_rgba(255,255,255,0.1)] active:scale-[0.98]"
            >
              Dashboard
              <ArrowUpRight size={14} />
            </Link>
          </SignedIn>

          {/* Mobile hamburger inside the navbar */}
          <MobileNav buttonStyle="flat" />
        </nav>
      </div>

      {/* ---- HERO ---- */}
      <section className="pricing-hero">
        <h1 className="pricing-hero-title">Tarifs</h1>
        <p className="pricing-hero-kicker">Sokar AI</p>
      </section>

      {/* ---- BILLING ---- */}
      <div className="flex items-center justify-center gap-3 px-8 pb-8 max-w-[1180px] mx-auto relative z-10">
        <label
          className="flex items-center gap-3 cursor-pointer"
          aria-label="Toggle yearly billing"
          onClick={toggleBilling}
        >
          <div
            id="toggle-track"
            className="pricing-toggle-track"
            role="switch"
            aria-checked={yearly}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                toggleBilling();
              }
            }}
          />
          <span className="flex items-center gap-1.5 select-none text-sm text-muted-foreground">
            Facturation annuelle
            <span className="px-2 py-0.5 text-xs bg-[hsl(var(--pricing-accent)/0.2)] text-[hsl(var(--pricing-accent))] border border-[hsl(var(--pricing-accent)/0.3)] rounded-full font-bold">
              -20%
            </span>
          </span>
        </label>
      </div>

      {/* ---- CARDS ---- */}
      <section className="relative z-[2] mx-auto max-w-[1180px] px-8 pb-8 -mt-7" aria-label="Pricing plans">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((plan) => (
            <div
              key={plan.label}
              className={cn(
                'pricing-card',
                plan.featured && 'pricing-card-featured',
              )}
            >
              <div>
                <div className="flex justify-between items-center">
                  <p className="relative z-[1] text-xl font-medium text-foreground mb-0.5">
                    {plan.label}
                  </p>
                  {plan.featured && (
                    <span className="px-2 py-0.5 text-xs font-bold tracking-wide uppercase bg-[hsl(var(--pricing-accent)/0.1)] border border-[hsl(var(--pricing-accent)/0.2)] text-[hsl(var(--pricing-accent))] rounded-full">
                      Recommandé
                    </span>
                  )}
                </div>
                <p className="relative z-[1] text-[clamp(2.2rem,4vw,3.1rem)] font-semibold tracking-tight text-foreground leading-none">
                  {displayPrice(plan.price, yearly)}
                  <span className="text-[clamp(1rem,1.6vw,1.35rem)] font-normal text-foreground tracking-tight">
                    {' '}{plan.period}
                  </span>
                </p>
                <p className="relative z-[1] mt-4 max-w-[18rem] text-sm text-foreground/70 leading-relaxed">
                  {plan.description}
                </p>
              </div>

              <ul className="list-none flex flex-col gap-3 flex-1 relative z-[1] m-0 p-0">
                {plan.features.map((feat) => (
                  <li key={feat} className="flex items-start gap-3 text-sm text-foreground/80 leading-snug">
                    <CheckIcon />
                    {feat}
                  </li>
                ))}
              </ul>

              <a
                href="/register"
                className={cn(
                  'self-center min-w-[9.25rem] px-6 py-[0.72rem] rounded-full text-[0.82rem] font-semibold cursor-pointer border-none relative z-[1] transition-all duration-200 text-center no-underline inline-block',
                  plan.featured
                    ? 'pricing-cta-featured'
                    : 'bg-primary text-primary-foreground hover:opacity-95 hover:-translate-y-px hover:shadow-[0_0.75rem_1.8rem_rgba(255,255,255,0.12)] active:scale-[0.99]',
                )}
              >
                Souscrire
              </a>
            </div>
          ))}
        </div>
      </section>

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
