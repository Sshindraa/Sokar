import { redirect } from 'next/navigation';
import { resolveOnboardingView } from '@/features/onboarding/tracks';

/** Les anciennes URL d’étapes, comme l’écran des canaux, ouvrent toutes le parcours principal. */
export default async function OnboardingStepPage({
  params,
}: {
  params: Promise<{ step: string }>;
}) {
  const { step } = await params;
  const target = resolveOnboardingView(step) ?? 'restaurant';
  redirect(`/onboarding?step=${target}`);
}
