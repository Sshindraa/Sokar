'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import Link from 'next/link';
import { ReactNode, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useSearchParams } from 'next/navigation';
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
  Gift,
  Moon,
  Sun,
  Radio,
  PencilRuler,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SyncOrganization } from './SyncOrganization';
import { CreateRestaurantGate } from './CreateRestaurantGate';
import MobileBottomNav from '@/components/MobileBottomNav';
import { AccountMenu } from '@/components/AccountMenu';
import { OnboardingProvider, useOnboarding } from '@/features/onboarding/onboarding-provider';
import {
  DashboardOnboardingGate,
  DashboardOnboardingPanel,
} from '@/features/onboarding/onboarding-dashboard';
import { DemoModeProvider, useDemoMode } from '@/features/onboarding/use-demo-mode';
import { DashboardThemeProvider, useDashboardTheme } from '@/features/theme/dashboard-theme';
import { useApi } from '@/lib/api';

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
  | 'customers'
  | 'reactivation'
  | 'giftCards'
  | 'agentic'
  | 'connect'
  | 'widget';

const navConfig: { href: string; key: NavKey; icon: LucideIcon }[] = [
  { href: '/dashboard', key: 'overview', icon: BarChart3 },
  { href: '/dashboard/calls', key: 'calls', icon: PhoneCall },
  { href: '/dashboard/reservations', key: 'reservations', icon: CalendarCheck },
  { href: '/dashboard/customers', key: 'customers', icon: Users },
  { href: '/dashboard/reactivation', key: 'reactivation', icon: HeartHandshake },
  { href: '/dashboard/gift-cards', key: 'giftCards', icon: Gift },
  { href: '/dashboard/agentic', key: 'agentic', icon: Sparkles },
  { href: '/dashboard/connect', key: 'connect', icon: Zap },
  { href: '/dashboard/widget', key: 'widget', icon: Code },
];

function SidebarNavItem({
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
        'flex h-10 w-10 flex-none items-center justify-center rounded-xl text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active &&
          'bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground',
      )}
    >
      <Icon size={17} strokeWidth={active ? 2.25 : 1.75} />
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
      className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-border bg-card/80 text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground"
      title={isLight ? t('themeTooltipLight') : t('themeTooltipDark')}
      aria-label={isLight ? t('themeTooltipLight') : t('themeTooltipDark')}
    >
      {isLight ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  );
}

function SettingsButton({ active = false }: { active?: boolean }) {
  const tNav = useTranslations('nav');

  return (
    <Link
      href="/dashboard/settings"
      className={cn(
        'inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-border bg-card/80 text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground',
        active &&
          'border-primary bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
      )}
      title={tNav('settings')}
      aria-label={tNav('settings')}
    >
      <Settings size={16} />
    </Link>
  );
}

function isNavItemActive(pathname: string, item: (typeof navConfig)[number]) {
  return item.key === 'giftCards'
    ? pathname.startsWith('/dashboard/gift-card')
    : pathname === item.href;
}

function DashboardModeSwitcher({ salleMode }: { salleMode: boolean }) {
  return (
    <nav
      aria-label="Espaces Sokar"
      className="fixed left-1/2 top-4 z-50 flex h-12 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card/90 p-1 shadow-xl shadow-background/30 backdrop-blur-xl"
    >
      <Link
        href="/dashboard"
        className={cn(
          'flex h-10 flex-1 items-center justify-center rounded-full px-3 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground',
          !salleMode &&
            'bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground',
        )}
      >
        Copilot
      </Link>
      <Link
        href="/dashboard/floor-plan?view=service-live"
        className={cn(
          'flex h-10 flex-1 items-center justify-center rounded-full px-3 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground',
          salleMode &&
            'bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground',
        )}
      >
        Salle
      </Link>
      <button
        type="button"
        disabled
        title="Bientôt disponible"
        className="flex h-10 flex-1 cursor-not-allowed items-center justify-center whitespace-nowrap rounded-full px-3 text-sm font-medium text-muted-foreground opacity-55"
      >
        Companion
      </button>
    </nav>
  );
}

