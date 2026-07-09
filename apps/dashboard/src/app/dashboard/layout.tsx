import { ReactNode } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, LOCALE_COOKIE, resolveLocale, type Locale } from '@/i18n/config';
import DashboardLayoutClient from './_layout-client';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // Resolve locale from cookie (same logic as root layout)
  const cookieStore = await cookies();
  const locale: Locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value);

  // Les layouts imbriqués doivent aussi appeler setRequestLocale pour que
  // leurs Server Components voient la bonne locale.
  setRequestLocale(locale);
  return <DashboardLayoutClient>{children}</DashboardLayoutClient>;
}
