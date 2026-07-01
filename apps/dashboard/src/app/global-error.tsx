'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/**
 * Global error boundary — captures React rendering errors to Sentry.
 * Required by @sentry/nextjs for App Router.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="fr">
      <body>
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <h2 style={{ marginBottom: '0.5rem' }}>Une erreur est survenue</h2>
          <p style={{ color: '#666' }}>Notre équipe a été notifiée. Veuillez rafraîchir la page.</p>
        </div>
      </body>
    </html>
  );
}
