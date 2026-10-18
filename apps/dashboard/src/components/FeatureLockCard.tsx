import Link from 'next/link';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { FeatureLock } from '@/lib/api-error';

/**
 * Fonction hors formule ou pas encore ouverte : un état normal, pas une panne. Pas de bandeau rouge ni de
 * « Réessayer » (cliquer ne change rien) ; on dit ce qui se passe et, si la formule le permet, où aller.
 */
export function FeatureLockCard({ lock, feature }: { lock: FeatureLock; feature: string }) {
  return (
    <section
      aria-label={feature}
      className="rounded-2xl border border-border bg-card p-6 shadow-sm md:p-8"
    >
      <div className="flex items-start gap-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground/75">
          <Lock size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold text-foreground">{feature}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{lock.message}</p>
          {lock.kind === 'not-included' ? (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="mt-4 transition-all duration-200"
            >
              <Link href="/pricing">Voir les formules</Link>
            </Button>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              Une question ? Écrivez-nous à{' '}
              <a
                href="mailto:hello@sokar.tech"
                className="underline underline-offset-4 transition-all duration-200 hover:text-foreground"
              >
                hello@sokar.tech
              </a>
              .
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
