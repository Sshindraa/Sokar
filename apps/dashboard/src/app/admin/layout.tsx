import { ReactNode } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, resolveLocale, type Locale } from '@/i18n/config';
import AdminLayoutClient from './_layout-client';

export const dynamic = 'force-dynamic';

/**
 * Layout dédié aux opérations Sokar.
 *
 * Il ne monte volontairement ni le sélecteur d'établissement ni l'onboarding
 * restaurant. L'autorisation opérateur est vérifiée côté client pour le rendu
 * et côté API pour chaque donnée sensible.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const locale: Locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  setRequestLocale(locale);

  return <AdminLayoutClient>{children}</AdminLayoutClient>;
}
