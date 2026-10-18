'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock3, RefreshCw, ShieldAlert } from 'lucide-react';
import { useApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getErrorMessage } from '@/types/api';
import { GiftCardStripeOnboarding } from './gift-card-stripe-onboarding';

type ConnectStatus = {
  connected: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  canConfigure: boolean;
  onboardingState?: 'configuration_required' | 'verification_pending' | 'action_required' | 'ready';
  actionItems?: string[];
  deadline?: string | null;
};

export function GiftCardStripeConnect({
  onReadinessChange,
}: {
  onReadinessChange?: (ready: boolean | null) => void;
} = {}) {
  const { get, orgId } = useApi();
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (!orgId) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const result = await get<ConnectStatus>(`restaurants/${orgId}/gift-cards/stripe-connect`, {
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setStatus(result);
        const state =
          result.onboardingState ??
          (result.chargesEnabled && result.payoutsEnabled ? 'ready' : 'configuration_required');
        onReadinessChange?.(result.chargesEnabled && result.payoutsEnabled && state === 'ready');
        setError('');
      }
    } catch (err) {
      if (!controller.signal.aborted)
        setError(getErrorMessage(err, 'Impossible de vérifier votre compte Stripe'));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [get, onReadinessChange, orgId]);
  useEffect(() => {
    setOpening(false);
    setStatus(null);
    setError('');
    onReadinessChange?.(null);
    void refresh();
    return () => request.current?.abort();
  }, [onReadinessChange, refresh]);
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const timer = status?.connected ? window.setInterval(check, 30_000) : undefined;
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [refresh, status?.connected]);

  function closeOnboarding() {
    setOpening(false);
    void refresh();
  }
  const inferredState =
    status?.onboardingState ??
    (status?.chargesEnabled && status.payoutsEnabled ? 'ready' : 'configuration_required');
  const ready =
    inferredState === 'ready' && status?.chargesEnabled === true && status.payoutsEnabled;
  const state = inferredState;
  const stateTitle = {
    configuration_required: 'Configuration à terminer',
    verification_pending: 'Vérification en cours',
    action_required: 'Action requise',
    ready: 'Stripe connecté',
  }[state];
  const stateDescription = ready
    ? 'Les ventes et versements sont actifs.'
    : state === 'verification_pending'
      ? 'Stripe vérifie les informations transmises.'
      : state === 'action_required'
        ? 'Stripe attend une action pour poursuivre.'
        : 'Les ventes et versements sont actuellement désactivés.';
  const canResume =
    status?.canConfigure && (state === 'action_required' || state === 'configuration_required');
  const canManage = status?.canConfigure && ready;
  return (
    <Card>
      <CardContent className="space-y-4 p-4 md:p-5">
        <h2 className="font-semibold">Paiements Stripe</h2>
        {!status && loading ? (
          <p role="status" className="text-sm text-muted-foreground">
            Vérification du statut…
          </p>
        ) : status ? (
          <div className="space-y-4" aria-live="polite">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2 font-medium">
                  {ready ? (
                    <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-primary" />
                  ) : state === 'verification_pending' ? (
                    <Clock3 aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ShieldAlert aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span>{stateTitle}</span>
                </div>
                <p className="text-sm text-muted-foreground">{stateDescription}</p>
                {!status.canConfigure && !ready && state !== 'verification_pending' && (
                  <p className="text-sm text-muted-foreground">
                    Le propriétaire de l’établissement doit terminer la configuration.
                  </p>
                )}
              </div>
              {(canResume || canManage) && !opening && (
                <Button
                  onClick={() => setOpening(true)}
                  disabled={loading || opening}
                  variant={ready ? 'outline' : 'default'}
                  className="transition-all duration-200"
                >
                  {ready
                    ? 'Gérer Stripe'
                    : state === 'action_required'
                      ? 'Traiter les demandes Stripe'
                      : status.connected
                        ? 'Reprendre la configuration'
                        : 'Configurer Stripe'}
                </Button>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2">
                <span className="text-sm">Encaissements</span>
                <span className="text-sm font-medium">
                  {status.chargesEnabled ? 'Actifs' : 'En attente'}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2">
                <span className="text-sm">Versements</span>
                <span className="text-sm font-medium">
                  {status.payoutsEnabled ? 'Actifs' : 'En attente'}
                </span>
              </div>
            </div>
            {status.actionItems && status.actionItems.length > 0 && (
              <ul aria-label="Actions Stripe à effectuer" className="space-y-1 text-sm">
                {status.actionItems.map((item) => (
                  <li key={item} className="text-muted-foreground">
                    {item}
                  </li>
                ))}
              </ul>
            )}
            {status.deadline && (
              <p className="text-sm text-muted-foreground">
                Date limite :{' '}
                {new Intl.DateTimeFormat('fr-FR', {
                  dateStyle: 'short',
                  timeZone: 'Europe/Paris',
                }).format(new Date(status.deadline))}
              </p>
            )}
          </div>
        ) : null}
        {error && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <p role="alert" className="text-sm text-destructive">
              {status ? 'Le statut Stripe n’a pas pu être actualisé.' : error}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refresh()}
              disabled={loading || opening}
              className="transition-all duration-200"
            >
              <RefreshCw aria-hidden="true" size={14} />
              Réessayer
            </Button>
          </div>
        )}
        {opening && orgId && status?.canConfigure && (
          <GiftCardStripeOnboarding key={orgId} restaurantId={orgId} onClose={closeOnboarding} />
        )}
      </CardContent>
    </Card>
  );
}
