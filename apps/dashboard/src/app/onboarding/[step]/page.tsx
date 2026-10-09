import { redirect } from 'next/navigation';
import { resolveOnboardingTask } from '@/features/onboarding/types';

/** Les anciennes URL d’étapes ouvrent toutes le parcours principal. */
export default async function OnboardingStepPage({
  params,
}: {
  params: Promise<{ step: string }>;
}) {
  const { step } = await params;
  const target = resolveOnboardingTask(step) ?? 'restaurant';
  redirect(`/onboarding?step=${target}`);
}
