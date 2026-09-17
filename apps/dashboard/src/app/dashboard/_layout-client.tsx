'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ReactNode, useEffect, useId, useRef, useState } from 'react';
import { SokarLogo } from '@/components/SokarLogo';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  BarChart3,
  CalendarCheck,
  PhoneCall,
  Settings,
  Users,
  Sparkles,
  Zap,
  HeartHandshake,
  Code,
  Gift,
  Moon,
  Sun,
  Radio,
  PencilRuler,
  Megaphone,
  Star,
  Award,
  Ticket,
  Share2,
  ShieldCheck,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SyncOrganization } from './SyncOrganization';
import { CreateRestaurantGate } from './CreateRestaurantGate';
import MobileBottomNav from '@/components/MobileBottomNav';
import { AccountMenu } from '@/components/AccountMenu';
import { OnboardingProvider } from '@/features/onboarding/onboarding-provider';
import {
  DashboardOnboardingGate,
  DashboardOnboardingPanel,
} from '@/features/onboarding/onboarding-dashboard';
import { DashboardThemeProvider, useDashboardTheme } from '@/features/theme/dashboard-theme';
import { useApi } from '@/lib/api';
import { SubscribeFromPricing } from './SubscribeFromPricing';
import { SiteProvider, SiteSwitcher } from '@/features/sites/site-context';

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
  | 'marketing'
  | 'reputation'
  | 'loyalty'
  | 'experiences'
  | 'events'
  | 'distribution'
  | 'reactivation'
  | 'giftCards'
  | 'agentic'
  | 'connect'
  | 'widget'
  | 'admin';

type NavItem = { href: string; key: NavKey; icon: LucideIcon };
type NavGroupId = 'service' | 'customers' | 'growth' | 'offers' | 'channels';

type NavGroup = {
  id: NavGroupId;
  key: NavGroupId;
  icon: LucideIcon;
  items: NavItem[];
};

const overviewNavItem: NavItem = { href: '/dashboard', key: 'overview', icon: BarChart3 };

const navGroups: NavGroup[] = [
  {
    id: 'service',
    key: 'service',
    icon: PhoneCall,
    items: [
      { href: '/dashboard/reservations', key: 'reservations', icon: CalendarCheck },
      { href: '/dashboard/calls', key: 'calls', icon: PhoneCall },
      { href: '/dashboard/floor-plan?view=service-live', key: 'floorPlan', icon: Radio },
      { href: '/dashboard/agentic', key: 'agentic', icon: Sparkles },
    ],
  },
  {
    id: 'customers',
    key: 'customers',
    icon: Users,
    items: [
      { href: '/dashboard/customers', key: 'customers', icon: Users },
      { href: '/dashboard/loyalty', key: 'loyalty', icon: Award },
      { href: '/dashboard/reactivation', key: 'reactivation', icon: HeartHandshake },
    ],
  },
  {
    id: 'growth',
    key: 'growth',
    icon: Megaphone,
    items: [
      { href: '/dashboard/marketing', key: 'marketing', icon: Megaphone },
      { href: '/dashboard/reputation', key: 'reputation', icon: Star },
    ],
  },
  {
    id: 'offers',
    key: 'offers',
    icon: Ticket,
    items: [
      { href: '/dashboard/experiences', key: 'experiences', icon: CalendarCheck },
      { href: '/dashboard/events', key: 'events', icon: Ticket },
      { href: '/dashboard/gift-cards', key: 'giftCards', icon: Gift },
    ],
  },
  {
    id: 'channels',
    key: 'channels',
    icon: Share2,
    items: [
      { href: '/dashboard/connect', key: 'connect', icon: Zap },
      { href: '/dashboard/widget', key: 'widget', icon: Code },
      { href: '/dashboard/distribution', key: 'distribution', icon: Share2 },
    ],
  },
];

function SidebarNavItem({
  href,
  label,
  icon: Icon,
  active,
  expanded = false,
  onClick,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  expanded?: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'flex h-10 flex-none items-center rounded-xl text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        expanded ? 'w-full justify-start gap-3 px-3' : 'w-10 justify-center',
        active &&
          'bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground',
      )}
    >
      <Icon size={17} strokeWidth={active ? 2.25 : 1.75} />
      <span className={cn('truncate text-sm font-medium', !expanded && 'sr-only')}>{label}</span>
    </Link>
  );
}

function SidebarGroupButton({
  id,
  label,
  icon: Icon,
  active,
  open,
  onClick,
}: {
  id: NavGroupId;
  label: string;
  icon: LucideIcon;
  active: boolean;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={open}
      aria-controls={`nav-group-${id}`}
      title={label}
      onClick={onClick}
      className={cn(
        'flex h-10 flex-none items-center rounded-xl text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'w-10 justify-center',
        active && 'bg-accent text-foreground',
      )}
    >
      <Icon size={17} strokeWidth={active ? 2.25 : 1.75} />
      <span className="sr-only">{label}</span>
    </button>
  );
}

