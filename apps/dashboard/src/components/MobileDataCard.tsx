'use client';

import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

export type MobileDataCardProps = {
  /** Primary label (bold, left) */
  title: string;
  /** Optional subtitle line */
  subtitle?: string;
  /** Key-value detail pairs rendered in a 2-col mini grid */
  details?: { label: string; value: ReactNode }[];
  /** Badge rendered top-right */
  badge?: ReactNode;
  /** Left accent border color class, e.g. 'border-l-emerald-500' */
  accentClass?: string;
  /** Click handler */
  onClick?: () => void;
};

export default function MobileDataCard({
  title,
  subtitle,
  details,
  badge,
  accentClass,
  onClick,
}: MobileDataCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 transition-all duration-200 active:scale-[0.98] active:bg-white/[0.04] touch-manipulation',
        accentClass && `border-l-2 ${accentClass}`,
        onClick && 'cursor-pointer',
      )}
    >
      {/* Header: title + badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white truncate">{title}</p>
          {subtitle && (
            <p className="mt-0.5 text-[11px] text-white/40 truncate">{subtitle}</p>
          )}
        </div>
        {badge && <div className="flex-shrink-0">{badge}</div>}
      </div>

      {/* Detail grid */}
      {details && details.length > 0 && (
        <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5">
          {details.map((d) => (
            <div key={d.label} className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-wider text-white/25">
                {d.label}
              </p>
              <p className="text-xs text-white/60 truncate">{d.value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
