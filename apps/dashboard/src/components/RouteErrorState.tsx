'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

type RouteErrorStateProps = {
  error: Error & { digest?: string };
  reset: () => void;
  /** Segment name, used only for the diagnostic log. */
  scope: string;
};

/**
 * Fallback partagé des boundaries d'erreur route-level.
 *
 * Capture les exceptions non gérées d'un Server Component (fetch raté au
 * rendu SSR, Clerk indisponible, etc.) AVANT qu'elles ne crashent tout l'arbre
 * React. Le restaurateur voit un message français et un bouton « Réessayer »
 * qui appelle `reset()`.
 *
 * Les erreurs 4xx/5xx de l'API Sokar ne tombent pas ici : chaque page les
 * rattrape et rend un `DataFetchError` inline, qui garde le contexte de la page.
 */
export function RouteErrorState({ error, reset, scope }: RouteErrorStateProps) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(`[${scope}] route error boundary:`, error);
  }, [error, scope]);

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
