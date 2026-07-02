/**
 * Sokar Connect — RestaurantCard component.
 * Carte restaurant pour la liste de la landing / et futures pages locales.
 *
 * Accepte un PublicRestaurantDto (issu de l'API publique) — pas le modèle
 * Prisma. On est strict sur le contrat.
 */
import Link from 'next/link';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import type { PublicRestaurantDto } from '@/lib/api-client';

type Props = {
  restaurant: PublicRestaurantDto;
  className?: string;
};

export function RestaurantCard({ restaurant, className }: Props) {
  const cover = restaurant.images.cover;
  const cuisine = restaurant.cuisineTypes[0] ?? 'Restaurant';

  return (
    <Link
      href={`/restaurant/${restaurant.slug}`}
      className={cn(
        'group block overflow-hidden rounded-xl border border-border bg-background transition-all duration-200 hover:border-ember/30 hover:shadow-md',
        className,
      )}
    >
      {cover && (
        <div className="aspect-[4/3] w-full overflow-hidden bg-muted">
          <Image
            src={cover}
            alt={restaurant.name}
            width={400}
            height={300}
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
          />
        </div>
      )}
      <div className="p-4">
        <h3 className="text-lg font-semibold text-ink group-hover:text-ember">{restaurant.name}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {cuisine}
          {restaurant.priceRange ? ` · ${restaurant.priceRange}` : ''}
          {restaurant.address.city ? ` · ${restaurant.address.city}` : ''}
        </p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{restaurant.address.line1}</p>
      </div>
    </Link>
  );
}
