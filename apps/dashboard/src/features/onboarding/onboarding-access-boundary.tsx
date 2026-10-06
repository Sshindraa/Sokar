'use client';

import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useOnboarding } from './onboarding-provider';
import { ONBOARDING_TASK_KEYS } from './types';

/** Un parcours reporté ou un état indisponible ne déverrouille jamais le dashboard. */
export function OnboardingAccessBoundary({
  children,
  onboarding,
  controls,
  enforceAccess = true,
}: {
  children: ReactNode;
  onboarding: ReactNode;
  controls?: ReactNode;
  enforceAccess?: boolean;
}) {
  const { state, loading, refresh } = useOnboarding();
  const pathname = usePathname();
  const router = useRouter();
  const complete =
    state &&
    ONBOARDING_TASK_KEYS.every((key) =>
      state.steps.some((step) => step.key === key && step.status === 'completed'),
    );

  useEffect(() => {
    if (!enforceAccess || loading) return;
    if (complete && pathname === '/onboarding') {
      router.replace('/dashboard');
    } else if (!complete && pathname.startsWith('/dashboard')) {
      router.replace('/onboarding');
    }
  }, [complete, enforceAccess, loading, pathname, router]);

  if (!enforceAccess) return <>{children}</>;

  if (!loading && complete && pathname !== '/onboarding') return <>{children}</>;
  if (!loading && complete && pathname === '/onboarding') {
    return (
      <main
        role="status"
        className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground"
      >
        Votre espace Sokar est prêt…
      </main>
    );
  }

  return (
    <main className="relative min-h-screen bg-background text-foreground">
      <div className="w-full">
        <div className="absolute right-4 top-4 z-20 flex items-center gap-3">{controls}</div>
        {loading ? (
          <p
            role="status"
            className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground"
          >
            Vérification de votre configuration…
          </p>
        ) : !state ? (
          <div role="alert" className="rounded-2xl border border-border bg-card p-6">
            <p className="text-sm text-muted-foreground">
              La configuration est momentanément indisponible. Réessayez pour reprendre votre
              parcours.
            </p>
            <Button onClick={() => void refresh()} className="mt-4 transition-all duration-200">
              Réessayer
            </Button>
          </div>
        ) : (
          onboarding
        )}
      </div>
    </main>
  );
}
