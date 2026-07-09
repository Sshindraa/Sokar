/**
 * i18n configuration for the dashboard.
 *
 * Convention: French-first. Le français est la locale par défaut, mais
 * l'anglais, l'espagnol et l'italien sont disponibles. L'utilisateur peut
 * changer de langue via le LanguageSwitcher (cookie `NEXT_LOCALE`).
 *
 * On utilise next-intl 4.x en mode "without i18n routing" : pas de segment
 * `[locale]` dans l'URL, pas de rewrite, pas de middleware. Toutes les routes
 * existantes (Clerk, /widget, /book, /api) restent à leur adresse actuelle.
 * La locale se résout côté serveur via `getRequestConfig()` (lit le cookie
 * `NEXT_LOCALE`) et côté client via `NextIntlClientProvider`. Le jour où on
 * voudra /en/..., il suffira de migrer vers le mode "with i18n routing" —
 * l'API publique des composants (`useTranslations`, `getTranslations`) reste
 * identique.
 */

export const DEFAULT_LOCALE = 'fr' as const;

export const LOCALES = ['fr', 'en', 'es', 'it'] as const;

export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'Français',
  en: 'English',
  es: 'Español',
  it: 'Italiano',
};

/**
 * Cookie name for persisting the user's locale choice.
 * next-intl convention. Set by LanguageSwitcher, read by getRequestConfig.
 */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

/**
 * Resolve the locale from a cookie value, falling back to DEFAULT_LOCALE.
 * Used by getRequestConfig() on the server side.
 */
export function resolveLocale(cookieValue: string | undefined | null): Locale {
  if (cookieValue && LOCALES.includes(cookieValue as Locale)) {
    return cookieValue as Locale;
  }
  return DEFAULT_LOCALE;
}
