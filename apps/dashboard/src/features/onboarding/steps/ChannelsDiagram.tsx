import { useId, type ReactNode } from 'react';
import { ArrowDown, ChevronRight, Layers, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type DiagramChannel = {
  key: string;
  icon: LucideIcon;
  title: string;
  hint: string;
  status: string;
  /** Un canal relié alimente déjà le planning ; sinon son connecteur reste en pointillés. */
  connected: boolean;
};

export function StatusBadge({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        ok
          ? 'border-success/30 bg-success/10 text-success'
          : 'border-border bg-muted/50 text-muted-foreground',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('size-1.5 rounded-full', ok ? 'bg-success' : 'bg-muted-foreground/50')}
      />
      {children}
    </span>
  );
}

/** Rail vertical qui réunit les connecteurs ; chaque carte en dessine son segment. */
function railPosition(index: number, count: number) {
  if (count === 1) return 'hidden';
  if (index === 0) return 'top-1/2 bottom-0';
  if (index === count - 1) return 'top-0 bottom-1/2';
  return 'inset-y-0';
}

function ChannelCard({
  channel,
  index,
  count,
}: {
  channel: DiagramChannel;
  index: number;
  count: number;
}) {
  const Icon = channel.icon;

  return (
    <li data-connected={channel.connected} className="relative py-1">
      <div
        className={cn(
          'flex items-start gap-3 rounded-xl border bg-background px-4 py-3 transition-all duration-200',
          channel.connected ? 'border-success/30' : 'border-border',
        )}
      >
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg transition-all duration-200',
            channel.connected ? 'bg-success/10 text-success' : 'bg-muted text-foreground',
          )}
        >
          <Icon size={17} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <span className="text-sm font-medium text-foreground">{channel.title}</span>
            <StatusBadge ok={channel.connected}>{channel.status}</StatusBadge>
          </span>
          <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
            {channel.hint}
          </span>
        </span>
      </div>
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-full top-1/2 hidden w-7 -translate-y-1/2 transition-all duration-200 lg:block',
          channel.connected
            ? 'h-0.5 rounded-full bg-success/60'
            : 'h-0 border-t-2 border-dashed border-border',
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-[calc(100%+1.75rem)] hidden w-0.5 -translate-x-1/2 bg-border lg:block',
          railPosition(index, count),
        )}
      />
    </li>
  );
}

/** Flèche qui mène du rail des canaux au planning commun ; vers le bas quand tout s'empile. */
function FlowArrow() {
  return (
    <div aria-hidden="true" className="flex items-center justify-center lg:justify-start lg:pl-7">
      <ArrowDown size={18} className="text-muted-foreground lg:hidden" />
      <span className="hidden h-0.5 flex-1 bg-border lg:block" />
      <ChevronRight size={16} className="hidden shrink-0 text-muted-foreground lg:block" />
    </div>
  );
}

/**
 * Les canaux d'entrée à gauche, reliés à un seul planning à droite : le restaurateur voit que tout
 * part des mêmes horaires, de la même salle et des mêmes règles, et quels canaux sont déjà branchés.
 */
export function ChannelsDiagram({
  channels,
  hub,
  children,
}: {
  channels: DiagramChannel[];
  hub: { title: string; description: string; summary?: string };
  children: ReactNode;
}) {
  const hubTitleId = useId();

  return (
    <div className="grid max-w-6xl items-center gap-2 lg:grid-cols-[minmax(0,1.1fr)_3.5rem_minmax(0,1fr)] lg:gap-0">
      <ul aria-label="Canaux de réservation" className="flex flex-col">
        {channels.map((channel, index) => (
          <ChannelCard key={channel.key} channel={channel} index={index} count={channels.length} />
        ))}
      </ul>
      <FlowArrow />
      <section
        aria-labelledby={hubTitleId}
        className="space-y-4 rounded-2xl border border-border bg-background p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Layers size={17} aria-hidden="true" />
            </span>
            <div>
              <h3 id={hubTitleId} className="text-sm font-semibold text-foreground">
                {hub.title}
              </h3>
              <p className="text-xs leading-5 text-muted-foreground">{hub.description}</p>
            </div>
          </div>
          {hub.summary ? (
            <span className="shrink-0 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
              {hub.summary}
            </span>
          ) : null}
        </div>
        <div className="space-y-4 border-t border-border pt-4">{children}</div>
      </section>
    </div>
  );
}
