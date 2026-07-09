/**
 * Sokar Connect — Page ville (T7).
 *
 * URL : /restaurants/[city] (ex. sokar.tech/restaurants/lyon)
 *
 * Si shouldIndex=false (totalInCity < 5), on met noindex mais on garde
 * la page avec un message "pas assez d'inventaire pour l'instant".
 * Cf. spec v1.1 §3.3.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { fetchCityPage, fetchCities } from '@/lib/api-client';
import { RestaurantCard } from '@/components/restaurant-card';
import { trackPageView } from '@/lib/tracking';

const SITE_URL = process.env.SITE_URL ?? 'https://sokar.tech';

export const revalidate = 300;
export const dynamicParams = true;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>;
}): Promise<Metadata> {
  const { city } = await params;
  const data = await fetchCityPage(city);
  if (!data) {
    return {
      title: 'Ville introuvable',
      robots: { index: false, follow: true },
    };
  }

  const canonical = `${SITE_URL}/restaurants/${data.citySlug}`;
  return {
    title: `Restaurants réservables à ${data.city} | Sokar`,
    description: `Découvrez les restaurants réservables en ligne à ${data.city} via Sokar. Consultez les horaires, adresses et disponibilités avant de réserver votre table.`,
    alternates: { canonical },
    robots: data.shouldIndex ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: {
      type: 'website',
      title: `Restaurants réservables à ${data.city} | Sokar`,
      description: `Découvrez les restaurants réservables en ligne à ${data.city}.`,
      url: canonical,
    },
  };
}

export default async function CityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city } = await params;
  const data = await fetchCityPage(city);
  if (!data) {
    notFound();
  }

  if (data.shouldIndex) {
    trackPageView({
      restaurantId: 'city-page',
      restaurantSlug: data.citySlug,
      city: data.city,
    });
  }

  // Liens vers les cuisines disponibles (>= 5 restos pour qu'on indexe)
  const cuisineLinks = await fetchCities().then((cities) => {
    const city = cities.find((c) => c.citySlug === data.citySlug);
    return (city?.cuisines ?? []).filter((c) => c.count >= 10);
  });

  return (
    <main id="main-content" className="mx-auto max-w-6xl px-6 py-12">
      {!data.shouldIndex && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Cette page n&apos;est pas indexée car la ville compte {data.totalInCity} restaurant
          {data.totalInCity > 1 ? 's' : ''} (minimum 5 pour l&apos;indexation).
        </div>
      )}

      <header className="mb-8">
        <h1 className="text-3xl font-bold text-ink sm:text-4xl">
          Restaurants réservables à {data.city}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {data.totalInCity} restaurant{data.totalInCity > 1 ? 's' : ''} disponible
          {data.totalInCity > 1 ? 's' : ''} · réservation en ligne via Sokar
        </p>
      </header>

      {cuisineLinks.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold text-ink">Filtrer par cuisine</h2>
          <ul className="flex flex-wrap gap-2">
            {cuisineLinks.map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/restaurants/${data.citySlug}/${c.slug}`}
                  className="inline-flex items-center rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-ink transition-all duration-200 hover:border-blue hover:bg-blue/5"
                >
                  {c.name} ({c.count})
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Sections thématiques : terrasse, végétarien, etc. */}
      {(() => {
        const withTerrace = data.restaurants.filter(
          (r) =>
            r.ambiance?.some((a) => a.toLowerCase().includes('terrasse')) ||
            r.description?.toLowerCase().includes('terrasse'),
        );
        const withVeggie = data.restaurants.filter((r) =>
          r.dietary?.some((d) => d.toLowerCase().includes('végétarien')),
        );
        const sections: Array<{ title: string; items: typeof data.restaurants }> = [];
        if (withTerrace.length > 0) sections.push({ title: 'Avec terrasse', items: withTerrace });
        if (withVeggie.length > 0)
          sections.push({ title: 'Options végétariennes', items: withVeggie });
        if (sections.length === 0) return null;
        return sections.map((section) => (
          <section key={section.title} className="mb-8">
            <h2 className="mb-3 text-lg font-semibold text-ink">{section.title}</h2>
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {section.items.map((r) => (
                <li key={r.id}>
                  <RestaurantCard restaurant={r} />
                </li>
              ))}
            </ul>
          </section>
        ));
      })()}

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">Tous les restaurants</h2>
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
      </section>
    </main>
  );
}
