'use client';

import { RouteErrorState } from '@/components/RouteErrorState';

/**
 * Boundary d'erreur pour l'espace opérateur `/admin` (santé, marge,
 * provisioning). Sans ce fichier, un crash de rendu y tombait dans la boundary
 * du segment `/dashboard`, qui n'est pas son parent.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorState error={error} reset={reset} scope="admin" />;
}
