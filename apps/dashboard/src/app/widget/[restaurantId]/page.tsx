'use client';

import { useParams, useSearchParams } from 'next/navigation';
import ReservationWidget from '@/components/reservation/reservation-widget';

export default function ReservationWidgetPage() {
  const params = useParams<{ restaurantId: string }>();
  const searchParams = useSearchParams();
  return (
    <ReservationWidget
      restaurantId={params.restaurantId}
      query={new URLSearchParams(searchParams.toString())}
    />
  );
}
