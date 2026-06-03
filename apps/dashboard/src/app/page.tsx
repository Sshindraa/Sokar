import Link from 'next/link';
import Image from 'next/image';
import { Sparkles } from 'lucide-react';
import { SignedIn, SignedOut } from '@clerk/nextjs';
import { ArrowUpRight } from 'lucide-react';
import { Outfit, Plus_Jakarta_Sans } from 'next/font/google';
import PricingSection from '@/app/PricingSection';
import FaqSection from '@/app/FaqSection';
import WaitlistSection from '@/app/WaitlistSection';
import MobileNav from '@/components/MobileNav';
import DemoSection from '@/app/DemoSection';

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800', '900'],
  display: 'swap',
  variable: '--font-display',
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-sans',
});

export default function HomePage() {
  return (
    <div className={`relative min-h-screen w-full overflow-hidden bg-[#030303] text-foreground flex flex-col justify-between items-center font-sans antialiased ${outfit.variable} ${jakarta.variable}`}>
      {/* Liquid Field Background */}
      <div className="liquid-field absolute inset-0 pointer-events-none z-0 overflow-hidden select-none" />

      {/* Logo — top-left fixed */}
      <Link
        href="/"
        className="fixed left-6 top-5 z-50 flex items-center gap-2 rounded-full transition-all duration-200 hover:opacity-80"
      >
        <Image src="/logo-nav.png" alt="Sokar" width={44} height={44} className="h-11 w-11" priority />
        <span className="text-xl font-bold tracking-tight text-white font-display">Sokar</span>
      </Link>

      {/* Floating navbar */}
      <div className="fixed left-1/2 top-5 z-50 -translate-x-1/2 flex items-center gap-2">
        {/* Mobile hamburger */}
        <MobileNav />
        <nav className="flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-2 shadow-2xl backdrop-blur-xl">
          <div className="hidden items-center gap-1 md:flex">
            {[
              { label: 'Services', href: '#services' },
              { label: "Cas d'usage", href: '#cases' },
              { label: 'Tarifs', href: '/pricing' },
              { label: 'Contact', href: '#contact' },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-full px-3 py-1.5 text-sm text-white/60 transition-colors hover:bg-white/5 hover:text-white"
              >
                {item.label}
              </Link>
            ))}
          </div>
          <SignedOut>
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm font-medium transition-all duration-300 hover:-translate-y-0.5 hover:bg-white hover:text-black hover:shadow-[0_0_15px_rgba(255,255,255,0.1)] active:scale-[0.98]"
            >
              Essai gratuit
              <ArrowUpRight size={14} />
            </Link>
          </SignedOut>
          <SignedIn>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm font-medium transition-all duration-300 hover:-translate-y-0.5 hover:bg-white hover:text-black hover:shadow-[0_0_15px_rgba(255,255,255,0.1)] active:scale-[0.98]"
            >
              Dashboard
              <ArrowUpRight size={14} />
            </Link>
          </SignedIn>
        </nav>
      </div>

      {/* Main Content */}
      <main className="relative z-10 w-full max-w-7xl px-6 pt-32 flex flex-col items-center">
        
        {/* HERO — fully static, server-rendered */}
        <section className="relative flex flex-col items-center justify-center text-center w-full min-h-[65vh] sm:min-h-[80vh]">
          <div className="flex flex-col items-center max-w-5xl px-6 pt-20 pb-8">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-5 py-2.5 text-xs text-white/70 backdrop-blur-xl transition-all duration-300 hover:border-white/20">
              <Sparkles size={14} />
              Assistant vocal pour restaurants
            </p>

            <h1 className="mt-6 max-w-5xl text-4xl sm:text-5xl md:text-7xl lg:text-8xl font-semibold leading-[1.05] sm:leading-[0.9] tracking-tight text-white font-display">
              La salle répond quand vous cuisinez.
            </h1>

            <p className="mx-auto mt-5 max-w-xl text-sm leading-6 text-white/50 md:text-base font-sans">
              Sokar prend les appels, confirme les réservations et transmet les bonnes infos à votre équipe sans casser le rythme du service.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <SignedOut>
                <Link
                  href="/register"
                  className="inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition-all duration-300 hover:-translate-y-0.5 hover:scale-[1.01] hover:bg-white/90 hover:shadow-[0_0_20px_rgba(255,255,255,0.12)] active:scale-[0.98]"
                >
                  Réserver une démo
                </Link>
              </SignedOut>
              <SignedIn>
                <Link
                  href="/dashboard"
                  className="inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition-all duration-300 hover:-translate-y-0.5 hover:scale-[1.01] hover:bg-white/90 hover:shadow-[0_0_20px_rgba(255,255,255,0.12)] active:scale-[0.98]"
                >
                  Accéder au Dashboard
                </Link>
              </SignedIn>
              <Link
                href="/pricing"
                className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-6 py-3 text-sm font-semibold text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/5 hover:border-white/20 hover:shadow-[0_0_15px_rgba(255,255,255,0.08)] active:scale-[0.98]"
              >
                Voir les tarifs
              </Link>
            </div>
          </div>
        </section>

        {/* FEATURES — fully static, server-rendered */}
        <section className="w-full py-16 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="glass-card p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-all duration-300 flex flex-col gap-4">
            <span className="h-10 w-10 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2a9 9 0 0 1 9 9"/><path d="M13 6a5 5 0 0 1 5 5"/><path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"/></svg>
            </span>
            <h3 className="text-lg font-bold text-white font-display">100% des appels traités</h3>
            <p className="text-[13px] text-white/50 leading-relaxed font-sans">Sokar gère plusieurs appels simultanés lors des pics de service. Finis les clients frustrés qui tombent sur messagerie.</p>
          </div>

          <div className="glass-card p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-all duration-300 flex flex-col gap-4">
            <span className="h-10 w-10 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/></svg>
            </span>
            <h3 className="text-lg font-bold text-white font-display">Zéro double saisie</h3>
            <p className="text-[13px] text-white/50 leading-relaxed font-sans">Intégration transparente et bidirectionnelle avec vos logiciels de réservation (ZenChef, TheFork) et de caisse.</p>
          </div>

          <div className="glass-card p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-all duration-300 flex flex-col gap-4">
            <span className="h-10 w-10 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>
            </span>
            <h3 className="text-lg font-bold text-white font-display">Intelligence locale</h3>
            <p className="text-[13px] text-white/50 leading-relaxed font-sans">Sokar connaît vos plats du jour, vos allergènes et prend des décisions complexes selon les consignes que vous lui donnez.</p>
          </div>
        </section>

        {/* DEMO — client component with simulator chat */}
        <DemoSection />

        {/* PRICING — client component for toggle interactivity */}
        <PricingSection />

        {/* FAQ — client component for accordion */}
        <FaqSection />

        {/* WAITLIST — client component for form */}
        <WaitlistSection />
      </main>

      {/* FOOTER — fully static, server-rendered */}
      <footer className="relative z-10 w-full border-t border-white/5 bg-black/40 backdrop-blur-md pt-16 pb-12 mt-20 px-6 flex flex-col items-center">
        <div className="absolute inset-x-0 bottom-0 overflow-hidden pointer-events-none select-none flex justify-center -z-10 opacity-30">
          <span className="stroke-text font-black text-[12vw] tracking-[0.1em] uppercase leading-none select-none">SOKAR</span>
        </div>

        <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
          <div className="flex flex-col gap-4">
            <Link href="/" className="flex items-center gap-2">
              <Image src="/logo-nav.png" alt="Sokar" width={32} height={32} className="h-8 w-8 filter drop-shadow-[0_0_10px_rgba(255,255,255,0.15)]" />
              <span className="text-lg font-bold text-white font-display">Sokar</span>
            </Link>
            <p className="text-xs text-white/40 leading-relaxed font-sans max-w-xs">
              L&apos;assistant vocal intelligent qui révolutionne la prise de réservations et la gestion des appels de votre restaurant.
            </p>
            <div className="flex items-center gap-3 mt-2">
              {['Twitter', 'Facebook', 'Instagram'].map((name) => (
                <a key={name} aria-label={name} href="#" className="h-11 w-11 rounded-full border border-white/10 bg-white/[0.03] flex items-center justify-center text-white/60 transition-all duration-300 hover:text-white hover:bg-white/[0.08] hover:border-white/20 active:scale-95 shadow-md shadow-black/10">
                  <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                </a>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <h4 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-white/80 font-sans">Produit</h4>
            <a href="#demo" className="text-xs text-white/45 hover:text-white transition-colors duration-200 font-sans py-2 min-h-[44px] flex items-center">Démonstration</a>
            <a href="#tarifs" className="text-xs text-white/45 hover:text-white transition-colors duration-200 font-sans py-2 min-h-[44px] flex items-center">Tarifs</a>
            <a href="#faq" className="text-xs text-white/45 hover:text-white transition-colors duration-200 font-sans py-2 min-h-[44px] flex items-center">FAQ</a>
          </div>

          <div className="flex flex-col gap-3">
            <h4 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-white/80 font-sans">Entreprise</h4>
            <a href="#waitlist" className="text-xs text-white/45 hover:text-white transition-colors duration-200 font-sans py-2 min-h-[44px] flex items-center">Waitlist Bêta</a>
            <Link href="/login" className="text-xs text-white/45 hover:text-white transition-colors duration-200 font-sans py-2 min-h-[44px] flex items-center">Espace Partenaire</Link>
          </div>

          <div className="flex flex-col gap-3">
            <h4 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-white/80 font-sans">Légal</h4>
            <a href="#" className="text-xs text-white/45 hover:text-white transition-colors duration-200 font-sans py-2 min-h-[44px] flex items-center">Mentions Légales</a>
            <a href="#" className="text-xs text-white/45 hover:text-white transition-colors duration-200 font-sans py-2 min-h-[44px] flex items-center">Confidentialité</a>
          </div>
        </div>

        <div className="w-full max-w-5xl border-t border-white/5 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-[11px] tracking-[0.1em] uppercase text-white/30 font-sans">
            &copy; {new Date().getFullYear()} SOKAR OS. TOUS DROITS RÉSERVÉS.
          </p>
          <div className="flex items-center gap-1.5 text-[11px] tracking-[0.15em] uppercase text-white/45 bg-white/5 border border-white/10 px-3 py-1 rounded-full font-bold">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
            Bêta Privée
          </div>
        </div>
      </footer>
    </div>
  );
}
