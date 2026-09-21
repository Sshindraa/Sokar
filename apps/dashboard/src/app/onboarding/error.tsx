'use client';

import { RouteErrorState } from '@/components/RouteErrorState';

/**
 * Boundary d'erreur du parcours d'inscription (`/onboarding/[step]`).
 * Un crash ici ne doit pas renvoyer un nouvel inscrit vers une page blanche :
 * il doit pouvoir réessayer sans perdre son contexte.
 */
export default function OnboardingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorState error={error} reset={reset} scope="onboarding" />;
}
