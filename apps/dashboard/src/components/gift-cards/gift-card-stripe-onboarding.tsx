'use client';

import { useEffect, useRef, useState } from 'react';
import type { StripeConnectInstance } from '@stripe/connect-js';
import { ConnectAccountOnboarding, ConnectComponentsProvider } from '@stripe/react-connect-js';
import { LoaderCircle } from 'lucide-react';
import { useApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { getErrorMessage } from '@/types/api';

type Session = { clientSecret: string; publishableKey: string };

export function GiftCardStripeOnboarding({
  restaurantId,
  onClose,
}: {
  restaurantId: string;
  onClose: () => void;
}) {
  const { post } = useApi();
  const [instance, setInstance] = useState<StripeConnectInstance | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    let connect: StripeConnectInstance | undefined;
    const abort = new AbortController();
    setInstance(null);
    setError('');
    const fetchSession = () =>
      post<Session>(
        `restaurants/${restaurantId}/gift-cards/stripe-connect/session`,
        {},
        { signal: abort.signal },
      );
    async function start() {
      try {
        const [{ loadConnectAndInitialize }, session] = await Promise.all([
          import('@stripe/connect-js/pure'),
          fetchSession(),
        ]);
        if (!active) return;
        let firstSecret: string | undefined = session.clientSecret;
        const tokens = getComputedStyle(document.documentElement);
        // Connect.js accepts legacy comma-separated HSL and pixel radii.
        const color = (token: string) =>
          `hsl(${tokens.getPropertyValue(token).trim().split(/\s+/).join(', ')})`;
        const containerStyle = container.current ? getComputedStyle(container.current) : undefined;
        connect = loadConnectAndInitialize({
          publishableKey: session.publishableKey,
          locale: 'fr-FR',
          appearance: {
            overlays: 'dialog',
            variables: {
              colorPrimary: color('--primary'),
              colorBackground: color('--background'),
              colorText: color('--foreground'),
              colorDanger: color('--destructive'),
              borderRadius: containerStyle?.borderRadius,
              fontFamily: containerStyle?.fontFamily,
            },
          },
          fetchClientSecret: async () => {
            if (!active) throw new Error('Configuration fermée.');
            if (firstSecret) {
              const secret = firstSecret;
              firstSecret = undefined;
              return secret;
            }
            try {
              const renewed = await fetchSession();
              if (!active) throw new Error('Configuration fermée.');
              return renewed.clientSecret;
            } catch {
              if (active)
                setError(
                  'La session a été interrompue. Veuillez réessayer pour reprendre votre configuration.',
                );
              throw new Error('Impossible de renouveler la session de configuration.');
            }
          },
        });
        setInstance(connect);
      } catch (err) {
        if (active)
          setError(
            getErrorMessage(err, 'Impossible de charger la configuration des encaissements.'),
          );
      }
    }
    void start();
    return () => {
      active = false;
      abort.abort();
      void connect?.logout().catch(() => undefined);
    };
  }, [restaurantId, post, attempt]);

  return (
    <div
      ref={container}
      className="space-y-4 rounded-lg border border-border bg-background p-6 text-foreground"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">Configurer les encaissements</h3>
        <Button variant="outline" onClick={onClose} className="transition-all duration-200">
          Fermer et reprendre plus tard
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Renseignez les informations de votre établissement et votre compte bancaire ici. Votre
        progression est enregistrée par Stripe. Une fenêtre peut s’ouvrir pour vérifier votre
        connexion.
      </p>
      {error ? (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          <Button
            onClick={() => setAttempt((value) => value + 1)}
            className="transition-all duration-200"
          >
            Réessayer la configuration
          </Button>
        </div>
      ) : instance ? (
        <ConnectComponentsProvider connectInstance={instance}>
          <ConnectAccountOnboarding
            onExit={onClose}
            onLoadError={() =>
              setError('Le formulaire Stripe n’a pas pu être chargé. Veuillez réessayer.')
            }
          />
        </ConnectComponentsProvider>
      ) : (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
          Chargement du formulaire sécurisé…
        </p>
      )}
    </div>
  );
}
