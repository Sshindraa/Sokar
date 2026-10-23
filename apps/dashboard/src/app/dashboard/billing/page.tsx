import { BillingPage } from '@/features/billing/billing-page';

export const metadata = {
  title: 'Mon abonnement | Sokar',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <BillingPage />;
}
