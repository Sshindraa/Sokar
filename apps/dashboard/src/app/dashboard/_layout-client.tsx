'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ReactNode } from 'react';
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
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-200',
        demoMode
          ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
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
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card/80 text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground"
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
    <div className={cn(theme, 'sokar-page relative min-h-screen overflow-hidden pt-4 md:pt-6')}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,hsl(var(--foreground)/0.10),transparent_36%),linear-gradient(hsl(var(--border)/0.18)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border)/0.14)_1px,transparent_1px)] bg-[auto,72px_72px,72px_72px] opacity-70" />
      {hasClerkKey && <SyncOrganization />}
      <DashboardOnboardingGate />
      <OnboardingModal />
      <div className="sokar-container relative z-10 px-4 py-3 md:px-8 md:py-4 pb-24 md:pb-8">
        <div className="mb-3 md:mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div>
              <p className="text-xs md:text-sm text-muted-foreground">Sokar OS</p>
              <h1 className="mt-0.5 md:mt-1 text-xl md:text-3xl font-semibold tracking-tight">
                Tableau de bord
              </h1>
            </div>
            <DemoModeToggle />
          </div>
          <div className="flex items-center gap-2">
            {/* Desktop nav pills — hidden on mobile (bottom nav replaces it) */}
            <nav className="dashboard-nav-scroll hidden md:flex gap-2 overflow-x-auto rounded-full border border-border bg-card/80 p-2 backdrop-blur-xl snap-x">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'snap-start inline-flex items-center gap-2 rounded-full px-4 py-2.5 min-h-[44px] text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground whitespace-nowrap touch-manipulation',
                      active &&
                        'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
                    )}
                  >
                    <Icon size={16} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
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
          <DashboardShell>{children}</DashboardShell>
        </DashboardThemeProvider>
      </DemoModeProvider>
    </OnboardingProvider>
  );
}
