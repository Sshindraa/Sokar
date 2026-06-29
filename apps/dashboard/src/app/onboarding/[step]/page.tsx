'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { OnboardingProvider, useOnboarding } from '@/features/onboarding/onboarding-provider';
import { OnboardingStepper } from '@/features/onboarding/onboarding-dashboard';
import { OnboardingNavFooter } from '@/features/onboarding/onboarding-nav-footer';
import { STEP_COMPONENTS, STEP_KEYS } from '@/features/onboarding/steps';
import type { OnboardingTaskKey } from '@/features/onboarding/types';
import { SyncOrganization } from '@/app/dashboard/SyncOrganization';

const hasClerkKey = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export default function OnboardingStepPage() {
  return (
    <OnboardingProvider>
      {hasClerkKey && <SyncOrganization />}
      <OnboardingStepContent />
    </OnboardingProvider>
  );
}

function OnboardingStepContent() {
  const params = useParams();
  const router = useRouter();
  const step = params.step as OnboardingTaskKey;
  const { state, loading, error } = useOnboarding();

  useEffect(() => {
    if (!STEP_KEYS.includes(step)) {
      router.replace('/onboarding/restaurant');
    }
  }, [router, step]);

  // En mode page dédiée, la complétion d'une étape redirige vers l'étape
  // suivante (toujours en page dédiée). L'utilisateur peut aussi naviguer
  // librement via le footer prev/next.
  const handleComplete = (nextStep: OnboardingTaskKey | null) => {
    if (nextStep) {
      router.push(`/onboarding/${nextStep}`);
    } else {
      router.push('/dashboard');
    }
  };

  const goToStep = (target: OnboardingTaskKey) => router.push(`/onboarding/${target}`);
  const currentIdx = STEP_KEYS.indexOf(step);
  const prevStep = currentIdx > 0 ? STEP_KEYS[currentIdx - 1] : null;
  const nextStep =
    currentIdx >= 0 && currentIdx < STEP_KEYS.length - 1 ? STEP_KEYS[currentIdx + 1] : null;

  if (loading || !state) {
    return (
      <main className="dark sokar-page min-h-screen p-6 pt-28 md:p-8 md:pt-32">
        <div className="mx-auto max-w-6xl space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </main>
    );
  }

  const StepComponent = STEP_COMPONENTS[step];

  return (
    <main className="dark sokar-page relative min-h-screen overflow-hidden p-4 pt-28 md:p-8 md:pt-32">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,hsl(var(--foreground)/0.10),transparent_36%),linear-gradient(hsl(var(--border)/0.18)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border)/0.14)_1px,transparent_1px)] bg-[auto,72px_72px,72px_72px] opacity-70" />
      <div className="relative z-10 mx-auto max-w-6xl space-y-5">
        <OnboardingNavFooter
          currentStep={step}
          onPrev={prevStep ? () => goToStep(prevStep) : null}
          onNext={nextStep ? () => goToStep(nextStep) : null}
          onExit={() => router.push('/dashboard')}
          completedCount={state.completedCount}
          totalCount={state.totalCount}
          progress={state.progress}
        />

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Sokar OS</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">
              Mise en service de l&apos;assistant
            </h1>
          </div>
        </div>

        <OnboardingStepper />

        {step === 'restaurant' && state.completedCount === 0 && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm transition-all duration-200">
            <p className="font-semibold text-foreground">
              Bienvenue dans la mise en service de votre assistant vocal.
            </p>
            <p className="mt-1 text-muted-foreground">
              10 étapes en deux temps : <strong>5 étapes Voice</strong> (~10 min) pour configurer
              votre assistant téléphonique, puis <strong>5 étapes Connect</strong> (~8 min) pour
              mettre en ligne votre fiche réservable. À la fin, votre IA répond au téléphone et vos
              clients peuvent réserver en ligne.
            </p>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive transition-all duration-200">
            {error}
          </div>
        )}

        <section className="rounded-lg border border-border bg-card/90 p-4 shadow-xl backdrop-blur-xl transition-all duration-200 md:p-6">
          {StepComponent && <StepComponent onComplete={handleComplete} />}
        </section>
      </div>
    </main>
  );
}
