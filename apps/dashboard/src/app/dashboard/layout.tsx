import { ReactNode } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { cookies } from 'next/headers';
import localFont from 'next/font/local';
import { DEFAULT_LOCALE, LOCALE_COOKIE, resolveLocale, type Locale } from '@/i18n/config';
import DashboardLayoutClient from './_layout-client';

export const dynamic = 'force-dynamic';

// Police du mot-symbole, la même que sur la page d'accueil (classe `font-brand`).
const fraunces = localFont({
  src: '../fonts/fraunces-latin.woff2',
  display: 'swap',
  variable: '--font-brand',
  weight: '400 700',
});

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // Resolve locale from cookie (same logic as root layout)
  const cookieStore = await cookies();
  const locale: Locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value);

  // Les layouts imbriqués doivent aussi appeler setRequestLocale pour que
  // leurs Server Components voient la bonne locale.
  setRequestLocale(locale);
  const crmQualificationRestaurantIds = (process.env.CRM_QUALIFICATION_RESTAURANT_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id && id !== '*');
  return (
    <div className={`${fraunces.variable} contents`}>
      <DashboardLayoutClient crmQualificationRestaurantIds={crmQualificationRestaurantIds}>
        {children}
      </DashboardLayoutClient>
    </div>
  );
}
