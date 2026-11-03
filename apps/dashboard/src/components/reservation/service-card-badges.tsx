'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Cake, HeartPulse, Leaf, Star, UserX } from 'lucide-react';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import type { ServiceCard, ServiceCardBadge } from '@/types/api';

/** Same cap as the API: one request covers a whole service list. */
const MAX_IDS_PER_REQUEST = 200;

export interface ServiceCardsState {
  cards: Map<string, ServiceCard>;
  loading: boolean;
  error: boolean;
}

/**
 * Service badges for a whole reservation list, in one request. A failure never
 * blocks the list: the badges simply show a discreet "unavailable" mark.
 */
export function useServiceCards(reservationIds: string[]): ServiceCardsState {
  const { get, orgId } = useApi();
  const key = orgId
    ? [...new Set(reservationIds)].sort().slice(0, MAX_IDS_PER_REQUEST).join(',')
    : '';
  // Result of the latest finished request, tagged with its list: while the list
  // changes, the previous badges stay on screen and `loading` is derived.
  const [result, setResult] = useState<{
    key: string;
    cards: Map<string, ServiceCard>;
    error: boolean;
  }>({ key: '', cards: new Map(), error: false });

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    get<{ data: ServiceCard[] }>(`customers/service-cards?reservationIds=${key}`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (controller.signal.aborted) return;
        const cards = new Map<string, ServiceCard>();
        for (const card of response?.data ?? []) cards.set(card.reservationId, card);
        setResult({ key, cards, error: false });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setResult({ key, cards: new Map(), error: true });
      });
    return () => controller.abort();
  }, [get, key]);

  if (!key) return { cards: new Map(), loading: false, error: false };
  return {
    cards: result.cards,
    loading: result.key !== key,
    error: result.key === key && result.error,
  };
}

const BADGE_STYLES: Record<ServiceCardBadge['kind'], string> = {
  regular: 'border-brand/30 bg-brand/10 text-foreground',
  allergy: 'border-destructive/40 bg-destructive/10 text-destructive',
  diet: 'border-success/40 bg-success/10 text-foreground',
  accessibility: 'border-border bg-muted text-foreground',
  occasion: 'border-warning/40 bg-warning/10 text-foreground',
  no_show_risk: 'border-warning/50 bg-warning/15 text-foreground',
};

const BADGE_ICONS: Record<ServiceCardBadge['kind'], typeof Star> = {
  regular: Star,
  allergy: AlertTriangle,
  diet: Leaf,
  accessibility: HeartPulse,
  occasion: Cake,
  no_show_risk: UserX,
};

export function ServiceCardBadges({
  reservationId,
  state,
  className,
}: {
  reservationId: string;
  state: ServiceCardsState;
  className?: string;
}) {
  if (state.loading && state.cards.size === 0) {
    return <Skeleton className={cn('h-5 w-24 rounded-full', className)} aria-hidden />;
  }
  if (state.error) {
    return (
      <span className={cn('text-xs text-muted-foreground', className)}>Fiche indisponible</span>
    );
  }
  const badges = state.cards.get(reservationId)?.badges ?? [];
  return <ServiceBadgeList badges={badges} className={className} />;
}

export function ServiceBadgeList({
  badges,
  className,
}: {
  badges: ServiceCardBadge[];
  className?: string;
}) {
  if (badges.length === 0) return null;
  return (
    <ul className={cn('flex flex-wrap gap-1', className)} aria-label="Fiche de service">
      {badges.map((badge) => {
        const Icon = BADGE_ICONS[badge.kind];
        return (
          <li
            key={`${badge.kind}-${badge.label}`}
            title={badge.detail}
            className={cn(
              'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-all duration-200',
              BADGE_STYLES[badge.kind],
            )}
          >
            <Icon size={12} aria-hidden className="shrink-0" />
            <span className="truncate">{badge.label}</span>
            <span className="sr-only"> : {badge.detail}</span>
          </li>
        );
      })}
    </ul>
  );
}
