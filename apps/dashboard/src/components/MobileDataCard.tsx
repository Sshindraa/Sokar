'use client';

import { useState, useRef, useEffect } from 'react';
import { cn, triggerHaptic } from '@/lib/utils';
import { MoreHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';

export type MobileDataCardAction = {
  label: string;
  icon?: ReactNode;
  colorClass?: string;
  onClick: (e: React.MouseEvent) => void;
};

export type MobileDataCardProps = {
  /** Primary label (bold, left) */
  title: string;
  /** Optional subtitle line */
  subtitle?: string;
  /** Key-value detail pairs rendered in a 2-col mini grid */
  details?: { label: string; value: ReactNode }[];
  /** Badge rendered top-right */
  badge?: ReactNode;
  /** Left accent border color class, e.g. 'border-l-brand' */
  accentClass?: string;
  /** Click handler */
  onClick?: () => void;
  /** Optional background actions revealed on swipe-left */
  actions?: MobileDataCardAction[];
  /** Next useful action, visible without opening the overflow menu. */
  primaryAction?: MobileDataCardAction & { disabled?: boolean };
};

export default function MobileDataCard({
  title,
  subtitle,
  details,
  badge,
  accentClass,
  onClick,
  actions,
  primaryAction,
}: MobileDataCardProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);

  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const currentOffsetX = useRef(0);
  const isSwiping = useRef(false);

  const maxOffset = actions ? actions.length * 68 : 0;
  const actionSignature = actions?.map((action) => action.label).join('|');

  // Reset offset if the available actions change, without closing on every parent render.
  useEffect(() => {
    setOffsetX(0);
    setActionsOpen(false);
  }, [actionSignature]);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!actions || actions.length === 0) return;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    currentOffsetX.current = offsetX;
    isSwiping.current = false;
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!actions || !isDragging) return;
    const diffX = e.touches[0].clientX - touchStartX.current;
    const diffY = e.touches[0].clientY - touchStartY.current;

    // Determine if user is swiping horizontally or vertically scrolling
    if (!isSwiping.current) {
      if (Math.abs(diffX) > 8 && Math.abs(diffX) > Math.abs(diffY)) {
        isSwiping.current = true;
      }
    }

    if (isSwiping.current) {
      // Prevent browser bounce / scroll when swiping a card
      if (e.cancelable) {
        e.preventDefault();
      }

      const newOffset = currentOffsetX.current + diffX;
      // Allow swiping left (negative) and block swiping right past 10px
      setOffsetX(Math.min(10, Math.max(-maxOffset - 25, newOffset)));
    }
  };

  const handleTouchEnd = () => {
    if (!actions || !isDragging) return;
    setIsDragging(false);

    // If swiped more than half-way, snap open, otherwise snap closed
    if (offsetX < -maxOffset / 2) {
      setOffsetX(-maxOffset);
      triggerHaptic(12);
    } else {
      setOffsetX(0);
    }
  };

  const handleContentClick = (e: React.MouseEvent) => {
    // If swiped open, click to close
    if (offsetX < 0) {
      e.stopPropagation();
      setOffsetX(0);
      triggerHaptic(8);
      return;
    }
    if (onClick) {
      onClick();
    }
  };

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card">
      {/* Swipe actions rendered in background */}
      {actions && actions.length > 0 && (
        <div
          aria-hidden={offsetX === 0}
          className="absolute right-0 top-0 bottom-0 flex items-stretch z-0"
        >
          {actions.map((act, idx) => (
            <button
              key={idx}
              tabIndex={offsetX < 0 ? 0 : -1}
              onClick={(e) => {
                e.stopPropagation();
                triggerHaptic(15);
                act.onClick(e);
                setOffsetX(0); // auto-close
              }}
              className={cn(
                'w-[68px] flex flex-col items-center justify-center gap-1 text-[10px] font-bold text-white transition-opacity active:opacity-75',
                act.colorClass || 'bg-brand',
              )}
            >
              {act.icon && <div className="text-white">{act.icon}</div>}
              <span>{act.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Foreground card body */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleContentClick}
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: isDragging ? 'none' : 'transform 240ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        className={cn(
          'rounded-xl border border-transparent bg-background p-3.5 transition-colors duration-200 active:bg-accent touch-manipulation relative z-10 select-none',
          accentClass && `border-l-2 ${accentClass}`,
          onClick && 'cursor-pointer',
        )}
      >
        {/* Header: title + badge */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground truncate">{title}</p>
            {subtitle && (
              <p className="mt-0.5 text-[11px] text-muted-foreground truncate">{subtitle}</p>
            )}
          </div>
          <div className="flex flex-shrink-0 items-center gap-1.5">
            {badge ? <div>{badge}</div> : null}
            {actions && actions.length > 0 ? (
              <button
                type="button"
                aria-label={actionsOpen ? 'Masquer les actions' : 'Afficher les actions'}
                aria-expanded={actionsOpen}
                title={actionsOpen ? 'Masquer les actions' : 'Afficher les actions'}
                onClick={(e) => {
                  e.stopPropagation();
                  setActionsOpen((open) => !open);
                  setOffsetX(0);
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <MoreHorizontal size={17} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>

        {/* Detail grid */}
        {details && details.length > 0 && (
          <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5">
            {details.map((d) => (
              <div key={d.label} className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                  {d.label}
                </p>
                <p className="text-xs text-muted-foreground truncate">{d.value}</p>
              </div>
            ))}
          </div>
        )}

        {primaryAction && (
          <button
            type="button"
            disabled={primaryAction.disabled}
            onClick={(event) => {
              event.stopPropagation();
              primaryAction.onClick(event);
            }}
            className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-all duration-200 disabled:opacity-50"
          >
            {primaryAction.icon}
            {primaryAction.label}
          </button>
        )}

        {actionsOpen && actions && actions.length > 0 ? (
          <div
            className="mt-3 grid grid-cols-2 gap-2 border-t border-border/70 pt-3"
            onClick={(e) => e.stopPropagation()}
          >
            {actions.map((act, idx) => (
              <button
                key={`inline-${idx}`}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  triggerHaptic(15);
                  act.onClick(e);
                  setActionsOpen(false);
                  setOffsetX(0);
                }}
                className={cn(
                  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-2 text-[11px] font-semibold text-white transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  act.colorClass || 'bg-brand',
                )}
              >
                {act.icon ? <span aria-hidden="true">{act.icon}</span> : null}
                <span>{act.label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
