'use client';

import { useState } from 'react';
import { ArrowRight, Loader2, PhoneForwarded, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApi } from '@/lib/api';
import { getErrorMessage } from '@/types/api';
import { useOnboarding } from '../onboarding-provider';
import { StepHeader, OnboardingAction, OnboardingPreview } from '../ui';
import type { StepProps } from '../types';
import { ONBOARDING_STEP_DELAY_MS } from '@/constants/ui';

export function PhoneStep({ onComplete }: StepProps) {
  const { state, updateTask } = useOnboarding();
  const { post } = useApi();
  const [calling, setCalling] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [testCallControlId, setTestCallControlId] = useState<string | null>(null);

  const phoneNumber = state?.restaurant.phoneNumber ?? '';
  const hasAssignedPhone = Boolean(state?.restaurant.phoneAssigned);
  const restaurantPhone = state?.restaurant.phoneE164?.trim() ?? '';
  const persistedTestCallControlId = state?.steps.find((step) => step.key === 'phone')?.state
    .metadata?.testCallControlId;
  const pendingTestCallControlId =
    testCallControlId ??
    (typeof persistedTestCallControlId === 'string' ? persistedTestCallControlId : null);

  async function handleTestCall() {
    if (!restaurantPhone) {
      setTestError("Numéro du restaurant manquant. Revenez à l'étape « Votre restaurant ».");
      return;
    }
    setCalling(true);
    setTestError(null);
    setTestResult(null);
    try {
      const res = await post<{ ok: boolean; message: string; callControlId: string }>(
        'restaurant/onboarding/test-call',
        {},
      );
      setTestCallControlId(res.callControlId);
      setTestResult(
        'Appel déclenché. Vérifiez que vous avez bien reçu l’appel et entendu l’assistant, puis confirmez ci-dessous.',
      );
    } catch (err: unknown) {
      // L'API renvoie un code structuré pour différencier les causes d'échec.
      // NO_PHONE_ASSIGNED : action Sokar (pas un retry utilisateur)
      // TELNYX_FAILED    : erreur réseau/opérateur (réessayer)
      // fallback         : message générique
      const errRecord = (err && typeof err === 'object' ? err : {}) as Record<string, unknown>;
      const response = errRecord.response as Record<string, unknown> | undefined;
      const responseData = response?.data as Record<string, unknown> | undefined;
      const code = (errRecord.code as string) ?? (responseData?.code as string);
      const apiMessage = (responseData?.error as string) ?? getErrorMessage(err, '');
      if (code === 'NO_PHONE_ASSIGNED') {
        setTestError(
          apiMessage ??
            "Aucun numéro Sokar attribué. L'équipe Sokar doit d'abord vous attribuer un numéro dédié.",
        );
      } else if (code === 'TELNYX_FAILED') {
        setTestError(
          apiMessage ??
            "L'appel test n'a pas pu être déclenché (opérateur injoignable). Réessayez dans quelques minutes.",
        );
      } else {
        setTestError(apiMessage ?? "L'appel test a échoué. Réessayez ou contactez le support.");
      }
    } finally {
      setCalling(false);
    }
  }

  async function handleConfirmTestCall() {
    if (!pendingTestCallControlId) return;
    setCalling(true);
    setTestError(null);
    try {
      const validated = await updateTask('first_call', 'phone', {
        metadata: { testCallControlId: pendingTestCallControlId },
      });
      if (!validated) {
        setTestError("La confirmation n'a pas été enregistrée. Actualisez la page puis réessayez.");
        return;
      }
      const completed = await updateTask('complete', 'phone');
      if (!completed) {
        setTestError('La validation des appels n’a pas été enregistrée. Réessayez.');
        return;
      }
      const activated = await updateTask('activate');
      if (!activated) {
        setTestError('La mise en service n’a pas été enregistrée. Réessayez.');
        return;
      }
      setTestResult(
        'Assistant vocal validé. Votre IA répond maintenant au téléphone. Passons à la mise en ligne de votre fiche réservable…',
      );
      window.setTimeout(() => onComplete('connect-identity'), ONBOARDING_STEP_DELAY_MS);
    } finally {
      setCalling(false);
    }
  }

  // ─── Phase 1 : pre-permission screen ───────────────────────────
  // Avant d'activer le renvoi d'appel (action opérateur irréversible),
  // on explique exactement ce qui va se passer et on rassure sur la
  // réversibilité. Pattern Brilliant/Centro — réduit la friction sur
  // l'étape la plus engagée du flow voice.
  if (!confirmed) {
    return (
      <div className="space-y-3">
        <StepHeader
          icon={PhoneForwarded}
          title="Mise en service des appels"
          body="Avant d'activer le renvoi, voici exactement ce qui va se passer et comment garder le contrôle."
        />
        <div className="grid max-w-6xl items-start gap-6 lg:grid-cols-2 lg:gap-12">
          {/* Schéma visuel : du téléphone du restaurant vers Sokar */}
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-background p-5 transition-all duration-200">
              <p className="text-sm font-semibold text-foreground">Ce qui va se passer</p>
              <div className="mt-4 flex items-center gap-3">
                <div className="flex-1 rounded-md border border-border bg-muted/30 p-3 text-center">
                  <PhoneForwarded size={20} className="mx-auto text-muted-foreground" />
                  <p className="mt-1 text-xs text-muted-foreground">Votre numéro de restaurant</p>
                  <p className="text-sm font-medium text-foreground">{restaurantPhone || '—'}</p>
                </div>
                <ArrowRight size={18} className="text-muted-foreground" />
                <div className="flex-1 rounded-md border border-primary/30 bg-primary/5 p-3 text-center">
                  <ShieldCheck size={20} className="mx-auto text-primary" />
                  <p className="mt-1 text-xs text-muted-foreground">Numéro Sokar</p>
                  <p className="text-sm font-medium text-foreground">
                    {hasAssignedPhone ? phoneNumber : 'À attribuer'}
                  </p>
                </div>
              </div>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                Une fois le renvoi activé, les appels arrivant sur le numéro du restaurant seront
                automatiquement transférés vers Sokar. L&apos;assistant vocal répond à votre place,
                prend les réservations et gère les annulations.
              </p>
            </div>

            {/* Rassurance réversibilité */}
            <div className="rounded-xl border border-border bg-background p-4 transition-all duration-200">
              <div className="flex items-start gap-3">
                <ShieldCheck size={18} className="mt-0.5 shrink-0 text-success" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">Vous gardez le contrôle</p>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Vous pouvez reprendre la main à tout moment en désactivant le renvoi depuis
                    votre téléphone (composez{' '}
                    <span className="font-mono text-foreground">##21#</span> sur la plupart des
                    opérateurs français). Vous restez joignable directement pendant les heures de
                    service si vous préférez décrocher vous-même.
                  </p>
                </div>
              </div>
            </div>
            {!hasAssignedPhone && (
              <p className="rounded-xl border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
                Votre numéro dédié sera attribué par l’équipe Sokar. Vous pourrez ensuite activer le
                renvoi et lancer l’appel test.
              </p>
            )}
          </div>
          <div className="space-y-4">
            <OnboardingPreview
              eyebrow="Un accueil, même quand vous êtes occupé"
              title="Sokar prend le relais"
              icon={PhoneForwarded}
            >
              <p className="text-xl font-medium leading-8">Chaque appel mérite une réponse.</p>
              <p className="text-sm leading-6 text-background/60">
                Après activation du renvoi, Sokar accueille vos clients, prend leurs réservations et
                gère les annulations.
              </p>
              <div className="border-t border-background/15 pt-4 text-sm">
                <span className="text-background/60">Votre numéro Sokar</span>
                <p className="mt-1 text-xl font-semibold">
                  {hasAssignedPhone ? phoneNumber : 'En attente d’attribution'}
                </p>
              </div>
            </OnboardingPreview>
          </div>

          <OnboardingAction>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                onClick={() => setConfirmed(true)}
                disabled={!hasAssignedPhone}
                className="transition-colors duration-200"
              >
                J&apos;ai compris, continuer
                <ArrowRight size={16} />
              </Button>
            </div>
          </OnboardingAction>
        </div>
      </div>
    );
  }

  // ─── Phase 2 : test call (après confirmation) ──────────────────
  return (
    <div className="space-y-3">
      <StepHeader
        icon={PhoneForwarded}
        title="Lancer l'appel test"
        body="Activez le renvoi d'appel depuis votre opérateur, puis lancez le test pour entendre l'assistant répondre."
      />
      <div className="grid max-w-6xl items-start gap-6 lg:grid-cols-2 lg:gap-12">
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-background p-5 transition-all duration-200">
            <p className="text-sm text-muted-foreground font-semibold">Numéro Sokar</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight">
              {hasAssignedPhone ? phoneNumber : 'À attribuer'}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background/60 p-4 text-sm text-muted-foreground transition-colors duration-200">
            Activez le renvoi d&apos;appel depuis l&apos;opérateur du restaurant vers le numéro
            Sokar, puis lancez le test.
          </div>

          {testResult && (
            <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
              {testResult}
            </div>
          )}
          {testError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {testError}
            </div>
          )}
        </div>
        <OnboardingPreview
          eyebrow="La dernière vérification"
          title="Entendez votre assistant en action"
          icon={PhoneForwarded}
        >
          <p className="text-xl font-medium leading-8">Votre premier appel avec Sokar.</p>
          <ol className="space-y-3 text-sm text-background/70">
            <li>1. Activez le renvoi vers votre numéro Sokar.</li>
            <li>2. Lancez l’appel test vers le numéro du restaurant.</li>
            <li>3. Confirmez après avoir entendu l’assistant.</li>
          </ol>
        </OnboardingPreview>
        <OnboardingAction>
          <div className="flex flex-col gap-2 sm:flex-row">
            {pendingTestCallControlId ? (
              <>
                <Button
                  type="button"
                  onClick={handleConfirmTestCall}
                  disabled={calling}
                  className="transition-colors duration-200"
                >
                  {calling && <Loader2 className="animate-spin" size={16} />}
                  {calling ? 'Confirmation en cours…' : "J'ai reçu l'appel"}
                  <ShieldCheck size={16} />
                </Button>
                <Button
                  type="button"
                  onClick={handleTestCall}
                  disabled={calling || !hasAssignedPhone || !restaurantPhone}
                  variant="outline"
                  className="transition-colors duration-200"
                >
                  Relancer l&apos;appel test
                  <PhoneForwarded size={16} />
                </Button>
              </>
            ) : (
              <Button
                type="button"
                onClick={handleTestCall}
                disabled={calling || !hasAssignedPhone || !restaurantPhone}
                className="transition-colors duration-200"
              >
                {calling && <Loader2 className="animate-spin" size={16} />}
                {calling ? 'Appel en cours…' : 'Lancer un appel test'}
                <PhoneForwarded size={16} />
              </Button>
            )}
          </div>
        </OnboardingAction>
        {!restaurantPhone && (
          <p className="text-xs text-muted-foreground">
            Renseignez le numéro du restaurant à l&apos;étape « Votre restaurant » pour lancer
            l&apos;appel test.
          </p>
        )}
        {!hasAssignedPhone && (
          <p className="text-xs text-muted-foreground">
            L&apos;appel test sera disponible dès qu&apos;un numéro Sokar sera attribué à ce
            restaurant par notre équipe.
          </p>
        )}
      </div>
    </div>
  );
}
