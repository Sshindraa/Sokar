/**
 * Sokar Connect — Page widget embeddable.
 *
 * URL : /widget/[slug]?embedded=1&primary=0f172a&accent=f97316
 *
 * Server Component qui affiche le BookingWidget seul, sans header ni footer.
 * Utilisé par le snippet JS /embed.js via iframe.
 */

import { notFound } from 'next/navigation';
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
          <h1 className="text-2xl font-bold text-ink">{restaurant.name}</h1>
          <p className="text-sm text-muted-foreground">{restaurant.city} · Réserver une table</p>
        </div>
      )}

      <BookingWidget
        slug={restaurant.slug}
        initialSource={source}
        embedded={isEmbedded}
        primaryColor={primary}
        accentColor={accent}
      />
    </main>
  );
}
