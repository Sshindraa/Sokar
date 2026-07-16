'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Gift, Package } from 'lucide-react';
import { cn } from '@/lib/utils';

const items = [
  { href: '/dashboard/gift-cards', label: 'Cartes cadeaux', icon: Gift },
  { href: '/dashboard/gift-card-packs', label: 'Packs cadeaux', icon: Package },
];

export function GiftCardSectionNav() {
  const pathname = usePathname();

  return (
    <div className="inline-flex w-fit gap-1 rounded-lg border border-border bg-muted p-1">
      {items.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-all duration-200 hover:text-foreground',
              active && 'bg-background text-foreground shadow-sm',
            )}
          >
            <Icon size={16} />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
