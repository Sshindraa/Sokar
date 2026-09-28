import Link from 'next/link';
import Image from 'next/image';
import { ArrowUpRight } from 'lucide-react';
import MobileNav from '@/components/MobileNav';
import { cn } from '@/lib/utils';
import PricingPlans from '@/app/PricingPlans';

/* ===== COMPONENT ===== */

export default function PricingPage() {
  return (
    <div className="pricing-root">
      {/* Floating navbar */}
      <div className="fixed left-1/2 top-5 z-50 -translate-x-1/2 flex items-center">
        <nav className="flex items-center gap-2 rounded-full border border-white/10 bg-black/85 px-3 py-2 shadow-2xl backdrop-blur-xl">
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
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-colors duration-200',
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
            className="hidden md:inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-white/10 bg-foreground/5 px-4 py-1.5 text-sm font-medium transition-all duration-300 hover:-translate-y-0.5 hover:bg-foreground hover:text-background hover:shadow-[0_0_15px_rgba(255,255,255,0.1)] active:scale-[0.98]"
          >
            Créer mon compte
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
            background:
              'radial-gradient(circle, hsl(var(--pricing-accent) / 0.18), transparent 70%)',
            filter: 'blur(80px)',
          }}
        />
        <div className="flex flex-col items-center pb-8 pt-4 md:pb-10 md:pt-10">
          <PricingPlans haptic />
        </div>
      </section>

      {/* Mobile closing CTA */}
      <div className="relative z-[2] mx-5 mb-8 flex items-center justify-between gap-4 rounded-3xl border border-border/40 bg-background/80 p-4 shadow-2xl backdrop-blur-lg md:hidden">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--pricing-accent))] font-bold">
            Sokar AI
          </span>
          <span className="text-xs font-semibold text-foreground">Souscription sécurisée</span>
        </div>
        <Link
          href="/register"
          className="flex-1 max-w-[180px] text-center inline-flex items-center justify-center gap-1.5 rounded-full bg-[hsl(var(--pricing-accent))] text-black px-4 py-2.5 text-xs font-bold shadow-[0_0_15px_hsl(var(--pricing-accent)/0.35)] transition-all duration-150 active:scale-95 active:brightness-90"
        >
          Souscrire
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
