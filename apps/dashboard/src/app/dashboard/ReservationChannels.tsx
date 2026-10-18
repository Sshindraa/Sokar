import { Globe, Phone, Search, Sparkles, Users, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ReservationChannelKey = 'phone' | 'website' | 'google' | 'ai' | 'team';

export interface ReservationChannelStat {
  channel: ReservationChannelKey;
  reservations: number;
  covers: number;
}

interface ChannelMeta {
  label: string;
  detail: string;
  icon: LucideIcon;
  /** Nuance du segment : la palette est monochrome, les canaux se lisent par intensité. */
  tone: string;
}

const CHANNEL_META: Record<ReservationChannelKey, ChannelMeta> = {
  phone: {
    label: 'Téléphone',
    detail: 'Appels pris par Sokar',
    icon: Phone,
    tone: 'bg-foreground',
  },
  website: {
    label: 'Site et réseaux',
    detail: 'Votre site, Instagram, QR code',
    icon: Globe,
    tone: 'bg-foreground/65',
  },
  google: {
    label: 'Google',
    detail: 'Recherche et fiche Google',
    icon: Search,
    tone: 'bg-foreground/40',
  },
  ai: {
    label: 'Assistants IA',
    detail: 'ChatGPT, Perplexity et agents',
    icon: Sparkles,
    tone: 'bg-foreground/25',
  },
  team: {
    label: 'Équipe',
    detail: 'Ajoutées depuis le dashboard',
    icon: Users,
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
  const withoutTeam = total - (byChannel.get('team')?.reservations ?? 0);
  const activeChannels = rows.filter((row) => row.reservations > 0).length;

  return (
    <section
      aria-labelledby="reservation-channels-title"
      className="rounded-2xl border border-border bg-card p-4 shadow-sm md:p-6"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2
            id="reservation-channels-title"
            className="text-base font-bold text-foreground md:text-lg"
          >
            Réservations par canal
          </h2>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Où vos clients ont réservé sur la période.
          </p>
        </div>
        {total > 0 && (
          <p className="text-xs font-semibold text-muted-foreground sm:text-right sm:text-sm">
            <span className="text-2xl font-black tracking-tight text-foreground md:text-3xl">
              {withoutTeam.toLocaleString('fr-FR')}
            </span>{' '}
            prises sans votre équipe
          </p>
        )}
      </div>

      {total === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-border bg-background px-4 py-5 text-sm text-muted-foreground">
          Aucune réservation confirmée sur cette période. Chaque nouvelle réservation apparaîtra ici
          avec son canal.
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
            className="mt-5 flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-secondary"
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

          <ul className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border bg-background">
            {rows.map((row) => {
              const meta = CHANNEL_META[row.channel];
              const Icon = meta.icon;
              const empty = row.reservations === 0;
              return (
                <li
                  key={row.channel}
                  className={cn(
                    'grid grid-cols-[auto_1fr_auto] items-center gap-3 px-3.5 py-3 transition-all duration-200 sm:grid-cols-[auto_1fr_5rem_5rem_4rem] sm:px-4',
                    empty && 'text-muted-foreground',
                  )}
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-foreground/75">
                    <Icon size={15} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={cn('h-2 w-2 shrink-0 rounded-full', meta.tone)}
                      />
                      <p
                        className={cn(
                          'truncate text-sm font-bold',
                          empty ? 'text-muted-foreground' : 'text-foreground',
                        )}
                      >
                        {meta.label}
                      </p>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {empty ? 'Aucune pour l’instant' : meta.detail}
                    </p>
                  </div>
                  <p className="text-right text-sm font-black tabular-nums text-foreground sm:text-base">
                    {row.reservations.toLocaleString('fr-FR')}
                    <span className="ml-1 text-xs font-semibold text-muted-foreground sm:hidden">
                      · {formatShare(row.reservations, total)}
                    </span>
                  </p>
                  <p className="hidden text-right text-xs font-semibold tabular-nums text-muted-foreground sm:block">
                    {row.covers.toLocaleString('fr-FR')} couv.
                  </p>
                  <p className="hidden text-right text-sm font-bold tabular-nums text-foreground sm:block">
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
