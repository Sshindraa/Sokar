import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Callyx — Dashboard Restaurateur',
  description: 'Assistant vocal intelligent pour votre restaurant',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-[var(--background)] antialiased">
        {children}
      </body>
    </html>
  );
}
