import Link from 'next/link';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { ArrowRight } from 'lucide-react';
import localFont from 'next/font/local';
import PricingSection from '@/app/PricingSection';
import FaqSection from '@/app/FaqSection';
import MobileNav from '@/components/MobileNav';
import AuthCTA from '@/components/AuthCTA';
import ServiceDaySection from '@/app/ServiceDaySection';
import SiteFooter from '@/components/footer/SiteFooter';
import SectionSkeleton from '@/components/SectionSkeleton';
import { HOME_METADATA } from '@/app/marketing-metadata';
import './brand-palette.css';
import { BRAND_TITLE } from '@sokar/shared';

export const metadata = HOME_METADATA;

// SSR les sections pour éviter le flash de skeleton sur 4G.
// DemoSection : useState/useEffect seulement, pas de window/document direct.
const DemoSection = dynamic(() => import('@/app/DemoSection'), {
  loading: () => <SectionSkeleton />,
});

// Keep production builds independent from the Google Fonts network endpoint.
const outfit = localFont({
  src: './fonts/outfit-latin.woff2',
  display: 'swap',
  variable: '--font-display',
  weight: '300 900',
});

// Police de marque : réservée au mot-symbole et au titre principal.
const fraunces = localFont({
  src: './fonts/fraunces-latin.woff2',
  display: 'swap',
  variable: '--font-brand',
  weight: '400 700',
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
      className={`brand-palette relative min-h-screen w-full bg-background text-foreground flex flex-col justify-between items-center font-sans antialiased ${outfit.variable} ${fraunces.variable} ${jakarta.variable}`}
    >
      {/* Logo : posé sur le fond clair, il défile avec la page */}
      <Link
        href="/"
        className="absolute left-4 top-5 z-50 hidden h-[52px] md:flex items-center gap-2 rounded-full transition-all duration-200 hover:opacity-80 sm:left-6"
      >
        <Image
          src="/logo-nav.png"
          alt="Suppernote"
          width={36}
          height={36}
          className="h-9 w-9 brightness-0 sm:h-10 sm:w-10"
          priority
        />
        <span className="hidden text-2xl font-medium tracking-tight text-background font-brand sm:inline">
          Suppernote
        </span>
      </Link>

      {/* Floating navbar */}
      <div className="fixed left-1/2 top-5 z-50 -translate-x-1/2 flex items-center">
        <nav className="flex items-center gap-2 rounded-full border border-white/10 bg-black/80 px-3 py-2 backdrop-blur-md">
          {/* Logo inside navbar on mobile */}
          <Link
            href="/"
            className="flex items-center gap-1.5 md:hidden pl-1 hover:opacity-80 transition-opacity"
          >
            <Image
              src="/logo-nav.png"
              alt="Suppernote"
              width={28}
              height={28}
              className="h-7 w-7"
            />
          </Link>
          <span className="h-4 w-px bg-white/10 md:hidden mx-1" />

          <div className="hidden items-center gap-1 md:flex">
            {[
              { label: 'La journée', href: '/#services' },
              { label: 'Aperçu', href: '/#demo' },
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
        <section className="day-paper day-halo-day w-full">
          <div className="mx-auto flex max-w-4xl flex-col items-center px-5 pb-4 pt-32 text-center sm:px-8 sm:pt-32">
            <h1 className="text-balance font-brand text-[2.5rem] font-medium leading-[1.06] tracking-[-0.01em] sm:text-6xl md:text-7xl">
              {BRAND_TITLE}
            </h1>
            <p className="day-muted mt-6 max-w-2xl text-balance text-lg leading-relaxed">
              Suppernote prend vos réservations par téléphone et en ligne, organise votre salle et
              garde la mémoire de vos clients.
            </p>
            <div className="mt-8 flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row">
              <Link
                href="/demo"
                className="day-cta inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] sm:w-auto"
              >
                Demander une démonstration
                <ArrowRight size={14} />
              </Link>
              <Link
                href="/register"
                className="day-cta-secondary inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] sm:w-auto"
              >
                Essayer 14 jours gratuits
                <ArrowRight size={14} />
              </Link>
            </div>
            <p className="day-muted mt-4 text-xs">Sans carte bancaire</p>
          </div>
        </section>

        <ServiceDaySection />

        <div className="relative w-full overflow-visible bg-black">
          <div className="relative mx-auto flex w-full flex-col items-center">
            {/* PRICING — client component for toggle interactivity */}
            <PricingSection />

            {/* DEMO — client component with simulator chat */}
            <DemoSection />

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
