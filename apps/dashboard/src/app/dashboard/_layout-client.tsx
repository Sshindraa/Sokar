'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  CalendarCheck,
  PhoneCall,
  Settings,
  Users,
  Sparkles,
  Zap,
  Eye,
  EyeOff,
  HeartHandshake,
  Code,
  LayoutGrid,
  Gift,
  Package,
  Moon,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SyncOrganization } from './SyncOrganization';
import { CreateRestaurantGate } from './CreateRestaurantGate';
import MobileBottomNav from '@/components/MobileBottomNav';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { OnboardingProvider, useOnboarding } from '@/features/onboarding/onboarding-provider';
import {
  DashboardOnboardingGate,
  DashboardOnboardingPanel,
} from '@/features/onboarding/onboarding-dashboard';
import { DemoModeProvider, useDemoMode } from '@/features/onboarding/use-demo-mode';
import { DashboardThemeProvider, useDashboardTheme } from '@/features/theme/dashboard-theme';

// OnboardingModal importe steps.tsx (1725 lignes, tous les composants de step).
// Lazy-load pour éviter de charger tout l'onboarding dans le bundle du dashboard
// quand l'utilisateur n'ouvre jamais le modal.
const OnboardingModal = dynamic(
  () => import('@/features/onboarding/onboarding-modal').then((m) => m.OnboardingModal),
  { ssr: false },
);

// Le libellé de chaque item de nav passe par `useTranslations('nav')`. Les
// icônes et les hrefs ne dépendent pas de la locale, donc ils restent dans
// un tableau de config hors du composant.
type NavKey =
  | 'overview'
  | 'calls'
  | 'reservations'
  | 'floorPlan'
  | 'customers'
  | 'reactivation'
  | 'giftCards'
  | 'giftCardPacks'
  | 'agentic'
  | 'connect'
  | 'widget'
  | 'settings';

const navConfig: { href: string; key: NavKey; icon: LucideIcon }[] = [
  { href: '/dashboard', key: 'overview', icon: BarChart3 },
  { href: '/dashboard/calls', key: 'calls', icon: PhoneCall },
  { href: '/dashboard/reservations', key: 'reservations', icon: CalendarCheck },
  { href: '/dashboard/floor-plan', key: 'floorPlan', icon: LayoutGrid },
  { href: '/dashboard/customers', key: 'customers', icon: Users },
  { href: '/dashboard/reactivation', key: 'reactivation', icon: HeartHandshake },
  { href: '/dashboard/gift-cards', key: 'giftCards', icon: Gift },
  { href: '/dashboard/gift-card-packs', key: 'giftCardPacks', icon: Package },
  { href: '/dashboard/agentic', key: 'agentic', icon: Sparkles },
  { href: '/dashboard/connect', key: 'connect', icon: Zap },
  { href: '/dashboard/widget', key: 'widget', icon: Code },
  { href: '/dashboard/settings', key: 'settings', icon: Settings },
];

function NavItem({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className={cn(
        'snap-start inline-flex items-center justify-center gap-0 rounded-full min-h-[44px] min-w-[44px] px-3 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground whitespace-nowrap touch-manipulation lg:gap-2 lg:px-4',
        active &&
          'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
      )}
    >
      <Icon size={16} />
      <span className="hidden lg:inline">{label}</span>
    </Link>
  );
}

const hasClerkKey = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

