'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApi } from '@/lib/api';

type Reason = 'unconfirmed' | 'noTable' | 'largeParty' | 'pastNoShow' | 'vip' | 'regular';

interface TonightRow {
  reservationId: string;
  name: string;
  time: string;
  partySize: number;
  reasons: Reason[];
}

interface TonightData {
  service: 'midi' | 'soir';
  date: string;
  covers: number;
  usualCovers: number | null;
  specialRequestsCount: number;
  waitlistCount: number;
  watch: TonightRow[];
  attention: TonightRow[];
}

type Status = 'loading' | 'ready' | 'error';

/** Une ligne par réservation : les motifs des deux listes s'ajoutent, dans l'ordre de l'heure. */
function mergeRows(data: TonightData): TonightRow[] {
  const byId = new Map<string, TonightRow>();
  for (const row of [...data.watch, ...data.attention]) {
    const existing = byId.get(row.reservationId);
    if (existing) existing.reasons.push(...row.reasons);
    else byId.set(row.reservationId, { ...row, reasons: [...row.reasons] });
  }
  return [...byId.values()].sort((a, b) => a.time.localeCompare(b.time));
}

export function TonightCard() {
  const t = useTranslations('companion.tonight');
  const locale = useLocale();
  const { get } = useApi();
  const [data, setData] = useState<TonightData | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    get<TonightData>('companion/tonight').then(
      (result) => {
        if (!current) return;
        setData(result);
        setStatus('ready');
      },
      () => {
        if (current) setStatus('error');
      },
    );
    return () => {
      current = false;
    };
  }, [get, attempt]);

  function retry() {
    setStatus('loading');
    setAttempt((value) => value + 1);
  }

  const rows = data ? mergeRows(data) : [];
  const title = data ? t(data.service === 'soir' ? 'soir' : 'midi') : t('title');
  const usualLabel =
    data?.usualCovers == null
      ? null
      : t('usual', {
          usual: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
            data.usualCovers,
          ),
        });

  return (
    <section
      aria-labelledby="companion-tonight-title"
      className="space-y-3 rounded-2xl border border-border bg-background p-4"
    >
      <h3 id="companion-tonight-title" className="text-sm font-semibold text-foreground">
        {title}
      </h3>

      {status === 'loading' && (
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          {t('loading')}
        </p>
      )}

      {status === 'error' && (
        <div role="alert" className="space-y-2">
          <p className="text-sm text-foreground">{t('error')}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={retry}
            className="transition-all duration-200"
          >
            {t('retry')}
          </Button>
        </div>
      )}

      {status === 'ready' && data && data.covers === 0 && (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      )}

      {status === 'ready' && data && data.covers > 0 && (
        <>
          <p className="text-sm text-foreground">
            {[t('covers', { count: data.covers }), usualLabel].filter(Boolean).join(' · ')}
          </p>
          {(data.specialRequestsCount > 0 || data.waitlistCount > 0) && (
            <p className="text-xs text-muted-foreground">
              {[
                data.specialRequestsCount > 0 &&
                  t('specialRequests', { count: data.specialRequestsCount }),
                data.waitlistCount > 0 && t('waitlist', { count: data.waitlistCount }),
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}

          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('nothingToWatch')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((row) => (
                <li key={row.reservationId}>
                  <Link
                    href={`/dashboard/reservations?${new URLSearchParams({ date: data.date, reservation: row.reservationId })}`}
                    className="flex items-start justify-between gap-3 rounded-xl py-2 transition-all duration-200 hover:bg-accent"
                  >
                    <span className="min-w-0 space-y-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {row.name}
                      </span>
                      <span className="flex flex-wrap gap-1">
                        {row.reasons.map((reason) => (
                          <span
                            key={reason}
                            className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
                          >
                            {t(`reasons.${reason}`)}
                          </span>
                        ))}
                      </span>
                    </span>
                    <span className="flex-none text-right text-xs text-muted-foreground">
                      {row.time} · {t('covers', { count: row.partySize })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
