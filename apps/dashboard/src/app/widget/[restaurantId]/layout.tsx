import type { Metadata } from 'next';

// Widget de réservation intégré aux sites des restaurants : ne doit pas apparaître dans les moteurs.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function WidgetLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
