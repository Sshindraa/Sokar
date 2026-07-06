import Link from 'next/link';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import {
  ArrowRight,
  Bot,
  CalendarCheck,
  CheckCircle2,
  Mic,
  PhoneCall,
  Utensils,
} from 'lucide-react';
import { Outfit, Plus_Jakarta_Sans } from 'next/font/google';
import PricingSection from '@/app/PricingSection';
import FaqSection from '@/app/FaqSection';
import MobileNav from '@/components/MobileNav';
import AuthCTA from '@/components/AuthCTA';
import SectionSkeleton from '@/components/SectionSkeleton';

// SSR les sections pour éviter le flash de skeleton sur 4G.
// ScrollStoryboardSection : Framer Motion useScroll retourne progress=0 en SSR,
//   l'état initial (1er story step) est rendu serveur, hydration client-side.
// DemoSection : useState/useEffect seulement, pas de window/document direct.
const ScrollStoryboardSection = dynamic(() => import('@/app/ScrollStoryboardSection'), {
  loading: () => <SectionSkeleton variant="storyboard" />,
});
const DemoSection = dynamic(() => import('@/app/DemoSection'), {
  loading: () => <SectionSkeleton variant="demo" />,
});

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
    <div
      className={`relative min-h-screen w-full bg-background text-foreground flex flex-col justify-between items-center font-sans antialiased ${outfit.variable} ${jakarta.variable}`}
    >
      {/* Liquid Field Background */}
      <div className="liquid-field absolute inset-0 pointer-events-none z-0 overflow-hidden select-none" />

      {/* Logo — top-left fixed */}
      <Link
        href="/"
        className="fixed left-4 top-5 z-50 hidden md:flex items-center gap-2 rounded-full transition-all duration-200 hover:opacity-80 sm:left-6"
      >
        <Image
          src="/logo-nav.png"
          alt="Sokar"
          width={36}
          height={36}
          className="h-9 w-9 sm:h-11 sm:w-11"
          priority
        />
        <span className="hidden text-xl font-bold tracking-tight text-white font-display sm:inline">
          Sokar
        </span>
      </Link>

      {/* Floating navbar */}
      <div className="fixed left-1/2 top-5 z-50 -translate-x-1/2 flex items-center">
        <nav className="flex items-center gap-2 rounded-full border border-white/10 bg-black/85 px-3 py-2 shadow-2xl">
          {/* Logo inside navbar on mobile */}
          <Link
            href="/"
            className="flex items-center gap-1.5 md:hidden pl-1 hover:opacity-80 transition-opacity"
          >
            <Image src="/logo-nav.png" alt="Sokar" width={28} height={28} className="h-7 w-7" />
          </Link>
          <span className="h-4 w-px bg-white/10 md:hidden mx-1" />

          <div className="hidden items-center gap-1 md:flex">
            {[
              { label: 'Services', href: '/#services' },
              { label: "Cas d'usage", href: '/#demo' },
              { label: 'Tarifs', href: '/pricing' },
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
      <main className="relative z-10 flex w-full flex-col items-center">
        {/* HERO — fully static, server-rendered */}
        <section className="relative flex min-h-screen w-full items-stretch justify-center overflow-hidden px-0 pb-0 pt-0">
          <div className="relative flex w-full overflow-hidden bg-black shadow-[0_40px_120px_rgba(0,0,0,0.75)]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_68%_18%,rgba(236,255,244,0.34),transparent_30%),radial-gradient(circle_at_12%_82%,rgba(210,244,255,0.28),transparent_24%),radial-gradient(circle_at_86%_55%,rgba(255,255,255,0.16),transparent_22%)]" />
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(180deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[length:84px_84px] opacity-35" />

            <div className="relative flex min-h-screen w-full overflow-hidden bg-black/70">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_55%_24%,rgba(255,255,255,0.28),transparent_18%),radial-gradient(circle_at_72%_18%,rgba(210,236,218,0.28),transparent_22%),radial-gradient(circle_at_12%_78%,rgba(215,242,255,0.18),transparent_18%),linear-gradient(135deg,rgba(255,255,255,0.02),transparent_42%)]" />
              <div className="pointer-events-none absolute inset-x-8 top-24 h-px bg-gradient-to-r from-transparent via-white/16 to-transparent" />
              <div className="pointer-events-none absolute bottom-0 left-1/2 h-56 w-px -translate-x-1/2 bg-gradient-to-b from-white/50 via-white/12 to-transparent" />
              <div className="pointer-events-none absolute bottom-0 left-[47%] h-48 w-px bg-gradient-to-b from-white/28 via-white/10 to-transparent" />
              <div className="pointer-events-none absolute bottom-0 left-[53%] h-64 w-px bg-gradient-to-b from-white/36 via-white/10 to-transparent" />

              <div className="absolute left-4 top-24 hidden w-56 items-center gap-3 text-left text-white/65 md:flex">
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/12 bg-white/8">
                  <PhoneCall size={14} />
                </span>
                <span className="h-px flex-1 bg-gradient-to-r from-white/20 to-transparent" />
                <span>
                  <span className="block text-xs font-semibold text-white">Appels entrants</span>
                  <span className="text-[10px] text-white/40">+42 aujourd&apos;hui</span>
                </span>
              </div>

              <div className="absolute right-5 top-28 hidden w-56 items-center gap-3 text-left text-white/65 md:flex">
                <span className="h-px flex-1 bg-gradient-to-l from-white/20 to-transparent" />
                <span>
                  <span className="block text-xs font-semibold text-white">Réservations</span>
                  <span className="text-[10px] text-white/40">Confirmées par SMS</span>
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/12 bg-white/8">
                  <CalendarCheck size={14} />
                </span>
              </div>

              <div className="absolute bottom-32 left-6 hidden w-64 items-center gap-3 text-left text-white/65 md:flex">
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/12 bg-white/8">
                  <Utensils size={14} />
                </span>
                <span className="h-px flex-1 bg-gradient-to-r from-white/20 to-transparent" />
                <span>
                  <span className="block text-xs font-semibold text-white">Service fluide</span>
                  <span className="text-[10px] text-white/40">Salle et cuisine alignées</span>
                </span>
              </div>

              <div className="absolute bottom-32 right-6 hidden w-64 items-center gap-3 text-left text-white/65 md:flex">
                <span className="h-px flex-1 bg-gradient-to-l from-white/20 to-transparent" />
                <span>
                  <span className="block text-xs font-semibold text-white">Assistant vocal</span>
                  <span className="text-[10px] text-white/40">Toujours disponible</span>
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/12 bg-white/8">
                  <Bot size={14} />
                </span>
              </div>

              <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center px-5 pb-28 pt-36 text-center sm:px-8 lg:pb-24">
                <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/8 px-4 py-2 text-[11px] font-semibold text-white/76 shadow-2xl shadow-black/20">
                  <Mic size={13} />
                  Sokar active votre standard
                  <ArrowRight size={12} />
                </p>

                <h1 className="mt-7 max-w-4xl text-[2.5rem] font-semibold leading-[0.98] tracking-tight text-white sm:text-6xl md:text-7xl lg:text-[5.5rem] font-display">
                  L&apos;IA devient le nouveau levier de la restauration
                </h1>

                <p className="mx-auto mt-5 max-w-2xl text-sm leading-6 text-white/62 md:text-base">
                  Sokar aide les restaurants à capter chaque demande, fluidifier chaque service et
                  transformer l&apos;accueil client en avantage opérationnel.
                </p>

                <div className="mt-8 flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row">
                  <Link
                    href="/register"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 active:scale-[0.98] sm:w-auto"
                  >
                    Réserver une démo
                    <ArrowRight size={14} />
                  </Link>
                  <Link
                    href="/#demo"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/8 px-6 py-3 text-sm font-semibold text-white shadow-2xl shadow-black/20 transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 active:scale-[0.98] sm:w-auto"
                  >
                    Découvrir
                    <ArrowRight size={14} />
                  </Link>
                </div>
              </div>
            </div>

            <div className="absolute inset-x-0 bottom-0 z-10 hidden grid-cols-2 gap-2 border-t border-white/8 bg-black/70 px-8 py-5 text-center text-[11px] font-semibold text-white/42 sm:grid sm:grid-cols-4 lg:grid-cols-7">
              {[
                'Réservations',
                'SMS',
                'Planning',
                'Clients VIP',
                'Reporting',
                'Google',
                'Dashboard',
              ].map((item) => (
                <div key={item} className="inline-flex items-center justify-center gap-2">
                  <CheckCircle2 size={13} className="text-white/28" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="relative w-full overflow-visible border-t border-white/5 bg-black/80">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_22%_18%,rgba(210,244,255,0.16),transparent_24rem),radial-gradient(circle_at_80%_42%,rgba(236,255,244,0.12),transparent_24rem),linear-gradient(180deg,rgba(255,255,255,0.03),transparent_28rem)]" />
          {/* backdrop-blur removed: was 4 instances here, replaced with bg-black/80 below */}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(180deg,rgba(255,255,255,0.018)_1px,transparent_1px)] bg-[length:96px_96px] opacity-70" />

          <div className="relative mx-auto flex w-full flex-col items-center">
            {/* SCROLL STORYBOARD — Framer Motion cinematic transition inspired by the reference */}
            <ScrollStoryboardSection />

            {/* DEMO — client component with simulator chat */}
            <DemoSection />

            {/* PRICING — client component for toggle interactivity */}
            <PricingSection />

            {/* FAQ — client component for accordion */}
            <FaqSection />
          </div>
        </div>
      </main>

      {/* FOOTER — fully static, server-rendered */}
      <footer className="relative z-10 mt-0 flex w-full flex-col items-center overflow-hidden border-t border-white/5 bg-black/95 px-6 pb-12 pt-16">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_28%_0%,rgba(210,244,255,0.12),transparent_26rem),radial-gradient(circle_at_78%_18%,rgba(236,255,244,0.08),transparent_24rem)]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.018)_1px,transparent_1px)] bg-[length:96px_96px] opacity-60" />
        <div className="absolute inset-x-0 bottom-0 overflow-hidden pointer-events-none select-none flex justify-center -z-10 opacity-30">
          <span
            aria-hidden="true"
            className="stroke-text font-black text-[12vw] tracking-[0.1em] uppercase leading-none select-none"
          >
            SOKAR
          </span>
        </div>

        <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
          <div className="flex flex-col gap-4">
            <Link href="/" className="flex items-center gap-2">
              <Image
                src="/logo-nav.png"
                alt="Sokar"
                width={32}
                height={32}
                className="h-8 w-8 filter drop-shadow-[0_0_10px_rgba(255,255,255,0.15)]"
              />
              <span className="text-lg font-bold text-white font-display">Sokar</span>
            </Link>
            <p className="text-xs text-white/40 leading-relaxed font-sans max-w-xs">
              L&apos;assistant vocal intelligent qui révolutionne la prise de réservations et la
              gestion des appels de votre restaurant.
            </p>
            <div className="flex items-center gap-3 mt-2">
              {[
                {
                  name: 'Twitter',
                  href: '#',
                  icon: (
                    <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                  ),
                },
                {
                  name: 'Facebook',
                  href: '#',
                  icon: (
                    <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
                      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                    </svg>
                  ),
                },
                {
                  name: 'Instagram',
                  href: '#',
                  icon: (
                    <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
                      <path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.281.63 4.07C.333 4.835.132 5.705.072 6.983.015 8.263 0 8.67 0 12s.015 3.737.072 5.017c.06 1.278.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.078 2.126 1.384.765.297 1.635.499 2.913.558C8.333 23.985 8.74 24 12 24s3.737-.015 5.017-.072c1.278-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.078-1.335 1.384-2.126.297-.765.499-1.635.558-2.913.06-1.28.072-1.687.072-5.017s-.015-3.737-.072-5.017c-.06-1.278-.262-2.148-.557-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.635-.499-2.913-.558C15.667.015 15.26 0 12 0zm0 2.162c3.204 0 3.584.012 4.85.07 1.17.054 1.805.249 2.227.415.562.217.96.477 1.378.896.419.42.679.819.896 1.378.164.422.36 1.057.414 2.227.058 1.266.07 1.646.07 4.85s-.012 3.584-.07 4.85c-.054 1.17-.249 1.805-.415 2.227-.217.562-.477.96-.896 1.378-.42.419-.819.679-1.378.896-.422.164-1.057.36-2.227.414-1.266.058-1.646.07-4.85.07s-3.584-.012-4.85-.07c-1.17-.054-1.805-.249-2.227-.415-.562-.217-.96-.477-1.378-.896-.419-.42-.679-.819-.896-1.378-.164-.422-.36-1.057-.414-2.227-.058-1.266-.07-1.646-.07-4.85s.012-3.584.07-4.85c.054-1.17.249-1.805.415-2.227.217-.562.477-.96.896-1.378.42-.419.819-.679 1.378-.896.422-.164 1.057-.36 2.227-.414 1.266-.058 1.646-.07 4.85-.07zM12 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm7.846-10.405a1.44 1.44 0 1 1-2.88 0 1.44 1.44 0 0 1 2.88 0z" />
                    </svg>
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
            <h4 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-white/80 font-sans">
              Produit
            </h4>
            <a
              href="#demo"
              className="text-xs text-white/40 hover:text-white transition-colors duration-200 font-sans py-2 min-h-[44px] flex items-center"
            >
              Démonstration
            </a>
            <a
              href="#tarifs"
              className="text-xs text-white/40 hover:text-white transition-colors duration-200 font-sans py-2 min-h-[44px] flex items-center"
            >
              Tarifs
            </a>
            <a
              href="#faq"
              className="text-xs text-white/40 hover:text-white transition-colors duration-200 font-sans py-2 min-h-[44px] flex items-center"
            >
              FAQ
            </a>
          </div>

          <div className="flex flex-col gap-3">
            <h4 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-white/80 font-sans">
              Entreprise
            </h4>
            <Link
              href="/login"
              className="text-xs text-white/40 hover:text-white transition-colors duration-200 font-sans py-2 min-h-[44px] flex items-center"
            >
              Espace Partenaire
            </Link>
          </div>

          <div className="flex flex-col gap-3">
            <h4 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-white/80 font-sans">
              Légal
            </h4>
            <a
              href="#"
              className="text-xs text-white/40 hover:text-white transition-colors duration-200 font-sans py-2 min-h-[44px] flex items-center"
            >
              Mentions Légales
            </a>
            <a
              href="#"
              className="text-xs text-white/40 hover:text-white transition-colors duration-200 font-sans py-2 min-h-[44px] flex items-center"
            >
              Confidentialité
            </a>
          </div>
        </div>

        <div className="w-full max-w-5xl border-t border-white/5 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs tracking-[0.1em] uppercase text-white/30 font-sans">
            &copy; {new Date().getFullYear()} SOKAR OS. TOUS DROITS RÉSERVÉS.
          </p>
          <div className="flex items-center gap-1.5 text-xs tracking-[0.15em] uppercase text-white/40 bg-white/5 border border-white/10 px-3 py-1 rounded-full font-bold">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
            Bêta Privée
          </div>
        </div>
      </footer>
    </div>
  );
}
// deploy perf test 1783355208
