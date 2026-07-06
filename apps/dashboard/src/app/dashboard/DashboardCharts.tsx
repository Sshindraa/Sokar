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

import { useDashboardTheme } from '@/features/theme/dashboard-theme';
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
    <article className="rounded-2xl border border-border bg-card p-4 shadow-sm md:p-6">
      <div className="mb-5">
        <h2 className="text-lg font-black tracking-tight text-foreground font-display">{title}</h2>
        <p className="mt-1 text-xs font-medium text-muted-foreground">{subtitle}</p>
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
    <div className="rounded-xl border border-border bg-popover px-3 py-2 shadow-2xl">
      <p className="mb-1 text-xs font-bold text-popover-foreground">{label}</p>
      <div className="space-y-1">
        {payload.map((item) => (
          <p key={item.name} className="text-[11px] font-medium text-muted-foreground">
            <span style={{ color: item.color }}>●</span> {item.name}:{' '}
            {item.value?.toLocaleString('fr-FR') ?? 0}
          </p>
        ))}
      </div>
    </div>
  );
}

export default function DashboardCharts({ analytics }: { analytics: AnalyticsPoint[] }) {
  const { theme } = useDashboardTheme();
  const isLight = theme === 'light';
  const axisColor = isLight ? 'rgba(14,23,38,0.4)' : 'rgba(169,184,204,0.5)';
  const gridColor = isLight ? 'rgba(14,23,38,0.08)' : 'rgba(143,167,196,0.15)';
  // Couleurs alignées sur les tokens brand/success de la palette liquid glass.
  const callsColor = isLight ? '#3B82F6' : '#5EA2FF';
  const reservationsColor = isLight ? '#12B981' : '#34D399';

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
                <stop offset="5%" stopColor={callsColor} stopOpacity={0.35} />
                <stop offset="95%" stopColor={callsColor} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="reservationsGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={reservationsColor} stopOpacity={0.35} />
                <stop offset="95%" stopColor={reservationsColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={gridColor} vertical={false} />
            <XAxis dataKey="label" stroke={axisColor} tickLine={false} axisLine={false} />
            <YAxis stroke={axisColor} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip />} />
            <Area
              type="monotone"
              dataKey="calls"
              name="Appels"
              stroke={callsColor}
              fill="url(#callsGradient)"
              strokeWidth={2.5}
            />
            <Area
              type="monotone"
              dataKey="reservations"
              name="Réservations"
              stroke={reservationsColor}
              fill="url(#reservationsGradient)"
              strokeWidth={2.5}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Couverts générés" subtitle="Nombre de personnes réservées via Sokar.">
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={analytics} margin={{ left: -18, right: 10, top: 10, bottom: 0 }}>
            <CartesianGrid stroke={gridColor} vertical={false} />
            <XAxis dataKey="label" stroke={axisColor} tickLine={false} axisLine={false} />
            <YAxis stroke={axisColor} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="covers" name="Couverts" fill={callsColor} radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </section>
  );
}
