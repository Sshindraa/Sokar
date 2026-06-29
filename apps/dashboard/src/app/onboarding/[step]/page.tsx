'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { OnboardingProvider, useOnboarding } from '@/features/onboarding/onboarding-provider';
import { OnboardingStepper } from '@/features/onboarding/onboarding-dashboard';
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

  // En mode page dédiée, la complétion d'une étape redirige vers /dashboard
  // (le modal in-dashboard prend le relais pour la suite).
  const handleComplete = (nextStep: OnboardingTaskKey | null) => {
    if (nextStep) {
      router.push(`/onboarding/${nextStep}`);
    } else {
      router.push('/dashboard');
    }
  };

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
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Sokar OS</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">
              Mise en service de l'assistant
            </h1>
          </div>
          <Button variant="outline" asChild className="transition-all duration-200">
            <Link href="/dashboard">
              <ArrowLeft size={16} />
              Retour au dashboard
            </Link>
          </Button>
        </div>

        <OnboardingStepper />

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive transition-all duration-200">
            {error}
          </div>
        )}

        <section className="rounded-lg border border-border bg-card/90 p-4 shadow-xl backdrop-blur-xl transition-all duration-200 md:p-6">
          {StepComponent && <StepComponent onComplete={handleComplete} />}
        </section>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {state.completedCount}/{state.totalCount} étapes validées · {state.progress}% prêt
          </p>
        </div>
      </div>
    </main>
  );
}
