'use client';

import { useState } from 'react';
import { ArrowRight, Loader2, PhoneForwarded, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApi } from '@/lib/api';
import { getErrorMessage } from '@/types/api';
import { useOnboarding } from '../onboarding-provider';
import { StepHeader } from '../ui';
import type { StepProps } from '../types';
import { ONBOARDING_STEP_DELAY_MS } from '@/constants/ui';

export function PhoneStep({ onComplete }: StepProps) {
  const { state, updateTask } = useOnboarding();
  const { post } = useApi();
  const [calling, setCalling] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const phoneNumber = state?.restaurant.phoneNumber ?? '';
  const hasAssignedPhone = Boolean(state?.restaurant.phoneAssigned);
  const managerPhone = state?.restaurant.managerPhone ?? '';

  async function handleTestCall() {
    if (!managerPhone) {
      setTestError("Numéro du restaurant manquant. Revenez à l'étape « Identité du restaurant ».");
      return;
    }
    setCalling(true);
    setTestError(null);
    setTestResult(null);
    try {
      const res = await post<{ ok: boolean; message: string }>('restaurant/onboarding/test-call', {
        phoneNumber: managerPhone,
      });
      await updateTask('first_call', 'phone');
      await updateTask('complete', 'phone');
      await updateTask('activate');
      setTestResult(
        'Assistant vocal configuré. Votre IA répond maintenant au téléphone. Passons à la mise en ligne de votre fiche réservable…',
      );
      window.setTimeout(() => onComplete('connect-identity'), ONBOARDING_STEP_DELAY_MS);
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

  async function handleSkip() {
    await updateTask('skip', 'phone', { reason: 'Pas de test immédiat' });
    onComplete('connect-identity');
  }

  // ─── Phase 1 : pre-permission screen ───────────────────────────
  // Avant d'activer le renvoi d'appel (action opérateur irréversible),
  // on explique exactement ce qui va se passer et on rassure sur la
  // réversibilité. Pattern Brilliant/Centro — réduit la friction sur
  // l'étape la plus engagée du flow voice.
  if (!confirmed) {
    return (
      <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
        <StepHeader
          icon={PhoneForwarded}
          title="Mise en service des appels"
          body="Avant d'activer le renvoi, voici exactement ce qui va se passer et comment garder le contrôle."
        />
        <div className="space-y-4">
          {/* Schéma visuel : du téléphone du restaurant vers Sokar */}
          <div className="rounded-lg border border-border bg-background/60 p-5 transition-colors duration-200">
            <p className="text-sm font-semibold text-foreground">Ce qui va se passer</p>
            <div className="mt-4 flex items-center gap-3">
              <div className="flex-1 rounded-md border border-border bg-muted/30 p-3 text-center">
                <PhoneForwarded size={20} className="mx-auto text-muted-foreground" />
                <p className="mt-1 text-xs text-muted-foreground">Votre téléphone</p>
                <p className="text-sm font-medium text-foreground">{managerPhone || '—'}</p>
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
              Une fois le renvoi activé, les appels arrivant sur votre téléphone seront
              automatiquement transférés vers Sokar. L&apos;assistant vocal répond à votre place,
              prend les réservations et gère les annulations.
            </p>
          </div>

          {/* Rassurance réversibilité */}
          <div className="rounded-lg border border-success/30 bg-success/5 p-4 transition-colors duration-200">
            <div className="flex items-start gap-3">
              <ShieldCheck size={18} className="mt-0.5 shrink-0 text-success" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Vous gardez le contrôle</p>
                <p className="text-sm leading-6 text-muted-foreground">
                  Vous pouvez reprendre la main à tout moment en désactivant le renvoi depuis votre
                  téléphone (composez <span className="font-mono text-foreground">##21#</span> sur
                  la plupart des opérateurs français). Vous restez joignable directement pendant les
                  heures de service si vous préférez décrocher vous-même.
                </p>
              </div>
            </div>
          </div>

          {!hasAssignedPhone && (
            <div className="rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm text-warning transition-colors duration-200">
              Votre numéro dédié sera attribué par l&apos;équipe Sokar. Une fois attribué, vous
              pourrez activer le renvoi et lancer l&apos;appel test.
            </div>
          )}

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
            <Button onClick={handleSkip} variant="ghost" className="transition-colors duration-200">
              Plus tard
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Phase 2 : test call (après confirmation) ──────────────────
  return (
    <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
      <StepHeader
        icon={PhoneForwarded}
        title="Lancer l'appel test"
        body="Activez le renvoi d'appel depuis votre opérateur, puis lancez le test pour entendre l'assistant répondre."
      />
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-background/60 p-4 transition-colors duration-200">
          <p className="text-sm text-muted-foreground font-semibold">Numéro Sokar</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">
            {hasAssignedPhone ? phoneNumber : 'À attribuer'}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-background/60 p-4 text-sm text-muted-foreground transition-colors duration-200">
          Activez le renvoi d&apos;appel depuis l&apos;opérateur du restaurant vers le numéro Sokar,
          puis lancez le test.
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

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            onClick={handleTestCall}
            disabled={calling || !hasAssignedPhone || !managerPhone}
            className="transition-colors duration-200"
          >
            {calling && <Loader2 className="animate-spin" size={16} />}
            {calling ? 'Appel en cours…' : 'Lancer un appel test'}
            <PhoneForwarded size={16} />
          </Button>
          <Button onClick={handleSkip} variant="ghost" className="transition-colors duration-200">
            Plus tard
          </Button>
        </div>
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
