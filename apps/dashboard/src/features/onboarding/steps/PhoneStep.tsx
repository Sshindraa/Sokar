'use client';

import { useState } from 'react';
import {
  ArrowRight,
  Check,
  Copy,
  Loader2,
  Phone,
  PhoneForwarded,
  Router,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { getErrorMessage } from '@/types/api';
import { useOnboarding } from '../onboarding-provider';
import { StepHeader, OnboardingAction, OnboardingPreview } from '../ui';
import type { StepProps } from '../types';
import { ONBOARDING_STEP_DELAY_MS } from '@/constants/ui';

type LineType = 'mobile' | 'fixed' | 'box';

const LINE_TYPES: Array<{ value: LineType; label: string; icon: typeof Phone }> = [
  { value: 'mobile', label: 'Mobile', icon: Smartphone },
  { value: 'fixed', label: 'Ligne fixe', icon: Phone },
  { value: 'box', label: 'Box internet', icon: Router },
];

function StepBadge({ n }: { n: number }) {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
      {n}
    </span>
  );
}

/** +33 1 23 45 67 89 → 01 23 45 67 89 : les lignes fixes se composent au format national. */
function toNational(e164: string) {
  return e164.startsWith('+33') ? `0${e164.slice(3)}` : e164;
}

/** Le geste exact pour activer le renvoi, avec le numéro Sokar déjà rempli. */
function lineGuide(type: LineType, sokarNumber: string) {
  if (type === 'mobile') {
    return {
      title: 'Composez ce code depuis le téléphone du restaurant, puis appuyez sur Appeler',
      code: `**21*${sokarNumber}#`,
      help: 'Un message de l’opérateur confirme l’activation.',
      stop: '##21#',
    };
  }
  if (type === 'fixed') {
    return {
      title: 'Composez ce code depuis la ligne fixe du restaurant',
      code: `*21*${toNational(sokarNumber)}#`,
      help: 'Si le code n’est pas reconnu, activez le renvoi depuis l’espace client de votre opérateur.',
      stop: '#21#',
    };
  }
  return {
    title: 'Activez le renvoi dans l’espace client de votre opérateur',
    code: '',
    help: `Rubrique « Renvoi d’appel » de votre abonnement, vers le ${sokarNumber}. Le code à composer dépend de l’opérateur.`,
    stop: '',
  };
}

