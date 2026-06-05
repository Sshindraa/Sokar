import Link from 'next/link';
import Image from 'next/image';
import { Sparkles, Phone, CalendarCheck, Zap } from 'lucide-react';
import { Outfit, Plus_Jakarta_Sans } from 'next/font/google';
import PricingSection from '@/app/PricingSection';
import FaqSection from '@/app/FaqSection';
import WaitlistSection from '@/app/WaitlistSection';
import MobileNav from '@/components/MobileNav';
import DemoSection from '@/app/DemoSection';
import AuthCTA from '@/components/AuthCTA';

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
        className="fixed left-4 top-5 z-50 hidden md:flex items-center gap-2 rounded-full transition-all duration-200 hover:opacity-80 sm:left-6"
      >
        <Image src="/logo-nav.png" alt="Sokar" width={36} height={36} className="h-9 w-9 sm:h-11 sm:w-11" priority />
        <span className="hidden text-xl font-bold tracking-tight text-white font-display sm:inline">Sokar</span>
      </Link>

      {/* Floating navbar */}
      <div className="fixed left-1/2 top-5 z-50 -translate-x-1/2 flex items-center">
        <nav className="flex items-center gap-2 rounded-full border border-white/10 bg-black/80 px-3 py-2 shadow-2xl backdrop-blur-xl">
          {/* Logo inside navbar on mobile */}
          <Link href="/" className="flex items-center gap-1.5 md:hidden pl-1 hover:opacity-80 transition-opacity">
            <Image src="/logo-nav.png" alt="Sokar" width={28} height={28} className="h-7 w-7" priority />
          </Link>
          <span className="h-4 w-px bg-white/10 md:hidden mx-1" />

          <div className="hidden items-center gap-1 md:flex">
            {[
              { label: 'Services', href: '/#services' },
              { label: "Cas d'usage", href: '/#demo' },
              { label: 'Tarifs', href: '/pricing' },
              { label: 'Contact', href: '/#waitlist' },
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
          <AuthCTA variant="nav" />

          {/* Mobile hamburger inside the navbar */}
          <MobileNav buttonStyle="flat" />
        </nav>
      </div>

      {/* Main Content */}
      <main className="relative z-10 w-full max-w-7xl px-4 sm:px-6 pt-28 sm:pt-32 flex flex-col items-center">
        
        {/* HERO — fully static, server-rendered */}
        <section className="relative flex flex-col items-center justify-center text-center w-full min-h-[50vh] sm:min-h-[65vh] md:min-h-[80vh]">
          <div className="flex flex-col items-center max-w-5xl px-2 sm:px-6 pt-12 sm:pt-20 pb-8">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-5 py-2.5 text-xs text-white/70 backdrop-blur-xl transition-all duration-300 hover:border-white/20">
              <Sparkles size={14} />
              Assistant vocal pour restaurants
            </p>

            <h1 className="mt-5 sm:mt-6 max-w-5xl text-3xl sm:text-4xl md:text-7xl lg:text-8xl font-semibold leading-[1.1] sm:leading-[1.05] md:leading-[0.9] tracking-tight text-white font-display">
              La salle répond quand vous cuisinez.
            </h1>

            <p className="mx-auto mt-5 max-w-xl text-sm leading-6 text-white/60 md:text-base font-sans">
              Sokar prend les appels, confirme les réservations et transmet les bonnes infos à votre équipe sans casser le rythme du service.
            </p>

            <div className="mt-6 sm:mt-8 flex flex-col sm:flex-row sm:flex-wrap items-center justify-center gap-3 w-full sm:w-auto">
              <AuthCTA variant="hero" />
              <Link
                href="/pricing"
                className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-6 py-3 text-sm font-semibold text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/5 hover:border-white/20 hover:shadow-[0_0_15px_rgba(255,255,255,0.08)] active:scale-[0.98] w-full sm:w-auto"
              >
                Voir les tarifs
              </Link>
            </div>
          </div>
        </section>

        {/* FEATURES — fully static, server-rendered */}
        <section id="services" className="w-full py-16 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="glass-card p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-all duration-300 flex flex-col gap-4">
            <span className="h-10 w-10 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
              <Phone size={18} />
            </span>
            <h3 className="text-lg font-bold text-white font-sans">100% des appels traités</h3>
            <p className="text-[13px] text-white/60 leading-relaxed font-sans">Sokar gère plusieurs appels simultanés lors des pics de service. Finis les clients frustrés qui tombent sur messagerie.</p>
          </div>

          <div className="glass-card p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-all duration-300 flex flex-col gap-4">
            <span className="h-10 w-10 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
              <CalendarCheck size={18} />
            </span>
            <h3 className="text-lg font-bold text-white font-sans">Zéro double saisie</h3>
            <p className="text-[13px] text-white/60 leading-relaxed font-sans">Intégration transparente et bidirectionnelle avec vos logiciels de réservation (ZenChef, TheFork) et de caisse.</p>
          </div>

          <div className="glass-card p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-all duration-300 flex flex-col gap-4">
            <span className="h-10 w-10 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
              <Zap size={18} />
            </span>
            <h3 className="text-lg font-bold text-white font-sans">Intelligence locale</h3>
            <p className="text-[13px] text-white/60 leading-relaxed font-sans">Sokar connaît vos plats du jour, vos allergènes et prend des décisions complexes selon les consignes que vous lui donnez.</p>
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
              {[
                {
                  name: 'Twitter',
                  href: '#',
                  icon: (
                    <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                  ),
                },
                {
                  name: 'Facebook',
                  href: '#',
                  icon: (
                    <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                  ),
                },
                {
                  name: 'Instagram',
                  href: '#',
                  icon: (
                    <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24"><path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.281.63 4.07C.333 4.835.132 5.705.072 6.983.015 8.263 0 8.67 0 12s.015 3.737.072 5.017c.06 1.278.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.078 2.126 1.384.765.297 1.635.499 2.913.558C8.333 23.985 8.74 24 12 24s3.737-.015 5.017-.072c1.278-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.078-1.335 1.384-2.126.297-.765.499-1.635.558-2.913.06-1.28.072-1.687.072-5.017s-.015-3.737-.072-5.017c-.06-1.278-.262-2.148-.557-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.635-.499-2.913-.558C15.667.015 15.26 0 12 0zm0 2.162c3.204 0 3.584.012 4.85.07 1.17.054 1.805.249 2.227.415.562.217.96.477 1.378.896.419.42.679.819.896 1.378.164.422.36 1.057.414 2.227.058 1.266.07 1.646.07 4.85s-.012 3.584-.07 4.85c-.054 1.17-.249 1.805-.415 2.227-.217.562-.477.96-.896 1.378-.42.419-.819.679-1.378.896-.422.164-1.057.36-2.227.414-1.266.058-1.646.07-4.85.07s-3.584-.012-4.85-.07c-1.17-.054-1.805-.249-2.227-.415-.562-.217-.96-.477-1.378-.896-.419-.42-.679-.819-.896-1.378-.164-.422-.36-1.057-.414-2.227-.058-1.266-.07-1.646-.07-4.85s.012-3.584.07-4.85c.054-1.17.249-1.805.415-2.227.217-.562.477-.96.896-1.378.42-.419.819-.679 1.378-.896.422-.164 1.057-.36 2.227-.414 1.266-.058 1.646-.07 4.85-.07zM12 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm7.846-10.405a1.44 1.44 0 1 1-2.88 0 1.44 1.44 0 0 1 2.88 0z"/></svg>
                  ),
                },
              ].map((social) => (
                <a
                  key={social.name}
                  aria-label={social.name}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-11 w-11 rounded-full border border-white/10 bg-white/[0.03] flex items-center justify-center text-white/60 transition-all duration-300 hover:text-white hover:bg-white/[0.08] hover:border-white/20 active:scale-95 shadow-md shadow-black/10"
                >
                  {social.icon}
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
          <p className="text-xs tracking-[0.1em] uppercase text-white/30 font-sans">
            &copy; {new Date().getFullYear()} SOKAR OS. TOUS DROITS RÉSERVÉS.
          </p>
          <div className="flex items-center gap-1.5 text-xs tracking-[0.15em] uppercase text-white/45 bg-white/5 border border-white/10 px-3 py-1 rounded-full font-bold">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
            Bêta Privée
          </div>
        </div>
      </footer>
    </div>
  );
}
