'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Boundary d'erreur route-level pour le dashboard et ses sous-routes.
 *
 * Capture les exceptions non gérées d'un Server Component (fetch raté au build
 * SSR, Clerk indisponible, etc.) AVANT qu'elles ne crashent tout l'arbre React.
 * Le user voit un fallback français avec un bouton "Réessayer" qui appelle
 * `reset()` pour re-tenter le rendu de la route.
 *
 * Note : les erreurs 4xx/5xx de l'API Sokar ne tombent PAS ici — elles sont
 * rattrapées par le `try/catch` de chaque page (rendu en ErrorState inline).
 * Ce fichier couvre uniquement les crashes du framework/rendu.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Envoi Sentry / log console. Le dashboard wrappe Sentry dans
    // instrumentation.ts (côté serveur) et providers.tsx (côté client).
    // eslint-disable-next-line no-console
    console.error('[dashboard] route error boundary:', error);
  }, [error]);

  const t = useTranslations('common');

  return (
    <div
      role="alert"
      className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center"
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10">
        <AlertCircle className="h-7 w-7 text-destructive" aria-hidden="true" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-lg font-bold text-foreground md:text-xl">{t('errorTitle')}</h2>
        <p className="max-w-md text-sm text-muted-foreground">{t('errorDescription')}</p>
      </div>
      {error.digest && (
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
          {t('errorDigest', { digest: error.digest })}
        </p>
      )}
      <Button type="button" onClick={reset} className="mt-2 min-h-[44px] gap-2" variant="default">
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
        {t('retry')}
      </Button>
    </div>
  );
}
