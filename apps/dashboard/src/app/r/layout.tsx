import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Ma réservation | Sokar',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default function ReservationManagementLayout({ children }: { children: React.ReactNode }) {
  return children;
}
