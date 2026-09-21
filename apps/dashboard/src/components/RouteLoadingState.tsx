import { getTranslations } from 'next-intl/server';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Skeleton générique des segments applicatifs qui n'ont pas de mise en page
 * de chargement spécifique (espace opérateur, onboarding, MCP).
 *
 * Next.js streame ce composant avant le bundle de la page cible : la structure
 * apparaît au premier paint et le contenu ne décale pas la mise en page quand
 * il arrive. Les pages gardent leur propre état de revalidation.
 */
export default async function RouteLoadingState() {
  const t = await getTranslations('common');

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      aria-label={t('loading')}
      className="space-y-6 p-6 md:space-y-8 md:p-8"
    >
      <header className="space-y-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-[180px] rounded-2xl" />
        <Skeleton className="h-[180px] rounded-2xl" />
      </section>

      <Skeleton className="h-[320px] rounded-2xl" />
    </div>
  );
}
