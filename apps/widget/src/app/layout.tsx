import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Réserver — Sokar',
  description: 'Réservez une table en quelques secondes.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: 'hsl(240 10% 3.9%)',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground">{children}</body>
    </html>
  );
}
