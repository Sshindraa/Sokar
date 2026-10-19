import Link from 'next/link';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { ArrowRight, Bot, CalendarCheck, Mic, PhoneCall, Sparkles, Utensils } from 'lucide-react';
import localFont from 'next/font/local';
import PricingSection from '@/app/PricingSection';
import FaqSection from '@/app/FaqSection';
import MobileNav from '@/components/MobileNav';
import AuthCTA from '@/components/AuthCTA';
import HeroDashboardPreview from '@/components/HeroDashboardPreview';
import SiteFooter from '@/components/footer/SiteFooter';
import SectionSkeleton from '@/components/SectionSkeleton';
import { HOME_METADATA } from '@/app/marketing-metadata';
import './brand-palette.css';
import { BRAND_TITLE } from '@sokar/shared';

export const metadata = HOME_METADATA;

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

// Keep production builds independent from the Google Fonts network endpoint.
const outfit = localFont({
  src: './fonts/outfit-latin.woff2',
  display: 'swap',
  variable: '--font-display',
  weight: '300 900',
});

const jakarta = localFont({
  src: './fonts/plus-jakarta-sans-latin.woff2',
  display: 'swap',
  variable: '--font-sans',
  weight: '300 800',
});

export default function HomePage() {
  return (
    <div
      className={`brand-palette relative min-h-screen w-full bg-background text-foreground flex flex-col justify-between items-center font-sans antialiased ${outfit.variable} ${jakarta.variable}`}
    >
      {/* Liquid Field Background */}
      <div className="liquid-field absolute inset-0 pointer-events-none z-0 overflow-hidden select-none" />

      {/* Bandeau flou derrière le logo et le menu : le contenu défile dessous, flouté. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-40 h-24 bg-black/40 backdrop-blur-xl [mask-image:linear-gradient(to_bottom,black_60%,transparent)]"
      />

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
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_68%_18%,rgba(160,182,212,0.34),transparent_30%),radial-gradient(circle_at_12%_82%,rgba(200,214,232,0.28),transparent_24%),radial-gradient(circle_at_86%_55%,rgba(255,255,255,0.16),transparent_22%)]" />
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(180deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[length:84px_84px] opacity-35" />

            <div className="relative flex min-h-screen w-full overflow-hidden bg-black/70">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_55%_24%,rgba(255,255,255,0.28),transparent_18%),radial-gradient(circle_at_72%_18%,rgba(160,182,212,0.28),transparent_22%),radial-gradient(circle_at_12%_78%,rgba(200,214,232,0.18),transparent_18%),linear-gradient(135deg,rgba(255,255,255,0.02),transparent_42%)]" />
              <div className="pointer-events-none absolute inset-x-8 top-24 h-px bg-gradient-to-r from-transparent via-white/16 to-transparent" />

              <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center px-5 pb-28 pt-36 text-center sm:px-8 lg:pb-24">
                <Link
                  href="/register"
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/8 px-4 py-2 text-[11px] font-semibold text-white/[0.76] shadow-2xl shadow-black/20 transition-all duration-200 hover:bg-white/12 hover:text-white"
                >
                  <Sparkles size={13} aria-hidden="true" />
                  14 jours offerts, sans carte bancaire
                  <ArrowRight size={12} aria-hidden="true" />
                </Link>

                <h1 className="mt-7 max-w-4xl text-[2.5rem] font-semibold leading-[0.98] tracking-tight text-white sm:text-6xl md:text-7xl lg:text-[5.5rem] font-display">
                  {BRAND_TITLE}
                </h1>

                <div className="mt-8 flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row">
                  <Link
                    href="/demo"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 active:scale-[0.98] sm:w-auto"
                  >
                    Demander une démonstration
                    <ArrowRight size={14} />
                  </Link>
                  <Link
                    href="/register"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/8 px-6 py-3 text-sm font-semibold text-white shadow-2xl shadow-black/20 transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 active:scale-[0.98] sm:w-auto"
                  >
                    Essayer 14 jours gratuits
                    <ArrowRight size={14} />
                  </Link>
                </div>

                <HeroDashboardPreview />
              </div>
            </div>
          </div>
        </section>

        <div
          id="services"
          className="relative w-full scroll-mt-24 overflow-visible border-t border-white/5 bg-black/80"
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_22%_18%,rgba(200,214,232,0.16),transparent_24rem),radial-gradient(circle_at_80%_42%,rgba(160,182,212,0.12),transparent_24rem),linear-gradient(180deg,rgba(255,255,255,0.03),transparent_28rem)]" />
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
      <SiteFooter />
    </div>
  );
}
