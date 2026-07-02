/**
 * Sokar Connect — Root page (sokar.tech/).
 *
 * Pour T4 (scaffold), c'est une landing qui liste les restos publiés
 * (via l'API publique, pas Prisma direct).
 */

import Link from 'next/link';
import { fetchPublishedSlugs, fetchPublicRestaurant } from '@/lib/api-client';
import { RestaurantCard } from '@/components/restaurant-card';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const slugs = await fetchPublishedSlugs();

  // Récupère les détails pour la grille (limité à 12)
  const restaurants = await Promise.all(
    slugs.slice(0, 12).map(async (entry) => {
      const dto = await fetchPublicRestaurant(entry.slug);
      return dto;
    }),
  );

  const valid = restaurants.filter((r): r is NonNullable<typeof r> => r !== null);

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <header className="mb-12">
        <h1 className="text-4xl font-bold text-ink">Sokar — Agent-Ready Pages</h1>
        <p className="mt-3 text-lg text-muted-foreground">
          Réseau de pages publiques Sokar rendant chaque restaurant client trouvable, compréhensible
          et réservable par les moteurs de recherche et les assistants IA.
        </p>
      </header>

      <section>
        <h2 className="mb-4 text-2xl font-semibold text-ink">
          Restaurants publiés ({valid.length})
        </h2>
        {valid.length === 0 ? (
          <p className="text-muted-foreground">
            Aucun restaurant n&apos;a encore activé sa page publique.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {valid.map((r) => (
              <li key={r.id}>
                <RestaurantCard restaurant={r} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-16 border-t border-border pt-6 text-sm text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span>Sokar Connect</span>
          <span aria-hidden>·</span>
          <Link className="text-ember underline" href="/restaurant/chez-sokar-demo">
            Restaurant démo
          </Link>
          <span aria-hidden>·</span>
          <Link className="text-ember underline" href="/assistant">
            Réserver avec votre IA
          </Link>
          <span aria-hidden>·</span>
          <Link className="text-ember underline" href="/privacy">
            Confidentialité
          </Link>
        </div>
      </footer>
    </main>
  );
}
