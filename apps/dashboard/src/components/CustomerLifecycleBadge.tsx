import { cn } from '@/lib/utils';
import type { CustomerLifecycle, CustomerLifecycleStatus } from '@/types/api';

export const LIFECYCLE_LABELS: Record<CustomerLifecycleStatus, string> = {
  new: 'Nouveau',
  active: 'Actif',
  regular: 'Habitué',
  at_risk: 'À risque',
  dormant: 'Endormi',
};

const LIFECYCLE_STYLES: Record<CustomerLifecycleStatus, string> = {
  new: 'border-border bg-muted text-muted-foreground',
  active: 'border-success/40 bg-success/10 text-foreground',
  regular: 'border-brand/30 bg-brand/10 text-foreground',
  at_risk: 'border-warning/50 bg-warning/15 text-foreground',
  dormant: 'border-border bg-secondary text-muted-foreground',
};

/** Lifecycle status with its reason, computed by the API from real visits. */
export function CustomerLifecycleBadge({
  lifecycle,
  showReason = false,
  className,
}: {
  lifecycle: CustomerLifecycle | null | undefined;
  showReason?: boolean;
  className?: string;
}) {
  if (!lifecycle) return <span className="text-muted-foreground opacity-50">—</span>;
  return (
    <span className={cn('inline-flex min-w-0 flex-col gap-0.5', className)}>
      <span
        title={lifecycle.reason}
        className={cn(
          'inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-xs font-medium transition-all duration-200',
          LIFECYCLE_STYLES[lifecycle.status],
        )}
      >
        {LIFECYCLE_LABELS[lifecycle.status]}
      </span>
      {showReason ? (
        <span className="truncate text-xs text-muted-foreground">{lifecycle.reason}</span>
      ) : null}
    </span>
  );
}
