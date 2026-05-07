'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface DashboardStats {
  totalCalls: number;
  totalReservations: number;
  quota: { used: number; limit: number };
  recentCalls: Array<{
    id: string;
    callerNumber: string;
    callerName?: string;
    status: string;
    durationSeconds?: number;
    createdAt: string;
  }>;
  todayReservations: Array<{
    id: string;
    customerName: string;
    date: string;
    time: string;
    covers: number;
    status: string;
  }>;
}

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('callyx_token');
}

async function authFetch(path: string, options?: RequestInit) {
  const token = getToken();
  return fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await authFetch('/api/dashboard/stats');
        if (!res.ok) {
          if (res.status === 401) {
            setError('Session expirée. Veuillez vous reconnecter.');
            return;
          }
          throw new Error('Erreur serveur');
        }
        setStats(await res.json());
      } catch {
        setError('Impossible de charger les données');
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, []);

  if (loading) {
    return <div className="text-center text-[var(--muted-foreground)]">Chargement...</div>;
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 p-4 text-sm text-red-600">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Vue d'ensemble</h1>

      <div className="grid gap-6 sm:grid-cols-3">
        <StatCard
          title="Appels traités"
          value={stats?.totalCalls ?? 0}
          subtitle="Depuis le début"
        />
        <StatCard
          title="Réservations"
          value={stats?.totalReservations ?? 0}
          subtitle="Aujourd'hui"
        />
        <StatCard
          title="Appels restants"
          value={(stats?.quota.limit ?? 0) - (stats?.quota.used ?? 0)}
          subtitle={`Sur ${stats?.quota.limit ?? 1500} / mois`}
        />
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="rounded-xl border border-[var(--border)] p-6">
          <h2 className="mb-4 text-lg font-semibold">Appels récents</h2>
          <div className="space-y-3">
            {stats?.recentCalls.length === 0 && (
              <p className="text-sm text-[var(--muted-foreground)]">Aucun appel</p>
            )}
            {stats?.recentCalls.map((call) => (
              <div
                key={call.id}
                className="flex items-center justify-between rounded-lg bg-[var(--muted)] p-3"
              >
                <div>
                  <p className="text-sm font-medium">{call.callerNumber}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {format(new Date(call.createdAt), 'HH:mm', { locale: fr })}
                    {call.durationSeconds && ` · ${call.durationSeconds}s`}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    call.status === 'completed'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-yellow-100 text-yellow-700'
                  }`}
                >
                  {call.status === 'completed' ? 'Terminé' : 'En cours'}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] p-6">
          <h2 className="mb-4 text-lg font-semibold">Réservations du jour</h2>
          <div className="space-y-3">
            {stats?.todayReservations.length === 0 && (
              <p className="text-sm text-[var(--muted-foreground)]">Aucune réservation</p>
            )}
            {stats?.todayReservations.map((res) => (
              <div
                key={res.id}
                className="flex items-center justify-between rounded-lg bg-[var(--muted)] p-3"
              >
                <div>
                  <p className="text-sm font-medium">{res.customerName}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {res.time} · {res.covers} couverts
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    res.status === 'confirmed'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {res.status === 'confirmed' ? 'Confirmée' : res.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: number;
  subtitle: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
      <p className="text-sm text-[var(--muted-foreground)]">{title}</p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
      <p className="mt-1 text-xs text-[var(--muted-foreground)]">{subtitle}</p>
    </div>
  );
}
