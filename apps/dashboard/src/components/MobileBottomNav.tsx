'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, CalendarCheck, PhoneCall, Users, Zap } from 'lucide-react';
import { cn, triggerHaptic } from '@/lib/utils';

const navItems = [
  { href: '/dashboard', label: 'Aperçu', icon: BarChart3 },
  { href: '/dashboard/calls', label: 'Appels', icon: PhoneCall },
  { href: '/dashboard/reservations', label: 'Résa', icon: CalendarCheck },
  { href: '/dashboard/customers', label: 'Clients', icon: Users },
  { href: '/dashboard/connect', label: 'Connect', icon: Zap },
];

export default function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 md:hidden border-t border-border bg-background/85 backdrop-blur-xl"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex items-stretch justify-around px-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => triggerHaptic(12)}
              className={cn(
                'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 min-h-[56px] text-[10px] font-medium transition-colors duration-200 touch-manipulation relative',
                active ? 'text-warning' : 'text-muted-foreground active:text-foreground/70',
              )}
            >
              {/* Active indicator dot */}
              {active && (
                <span className="absolute top-1.5 h-[3px] w-5 rounded-full bg-warning animate-in fade-in zoom-in-75 duration-300" />
              )}
              <Icon
                size={20}
                strokeWidth={active ? 2.2 : 1.5}
                className={cn('transition-all duration-200', active && 'scale-110')}
              />
              <span className="tracking-wide">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
