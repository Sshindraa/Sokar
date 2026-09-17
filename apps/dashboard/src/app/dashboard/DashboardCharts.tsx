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

function ChartCard({
  title,
  header,
  children,
}: {
  title: string;
  header?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-black tracking-tight text-foreground font-display">{title}</h2>
        {header}
      </header>
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
  payload?: Array<{ name?: string | number; value?: number | string; color?: string }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;

  // Recharts trie par nom par défaut, ce qui plaçait « Couverts » avant
  // « Réservations » dans la bulle alors que la légende suivait l'ordre
  // opérationnel. On garde le même ordre partout dans le cockpit.
  const orderedPayload = [...payload].sort((left, right) => {
    const order = (name?: string | number) => {
      if (name === 'Réservations') return 0;
      if (name === 'Couverts') return 1;
      return 2;
    };

    return order(left.name) - order(right.name);
  });

  return (
    <div className="dashboard-chart-tooltip max-w-[12rem] rounded-xl border border-border bg-popover px-3 py-2 shadow-xl">
      <p className="mb-1 text-xs font-bold text-popover-foreground">{label}</p>
      <div className="space-y-1">
        {orderedPayload.map((item, index) => (
          <p
            key={`${item.name ?? 'series'}-${index}`}
            className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"
          >
            <span aria-hidden="true" className="text-[10px]" style={{ color: item.color }}>
              ●
            </span>
            <span>{item.name}</span>
            <span className="font-bold text-popover-foreground">
              {typeof item.value === 'number'
                ? item.value.toLocaleString('fr-FR')
                : (item.value ?? 0)}
            </span>
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
  // Les deux séries restent neutres : la couleur ne porte ici aucun statut.
  const coversColor = 'hsl(var(--metal))';
  const reservationsColor = isLight
    ? 'hsl(var(--foreground) / 0.62)'
    : 'hsl(var(--foreground) / 0.72)';
  const totals = analytics.reduce(
    (acc, point) => ({
      reservations: acc.reservations + point.reservations,
      covers: acc.covers + point.covers,
    }),
    { reservations: 0, covers: 0 },
  );

  return (
    <section>
      <ChartCard
        title="Réservations et couverts"
        header={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: reservationsColor }}
              />
              <span>Réservations</span>
              <span className="font-bold text-foreground">{totals.reservations}</span>
            </div>
            <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: coversColor }}
              />
              <span>Couverts</span>
              <span className="font-bold text-foreground">{totals.covers}</span>
            </div>
          </div>
        }
      >
        <div className="h-[15.5rem] min-h-0 sm:h-[17.5rem]">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
            <AreaChart data={analytics} margin={{ left: 0, right: 8, top: 42, bottom: 0 }}>
              <defs>
                <linearGradient id="coversGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={coversColor} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={coversColor} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="reservationsGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={reservationsColor} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={reservationsColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={gridColor} strokeDasharray="3 6" vertical={false} />
              <XAxis
                dataKey="label"
                stroke={axisColor}
                tickLine={false}
                axisLine={false}
                tickMargin={10}
                minTickGap={20}
              />
              <YAxis
                stroke={axisColor}
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                width={44}
                allowDecimals={false}
              />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ stroke: gridColor, strokeDasharray: '4 4' }}
                itemSorter={(item) => (item.name === 'Réservations' ? 0 : 1)}
                position={{ x: 48, y: 4 }}
                offset={0}
                isAnimationActive={false}
                wrapperStyle={{ outline: 'none', pointerEvents: 'none', zIndex: 2 }}
              />
              <Area
                type="monotone"
                dataKey="reservations"
                name="Réservations"
                stroke={reservationsColor}
                fill="url(#reservationsGradient)"
                strokeWidth={2.25}
                activeDot={{
                  r: 4,
                  strokeWidth: 2,
                  stroke: reservationsColor,
                  fill: 'hsl(var(--card))',
                }}
              />
              <Area
                type="monotone"
                dataKey="covers"
                name="Couverts"
                stroke={coversColor}
                fill="url(#coversGradient)"
                strokeWidth={2.25}
                activeDot={{ r: 4, strokeWidth: 2, stroke: coversColor, fill: 'hsl(var(--card))' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    </section>
  );
}
