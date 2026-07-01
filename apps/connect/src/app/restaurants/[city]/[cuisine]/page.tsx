/**
 * Sokar Connect — Page ville + cuisine (T7).
 *
 * URL : /restaurants/[city]/[cuisine] (ex. sokar.tech/restaurants/lyon/italien)
 *
 * Règle : indexable si totalInCity >= 10 ET cuisineCount >= 5.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { fetchCityPage } from '@/lib/api-client';
import { RestaurantCard } from '@/components/restaurant-card';

const SITE_URL = process.env.SITE_URL ?? 'https://sokar.tech';

export const revalidate = 300;
export const dynamicParams = true;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string; cuisine: string }>;
}): Promise<Metadata> {
  const { city, cuisine } = await params;
  const data = await fetchCityPage(city, cuisine);
  if (!data || !data.cuisine) {
    return {
      title: 'Page introuvable',
      robots: { index: false, follow: true },
    };
  }

  const canonical = `${SITE_URL}/restaurants/${data.citySlug}/${cuisine}`;
  return {
    title: `Restaurants ${data.cuisine.toLowerCase()} réservables à ${data.city} | Sokar`,
    description: `Découvrez les restaurants ${data.cuisine.toLowerCase()} réservables en ligne à ${data.city} via Sokar.`,
    alternates: { canonical },
    robots: data.shouldIndex ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: {
      type: 'website',
      title: `Restaurants ${data.cuisine.toLowerCase()} à ${data.city}`,
      url: canonical,
    },
  };
}

export default async function CityCuisinePage({
  params,
}: {
  params: Promise<{ city: string; cuisine: string }>;
}) {
  const { city, cuisine } = await params;
  const data = await fetchCityPage(city, cuisine);
  if (!data || !data.cuisine) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      {!data.shouldIndex && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Cette page n&apos;est pas indexée car il y a {data.cuisineCount} restaurant
          {data.cuisineCount > 1 ? 's' : ''} {data.cuisine} à {data.city} (minimum 5 pour
          l&apos;indexation d&apos;une page cuisine).
        </div>
      )}

      <nav className="mb-4 text-sm">
        <Link
          href={`/restaurants/${data.citySlug}`}
          className="text-ember underline hover:no-underline"
        >
          ← {data.city}
        </Link>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl font-bold text-ink sm:text-4xl">
          Restaurants {data.cuisine.toLowerCase()} réservables à {data.city}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {data.cuisineCount} restaurant{data.cuisineCount > 1 ? 's' : ''}{' '}
          {data.cuisine.toLowerCase()} · réservation en ligne via Sokar
        </p>
      </header>

      {data.restaurants.length === 0 ? (
        <p className="text-muted-foreground">Aucun restaurant à afficher pour l&apos;instant.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.restaurants.map((r) => (
            <li key={r.id}>
              <RestaurantCard restaurant={r} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
