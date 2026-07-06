/**
 * Sokar Connect — Page widget embeddable.
 *
 * URL : /widget/[slug]?embedded=1&primary=0f172a&accent=f97316
 * URL : /widget/[slug]?source=restaurant&date=2026-07-07&time=20:00&partySize=4
 *
 * Server Component qui affiche le BookingWidget seul, sans header ni footer.
 * Utilisé par le snippet JS /embed.js via iframe, mais aussi accessible
 * directement (lien "Réserver" depuis /restaurant/[slug]).
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { fetchWidgetRestaurant } from '@/lib/api-client';
import { BookingWidget } from '@/components/booking-widget';
import { trackEventAsync } from '@/lib/tracking';
import { toHexColor } from '@/lib/widget-colors';

export const dynamic = 'force-dynamic';

type SearchParams = {
  embedded?: string;
  primary?: string;
  accent?: string;
  source?: string;
  date?: string;
  time?: string;
  partySize?: string;
  from?: string;
};

export default async function WidgetPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const restaurant = await fetchWidgetRestaurant(slug);
  if (!restaurant) {
    notFound();
  }

  const isEmbedded = sp.embedded === '1';
  const primary = toHexColor(sp.primary, '#0F172A');
  const accent = toHexColor(sp.accent, '#0284C7');
  const source = sp.source ?? 'widget';

  // Params de pré-sélection (depuis l'aperçu inline de /restaurant/[slug])
  const partySize = sp.partySize ? Number(sp.partySize) : undefined;
  const date = sp.date;
  const time = sp.time;

  void trackEventAsync({
    event: 'widget_page_view',
    restaurantId: restaurant.id,
    restaurantSlug: restaurant.slug,
    source,
  });

  return (
    <main className="mx-auto max-w-xl px-4 py-6 sm:px-6">
      {!isEmbedded && (
        <div className="mb-4">
          <Link
            href={`/restaurant/${restaurant.slug}`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-blue transition-all duration-200 hover:gap-2.5"
          >
            <ArrowLeft size={16} />
            {restaurant.name}
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-ink">Réserver une table</h1>
          <p className="text-sm text-muted-foreground">{restaurant.city}</p>
        </div>
      )}

      <BookingWidget
        slug={restaurant.slug}
        initialSource={source}
        initialPartySize={partySize}
        initialDate={date}
        initialTime={time}
        embedded={isEmbedded}
        primaryColor={primary}
        accentColor={accent}
      />
    </main>
  );
}
