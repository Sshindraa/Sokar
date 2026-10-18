import type { Metadata } from 'next';

// Page d'inscription : utile aux restaurateurs, sans intérêt pour les moteurs de recherche.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
