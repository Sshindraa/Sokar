'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface ReservationRecord {
  id: string;
  customerName: string;
  customerPhone: string;
  date: string;
  time: string;
  covers: number;
  status: string;
  notes?: string;
  createdAt: string;
}

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('callyx_token');
}

export default function ReservationsPage() {
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchReservations() {
      const token = getToken();
      const res = await fetch(
        `${API}/api/reservations?limit=100&offset=0`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      );
      if (res.ok) {
        const data = await res.json();
        setReservations(data.data);
        setTotal(data.total);
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
        <span className="text-sm text-[var(--muted-foreground)]">{total} réservations</span>
      </div>

      <div className="rounded-xl border border-[var(--border)]">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-sm font-medium text-[var(--muted-foreground)]">
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Téléphone</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Heure</th>
              <th className="px-4 py-3">Couverts</th>
              <th className="px-4 py-3">Statut</th>
              <th className="px-4 py-3">Notes</th>
            </tr>
          </thead>
          <tbody>
            {reservations.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">
                  Aucune réservation
                </td>
              </tr>
            )}
            {reservations.map((res) => (
              <tr key={res.id} className="border-b border-[var(--border)] text-sm">
                <td className="px-4 py-3 font-medium">{res.customerName}</td>
                <td className="px-4 py-3 text-[var(--muted-foreground)]">{res.customerPhone}</td>
                <td className="px-4 py-3">
                  {format(new Date(res.date), 'dd MMM yyyy', { locale: fr })}
                </td>
                <td className="px-4 py-3">{res.time}</td>
                <td className="px-4 py-3">{res.covers}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      res.status === 'confirmed'
                        ? 'bg-green-100 text-green-700'
                        : res.status === 'cancelled'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {res.status === 'confirmed'
                      ? 'Confirmée'
                      : res.status === 'cancelled'
                        ? 'Annulée'
                        : res.status === 'no_show'
                          ? 'No-show'
                          : 'En attente'}
                  </span>
                </td>
                <td className="px-4 py-3 text-[var(--muted-foreground)]">{res.notes || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
