'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useServiceCopilotAccess } from '@/lib/use-service-copilot-access';

export function ServiceCopilotAccess({ children }: { children: ReactNode }) {
  const access = useServiceCopilotAccess();
  if (access.allowed) return <>{children}</>;
  return (
    <div className="rounded-2xl border border-border bg-card p-6 text-sm">
      {access.loading ? (
        <p role="status">Vérification de l’accès au copilote…</p>
      ) : access.error ? (
        <>
          <p role="alert">Impossible de vérifier l’accès au copilote.</p>
          <Button
            variant="outline"
            onClick={access.retry}
            className="mt-3 transition-all duration-200"
          >
            Réessayer
          </Button>
        </>
      ) : (
        <>
          <p className="font-semibold">Le copilote de service accompagne la formule Pro.</p>
          <p className="mt-2 text-muted-foreground">
            Votre planning, votre plan de salle et le placement manuel restent accessibles avec
            Essential.
          </p>
          <Link
            href="/demo?plan=pro&billing=monthly"
            className="mt-3 inline-block font-medium underline transition-all duration-200"
          >
            Découvrir le copilote
          </Link>
        </>
      )}
    </div>
  );
}
