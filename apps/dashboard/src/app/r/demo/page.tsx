import { notFound } from 'next/navigation';
import ReservationView from '../reservation-view';

export default function ReservationDemoPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <ReservationView demo />;
}
