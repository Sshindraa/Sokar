'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Globe, Check } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { LOCALES, LOCALE_LABELS, LOCALE_COOKIE, type Locale } from '@/i18n/config';
import { cn } from '@/lib/utils';

/**
 * Sélecteur de langue fonctionnel.
 *
 * Lit la locale courante depuis le cookie `NEXT_LOCALE` (ou DEFAULT_LOCALE).
 * Au clic, set le cookie et appelle `router.refresh()` pour recharger
 * les Server Components avec la nouvelle locale.
 *
 * Utilise un dropdown simple (pas Radix) pour éviter une dépendance
 * supplémentaire. Ferme au clic extérieur ou sur Escape.
 */
export function LanguageSwitcher() {
  const t = useTranslations('languageSwitcher');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [currentLocale, setCurrentLocale] = useState<Locale>('fr');
  const ref = useRef<HTMLDivElement>(null);

  // Read the current locale from cookie on mount
  useEffect(() => {
    const match = document.cookie.match(/NEXT_LOCALE=(\w+)/);
    if (match && LOCALES.includes(match[1] as Locale)) {
      setCurrentLocale(match[1] as Locale);
    }
  }, []);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close on Escape
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  function selectLocale(locale: Locale) {
    // Set cookie (1 year expiry)
    document.cookie = `${LOCALE_COOKIE}=${locale};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
    setCurrentLocale(locale);
    setOpen(false);
    // Reload server components with new locale
    router.refresh();
  }

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('current', { label: LOCALE_LABELS[currentLocale] })}
        title={t('label')}
        className="inline-flex h-9 flex-shrink-0 items-center justify-center gap-2 rounded-full border border-border bg-card/80 px-3 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-card hover:text-foreground"
      >
        <Globe size={16} aria-hidden />
        <span>{LOCALE_LABELS[currentLocale]}</span>
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute right-0 top-full z-50 mt-2 min-w-[140px] overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-md"
        >
          {LOCALES.map((locale) => (
            <li key={locale}>
              <button
                type="button"
                role="option"
                aria-selected={locale === currentLocale}
                onClick={() => selectLocale(locale)}
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors duration-150',
                  locale === currentLocale
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )}
              >
                {LOCALE_LABELS[locale]}
                {locale === currentLocale && <Check size={14} aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
