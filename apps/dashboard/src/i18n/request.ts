import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, LOCALES, LOCALE_COOKIE, resolveLocale, type Locale } from './config';

/**
 * Charge les messages pour la locale résolue. Appelé par next-intl côté
 * serveur (Server Components, Server Actions, route handlers).
 *
 * Résolution de la locale (par ordre de priorité) :
 *  1. Cookie `NEXT_LOCALE` (choix explicite de l'utilisateur via LanguageSwitcher)
 *  2. `requestLocale` (passé par next-intl, peut venir du middleware)
 *  3. `DEFAULT_LOCALE` (fr)
 *
 * Si une locale demandée est absente, on retombe sur la locale par défaut
 * plutôt que de 500 — comportement attendu d'un fallback de localisation.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  // 1. Try cookie first (user's explicit choice)
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  let locale = resolveLocale(cookieLocale);

  // 2. Fall back to requestLocale if cookie not set
  if (!cookieLocale) {
    const requested = (await requestLocale) as Locale | undefined;
    if (requested && LOCALES.includes(requested)) {
      locale = requested;
    }
  }

  // 3. Ensure we always have a valid locale
  if (!LOCALES.includes(locale)) {
    locale = DEFAULT_LOCALE;
  }

  const messages = (await import(`../../messages/${locale}.json`)).default;
  return { locale, messages };
});
