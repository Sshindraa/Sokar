'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useApi } from '../../lib/api';

export default function CallsPage() {
  const { get, orgId } = useApi();

  const [calls, setCalls] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) return;

    async function fetchCalls() {
      try {
        const data = await get(`calls?restaurantId=${orgId}&limit=100&offset=0`);
        setCalls(data.data ?? []);
        setTotal(data.total ?? 0);
      } catch {
        // silent
      }
      setLoading(false);
    }
    fetchCalls();
  }, [orgId]);

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
              <th className="px-4 py-3">Call SID</th>
              <th className="px-4 py-3">Intention</th>
              <th className="px-4 py-3">Résultat</th>
              <th className="px-4 py-3">Durée</th>
              <th className="px-4 py-3">Carrier</th>
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
                <td className="px-4 py-3 font-medium">{call.callSid}</td>
                <td className="px-4 py-3 text-[var(--muted-foreground)]">
                  {call.intent || '—'}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      call.outcome === 'RESERVED'
                        ? 'bg-green-100 text-green-700'
                        : call.outcome === 'INFO'
                          ? 'bg-blue-100 text-blue-700'
                          : call.outcome === 'NO_ACTION'
                            ? 'bg-gray-100 text-gray-700'
                            : 'bg-yellow-100 text-yellow-700'
                    }`}
                  >
                    {call.outcome === 'RESERVED'
                      ? 'Réservé'
                      : call.outcome === 'INFO'
                        ? 'Info'
                        : call.outcome === 'NO_ACTION'
                          ? 'Aucune action'
                          : call.outcome ?? 'En cours'}
                  </span>
                </td>
                <td className="px-4 py-3 text-[var(--muted-foreground)]">
                  {call.durationSec != null ? `${call.durationSec}s` : '—'}
                </td>
                <td className="px-4 py-3 text-[var(--muted-foreground)]">
                  {call.carrier || '—'}
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
