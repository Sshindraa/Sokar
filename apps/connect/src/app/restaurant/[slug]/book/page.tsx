/**
 * Sokar Connect — Page réservation.
 *
 * URL : /restaurant/[slug]/book?partySize=4&date=2026-06-24&time=20:00&source=chatgpt
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
  from?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
};

export default async function BookPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const restaurant = await fetchPublicRestaurant(slug);
  if (!restaurant) {
    notFound();
  }

  // Track page_view (T5/T8)
  trackEvent({
    event: 'booking_page_view',
    restaurantId: restaurant.id,
    restaurantSlug: restaurant.slug,
    source: sp.source,
  });

  // Track availability_preview_clicked si l'utilisateur vient de l'aperçu
  // inline de la page restaurant (Phase 2).
  if (sp.from === 'preview' && sp.date && sp.time) {
    trackEvent({
      event: 'availability_preview_clicked',
      restaurantId: restaurant.id,
      restaurantSlug: restaurant.slug,
      date: sp.date,
      time: sp.time,
      partySize: sp.partySize ? Number(sp.partySize) : 2,
    });
  }

  const partySize = sp.partySize ? Number(sp.partySize) : undefined;
  const date = sp.date;
  const time = sp.time;

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <div className="mb-6">
        <Link
          href={`/restaurant/${restaurant.slug}`}
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
        initialSource={sp.source}
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
