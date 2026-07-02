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
import './globals.css';

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
    <html lang="fr">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
        <footer className="border-t border-border bg-background px-6 py-8 text-center text-sm text-muted-foreground">
          <p>
            Sokar — Réservation en ligne pour restaurants ·{' '}
            <a
              href="/privacy"
              className="text-foreground underline transition-all duration-200 hover:text-ember"
            >
              Politique de confidentialité
            </a>
          </p>
        </footer>
      </body>
    </html>
  );
}
