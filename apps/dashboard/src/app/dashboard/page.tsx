'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface DashboardStats {
  totalCalls: number;
  totalReservations: number;
  answeredRate: number;
  revenueRecovered: number;
}

interface RecentActivity {
  reservations: Array<{
    id: string;
    restaurantId: string;
    callId: string | null;
    customerId: string | null;
    reservedAt: string;
    partySize: number;
    customerName: string;
    customerPhone: string | null;
    status: string;
    estimatedRevenue: string | null;
    confirmedRevenue: string | null;
    createdAt: string;
  }>;
  calls: Array<{
    id: string;
    restaurantId: string;
    callSid: string;
    durationSec: number | null;
    transcript: string | null;
    intent: string | null;
    outcome: string | null;
    sttProvider: string | null;
    llmProvider: string | null;
    ttsProvider: string | null;
    carrier: string | null;
    createdAt: string;
  }>;
}

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
const RESTAURANT_ID = '00000000-0000-0000-0000-000000000001';

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activity, setActivity] = useState<RecentActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchData() {
      try {
        const [statsRes, activityRes] = await Promise.all([
          fetch(`${API}/dashboard/stats?restaurantId=${RESTAURANT_ID}`),
          fetch(`${API}/dashboard/recent-activity?restaurantId=${RESTAURANT_ID}`),
        ]);

        if (!statsRes.ok || !activityRes.ok) {
          throw new Error('Erreur serveur');
        }

        const statsData = await statsRes.json();
        const activityData = await activityRes.json();

        setStats({
          totalCalls: statsData.total_calls,
          totalReservations: statsData.total_reservations,
          answeredRate: statsData.answered_rate,
          revenueRecovered: statsData.revenue_recovered,
        });
        setActivity(activityData);
      } catch {
        setError('Impossible de charger les données');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
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

  const todayCalls = activity?.calls.slice(0, 5) ?? [];
  const todayReservations = activity?.reservations.slice(0, 5) ?? [];

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
          subtitle="Total"
        />
        <StatCard
          title="Taux de réponse"
          value={`${stats?.answeredRate ?? 0}%`}
          subtitle="Appels aboutis"
        />
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="rounded-xl border border-[var(--border)] p-6">
          <h2 className="mb-4 text-lg font-semibold">Appels récents</h2>
          <div className="space-y-3">
            {todayCalls.length === 0 && (
              <p className="text-sm text-[var(--muted-foreground)]">Aucun appel</p>
            )}
            {todayCalls.map((call) => (
              <div
                key={call.id}
                className="flex items-center justify-between rounded-lg bg-[var(--muted)] p-3"
              >
                <div>
                  <p className="text-sm font-medium">{call.callSid}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {format(new Date(call.createdAt), 'HH:mm', { locale: fr })}
                    {call.durationSec != null && ` · ${call.durationSec}s`}
                    {call.outcome && ` · ${call.outcome}`}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    call.outcome === 'RESERVED'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-yellow-100 text-yellow-700'
                  }`}
                >
                  {call.outcome === 'RESERVED' ? 'Réservé' : call.outcome ?? 'En cours'}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] p-6">
          <h2 className="mb-4 text-lg font-semibold">Réservations récentes</h2>
          <div className="space-y-3">
            {todayReservations.length === 0 && (
              <p className="text-sm text-[var(--muted-foreground)]">Aucune réservation</p>
            )}
            {todayReservations.map((res) => (
              <div
                key={res.id}
                className="flex items-center justify-between rounded-lg bg-[var(--muted)] p-3"
              >
                <div>
                  <p className="text-sm font-medium">{res.customerName}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {format(new Date(res.reservedAt), 'HH:mm', { locale: fr })}
                    {' · '}
                    {res.partySize} couverts
                    {res.estimatedRevenue && ` · ${res.estimatedRevenue}€ estimé`}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    res.status === 'CONFIRMED'
                      ? 'bg-green-100 text-green-700'
                      : res.status === 'SEATED'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {res.status === 'CONFIRMED'
                    ? 'Confirmée'
                    : res.status === 'SEATED'
                      ? 'Installée'
                      : res.status}
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
  value: string | number;
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
