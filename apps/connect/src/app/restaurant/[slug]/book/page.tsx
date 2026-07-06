/**
 * Sokar Connect — Redirect permanent vers /book/[slug].
 *
 * L'URL canonique de réservation est maintenant /book/[slug] (widget dashboard).
 * Cette route est conservée pour la rétrocompatibilité des liens existants.
 */

import { redirect, notFound } from 'next/navigation';
import { fetchPublicRestaurant } from '@/lib/api-client';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | undefined>;

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

  const query = new URLSearchParams();
  Object.entries(sp).forEach(([key, value]) => {
    if (value != null) {
      query.set(key, value);
    }
  });
  const queryString = query.toString();

  redirect(`/book/${restaurant.slug}${queryString ? `?${queryString}` : ''}`);
}
