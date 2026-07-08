/**
 * Sokar Connect — Page restaurant publique (T5 complète).
 *
 * URL : /restaurant/[slug]
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
import Image from 'next/image';
import { fetchPublicRestaurant, fetchPublishedSlugs, fetchAvailability } from '@/lib/api-client';
import { ReservationJsonLd, buildPublicRestaurantJsonLd } from '@/lib/jsonld';
import { trackPageView, trackEvent } from '@/lib/tracking';
import { BookCtaLink } from '@/components/book-cta-link';
import { PageViewTracker } from '@/components/page-view-tracker';

const SITE_URL = process.env.SITE_URL ?? 'https://sokar.tech';

export const revalidate = 60;
export const dynamicParams = true;
// Force le rendu dynamique pour éviter DYNAMIC_SERVER_USAGE en staging (Next.js 15 +
// standalone). En prod l'ISR fonctionne car Cloudflare cache le HTML statique ; en
// staging le serveur standalone tente de re-render la page et échoue sur les
// fetchs dynamiques (date du jour + availability). Le rendu dynamique est
// acceptable pour le trafic staging.
export const dynamic = 'force-dynamic';

// Pre-render les pages restaurant publiées au build time.
// Les nouvelles publications sont rendues à la demande (dynamicParams=true)
// puis mises en cache ISR (revalidate=60).
export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  const slugs = await fetchPublishedSlugs();
  return slugs.map((entry) => ({ slug: entry.slug }));
}

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
  const canonical = `${SITE_URL}/restaurant/${restaurant.slug}`;

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

  // Track page_view côté client (en ISR, le server-side ne s'exécute qu'au revalidate)
  // PageViewTracker est un composant client qui track au mount — chaque visite est comptée

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

  // Groupe les horaires par jour (support multi-créneaux : midi + soir).
  // [{day: monday, open: 12:00, close: 14:30}, {day: monday, open: 19:00, close: 22:30}]
  // → [{day: monday, slots: [{open: 12:00, close: 14:30}, {open: 19:00, close: 22:30}]}]
  const hoursGrouped = hoursByDay.reduce<
    Array<{ day: string; slots: Array<{ open: string; close: string }> }>
  >((acc, h) => {
    const existing = acc.find((g) => g.day === h.day);
    if (existing) {
      existing.slots.push({ open: h.open, close: h.close });
    } else {
      acc.push({ day: h.day, slots: [{ open: h.open, close: h.close }] });
    }
    return acc;
  }, []);

  // Disponibilités inline (Phase 2) : aperçu des créneaux du jour pour
  // éviter le clic supplémentaire vers /book. ISR 30s côté API (cache Next 30s).
  const today = new Date().toISOString().slice(0, 10);
  const previewPartySize = 2;
  const availability = await fetchAvailability(
    restaurant.slug,
    { date: today, partySize: previewPartySize },
    { revalidate: 30 },
  );
  const availableSlots = availability?.slots.filter((s) => s.available).slice(0, 4) ?? [];
  const previewShown = availableSlots.length > 0;

  // Track availability_preview_shown (fire-and-forget, best-effort)
  if (previewShown) {
    trackEvent({
      event: 'availability_preview_shown',
      restaurantId: restaurant.id,
      restaurantSlug: restaurant.slug,
      date: today,
      partySize: previewPartySize,
      availableCount: availableSlots.length,
    });
  }

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
        <PageViewTracker
          restaurantId={restaurant.id}
          restaurantSlug={restaurant.slug}
          city={restaurant.address.city}
          source={sp.source}
          utmSource={sp.utm_source}
          utmMedium={sp.utm_medium}
          utmCampaign={sp.utm_campaign}
        />
        <article>
          <header className="mb-8">
            <h1 className="text-3xl font-bold text-ink sm:text-4xl">
              {restaurant.name} — Restaurant {cuisine.toLowerCase()} à {restaurant.address.city}
            </h1>
            {restaurant.aggregateRating && (
              <p className="mt-2 text-sm text-muted-foreground">
                <span className="font-semibold text-blue">
                  {restaurant.aggregateRating.ratingValue.toFixed(1)} ★
                </span>{' '}
                · {restaurant.aggregateRating.reviewCount} avis Google
              </p>
            )}
            {restaurant.description && (
              <p className="mt-3 text-lg text-muted-foreground">{restaurant.description}</p>
            )}

            {/* CTA principal — au-dessus de la ligne de flottaison (acceptance T5) */}
            <div className="mt-6">
              <BookCtaLink
                href={`/book/${restaurant.slug}?source=restaurant${sp.source ? `&utm=${sp.source}` : ''}`}
                restaurantId={restaurant.id}
                restaurantSlug={restaurant.slug}
                source={sp.source}
                className="inline-flex items-center justify-center rounded-lg bg-ink px-6 py-3 text-base font-semibold text-white transition-all duration-200 hover:bg-ink/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                Réserver une table
              </BookCtaLink>
            </div>
          </header>

          {restaurant.images.cover && (
            <figure className="mb-8 overflow-hidden rounded-xl">
              <Image
                src={restaurant.images.cover}
                alt={restaurant.name}
                width={1200}
                height={320}
                className="h-64 w-full object-cover sm:h-80"
                priority
              />
            </figure>
          )}

          {restaurant.images.gallery.length > 0 && (
            <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {restaurant.images.gallery.slice(0, 6).map((url, idx) => (
                <figure key={idx} className="overflow-hidden rounded-lg">
                  <Image
                    src={url}
                    alt={`${restaurant.name} — photo ${idx + 2}`}
                    width={400}
                    height={160}
                    className="h-32 w-full object-cover transition-transform duration-200 hover:scale-105 sm:h-40"
                  />
                </figure>
              ))}
            </section>
          )}

          {/* Disponibilités inline (Phase 2) — aperçu des créneaux du jour */}
          <section className="mb-8 rounded-xl border border-border bg-background p-6">
            <h2 className="mb-3 text-xl font-semibold text-ink">Disponibilités aujourd&apos;hui</h2>
            {availableSlots.length > 0 ? (
              <>
                <p className="mb-3 text-sm text-muted-foreground">
                  Table de {previewPartySize} — {availableSlots.length} créneau
                  {availableSlots.length > 1 ? 'x' : ''} disponible
                  {availableSlots.length > 1 ? 's' : ''} :
                </p>
                <div className="flex flex-wrap gap-2">
                  {availableSlots.map((slot) => (
                    <Link
                      key={slot.time}
                      href={`/book/${restaurant.slug}?source=restaurant&date=${today}&time=${slot.time}&partySize=${previewPartySize}&from=preview${sp.source ? `&utm=${sp.source}` : ''}`}
                      className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold text-ink transition-all duration-200 hover:border-blue hover:bg-blue/5"
                    >
                      {slot.time}
                    </Link>
                  ))}
                </div>
                <Link
                  href={`/book/${restaurant.slug}?source=restaurant${sp.source ? `&utm=${sp.source}` : ''}`}
                  className="mt-3 inline-block text-sm text-blue underline hover:no-underline"
                >
                  Voir tous les créneaux et tailles de table
                </Link>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Aucun créneau disponible pour aujourd&apos;hui (table de {previewPartySize}).{' '}
                <Link
                  href={`/book/${restaurant.slug}?source=restaurant${sp.source ? `&utm=${sp.source}` : ''}`}
                  className="text-blue underline hover:no-underline"
                >
                  Vérifier un autre jour
                </Link>
              </p>
            )}
          </section>

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
                    className="text-blue underline hover:no-underline"
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
                    className="text-blue underline hover:no-underline"
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

          {hoursGrouped.length > 0 && (
            <section className="mb-8 rounded-xl border border-border bg-background p-6">
              <h2 className="mb-3 text-xl font-semibold text-ink">Horaires</h2>
              <ul className="space-y-1 text-ink">
                {hoursGrouped.map((g) => (
                  <li key={g.day} className="flex justify-between">
                    <span className="font-medium">{DAY_LABELS_FR[g.day] ?? g.day}</span>
                    <span>{g.slots.map((s) => `${s.open}–${s.close}`).join(', ')}</span>
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
              href={`/book/${restaurant.slug}?source=restaurant${sp.source ? `&utm=${sp.source}` : ''}`}
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
