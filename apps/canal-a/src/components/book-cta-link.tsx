'use client';

/**
 * Canal A — BookCtaLink component.
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
  className?: string;
  children: ReactNode;
};

export function BookCtaLink({ href, restaurantId, restaurantSlug, source, className, children }: Props) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        trackBookCta({ restaurantId, restaurantSlug, source });
      }}
    >
      {children}
    </Link>
  );
}
