/**
 * Sokar Connect — Page réservation.
 *
 * URL : /r/[slug]/book?partySize=4&date=2026-06-24&time=20:00&source=chatgpt
 *
 * Server Component qui lit les searchParams, puis monte le BookingWidget
 * (client component) qui gère le flow interactif.
 *
 * Tracke booking_page_view (T5/T8).
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { fetchPublicRestaurant } from '@/lib/api-client';
import { BookingWidget } from '@/components/booking-widget';
import { trackEvent } from '@/lib/tracking';

export const dynamic = 'force-dynamic';

type SearchParams = {
  partySize?: string;
  date?: string;
  time?: string;
  source?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
};

export default async function BookPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: SearchParams;
}) {
  const restaurant = await fetchPublicRestaurant(params.slug);
  if (!restaurant) {
    notFound();
  }

  // Track page_view (T5/T8)
  trackEvent({
    event: 'booking_page_view',
    restaurantId: restaurant.id,
    restaurantSlug: restaurant.slug,
    source: searchParams.source,
  });

  const partySize = searchParams.partySize ? Number(searchParams.partySize) : undefined;
  const date = searchParams.date;
  const time = searchParams.time;

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <div className="mb-6">
        <Link
          href={`/r/${restaurant.slug}`}
          className="text-sm text-ember underline hover:no-underline"
        >
          ← {restaurant.name}
        </Link>
        <h1 className="mt-2 text-3xl font-bold text-ink">Réserver une table</h1>
        <p className="mt-1 text-muted-foreground">
          {restaurant.name} — {restaurant.address.city}
        </p>
      </div>

      <BookingWidget
        slug={restaurant.slug}
        initialSource={searchParams.source}
        initialPartySize={partySize}
        initialDate={date}
        initialTime={time}
      />

      <p className="mt-8 text-xs text-muted-foreground">
        En réservant, vous acceptez que vos informations soient transmises au restaurant pour gérer
        votre réservation. Vos données ne sont pas partagées avec des tiers.
      </p>
    </main>
  );
}
