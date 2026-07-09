import { getTranslations } from 'next-intl/server';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Skeleton streaming pour toutes les sous-routes du dashboard.
 *
 * Pourquoi un loading.tsx route-level :
 * 1. Next.js streame ce composant AVANT que le bundle de la page cible
 *    ne soit chargé — l'utilisateur voit une structure stable dès le 1er paint.
 * 2. Évite le CLS : les largeurs/hauteurs reflètent celles des pages réelles
 *    (KPIs en grille 4 colonnes, jauge 1.25/0.75, charts).
 * 3. Couvre toutes les sous-routes (calls, reservations, settings, ...) sans
 *    avoir à dupliquer un skeleton dans chaque page.
 *
 * Les pages restent `'use client'` et gèrent leur propre skeleton de revalidation
 * (changement de filtre, etc.) — ce fichier ne sert qu'au cold load.
 */
export default async function DashboardLoading() {
  // Le label est calculé côté serveur via getTranslations pour rester
  // cohérent avec le catalogue fr.json. Cf. apps/dashboard/src/i18n/config.ts
  // pour le passage à plusieurs locales.
  const t = await getTranslations('common');

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      aria-label={t('loading')}
      className="space-y-6 md:space-y-8"
    >
      {/* Header : titre + sélecteur de période */}
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 max-w-2xl space-y-3">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-9 w-72" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="grid h-12 w-full shrink-0 grid-cols-3 gap-2 rounded-2xl border border-border bg-card p-1.5 md:w-auto md:min-w-[280px]">
          <Skeleton className="rounded-xl" />
          <Skeleton className="rounded-xl" />
          <Skeleton className="rounded-xl" />
        </div>
      </header>

      {/* Bloc jauge + KPIs 4 colonnes */}
      <section className="grid gap-3 xl:grid-cols-[0.9fr_1.6fr]">
        <Skeleton className="h-[280px] rounded-2xl" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Skeleton className="h-[120px] rounded-2xl" />
          <Skeleton className="h-[120px] rounded-2xl" />
          <Skeleton className="h-[120px] rounded-2xl" />
          <Skeleton className="h-[120px] rounded-2xl" />
        </div>
      </section>

      {/* Charts : un large + un étroit (mêmes proportions que DashboardCharts) */}
      <section className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <Skeleton className="h-[360px] rounded-2xl" />
        <Skeleton className="h-[360px] rounded-2xl" />
      </section>
    </div>
  );
}