function DashboardSidebar({ pathname, salleView }: { pathname: string; salleView: string }) {
  const tNav = useTranslations('nav');
  const salleMode = pathname.startsWith('/dashboard/floor-plan');

  return (
    <aside className="fixed bottom-4 left-4 top-4 z-40 hidden w-16 flex-col items-center rounded-[1.4rem] border border-border bg-card/85 p-2 shadow-2xl shadow-background/40 backdrop-blur-xl md:flex">
      <Link
        href="/dashboard"
        aria-label="Sokar"
        title="Sokar"
        className="mb-2 flex h-11 w-11 flex-none items-center justify-center rounded-2xl border border-border bg-background/60 transition-all duration-200 hover:border-foreground/20 hover:bg-accent"
      >
        <Image
          src="/logo-nav.png"
          alt="Sokar"
          width={34}
          height={34}
          className="h-8 w-8"
          priority
        />
      </Link>

      <div className="mb-2 h-px w-7 flex-none bg-border" />

      <nav
        aria-label={salleMode ? 'Navigation Salle' : 'Navigation Copilot'}
        className="dashboard-nav-scroll flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto py-1"
      >
        {salleMode ? (
          <>
            <SidebarNavItem
              href="/dashboard/floor-plan?view=service-live"
              label="Live service"
              icon={Radio}
              active={salleView !== 'edit-plan'}
            />
            <SidebarNavItem
              href="/dashboard/floor-plan?view=edit-plan"
              label="Salle édition"
              icon={PencilRuler}
              active={salleView === 'edit-plan'}
            />
          </>
        ) : (
          navConfig.map((item) => (
            <SidebarNavItem
              key={item.href}
              href={item.href}
              label={tNav(item.key)}
              icon={item.icon}
              active={isNavItemActive(pathname, item)}
            />
          ))
        )}
      </nav>

      <div className="my-2 h-px w-7 flex-none bg-border" />
      <div className="flex flex-none flex-col items-center gap-1.5">
        <ThemeToggle />
        <SettingsButton active={pathname.startsWith('/dashboard/settings')} />
      </div>
    </aside>
  );
}

function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { theme } = useDashboardTheme();
  const { orgId, get } = useApi();
  const [restaurantName, setRestaurantName] = useState('Restaurant');

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void get<{ name?: string }>(`restaurants/${orgId}`)
      .then((restaurant) => {
        if (!cancelled && restaurant.name?.trim()) setRestaurantName(restaurant.name.trim());
      })
      .catch(() => {
        // Le libellé de repli reste affiché si l'identité du restaurant est indisponible.
      });
    return () => {
      cancelled = true;
    };
  }, [get, orgId]);

  return (
    <div className={cn(theme, 'sokar-page relative min-h-screen overflow-hidden pt-[4.5rem]')}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,hsl(var(--foreground)/0.10),transparent_36%),linear-gradient(hsl(var(--border)/0.18)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border)/0.14)_1px,transparent_1px)] bg-[auto,72px_72px,72px_72px] opacity-70" />
      {hasClerkKey && <SyncOrganization />}
      <DashboardOnboardingGate />
      <OnboardingModal />
      <DashboardModeSwitcher salleMode={pathname.startsWith('/dashboard/floor-plan')} />
      <DashboardSidebar pathname={pathname} salleView={searchParams.get('view') ?? ''} />
      <div className="fixed left-24 top-4 z-50 hidden h-12 max-w-[calc(50vw-18rem)] items-center xl:flex">
        <span className="truncate text-lg font-black tracking-tight text-foreground font-display">
          {restaurantName} HQ
        </span>
      </div>
      <div className="fixed right-8 top-4 z-50 hidden h-12 items-center gap-2 xl:flex">
        <DemoModeToggle />
        <AccountMenu />
      </div>
      <div className="relative z-10 w-full px-4 py-3 pb-24 md:pl-24 md:pr-8 md:pb-8 xl:py-3">
        {/*
          En-tête du dashboard.
          - Mobile et tablette (<1280 px) : identité et contrôles restent sur
            une ligne compacte dans le flux.
          - Desktop (≥1280 px) : ils rejoignent la barre supérieure fixe pour
            libérer l'espace vertical du contenu.
        */}
        <div className="mb-3 flex items-center justify-between gap-2 xl:hidden">
          <span className="truncate text-base font-black tracking-tight text-foreground font-display sm:text-lg">
            {restaurantName} HQ
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <DemoModeToggle />
            <div className="flex items-center gap-2 md:hidden">
              <ThemeToggle />
              <SettingsButton active={pathname.startsWith('/dashboard/settings')} />
            </div>
            <AccountMenu />
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
