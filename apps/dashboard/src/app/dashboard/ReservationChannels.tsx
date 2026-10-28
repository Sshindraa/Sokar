import { cn } from '@/lib/utils';

export type ReservationChannelKey = 'phone' | 'website' | 'google' | 'ai' | 'team';

export interface ReservationChannelStat {
  channel: ReservationChannelKey;
  reservations: number;
  covers: number;
}

interface ChannelMeta {
  label: string;
  /** Nuance du segment : la palette est monochrome, les canaux se lisent par intensité. */
  tone: string;
}

const CHANNEL_META: Record<ReservationChannelKey, ChannelMeta> = {
  phone: {
    label: 'Téléphone',
    tone: 'bg-foreground',
  },
  website: {
    label: 'Site et réseaux',
    tone: 'bg-foreground/65',
  },
  google: {
    label: 'Google',
    tone: 'bg-foreground/40',
  },
  ai: {
    label: 'Assistants IA',
    tone: 'bg-foreground/25',
  },
  team: {
    label: 'Équipe',
    tone: 'bg-foreground/10',
  },
};

const CHANNEL_ORDER: ReservationChannelKey[] = ['phone', 'website', 'google', 'ai', 'team'];

/** Répartition de démo, proportionnelle au total affiché, pour le mode sans session. */
export function demoReservationChannels(
  totalReservations: number,
  covers: number,
): ReservationChannelStat[] {
  const shares: Record<ReservationChannelKey, number> = {
    phone: 0.56,
    website: 0.21,
    google: 0.12,
    ai: 0.07,
    team: 0.04,
  };
  let remainingReservations = totalReservations;
  let remainingCovers = covers;
  return CHANNEL_ORDER.map((channel, index) => {
    const last = index === CHANNEL_ORDER.length - 1;
    const reservations = last
      ? remainingReservations
      : Math.round(totalReservations * shares[channel]);
    const channelCovers = last ? remainingCovers : Math.round(covers * shares[channel]);
    remainingReservations -= reservations;
    remainingCovers -= channelCovers;
    return { channel, reservations, covers: channelCovers };
  });
}

function formatShare(part: number, total: number): string {
  if (total === 0) return '0 %';
  return `${Math.round((part / total) * 100)} %`;
}

export default function ReservationChannels({ stats }: { stats: ReservationChannelStat[] }) {
  const byChannel = new Map(stats.map((stat) => [stat.channel, stat]));
  const rows = CHANNEL_ORDER.map(
    (channel) => byChannel.get(channel) ?? { channel, reservations: 0, covers: 0 },
  );
  const total = rows.reduce((sum, row) => sum + row.reservations, 0);
  const activeChannels = rows.filter((row) => row.reservations > 0).length;

  return (
    <section
      aria-labelledby="reservation-channels-title"
      className="rounded-2xl border border-border bg-card p-4 md:p-5"
    >
      <h2 id="reservation-channels-title" className="text-base font-semibold text-foreground">
        Réservations par canal
      </h2>

      {total === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Aucune réservation confirmée sur cette période.
        </p>
      ) : (
        <>
          <div
            role="img"
            aria-label={rows
              .filter((row) => row.reservations > 0)
              .map(
                (row) =>
                  `${CHANNEL_META[row.channel].label} ${formatShare(row.reservations, total)}`,
              )
              .join(', ')}
            className="mt-4 flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-secondary"
          >
            {rows
              .filter((row) => row.reservations > 0)
              .map((row) => (
                <span
                  key={row.channel}
                  className={cn(
                    'h-full transition-all duration-200',
                    CHANNEL_META[row.channel].tone,
                  )}
                  style={{ width: `${(row.reservations / total) * 100}%` }}
                />
              ))}
          </div>

          <div
            aria-hidden="true"
            className="mt-3 hidden grid-cols-[minmax(0,1fr)_6rem_5rem_3rem] gap-3 pb-2 text-right text-xs font-medium text-muted-foreground sm:grid"
          >
            <span className="text-left">Canal</span>
            <span>Réservations</span>
            <span>Couverts</span>
            <span>Part</span>
          </div>
          <ul className="mt-3 divide-y divide-border sm:mt-0">
            {rows.map((row) => {
              const meta = CHANNEL_META[row.channel];
              const empty = row.reservations === 0;
              return (
                <li
                  key={row.channel}
                  className={cn(
                    'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2 transition-all duration-200 sm:py-3 sm:grid-cols-[minmax(0,1fr)_6rem_5rem_3rem]',
                    empty && 'text-muted-foreground',
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={cn('h-2 w-2 shrink-0 rounded-full', meta.tone)}
                    />
                    <span
                      className={cn(
                        'text-sm font-medium',
                        empty ? 'text-muted-foreground' : 'text-foreground',
                      )}
                    >
                      {row.channel === 'ai' ? (
                        <span
                          tabIndex={0}
                          aria-describedby="ai-channel-description"
                          className="group relative cursor-help rounded-sm outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {meta.label}
                          <span
                            id="ai-channel-description"
                            role="tooltip"
                            className="absolute bottom-full left-0 z-10 hidden w-max max-w-52 rounded-md border border-border bg-popover px-3 py-2 text-xs font-normal text-popover-foreground shadow-sm group-hover:block group-focus:block"
                          >
                            ChatGPT, Perplexity et autres agents de réservation.
                          </span>
                        </span>
                      ) : (
                        meta.label
                      )}
                      {empty && <span className="sr-only"> — Aucune pour l’instant</span>}
                    </span>
                  </div>
                  <p className="text-right text-sm font-semibold tabular-nums text-foreground sm:text-base">
                    <span className="sr-only">Réservations : </span>
                    {row.reservations.toLocaleString('fr-FR')}
                    <span className="ml-1 text-xs font-normal text-muted-foreground sm:hidden">
                      · {formatShare(row.reservations, total)}
                    </span>
                  </p>
                  <p className="hidden text-right text-sm font-normal tabular-nums text-muted-foreground sm:block">
                    <span className="sr-only">Couverts : </span>
                    {row.covers.toLocaleString('fr-FR')}
                  </p>
                  <p className="hidden text-right text-sm font-normal tabular-nums text-foreground sm:block">
                    <span className="sr-only">Part : </span>
                    {formatShare(row.reservations, total)}
                  </p>
                </li>
              );
            })}
          </ul>

          {activeChannels === 1 && rows[0].reservations === total && (
            <p className="mt-3 text-xs text-muted-foreground">
              Toutes vos réservations arrivent par téléphone. Ajoutez votre lien de réservation sur
              votre site, Instagram et votre fiche Google pour en recevoir aussi en ligne.
            </p>
          )}
        </>
      )}
    </section>
  );
}