const isDemoMode = Boolean(
  process.env.NEXT_PUBLIC_DEMO_RESTAURANT_ID && process.env.NEXT_PUBLIC_DEMO_STAGING,
);
const hasClerkKey = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) && !isDemoMode;
const demoRestaurantId = process.env.NEXT_PUBLIC_DEMO_RESTAURANT_ID;
const defaultRestaurantName = demoRestaurantId ? 'Chez Sokar' : 'Votre restaurant';

function cleanRestaurantName(name: string | undefined) {
  const trimmed = name?.trim() ?? '';
  return trimmed.replace(/\s+HQ\s*$/i, '').trim();
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

function isNavItemActive(pathname: string, item: NavItem) {
  if (item.key === 'giftCards') return pathname.startsWith('/dashboard/gift-card');
  if (item.key === 'customers') return pathname.startsWith('/dashboard/customers');
  if (item.key === 'marketing') return pathname.startsWith('/dashboard/marketing');
  if (item.key === 'loyalty') return pathname.startsWith('/dashboard/loyalty');
  if (item.key === 'experiences') return pathname.startsWith('/dashboard/experiences');
  if (item.key === 'events') return pathname.startsWith('/dashboard/events');
  if (item.key === 'distribution') return pathname.startsWith('/dashboard/distribution');
  if (item.key === 'floorPlan') return pathname.startsWith('/dashboard/floor-plan');
  return pathname === item.href;
}

function isNavGroupActive(pathname: string, group: NavGroup) {
  return group.items.some((item) => isNavItemActive(pathname, item));
}

function DashboardModeSwitcher({
  salleMode,
  compact = false,
}: {
  salleMode: boolean;
  compact?: boolean;
}) {
  const tNav = useTranslations('nav');
  const [companionOpen, setCompanionOpen] = useState(false);
  const companionDialogId = useId();
  const switcherRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!companionOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!switcherRef.current?.contains(event.target as Node)) {
        setCompanionOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCompanionOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [companionOpen]);

  const modeNav = (
    <nav
      aria-label="Espaces Sokar"
      className="dashboard-mode-switcher__nav flex h-12 items-center gap-1 rounded-full border border-border bg-card/90 p-1 shadow-xl shadow-background/30 backdrop-blur-xl"
    >
      <Link
        href="/dashboard"
        aria-current={!salleMode ? 'page' : undefined}
        className={cn(
          'dashboard-mode-switcher__item flex min-w-0 items-center justify-center rounded-lg font-medium text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground',
          'h-10 flex-1 rounded-full px-3 text-sm',
          !salleMode &&
            'bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground',
        )}
      >
        Copilot
      </Link>
      <Link
        href="/dashboard/floor-plan?view=service-live"
        aria-current={salleMode ? 'page' : undefined}
        className={cn(
          'dashboard-mode-switcher__item flex min-w-0 items-center justify-center rounded-lg font-medium text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground',
          'h-10 flex-1 rounded-full px-3 text-sm',
          salleMode &&
            'bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground',
        )}
      >
        Salle
      </Link>
      {!compact && (
        <button
          type="button"
          aria-expanded={companionOpen}
          aria-controls={companionDialogId}
          onClick={() => setCompanionOpen((open) => !open)}
          className={cn(
            'dashboard-mode-switcher__item group relative flex min-w-0 items-center justify-center whitespace-nowrap font-medium text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'h-10 flex-1 gap-2 rounded-full px-3 text-sm',
            companionOpen && 'bg-accent/80 text-foreground',
          )}
        >
          <span>Companion</span>
          <span
            className={cn(
              'dashboard-mode-switcher__coming-soon rounded-full border border-border/80 bg-background/70 font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors group-hover:border-foreground/20 group-hover:text-foreground',
              'px-1.5 py-0.5 text-[9px]',
            )}
          >
            {tNav('comingSoon')}
          </span>
        </button>
      )}
    </nav>
  );

  return (
    <div
      ref={switcherRef}
      className={cn(
        compact
          ? 'dashboard-mobile-only dashboard-mobile-mode-switcher relative z-30 w-full'
          : 'dashboard-desktop-only dashboard-mode-switcher fixed left-1/2 top-4 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2',
      )}
    >
      {modeNav}
      {companionOpen && (
        <div
          id={companionDialogId}
          role="dialog"
          aria-label={tNav('companionSoon')}
          className="dashboard-mode-switcher__dialog absolute left-1/2 top-14 w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-border bg-card/95 p-4 shadow-2xl shadow-background/40 backdrop-blur-xl"
        >
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Sparkles size={17} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{tNav('companionSoon')}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {tNav('companionSoonDescription')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCompanionOpen(false)}
            className="mt-3 w-full rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {tNav('close')}
          </button>
        </div>
      )}
    </div>
  );
}

