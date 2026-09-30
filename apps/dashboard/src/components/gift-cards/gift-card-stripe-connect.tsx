'use client';

import { useCallback, useEffect, useState } from 'react';
import { useApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getErrorMessage } from '@/types/api';

type ConnectStatus = { connected: boolean; chargesEnabled: boolean; payoutsEnabled: boolean };

export function GiftCardStripeConnect() {
  const { get, post, orgId } = useApi();
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError('');
    try {
      setStatus(await get<ConnectStatus>(`restaurants/${orgId}/gift-cards/stripe-connect`));
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de vérifier votre compte Stripe'));
    } finally {
      setLoading(false);
    }
  }, [get, orgId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function connect() {
    if (!orgId) return;
    setOpening(true);
    setError('');
    try {
      const result = await post<{ url: string }>(
        `restaurants/${orgId}/gift-cards/stripe-connect/onboarding`,
        {},
      );
      window.location.assign(result.url);
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de connecter Stripe'));
      setOpening(false);
    }
  }
  const ready = status?.chargesEnabled && status.payoutsEnabled;
  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <h2 className="font-semibold">Encaissement des cartes cadeaux</h2>
        <p className="text-sm text-muted-foreground">
          {loading
            ? 'Vérification de votre compte Stripe…'
            : ready
              ? 'Votre compte Stripe est prêt. Les ventes sont encaissées directement sur votre compte, avec prélèvement de la commission Sokar.'
              : 'Connectez votre compte Stripe pour encaisser les ventes et recevoir les versements. Cette action est réservée au propriétaire.'}
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          {!ready && (
            <Button
              onClick={connect}
              disabled={loading || opening}
              className="transition-all duration-200"
            >
              {opening
                ? 'Ouverture de Stripe…'
                : status?.connected
                  ? 'Terminer la configuration Stripe'
                  : 'Connecter Stripe'}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={refresh}
            disabled={loading || opening}
            className="transition-all duration-200"
          >
            Actualiser le statut
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
