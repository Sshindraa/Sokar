'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { useSiteSelection } from '@/features/sites/site-context';
import { canOpenNavEntry, findNavSection, isNavEntryActive } from '@/features/navigation/sections';

// Liens texte de la section courante, en haut de chaque page de section.
export function SectionTabs() {
  const pathname = usePathname();
  const tNav = useTranslations('nav');
  const { activeSite } = useSiteSelection();
  const section = findNavSection(pathname);
  if (!section) return null;

  const entries = section.entries.filter(
    (entry) => !entry.spaceSwitch && canOpenNavEntry(entry, activeSite?.role),
  );
  if (entries.length < 2) return null;

  return (
    <nav aria-label={tNav(section.labelKey)} className="mb-6 min-w-0">
      <div className="scrollbar-none flex gap-5 overflow-x-auto overscroll-x-contain">
        {entries.map((entry) => {
          const active = isNavEntryActive(pathname, entry);
          return (
            <Link
              key={entry.href}
              href={entry.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'shrink-0 whitespace-nowrap rounded-md text-sm text-muted-foreground transition-all duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active && 'font-medium text-foreground',
              )}
            >
              {tNav(entry.key)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
