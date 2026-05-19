'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface ReservationRecord {
  id: string;
  customerName: string;
  customerPhone: string | null;
  reservedAt: string;
  partySize: number;
  status: string;
  estimatedRevenue: string | null;
  confirmedRevenue: string | null;
  createdAt: string;
}

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
const RESTAURANT_ID = '00000000-0000-0000-0000-000000000001';

export default function ReservationsPage() {
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchReservations() {
      const res = await fetch(
        `${API}/reservations?restaurantId=${RESTAURANT_ID}&limit=100`,
      );
      if (res.ok) {
        const data = await res.json();
        setReservations(data);
      }
      setLoading(false);
    }
    fetchReservations();
  }, []);

  if (loading) {
    return <div className="text-center text-[var(--muted-foreground)]">Chargement...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Réservations</h1>
        <span className="text-sm text-[var(--muted-foreground)]">{reservations.length} réservations</span>
      </div>

      <div className="rounded-xl border border-[var(--border)]">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-sm font-medium text-[var(--muted-foreground)]">
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Téléphone</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Couverts</th>
              <th className="px-4 py-3">Revenu estimé</th>
              <th className="px-4 py-3">Statut</th>
            </tr>
          </thead>
          <tbody>
            {reservations.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">
                  Aucune réservation
                </td>
              </tr>
            )}
            {reservations.map((res) => (
              <tr key={res.id} className="border-b border-[var(--border)] text-sm">
                <td className="px-4 py-3 font-medium">{res.customerName}</td>
                <td className="px-4 py-3 text-[var(--muted-foreground)]">
                  {res.customerPhone ?? '—'}
                </td>
                <td className="px-4 py-3">
                  {format(new Date(res.reservedAt), 'dd MMM yyyy HH:mm', { locale: fr })}
                </td>
                <td className="px-4 py-3">{res.partySize}</td>
                <td className="px-4 py-3 text-[var(--muted-foreground)]">
                  {res.estimatedRevenue ? `${res.estimatedRevenue}€` : '—'}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      res.status === 'CONFIRMED'
                        ? 'bg-green-100 text-green-700'
                        : res.status === 'CANCELLED'
                          ? 'bg-red-100 text-red-700'
                          : res.status === 'SEATED'
                            ? 'bg-blue-100 text-blue-700'
                            : res.status === 'NO_SHOW'
                              ? 'bg-gray-100 text-gray-700'
                              : 'bg-yellow-100 text-yellow-700'
                    }`}
                  >
                    {res.status === 'CONFIRMED'
                      ? 'Confirmée'
                      : res.status === 'CANCELLED'
                        ? 'Annulée'
                        : res.status === 'SEATED'
                          ? 'Installée'
                          : res.status === 'NO_SHOW'
                            ? 'No-show'
                            : 'En attente'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
