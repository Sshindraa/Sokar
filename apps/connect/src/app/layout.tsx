/**
 * Sokar Connect — Root layout.
 *
 * Pas de Clerk, pas de header restaurateur, pas de bundle dashboard.
 * Cf. spec connect-v1.1 §3.2 : "Zéro Clerk, zéro cookie auth, zéro header
 * restaurateur dans le HTML rendu aux crawlers".
 *
 * Le <head> est minimal pour ne pas gonfler le HTML initial (< 100 KB cible).
 */

import type { Metadata, Viewport } from 'next';
import { Outfit, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { Footer } from '@/components/footer';

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800', '900'],
  variable: '--font-display',
  display: 'swap',
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'https://sokar.tech'),
  title: {
    default: 'Sokar — Réservez en ligne',
    template: '%s | Sokar',
  },
  description:
    'Sokar rend votre restaurant réservable depuis Google, ChatGPT et les assistants IA.',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-snippet': -1,
      'max-image-preview': 'large',
      'max-video-preview': -1,
    },
  },
  openGraph: {
    type: 'website',
    siteName: 'Sokar',
    locale: 'fr_FR',
  },
  twitter: {
    card: 'summary_large_image',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#EA580C',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${outfit.variable} ${jakarta.variable}`}>
      <body
        className="min-h-screen bg-background text-foreground antialiased"
        style={{ fontFamily: 'var(--font-body), ui-sans-serif, system-ui, sans-serif' }}
      >
        {children}
        <Footer />
      </body>
    </html>
  );
}
