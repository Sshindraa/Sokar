'use client';

import { RouteErrorState } from '@/components/RouteErrorState';

/**
 * Boundary d'erreur route-level pour `/dashboard` et toutes ses sous-routes
 * (réservations, appels, clients, marketing, plan de salle, …).
 *
 * Le rendu est partagé avec les autres segments applicatifs : voir
 * `components/RouteErrorState.tsx`.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorState error={error} reset={reset} scope="dashboard" />;
}
