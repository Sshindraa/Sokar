'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { useDashboardTheme } from '@/features/theme/dashboard-theme';
import type { AnalyticsPoint } from './page';

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
      <div className="mb-3">
        <h2 className="text-lg font-black tracking-tight text-foreground font-display">{title}</h2>
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
  const axisColor = isLight ? 'hsl(0 0% 6.7% / 0.4)' : 'hsl(60 13% 95.5% / 0.4)';
  const gridColor = isLight ? 'hsl(0 0% 6.7% / 0.08)' : 'hsl(60 13% 95.5% / 0.1)';
  // Couleurs alignées sur les tokens sémantiques (pas de bleu hardcodé).
  const coversColor = isLight ? 'hsl(38 7.8% 52%)' : 'hsl(38 7.8% 52%)';
  const reservationsColor = isLight ? 'hsl(139 13% 48%)' : 'hsl(152 18% 48%)';

  return (
    <section>
      <ChartCard title="Réservations et couverts">
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={analytics} margin={{ left: -18, right: 10, top: 10, bottom: 0 }}>
            <defs>
              <linearGradient id="coversGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={coversColor} stopOpacity={0.35} />
                <stop offset="95%" stopColor={coversColor} stopOpacity={0} />
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
              dataKey="covers"
              name="Couverts"
              stroke={coversColor}
              fill="url(#coversGradient)"
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
    </section>
  );
}
