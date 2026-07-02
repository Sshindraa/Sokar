'use client';

/**
 * Tracke un page_view côté client au mount du composant.
 *
 * En ISR, le code server-side ne s'exécute qu'au revalidate (1 fois/60s),
 * pas à chaque visite. Ce composant client assure que chaque visite est trackée.
 */
import { useEffect } from 'react';
import { trackPageView } from '@/lib/tracking';

type Props = {
  restaurantId: string;
  restaurantSlug: string;
  city: string;
  source?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
};

export function PageViewTracker(props: Props) {
  useEffect(() => {
    trackPageView(props);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
