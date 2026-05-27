'use client';

import Link from 'next/link';
import { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { BarChart3, CalendarCheck, PhoneCall, Settings, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

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
    <div className="dark sokar-page pt-24">
      <div className="sokar-container">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Sokar OS</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Tableau de bord</h1>
          </div>
          <nav className="flex gap-2 overflow-x-auto rounded-full border border-border bg-card/80 p-2 backdrop-blur-xl">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground',
                    active && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
                  )}
                >
                  <Icon size={16} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <main className="min-h-[calc(100vh-14rem)]">{children}</main>
      </div>
    </div>
  );
}
