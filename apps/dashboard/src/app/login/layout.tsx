import type { Metadata } from 'next';

// Page de connexion : utile aux restaurateurs, sans intérêt pour les moteurs de recherche.
export const metadata: Metadata = {
  title: 'Connexion — Suppernote',
  robots: { index: false, follow: false },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
