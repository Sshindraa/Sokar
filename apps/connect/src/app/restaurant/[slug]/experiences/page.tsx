import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ExperienceBooking } from '@/components/experience-booking';
import { fetchPublicRestaurant } from '@/lib/api-client';
import { isValidSlug } from '@/lib/widget-colors';

export const dynamic = 'force-dynamic';

type SearchParams = {
  checkout?: string;
  checkout_id?: string;
  session_id?: string;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const restaurant = await fetchPublicRestaurant(slug);
  return {
    title: restaurant ? `Expériences chez ${restaurant.name}` : 'Expériences',
    robots: { index: false, follow: true },
  };
}

export default async function RestaurantExperiencesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  if (!isValidSlug(slug)) notFound();
  const restaurant = await fetchPublicRestaurant(slug);
  if (!restaurant) notFound();

  return (
    <ExperienceBooking
      slug={restaurant.slug}
      restaurantName={restaurant.name}
      returnState={query.checkout}
      checkoutId={query.checkout_id}
      stripeSessionId={query.session_id}
    />
  );
}
