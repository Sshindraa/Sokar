'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { AnalyticsPoint } from './page';

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <article className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 shadow-xl md:p-6">
      <div className="mb-5">
        <h2 className="text-lg font-black tracking-tight text-white font-display">{title}</h2>
        <p className="mt-1 text-xs font-medium text-white/40">{subtitle}</p>
      </div>
      {children}
    </article>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-black/90 px-3 py-2 shadow-2xl">
      <p className="mb-1 text-xs font-bold text-white">{label}</p>
      <div className="space-y-1">
        {payload.map((item) => (
          <p key={item.name} className="text-[11px] font-medium text-white/60">
            <span style={{ color: item.color }}>●</span> {item.name}:{' '}
            {item.value?.toLocaleString('fr-FR') ?? 0}
          </p>
        ))}
      </div>
    </div>
  );
}

export default function DashboardCharts({ analytics }: { analytics: AnalyticsPoint[] }) {
  return (
    <section className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
      <ChartCard
        title="Appels et réservations"
        subtitle="Le volume entrant comparé aux réservations confirmées."
      >
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={analytics} margin={{ left: -18, right: 10, top: 10, bottom: 0 }}>
            <defs>
              <linearGradient id="callsGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="reservationsGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#34d399" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="label"
              stroke="rgba(255,255,255,0.35)"
              tickLine={false}
              axisLine={false}
            />
            <YAxis stroke="rgba(255,255,255,0.35)" tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip />} />
            <Area
              type="monotone"
              dataKey="calls"
              name="Appels"
              stroke="#22d3ee"
              fill="url(#callsGradient)"
              strokeWidth={2.5}
            />
            <Area
              type="monotone"
              dataKey="reservations"
              name="Réservations"
              stroke="#34d399"
              fill="url(#reservationsGradient)"
              strokeWidth={2.5}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Couverts générés" subtitle="Nombre de personnes réservées via Sokar.">
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={analytics} margin={{ left: -18, right: 10, top: 10, bottom: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="label"
              stroke="rgba(255,255,255,0.35)"
              tickLine={false}
              axisLine={false}
            />
            <YAxis stroke="rgba(255,255,255,0.35)" tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="covers" name="Couverts" fill="#22d3ee" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </section>
  );
}
