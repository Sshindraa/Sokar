'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  CalendarCheck,
  Circle,
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SyncOrganization } from './SyncOrganization';
import MobileBottomNav from '@/components/MobileBottomNav';
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

const navItems = [
  { href: '/dashboard', label: 'Aperçu', icon: BarChart3 },
  { href: '/dashboard/calls', label: 'Appels', icon: PhoneCall },
  { href: '/dashboard/reservations', label: 'Réservations', icon: CalendarCheck },
  { href: '/dashboard/floor-plan', label: 'Salle', icon: LayoutGrid },
  { href: '/dashboard/customers', label: 'Clients', icon: Users },
  { href: '/dashboard/reactivation', label: 'Réactivation', icon: HeartHandshake },
  { href: '/dashboard/gift-cards', label: 'Cartes cadeaux', icon: Gift },
  { href: '/dashboard/gift-card-packs', label: 'Packs cadeaux', icon: Package },
  { href: '/dashboard/agentic', label: 'Agents IA', icon: Sparkles },
  { href: '/dashboard/connect', label: 'Connect', icon: Zap },
  { href: '/dashboard/widget', label: 'Widget', icon: Code },
  { href: '/dashboard/settings', label: 'Réglages', icon: Settings },
];
const hasClerkKey = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

function DemoModeToggle() {
  const { state } = useOnboarding();
  const { demoMode, setDemoMode } = useDemoMode();

  // Le toggle n'est visible que si l'onboarding voice n'est pas terminé
  // (l'utilisateur a besoin de voir la démo pour comprendre le produit).
  if (!hasClerkKey || !state || state.voiceOnboardingDone) return null;

  return (
    <button
      type="button"
      onClick={() => setDemoMode(!demoMode)}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm transition-all duration-200',
        demoMode
          ? 'border-warning/40 bg-warning/10 text-warning'
          : 'border-border bg-card/80 text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
      title={demoMode ? 'Désactiver le mode démo' : 'Voir le produit avec des données de démo'}
    >
      {demoMode ? <EyeOff size={14} /> : <Eye size={14} />}
      {demoMode ? 'Mode démo actif' : 'Voir la démo'}
    </button>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useDashboardTheme();
  const isLight = theme === 'light';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-border bg-card/85 text-muted-foreground shadow-sm transition-all duration-200 hover:bg-accent hover:text-foreground"
      title={isLight ? 'Passer en mode sombre' : 'Passer en mode clair'}
      aria-label={isLight ? 'Passer en mode sombre' : 'Passer en mode clair'}
    >
      {isLight ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  );
}

function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { theme } = useDashboardTheme();

  return (
    <div
      className={cn(
        theme,
        'sokar-page relative min-h-screen overflow-hidden px-3 py-8 md:px-8 md:py-24',
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,hsl(var(--card)/0.38),transparent_30%),linear-gradient(hsl(var(--card)/0.14)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--card)/0.12)_1px,transparent_1px)] bg-[auto,80px_80px,80px_80px] opacity-80" />
      {hasClerkKey && <SyncOrganization />}
      <DashboardOnboardingGate />
      <OnboardingModal />
      <div className="relative z-10 mx-auto w-full max-w-4xl overflow-hidden rounded-[1.25rem] border border-card/70 bg-card/78 p-2.5 shadow-[0_24px_80px_hsl(var(--foreground)/0.16)] backdrop-blur-2xl">
        <div className="mb-2.5 flex flex-col gap-2 rounded-[1rem] border border-border/70 bg-card/82 px-3 py-2 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex flex-shrink-0 items-center gap-3">
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-sm">
              <Sparkles size={16} />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-foreground">
                Sokar
              </p>
            </div>
            <DemoModeToggle />
          </div>
          <div className="flex min-w-0 max-w-full items-center gap-3">
            {/* Desktop nav pills — hidden on mobile (bottom nav replaces it) */}
            <nav className="dashboard-nav-scroll hidden min-w-0 flex-1 snap-x gap-5 overflow-x-auto px-1 md:flex">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'snap-start inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap text-[10px] font-medium text-muted-foreground transition-all duration-200 touch-manipulation hover:text-foreground',
                      active && 'text-foreground',
                    )}
                  >
                    {active ? <Icon size={13} /> : <Circle size={5} fill="currentColor" />}
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
            <div className="hidden h-8 w-48 flex-shrink-0 items-center rounded-full border border-border bg-secondary/60 px-3 text-[10px] text-muted-foreground shadow-inner lg:flex">
              Rechercher une réservation...
            </div>
            <ThemeToggle />
          </div>
        </div>
        <DashboardOnboardingPanel />
        <main className="min-h-[calc(100vh-12rem)] rounded-[1rem] md:min-h-[34rem]">
          {children}
        </main>
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
          <DashboardShell>{children}</DashboardShell>
        </DashboardThemeProvider>
      </DemoModeProvider>
    </OnboardingProvider>
  );
}
