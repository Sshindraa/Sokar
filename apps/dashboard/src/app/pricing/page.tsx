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
              className="hidden md:inline-flex items-center gap-2 rounded-full border border-border/40 bg-foreground/5 px-4 py-1.5 text-sm font-medium transition-all duration-300 hover:-translate-y-0.5 hover:bg-foreground hover:text-background hover:shadow-[0_0_15px_rgba(255,255,255,0.1)] active:scale-[0.98]"
            >
              Essai gratuit
              <ArrowUpRight size={14} />
            </Link>
          </SignedOut>
          <SignedIn>
            <Link
              href="/dashboard"
              className="hidden md:inline-flex items-center gap-2 rounded-full border border-border/40 bg-foreground/5 px-4 py-1.5 text-sm font-medium transition-all duration-300 hover:-translate-y-0.5 hover:bg-foreground hover:text-background hover:shadow-[0_0_15px_rgba(255,255,255,0.1)] active:scale-[0.98]"
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
          <span className="flex items-center gap-2 select-none text-sm text-muted-foreground font-medium">
            Facturation annuelle
            <span className="px-2.5 py-1 text-xs bg-[hsl(var(--pricing-accent))] text-black border border-[hsl(var(--pricing-accent-glow)/0.4)] rounded-full font-bold tracking-wide shadow-[0_0_15px_hsl(var(--pricing-accent)/0.4)]">
              économisez 20%
            </span>
          </span>
        </label>
      </div>

      {/* ---- CARDS ---- */}
      <section className="relative z-[2] mx-auto max-w-[1180px] px-4 md:px-8 pb-8 -mt-7" aria-label="Pricing plans">
        <div className="flex md:grid md:grid-cols-3 gap-6 overflow-x-auto md:overflow-x-visible snap-x snap-mandatory pb-10 scrollbar-none px-4 -mx-4 md:px-0 md:mx-0">
          {plans.map((plan) => (
            <div
              key={plan.label}
              className={cn(
                'pricing-card snap-center shrink-0 w-[85vw] max-w-[340px] md:w-auto md:shrink md:max-w-none',
                plan.featured && 'pricing-card-featured',
              )}
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

                {/* Price block anchor */}
                <div className="relative z-[1] flex items-baseline gap-1.5 py-2 border-b border-border/10 mb-4">
                  <span className="text-[clamp(2.5rem,5vw,3.5rem)] font-extrabold tracking-tight leading-none bg-gradient-to-br from-foreground via-foreground to-muted-foreground bg-clip-text text-transparent">
                    {displayPrice(plan.price, yearly)}
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
                  {plan.description}
                </p>
              </div>

              <ul className="list-none flex flex-col gap-3.5 flex-1 relative z-[1] m-0 p-0">
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
                    : 'bg-primary text-primary-foreground hover:opacity-95 hover:-translate-y-px hover:shadow-[0_0.75rem_1.8rem_rgba(255,255,255,0.12)] active:scale-95 active:bg-primary/95',
                )}
              >
                Souscrire
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* Sticky Bottom Bar on Mobile */}
      <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-background/80 backdrop-blur-lg border-t border-border/40 md:hidden pb-[calc(1rem+env(safe-area-inset-bottom,0px))] flex items-center justify-between gap-4 shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--pricing-accent))] font-bold">Sokar AI</span>
          <span className="text-xs font-semibold text-foreground">Essai gratuit de 7 jours</span>
        </div>
        <SignedOut>
          <Link
            href="/register"
            className="flex-1 max-w-[180px] text-center inline-flex items-center justify-center gap-1.5 rounded-full bg-[hsl(var(--pricing-accent))] text-black px-4 py-2.5 text-xs font-bold shadow-[0_0_15px_hsl(var(--pricing-accent)/0.35)] transition-all duration-150 active:scale-95 active:brightness-90"
          >
            Essai gratuit
            <ArrowUpRight size={14} />
          </Link>
        </SignedOut>
        <SignedIn>
          <Link
            href="/dashboard"
            className="flex-1 max-w-[180px] text-center inline-flex items-center justify-center gap-1.5 rounded-full bg-[hsl(var(--pricing-accent))] text-black px-4 py-2.5 text-xs font-bold shadow-[0_0_15px_hsl(var(--pricing-accent)/0.35)] transition-all duration-150 active:scale-95 active:brightness-90"
          >
            Dashboard
            <ArrowUpRight size={14} />
          </Link>
        </SignedIn>
      </div>

      {/* ---- FOOTER ---- */}
      <footer className="border-t border-border py-6 text-center text-sm text-muted-foreground pb-[calc(5rem+env(safe-area-inset-bottom,0px))] md:pb-6">
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
