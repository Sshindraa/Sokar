'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface CallRecord {
  id: string;
  callerNumber: string;
  callerName?: string;
  status: string;
  outcome?: string;
  durationSeconds?: number;
  costUsd?: string;
  createdAt: string;
}

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('callyx_token');
}

export default function CallsPage() {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCalls() {
      const token = getToken();
      const res = await fetch(
        `${API}/api/calls?limit=100&offset=0`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      );
      if (res.ok) {
        const data = await res.json();
        setCalls(data.data);
        setTotal(data.total);
      }
      setLoading(false);
    }
    fetchCalls();
  }, []);

  if (loading) {
    return <div className="text-center text-[var(--muted-foreground)]">Chargement...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Appels</h1>
        <span className="text-sm text-[var(--muted-foreground)]">{total} appels</span>
      </div>

      <div className="rounded-xl border border-[var(--border)]">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-sm font-medium text-[var(--muted-foreground)]">
              <th className="px-4 py-3">Numéro</th>
              <th className="px-4 py-3">Nom</th>
              <th className="px-4 py-3">Statut</th>
              <th className="px-4 py-3">Durée</th>
              <th className="px-4 py-3">Coût</th>
              <th className="px-4 py-3">Date</th>
            </tr>
          </thead>
          <tbody>
            {calls.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">
                  Aucun appel
                </td>
              </tr>
            )}
            {calls.map((call) => (
              <tr key={call.id} className="border-b border-[var(--border)] text-sm">
                <td className="px-4 py-3 font-medium">{call.callerNumber}</td>
                <td className="px-4 py-3 text-[var(--muted-foreground)]">
                  {call.callerName || '—'}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      call.status === 'completed'
                        ? 'bg-green-100 text-green-700'
                        : call.status === 'failed'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-yellow-100 text-yellow-700'
                    }`}
                  >
                    {call.status === 'completed' ? 'Terminé' : call.status === 'failed' ? 'Échec' : 'En cours'}
                  </span>
                </td>
                <td className="px-4 py-3 text-[var(--muted-foreground)]">
                  {call.durationSeconds ? `${call.durationSeconds}s` : '—'}
                </td>
                <td className="px-4 py-3 text-[var(--muted-foreground)]">
                  {call.costUsd ? `${parseFloat(call.costUsd).toFixed(4)}$` : '—'}
                </td>
                <td className="px-4 py-3 text-[var(--muted-foreground)]">
                  {format(new Date(call.createdAt), 'dd MMM HH:mm', { locale: fr })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