function DemoModeToggle() {
  const { state } = useOnboarding();
  const { demoMode, setDemoMode } = useDemoMode();
  const t = useTranslations('dashboard');

  // Le toggle n'est visible que si l'onboarding voice n'est pas terminé
  // (l'utilisateur a besoin de voir la démo pour comprendre le produit).
  if (!hasClerkKey || !state || state.voiceOnboardingDone) return null;

  return (
    <button
      type="button"
      onClick={() => setDemoMode(!demoMode)}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-200',
        demoMode
          ? 'border-warning/50 bg-warning/10 text-warning'
          : 'border-border bg-card/80 text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
      title={demoMode ? t('demoModeTooltipOn') : t('demoModeTooltipOff')}
    >
      {demoMode ? <EyeOff size={14} /> : <Eye size={14} />}
      {demoMode ? t('demoModeOn') : t('demoModeOff')}
    </button>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useDashboardTheme();
  const t = useTranslations('dashboard');
  const isLight = theme === 'light';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="inline-flex h-9 flex-shrink-0 items-center justify-center gap-2 rounded-full border border-border bg-card/80 px-3 text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground"
      title={isLight ? t('themeTooltipLight') : t('themeTooltipDark')}
      aria-label={isLight ? t('themeTooltipLight') : t('themeTooltipDark')}
    >
      {isLight ? <Moon size={16} /> : <Sun size={16} />}
      <span className="hidden text-sm font-medium md:inline">{t('themeToggle')}</span>
    </button>
  );
}

function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { theme } = useDashboardTheme();
  const tNav = useTranslations('nav');
  const tDash = useTranslations('dashboard');

  return (
    <div className={cn(theme, 'sokar-page relative min-h-screen overflow-hidden pt-4 md:pt-6')}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,hsl(var(--foreground)/0.10),transparent_36%),linear-gradient(hsl(var(--border)/0.18)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border)/0.14)_1px,transparent_1px)] bg-[auto,72px_72px,72px_72px] opacity-70" />
      {hasClerkKey && <SyncOrganization />}
      <DashboardOnboardingGate />
      <OnboardingModal />
      <div className="relative z-10 w-full px-4 py-3 md:px-8 md:py-4 pb-24 md:pb-8">
        {/*
          En-tête du dashboard.
          - Mobile (<768 px) : titre et contrôles empilés (justify-between
            sans effet en colonne).
          - iPad (768–1023 px) : on garde l'empilement pour que "Tableau de
            bord" ne soit pas compressé contre les 12 icônes de nav (sinon
            le titre wrappe sur 2 lignes et la nav déborde).
          - Desktop (≥1024 px / `lg`) : titre à gauche, nav + switcher de
            langue + thème à droite sur la même ligne.
        */}
        <div className="mb-3 md:mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div>
              <p className="text-xs md:text-sm text-muted-foreground">{tDash('subdomain')}</p>
              <h1 className="mt-0.5 md:mt-1 text-xl md:text-3xl font-semibold tracking-tight">
                {tDash('pageTitle')}
              </h1>
            </div>
            <DemoModeToggle />
          </div>
          <div className="flex min-w-0 max-w-full items-center gap-2">
            {/*
              Desktop nav pills — hidden on mobile (bottom nav replaces it).
              iPad (768–1023 px) : icône seule, gap resserré, padding réduit,
              `aria-label` pour l'accessibilité (le libellé texte est masqué).
              Desktop (≥1024 px / `lg`) : libellé complet + espacement large.
            */}
            <nav className="dashboard-nav-scroll hidden md:flex min-w-0 flex-1 gap-1 overflow-x-auto rounded-full border border-border bg-card/80 p-1.5 backdrop-blur-xl snap-x lg:gap-2 lg:p-2">
              {navConfig.map((item) => (
                <NavItem
                  key={item.href}
                  href={item.href}
                  label={tNav(item.key)}
                  icon={item.icon}
                  active={pathname === item.href}
                />
              ))}
            </nav>
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </div>
        <DashboardOnboardingPanel />
        <main className="min-h-[calc(100vh-12rem)] md:min-h-[calc(100vh-14rem)]">{children}</main>
      </div>
      {/* Mobile bottom tab bar */}
      <MobileBottomNav />
    </div>
  );
}

export default function DashboardLayoutClient({ children }: { children: ReactNode }) {
  return (
    <OnboardingProvider>
      <DemoModeProvider>
        <DashboardThemeProvider>
          <CreateRestaurantGate>
            <DashboardShell>{children}</DashboardShell>
          </CreateRestaurantGate>
        </DashboardThemeProvider>
      </DemoModeProvider>
    </OnboardingProvider>
  );
}
