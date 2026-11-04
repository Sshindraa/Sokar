import { BillingPage } from '@/features/billing/billing-page';

export const metadata = {
  title: 'Mon abonnement | Suppernote',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <BillingPage />;
}
