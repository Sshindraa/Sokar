'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useApi } from '../../lib/api';

export default function DashboardPage() {
  const { get, orgId } = useApi();

  const [stats, setStats] = useState<any>(null);
  const [activity, setActivity] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!orgId) return;

    async function fetchData() {
      try {
        const [statsData, activityData] = await Promise.all([
          get(`dashboard/stats?restaurantId=${orgId}`),
          get(`dashboard/recent-activity?restaurantId=${orgId}`),
        ]);
        setStats({
          totalCalls: statsData.total_calls ?? 0,
          totalReservations: statsData.total_reservations ?? 0,
          answeredRate: statsData.answered_rate ?? 0,
          revenueRecovered: statsData.revenue_recovered ?? 0,
        });
        setActivity(activityData);
      } catch (err: any) {
        setError(err.message || 'Impossible de charger les données');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [orgId]);

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
