'use client';
 
import Link from 'next/link';
import { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { BarChart3, CalendarCheck, PhoneCall, Settings, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SyncOrganization } from './SyncOrganization';
import MobileBottomNav from '@/components/MobileBottomNav';
 
const navItems = [
  { href: '/dashboard', label: 'Aperçu', icon: BarChart3 },
  { href: '/dashboard/calls', label: 'Appels', icon: PhoneCall },
  { href: '/dashboard/reservations', label: 'Réservations', icon: CalendarCheck },
  { href: '/dashboard/customers', label: 'Clients', icon: Users },
  { href: '/dashboard/settings', label: 'Réglages', icon: Settings },
];
 
export default function DashboardLayoutClient({ children }: { children: ReactNode }) {
  const pathname = usePathname();
 
  return (
    <div className="dark sokar-page pt-4 md:pt-6">
      <SyncOrganization />
      <div className="sokar-container px-4 py-3 md:px-8 md:py-4 pb-24 md:pb-8">
        <div className="mb-3 md:mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs md:text-sm text-muted-foreground">Sokar OS</p>
            <h1 className="mt-0.5 md:mt-1 text-xl md:text-3xl font-semibold tracking-tight">Tableau de bord</h1>
          </div>
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
                    active && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
                  )}
                >
                  <Icon size={16} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
        <main className="min-h-[calc(100vh-12rem)] md:min-h-[calc(100vh-14rem)]">{children}</main>
      </div>
      {/* Mobile bottom tab bar */}
      <MobileBottomNav />
    </div>
  );
}
