/**
 * Sokar Connect — Page restaurant publique (T5 complète).
 *
 * URL : /r/[slug]
 *
 * Sections :
 * - Header (H1, description, CTA Réserver)
 * - Galerie / cover
 * - Informations pratiques (adresse, tél, cuisine, prix, lien Maps)
 * - Horaires (depuis restaurant.openingHours)
 * - Ambiance & options (dietary, noiseLevel, terrasse, etc. si présents)
 * - CTA Réserver (secondaire, bas de page)
 * - FAQ (1-2 Q/R pour Schema.org FAQPage — bonus SEO)
 *
 * Server Component, ISR 60s, JSON-LD injecté via <script>.
 * Tracke page_view via fetch asynchrone (fire-and-forget).
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { fetchPublicRestaurant } from '@/lib/api-client';
import { ReservationJsonLd, buildPublicRestaurantJsonLd } from '@/lib/jsonld';
import { trackPageView } from '@/lib/tracking';
import { BookCtaLink } from '@/components/book-cta-link';

const SITE_URL = process.env.SITE_URL ?? 'https://sokar.tech';

export const revalidate = 60;
export const dynamicParams = true;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ preview?: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { preview } = await searchParams;
  const isPreview = preview === '1';
  const restaurant = await fetchPublicRestaurant(slug, { preview: isPreview });

  if (!restaurant) {
    return {
      title: 'Restaurant introuvable',
      robots: { index: false, follow: true },
    };
  }

  const cuisine = restaurant.cuisineTypes[0] ?? 'Restaurant';
  const canonical = `${SITE_URL}/r/${restaurant.slug}`;

  return {
    title: `${restaurant.name} — Réservation en ligne à ${restaurant.address.city} | Sokar`,
    description: `Réservez une table chez ${restaurant.name}, restaurant ${cuisine.toLowerCase()} à ${restaurant.address.city}. Horaires, adresse et réservation en ligne via Sokar.`,
    alternates: { canonical },
    openGraph: {
      type: 'website',
      title: `${restaurant.name} — Réservation en ligne à ${restaurant.address.city}`,
      description: `Réservez une table chez ${restaurant.name} via Sokar.`,
      url: canonical,
      images: restaurant.images.cover ? [{ url: restaurant.images.cover }] : [],
    },
    robots: {
      index: !isPreview,
      follow: true,
      googleBot: {
        index: !isPreview,
        follow: true,
        'max-snippet': -1,
        'max-image-preview': 'large',
      },
    },
  };
}

const DAY_LABELS_FR: Record<string, string> = {
  monday: 'Lundi',
  tuesday: 'Mardi',
  wednesday: 'Mercredi',
  thursday: 'Jeudi',
  friday: 'Vendredi',
  saturday: 'Samedi',
  sunday: 'Dimanche',
};

const DAY_ORDER: string[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

/** Construit une URL Google Maps à partir d'une adresse. */
function googleMapsUrl(line1: string, city: string, country: string): string {
  const q = encodeURIComponent(`${line1}, ${city}, ${country}`);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

export default async function RestaurantPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    source?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    preview?: string;
  }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const isPreview = sp.preview === '1';
  const restaurant = await fetchPublicRestaurant(slug, { preview: isPreview });

  if (!restaurant) {
    notFound();
  }

  // Track page_view (fire-and-forget, ne bloque pas le rendu)
  trackPageView({
    restaurantId: restaurant.id,
    restaurantSlug: restaurant.slug,
    city: restaurant.address.city,
    source: sp.source,
    utmSource: sp.utm_source,
    utmMedium: sp.utm_medium,
    utmCampaign: sp.utm_campaign,
  });

  const jsonLd = buildPublicRestaurantJsonLd({
    restaurant,
    attributesConfidence: null, // OpeningHours omis (cf. spec v1.1 §5.5)
  });

  const cuisine = restaurant.cuisineTypes[0] ?? 'Restaurant';
  const mapsUrl = googleMapsUrl(
    restaurant.address.line1,
    restaurant.address.city,
    restaurant.address.country,
  );

  // Horaires triés par jour de la semaine
  const hoursByDay = restaurant.openingHours
    .slice()
    .sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day));

  // JSON-LD FAQ (1 Q/R pour Schema.org FAQPage — bonus SEO sans sur-promesse)
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: `${restaurant.name} accepte-t-il les réservations ?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: `Oui, vous pouvez réserver une table en ligne chez ${restaurant.name} via Sokar.`,
        },
      },
    ],
  };

  return (
    <>
      <ReservationJsonLd jsonLd={jsonLd} />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      <main className="mx-auto max-w-4xl px-6 py-12">
        <article>
          <header className="mb-8">
            <h1 className="text-3xl font-bold text-ink sm:text-4xl">
              {restaurant.name} — Restaurant {cuisine.toLowerCase()} à {restaurant.address.city}
            </h1>
            {restaurant.description && (
              <p className="mt-3 text-lg text-muted-foreground">{restaurant.description}</p>
            )}

            {/* CTA principal — au-dessus de la ligne de flottaison (acceptance T5) */}
            <div className="mt-6">
              <BookCtaLink
                href={`/r/${restaurant.slug}/book${sp.source ? `?source=${sp.source}` : ''}`}
                restaurantId={restaurant.id}
                restaurantSlug={restaurant.slug}
                source={sp.source}
                className="inline-flex items-center justify-center rounded-lg bg-ember px-6 py-3 text-base font-semibold text-white transition-all duration-200 hover:bg-ember/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                Réserver une table
              </BookCtaLink>
            </div>
          </header>

          {restaurant.images.cover && (
            <figure className="mb-8 overflow-hidden rounded-xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={restaurant.images.cover}
                alt={restaurant.name}
                className="h-64 w-full object-cover sm:h-80"
                loading="eager"
              />
            </figure>
          )}

          {restaurant.images.gallery.length > 0 && (
            <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {restaurant.images.gallery.slice(0, 6).map((url, idx) => (
                <figure key={idx} className="overflow-hidden rounded-lg">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`${restaurant.name} — photo ${idx + 2}`}
                    className="h-32 w-full object-cover transition-transform duration-200 hover:scale-105 sm:h-40"
                    loading="lazy"
                  />
                </figure>
              ))}
            </section>
          )}

          <section className="mb-8 rounded-xl border border-border bg-cream p-6">
            <h2 className="mb-3 text-xl font-semibold text-ink">Informations</h2>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Adresse</dt>
                <dd>
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ember underline hover:no-underline"
                  >
                    {restaurant.address.line1}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-muted-foreground">Téléphone</dt>
                <dd>
                  <a
                    href={`tel:${restaurant.phone}`}
                    className="text-ember underline hover:no-underline"
                  >
                    {restaurant.phone}
                  </a>
                </dd>
              </div>
              {restaurant.cuisineTypes.length > 0 && (
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">Cuisine</dt>
                  <dd className="text-ink">{restaurant.cuisineTypes.join(', ')}</dd>
                </div>
              )}
              {restaurant.priceRange && (
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">Prix</dt>
                  <dd className="text-ink">{restaurant.priceRange}</dd>
                </div>
              )}
            </dl>
          </section>

          {hoursByDay.length > 0 && (
            <section className="mb-8 rounded-xl border border-border bg-background p-6">
              <h2 className="mb-3 text-xl font-semibold text-ink">Horaires</h2>
              <ul className="space-y-1 text-ink">
                {hoursByDay.map((h) => (
                  <li key={h.day} className="flex justify-between">
                    <span className="font-medium">{DAY_LABELS_FR[h.day] ?? h.day}</span>
                    <span>
                      {h.open}–{h.close}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(restaurant.ambiance?.length || restaurant.dietary?.length || restaurant.noiseLevel) && (
            <section className="mb-8 rounded-xl border border-border bg-background p-6">
              <h2 className="mb-3 text-xl font-semibold text-ink">Ambiance & options</h2>
              <ul className="space-y-2 text-ink">
                {restaurant.ambiance?.length ? (
                  <li>
                    <span className="text-sm font-medium text-muted-foreground">Ambiance : </span>
                    {restaurant.ambiance.join(', ')}
                  </li>
                ) : null}
                {restaurant.dietary?.length ? (
                  <li>
                    <span className="text-sm font-medium text-muted-foreground">
                      Options alimentaires :{' '}
                    </span>
                    {restaurant.dietary.join(', ')}
                  </li>
                ) : null}
                {restaurant.noiseLevel ? (
                  <li>
                    <span className="text-sm font-medium text-muted-foreground">
                      Niveau sonore :{' '}
                    </span>
                    {restaurant.noiseLevel}
                  </li>
                ) : null}
              </ul>
            </section>
          )}

          <section className="mb-8 rounded-xl border border-border bg-background p-6">
            <h2 className="mb-3 text-xl font-semibold text-ink">Réservation</h2>
            <p className="text-ink">Réservation en ligne avec confirmation rapide.</p>
            <BookCtaLink
              href={`/r/${restaurant.slug}/book${sp.source ? `?source=${sp.source}` : ''}`}
              restaurantId={restaurant.id}
              restaurantSlug={restaurant.slug}
              source={sp.source}
              className="mt-4 inline-flex items-center justify-center rounded-lg border border-border bg-background px-5 py-2 text-sm font-semibold text-ink transition-all duration-200 hover:bg-muted"
            >
              Voir les disponibilités
            </BookCtaLink>
          </section>

          <section className="rounded-xl border border-border bg-background p-6">
            <h2 className="mb-3 text-xl font-semibold text-ink">Questions fréquentes</h2>
            <details className="group">
              <summary className="cursor-pointer text-base font-medium text-ink">
                {restaurant.name} accepte-t-il les réservations ?
              </summary>
              <p className="mt-2 text-ink">
                Oui, vous pouvez réserver une table en ligne via Sokar.
                {restaurant.connectAgentic
                  ? ' Les assistants IA (ChatGPT, Perplexity) peuvent aussi vous y envoyer directement.'
                  : ''}
              </p>
            </details>
          </section>
        </article>
      </main>
    </>
  );
}
