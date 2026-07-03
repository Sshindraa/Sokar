/**
 * Sokar Connect — Page widget achat carte cadeau.
 *
 * URL : /widget/[slug]/gift-card?embedded=1&primary=0f172a&accent=f97316
 *
 * Server Component qui affiche le GiftCardPurchase seul, sans header ni footer.
 * Mêmes conventions que la page widget de réservation.
 */

import { notFound } from 'next/navigation';
import { fetchWidgetRestaurant } from '@/lib/api-client';
import { GiftCardPurchase } from '@/components/gift-card-purchase';
import { trackEventAsync } from '@/lib/tracking';
import { toHexColor } from '@/lib/widget-colors';

export const dynamic = 'force-dynamic';

type SearchParams = {
  embedded?: string;
  primary?: string;
  accent?: string;
  source?: string;
};

export default async function GiftCardWidgetPage({
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
  const accent = toHexColor(sp.accent, '#EA580C');
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
          <p className="text-sm text-muted-foreground">
            {restaurant.city} · Offrir une carte cadeau
          </p>
        </div>
      )}

      <GiftCardPurchase
        slug={restaurant.slug}
        restaurantId={restaurant.id}
        restaurantName={restaurant.name}
        primaryColor={primary}
        accentColor={accent}
        source={source}
      />
    </main>
  );
}