function DashboardSidebar({
  pathname,
  salleView,
  isSokarOperator,
}: {
  pathname: string;
  salleView: string;
  isSokarOperator: boolean;
}) {
  const tNav = useTranslations('nav');
  const salleMode = pathname.startsWith('/dashboard/floor-plan');
  const [openGroup, setOpenGroup] = useState<NavGroupId | null>(null);
  const openGroupDefinition = navGroups.find((group) => group.id === openGroup) ?? null;

  return (
    <aside className="dashboard-desktop-sidebar fixed bottom-4 left-4 top-4 z-40 w-16 flex-col items-center rounded-[1.4rem] border border-border bg-card/85 p-2 shadow-2xl shadow-background/40 backdrop-blur-xl">
      <Link
        href="/dashboard"
        aria-label="Sokar"
        title="Sokar"
        className="mb-2 flex h-11 w-11 flex-none items-center justify-center rounded-2xl border border-border bg-background/60 transition-all duration-200 hover:border-foreground/20 hover:bg-accent"
      >
        <SokarLogo className="h-8 w-8 text-foreground" />
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
          <>
            <SidebarNavItem
              href={overviewNavItem.href}
              label={tNav(overviewNavItem.key)}
              icon={overviewNavItem.icon}
              active={isNavItemActive(pathname, overviewNavItem)}
              onClick={() => setOpenGroup(null)}
            />
            {navGroups.map((group) => {
              const active = isNavGroupActive(pathname, group);
              const open = openGroup === group.id;

              return (
                <div key={group.id} className="flex flex-none flex-col">
                  <SidebarGroupButton
                    id={group.id}
                    label={tNav(group.key)}
                    icon={group.icon}
                    active={active}
                    open={open}
                    onClick={() => setOpenGroup(open ? null : group.id)}
                  />
                </div>
              );
            })}
          </>
        )}
      </nav>

      {openGroupDefinition && !salleMode && (
        <div
          id={`nav-group-${openGroupDefinition.id}`}
          className="absolute left-20 top-16 z-50 w-56 rounded-2xl border border-border bg-background p-2 shadow-2xl shadow-background/50"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-2 pb-2">
            <span className="text-sm font-semibold text-foreground">
              {tNav(openGroupDefinition.key)}
            </span>
            <button
              type="button"
              aria-label={tNav('collapse')}
              title={tNav('collapse')}
              onClick={() => setOpenGroup(null)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X size={15} />
            </button>
          </div>
          <div className="mt-2 space-y-1">
            {openGroupDefinition.items.map((item) => (
              <SidebarNavItem
                key={item.href}
                href={item.href}
                label={tNav(item.key)}
                icon={item.icon}
                active={isNavItemActive(pathname, item)}
                expanded
                onClick={() => setOpenGroup(null)}
              />
            ))}
          </div>
        </div>
      )}

      {isSokarOperator && !salleMode && (
        <div className="mt-2 flex flex-none flex-col items-center border-t border-border pt-2">
          <SidebarNavItem
            href="/admin"
            label={tNav('admin')}
            icon={ShieldCheck}
            active={pathname.startsWith('/admin')}
            onClick={() => setOpenGroup(null)}
          />
        </div>
      )}

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
  const router = useRouter();
  const { theme } = useDashboardTheme();
  const { orgId, get, isSignedIn } = useApi();
  const [restaurantName, setRestaurantName] = useState(defaultRestaurantName);
  const [operatorAccess, setOperatorAccess] = useState<boolean | null>(null);
  const isLegacyOperatorPath =
    pathname === '/dashboard/usage' ||
    pathname === '/dashboard/admin' ||
    pathname.startsWith('/dashboard/admin/');
  const legacyOperatorDestination =
    pathname === '/dashboard/usage'
      ? '/admin/margin'
      : pathname.replace(/^\/dashboard\/admin(?=\/|$)/, '/admin') || '/admin';

  useEffect(() => {
    let cancelled = false;

    if (!isSignedIn) {
      setOperatorAccess(false);
      return () => {
        cancelled = true;
      };
    }

    setOperatorAccess(null);
    void get<{ allowed?: boolean }>('admin/access')
      .then((response) => {
        if (!cancelled) setOperatorAccess(response.allowed === true);
      })
      .catch(() => {
        // Fail closed: an unavailable capability probe must never reveal an
        // internal navigation item or page to a restaurant account.
        if (!cancelled) setOperatorAccess(false);
      });

    return () => {
      cancelled = true;
    };
  }, [get, isSignedIn]);

  useEffect(() => {
    if (!isLegacyOperatorPath || operatorAccess === null) return;
    if (operatorAccess) {
      router.replace(legacyOperatorDestination);
    } else {
      router.replace('/dashboard');
    }
  }, [isLegacyOperatorPath, legacyOperatorDestination, operatorAccess, router]);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void get<{ name?: string }>(`restaurants/${orgId}`)
      .then((restaurant) => {
        const name = cleanRestaurantName(restaurant.name);
        // Le seed/API de certains environnements historiques renvoie encore
        // « Restaurant ». En démo, garder le nom du restaurant de référence
        // évite d'afficher un en-tête générique ; un compte réel conserve
        // toujours le nom fourni par son établissement.
        const isGenericDemoName = demoRestaurantId && name.toLowerCase() === 'restaurant';
        if (!cancelled && name && !isGenericDemoName) setRestaurantName(name);
      })
      .catch(() => {
        // Le libellé de repli reste affiché si l'identité du restaurant est indisponible.
      });
    return () => {
      cancelled = true;
    };
  }, [get, orgId]);

  return (
    <div className={cn(theme, 'dashboard-shell sokar-page relative min-h-screen overflow-hidden')}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,hsl(var(--foreground)/0.10),transparent_36%),linear-gradient(hsl(var(--border)/0.18)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border)/0.14)_1px,transparent_1px)] bg-[auto,72px_72px,72px_72px] opacity-70" />
      {hasClerkKey && <SyncOrganization />}
      <SubscribeFromPricing />
      <DashboardOnboardingGate />
      <OnboardingModal />
      <DashboardModeSwitcher salleMode={pathname.startsWith('/dashboard/floor-plan')} />
      <DashboardSidebar
        pathname={pathname}
        salleView={searchParams.get('view') ?? ''}
        isSokarOperator={operatorAccess === true}
      />
      <div className="dashboard-desktop-only fixed left-24 top-4 z-50 h-12 max-w-[calc(50vw-18rem)] items-center gap-3">
        <span className="truncate text-lg font-black tracking-tight text-foreground font-display">
          {restaurantName} HQ
        </span>
        <SiteSwitcher />
      </div>
      <div className="dashboard-desktop-only fixed right-8 top-4 z-50 h-12 items-center gap-2">
        <AccountMenu />
      </div>
      <div className="dashboard-shell-content relative z-10 w-full px-4 py-3">
        {/*
          En-tête du dashboard.
          - Téléphone et iPad portrait : identité et contrôles restent sur une
            ligne compacte dans le flux.
          - PC et iPad paysage : ils rejoignent la barre supérieure fixe pour
            libérer l'espace vertical du contenu.
        */}
        <div className="dashboard-flow-header mb-3 gap-3 sm:mb-4">
          <div className="flex min-w-0 items-center gap-2">
            <span className="max-w-32 truncate text-base font-black tracking-tight text-foreground font-display sm:max-w-none sm:text-lg">
              {restaurantName} HQ
            </span>
            <SiteSwitcher className="hidden w-[11rem] max-w-[32vw] sm:flex" />
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <div className="hidden items-center gap-2 sm:flex md:hidden">
                <ThemeToggle />
                <SettingsButton active={pathname.startsWith('/dashboard/settings')} />
              </div>
              <AccountMenu />
            </div>
          </div>
          <DashboardModeSwitcher salleMode={pathname.startsWith('/dashboard/floor-plan')} compact />
        </div>
        <DashboardOnboardingPanel />
        <main className="min-h-[calc(100vh-12rem)] md:min-h-[calc(100vh-14rem)]">
          {isLegacyOperatorPath && operatorAccess !== true ? (
            <div
              className="flex min-h-[calc(100vh-16rem)] items-center justify-center text-sm text-muted-foreground"
              aria-busy="true"
            >
              Vérification des accès…
            </div>
          ) : (
            children
          )}
        </main>
      </div>
      {/* Mobile bottom tab bar */}
      <MobileBottomNav />
    </div>
  );
}

function DashboardSiteBoundary({ children }: { children: ReactNode }) {
  // useApi fournit l'organisation Clerk sans que le provider de sites ait à
  // appeler directement les hooks Clerk. Cela garde le mode démo compatible
  // avec les aperçus locaux sans ClerkProvider.
  const { organizationId } = useApi();
  return <SiteProvider organizationId={organizationId}>{children}</SiteProvider>;
}

export default function DashboardLayoutClient({ children }: { children: ReactNode }) {
  return (
    <OnboardingProvider>
      <DashboardThemeProvider>
        <CreateRestaurantGate>
          <DashboardSiteBoundary>
            <DashboardShell>{children}</DashboardShell>
          </DashboardSiteBoundary>
        </CreateRestaurantGate>
      </DashboardThemeProvider>
    </OnboardingProvider>
  );
}
