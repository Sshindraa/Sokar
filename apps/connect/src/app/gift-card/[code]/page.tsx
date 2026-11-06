import { GiftCardBeneficiaryPage } from '@/components/gift-card-beneficiary';
export const metadata = {
  title: 'Votre carte cadeau — Suppernote',
  robots: { index: false, follow: false },
};
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <GiftCardBeneficiaryPage code={code} />;
}