export function PhoneStep({ onComplete }: StepProps) {
  const { state, updateTask } = useOnboarding();
  const { post } = useApi();
  const [calling, setCalling] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [lineType, setLineType] = useState<LineType>('mobile');
  const [forwardingDone, setForwardingDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [testCallControlId, setTestCallControlId] = useState<string | null>(null);

  const phoneNumber = state?.restaurant.phoneNumber ?? '';
  const hasAssignedPhone = Boolean(state?.restaurant.phoneAssigned);
  const restaurantPhone = state?.restaurant.phoneE164?.trim() ?? '';
  const persistedTestCallControlId = state?.steps.find((step) => step.key === 'phone')?.state
    .metadata?.testCallControlId;
  const pendingTestCallControlId =
    testCallControlId ??
    (typeof persistedTestCallControlId === 'string' ? persistedTestCallControlId : null);

  async function handleCopy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

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
            "Aucun numéro Sokar attribué. L'appel test vérifie que le renvoi arrive jusqu'à ce numéro : l'équipe Sokar doit d'abord vous en attribuer un.",
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

  // ─── Phase 1 : activer le renvoi ───────────────────────────────
  // Le restaurateur choisit son type de ligne, voit le geste exact avec le numéro Sokar déjà
  // rempli, et confirme l'avoir fait : on avance vers l'appel test seulement ensuite.
  if (!confirmed) {
    const sokarNumber = hasAssignedPhone ? phoneNumber : '';
    const guide = lineGuide(lineType, sokarNumber);
    return (
      <div className="space-y-3">
        <StepHeader
          icon={PhoneForwarded}
          title="Mise en service des appels"
          body="Activez le renvoi d'appel vers votre numéro Sokar."
        />
        <div className="max-w-4xl">
          {!hasAssignedPhone ? (
            <p className="rounded-xl border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
              L’appel test vérifie que le renvoi arrive bien jusqu’à votre numéro Sokar : il faut
              donc que l’équipe Sokar vous l’ait attribué. Cette étape se débloquera dès que ce sera
              fait ; vous pouvez continuer les autres étapes en attendant.
            </p>
          ) : (
            <div className="space-y-5 rounded-[1.75rem] border border-border bg-card p-5 sm:p-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                <h3 className="flex shrink-0 items-center gap-2 text-sm font-semibold text-foreground">
                  <StepBadge n={1} />
                  Votre ligne est…
                </h3>
                <div
                  role="group"
                  aria-label="Type de ligne"
                  className="grid flex-1 grid-cols-3 gap-1 rounded-xl bg-muted/50 p-1"
                >
                  {LINE_TYPES.map((option) => {
                    const Icon = option.icon;
                    const active = lineType === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setLineType(option.value)}
                        className={cn(
                          'flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-2 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                          active
                            ? 'bg-foreground text-background shadow-sm'
                            : 'text-muted-foreground hover:bg-background hover:text-foreground',
                        )}
                      >
                        <Icon size={16} aria-hidden />
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <div className="flex flex-col items-stretch justify-between gap-1 rounded-xl border border-border bg-muted/20 p-3">
                  <div className="rounded-lg border border-border bg-background px-3 py-2 text-center">
                    <p className="text-xs text-muted-foreground">Numéro du restaurant</p>
                    <p className="text-base font-semibold tabular-nums text-foreground">
                      {restaurantPhone || '—'}
                    </p>
                  </div>
                  <div className="flex flex-col items-center text-primary" aria-hidden>
                    <span className="h-3 w-px border-l border-dashed border-primary/50" />
                    <ArrowRight size={16} className="rotate-90" />
                  </div>
                  <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-center">
                    <p className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                      <ShieldCheck size={12} className="text-primary" aria-hidden />
                      Numéro Sokar
                    </p>
                    <p className="text-base font-semibold tabular-nums text-foreground">
                      {phoneNumber}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <h3 className="flex items-start gap-2 text-sm font-semibold text-foreground">
                    <StepBadge n={2} />
                    {guide.title}
                  </h3>
                  {guide.code ? (
                    <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 py-2 pl-4 pr-2">
                      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xl font-semibold tracking-wide text-foreground">
                        {guide.code}
                      </code>
                      <Button
                        type="button"
                        variant={copied ? 'default' : 'outline'}
                        onClick={() => handleCopy(guide.code)}
                        className="shrink-0 transition-all duration-200"
                      >
                        {copied ? <Check size={16} /> : <Copy size={16} />}
                        {copied ? 'Copié' : 'Copier'}
                      </Button>
                    </div>
                  ) : null}
                  <p className="text-sm leading-5 text-muted-foreground">
                    {guide.help}
                    {guide.stop ? (
                      <>
                        {' '}
                        Pour arrêter le renvoi :{' '}
                        <span className="font-mono font-medium text-foreground">{guide.stop}</span>
                      </>
                    ) : null}
                  </p>
                </div>
              </div>

              <label
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium text-foreground transition-all duration-200 focus-within:ring-2 focus-within:ring-ring',
                  forwardingDone
                    ? 'border-success/40 bg-success/10'
                    : 'border-border hover:bg-accent',
                )}
              >
                <input
                  type="checkbox"
                  checked={forwardingDone}
                  onChange={(event) => setForwardingDone(event.target.checked)}
                  className="size-5 accent-foreground"
                />
                J’ai activé le renvoi
              </label>
            </div>
          )}

          <OnboardingAction>
            <Button
              type="button"
              onClick={() => setConfirmed(true)}
              disabled={!hasAssignedPhone || !forwardingDone}
              className="transition-all duration-200"
            >
              Continuer
              <ArrowRight size={16} />
            </Button>
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
            L&apos;appel test vérifie que le renvoi arrive jusqu&apos;à votre numéro Sokar : il sera
            disponible dès que l&apos;équipe Sokar vous l&apos;aura attribué. Vous pouvez continuer
            les autres étapes en attendant.
          </p>
        )}
      </div>
    </div>
  );
}
