'use client';

/**
 * Sokar Connect — BookCtaLink component.
 *
 * Wrapper autour de <Link> qui tracke le clic sur le CTA "Réserver"
 * via fetch fire-and-forget vers /public/analytics/events.
 *
 * Server-rendered comme un <Link>, hydrate en client component.
 */

import Link from 'next/link';
import { trackBookCta } from '@/lib/tracking';
import type { ReactNode } from 'react';

type Props = {
  href: string;
  restaurantId: string;
  restaurantSlug: string;
  source?: string;
  /** false pour le parcours d'essai de l'onboarding : le clic n'est pas compté. */
  track?: boolean;
  className?: string;
  children: ReactNode;
};

export function BookCtaLink({
  href,
  restaurantId,
  restaurantSlug,
  source,
  track = true,
  className,
  children,
}: Props) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        if (track) trackBookCta({ restaurantId, restaurantSlug, source });
      }}
    >
      {children}
    </Link>
  );
}
