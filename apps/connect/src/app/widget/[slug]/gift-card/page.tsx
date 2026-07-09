/**
 * Sokar Connect — Page widget achat carte cadeau.
 *
 * URL : /widget/[slug]/gift-card?embedded=1&primary=0f172a&accent=f97316
 *
 * Server Component qui affiche le GiftCardPurchase seul, sans header ni footer.
 * Design aligné avec le widget de réservation (cream bg, glassmorphism, display font).
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
  const accent = toHexColor(sp.accent, '#0284C7');
  const source = sp.source ?? 'widget';

  void trackEventAsync({
    event: 'widget_page_view',
    restaurantId: restaurant.id,
    restaurantSlug: restaurant.slug,
    source,
  });

  return (
    <div
      className="relative min-h-[100dvh] w-full overflow-x-hidden bg-[hsl(var(--reservation-bg))]"
      style={{
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ['--widget-primary' as any]: primary,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ['--widget-accent' as any]: accent,
      }}
    >
      {/* Décorations — mêmes que le widget résa */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-white/30 to-transparent" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[34rem] w-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[hsl(var(--reservation-glow)/0.11)] blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,hsl(var(--reservation-ink)/0.025)_1px,transparent_1px)] bg-[length:96px_96px] opacity-30" />

      <main id="main-content" className="relative z-10 mx-auto max-w-xl px-4 py-6 sm:px-6 sm:py-8">
        {!isEmbedded && (
          <div className="mb-6 text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[hsl(var(--reservation-soft))]">
              Carte cadeau
            </p>
            <h1 className="mt-1 font-display text-[2rem] font-black leading-none tracking-[-0.04em] text-[hsl(var(--reservation-ink))]">
              {restaurant.name}
            </h1>
            <p className="mt-2 text-sm font-semibold text-[hsl(var(--reservation-soft))]">
              {restaurant.city} · Offrez une expérience inoubliable
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
    </div>
  );
}
