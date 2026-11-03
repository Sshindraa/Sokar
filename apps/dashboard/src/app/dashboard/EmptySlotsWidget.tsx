'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useApi } from '../../lib/api';
import { DataFetchError } from '@/components/DataFetchError';
import { getErrorMessage } from '@/types/api';

interface EmptySlotDay {
  date: string;
  dayName: string;
  isOpen: boolean;
  openTime: string | null;
  closeTime: string | null;
  reservationCount: number;
  covers: number;
  isUnderbooked: boolean;
  revenueAtRisk: number;
}

interface FillSuggestion {
  date: string;
  service: 'midi' | 'soir';
  capacity: number;
  freePlaces: number;
  emptyPlaces: number;
  forecastSource: 'historique' | 'simple';
  sends: number;
  tiers: Partial<Record<'CRENEAU' | 'REGULIER' | 'CONNU', number>>;
  costEstimate: { amount: number | string | null; status: string } | null;
  canPrepare: boolean;
  // Absent des anciennes entrées du cache : traité comme null.
  prepareBlockedReason?: 'SENDS_DISABLED' | 'BUDGET_EXHAUSTED' | 'NO_AUDIENCE' | null;
}

interface EmptySlotsResponse {
  days: EmptySlotDay[];
  summary: {
    underbookedDays: number;
    totalOpenDays: number;
    revenueAtRisk: number;
    avgRevenuePerReservation: number;
    threshold: number;
  };
}

const DAY_LABELS: Record<string, string> = {
  dim: 'Dimanche',
  lun: 'Lundi',
  mar: 'Mardi',
  mer: 'Mercredi',
  jeu: 'Jeudi',
  ven: 'Vendredi',
  sam: 'Samedi',
};

const MAX_VISIBLE_DAYS = 3;
const rowKey = (item: FillSuggestion) => `${item.date}-${item.service}`;
const TIERS = ['CRENEAU', 'REGULIER', 'CONNU'] as const;

function getLocalDateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function formatShortDate(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return '';

  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
  }).format(parsed);
}

function formatDayName(date: string, fallback: string) {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return DAY_LABELS[fallback] || fallback;

  const dayName = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' }).format(parsed);
  return dayName.charAt(0).toUpperCase() + dayName.slice(1);
}

export default function EmptySlotsWidget() {
  const t = useTranslations('fillService');
  const locale = useLocale();
  const { get, post, orgId } = useApi();
  const [data, setData] = useState<EmptySlotsResponse | null>(null);
  // null = route des suggestions indisponible (403, panne) : on garde la vue des journées.
  const [suggestions, setSuggestions] = useState<FillSuggestion[] | null>(null);
  const [dismissError, setDismissError] = useState(false);
  // Lignes dont l'appel « Ignorer » est en cours : le bouton est désactivé pour éviter le double envoi.
  const [dismissing, setDismissing] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    let mounted = true;
    async function fetchEmptySlots() {
      setError('');
      setLoading(true);
      setDismissError(false);
      const [suggestionsRes, slotsRes] = await Promise.allSettled([
        get<{ data: FillSuggestion[] }>('marketing/fill-suggestions'),
        get<EmptySlotsResponse>('dashboard/empty-slots'),
      ]);
      if (!mounted) return;
      setSuggestions(suggestionsRes.status === 'fulfilled' ? suggestionsRes.value.data : null);
      setData(slotsRes.status === 'fulfilled' ? slotsRes.value : null);
      if (suggestionsRes.status === 'rejected' && slotsRes.status === 'rejected') {
        setError(getErrorMessage(slotsRes.reason, "Impossible de charger l'analyse des créneaux"));
      }
      setLoading(false);
    }
    fetchEmptySlots();
    return () => {
      mounted = false;
    };
  }, [get, orgId, reloadKey]);

  if (!orgId) return null;
  if (loading) {
    return (
      <section className="rounded-2xl border border-border bg-card p-4 md:p-5">
        <Skeleton className="mb-4 h-6 w-52" />
        <div className="grid gap-2 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      </section>
    );
  }

  // Une panne ne doit pas ressembler à « aucune journée sous le seuil » : le widget l'annonce et propose de réessayer.
  if (error) {
    return (
      <section aria-label="Jours creux">
        <DataFetchError
          message={error}
          onRetry={() => setReloadKey((key) => key + 1)}
          retrying={loading}
        />
      </section>
    );
  }

  if (suggestions) {
    async function dismiss(suggestion: FillSuggestion) {
      const key = rowKey(suggestion);
      setDismissError(false);
      setDismissing((keys) => [...keys, key]);
      try {
        await post('marketing/fill-suggestions/dismiss', {
          date: suggestion.date,
          service: suggestion.service,
        });
        setSuggestions((list) =>
          (list ?? []).filter(
            (item) => item.date !== suggestion.date || item.service !== suggestion.service,
          ),
        );
      } catch {
        setDismissError(true);
      } finally {
        setDismissing((keys) => keys.filter((k) => k !== key));
      }
    }

    const money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' });

    return (
      <section
        aria-labelledby="fill-suggestions-title"
        className="rounded-2xl border border-border bg-card p-4 md:p-5"
      >
        <h2 id="fill-suggestions-title" className="text-base font-semibold text-foreground">
          {t('suggestions.title')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('suggestions.subtitle')}</p>
        {dismissError && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {t('suggestions.dismissError')}
          </p>
        )}
        {suggestions.length === 0 ? (
          <p className="mt-3 text-sm text-foreground">{t('suggestions.empty')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {suggestions.map((item) => {
              const rowLabel = {
                day: `${formatDayName(item.date, '').toLocaleLowerCase('fr-FR')} ${formatShortDate(item.date)}`,
                service: t(`suggestions.${item.service}`).toLocaleLowerCase('fr-FR'),
              };
              return (
                <li
                  key={rowKey(item)}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium text-foreground">
                      {formatDayName(item.date, '')} {formatShortDate(item.date)}
                      {' · '}
                      <span>{t(`suggestions.${item.service}`)}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('suggestions.emptyPlaces', { count: item.emptyPlaces })}
                      {item.forecastSource === 'simple' && (
                        <span> · {t('suggestions.sourceSimple')}</span>
                      )}
                    </p>
                    {item.sends > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {t('suggestions.sends', { count: item.sends })}
                        {/* Les anciennes entrées du cache n'ont pas de composition. */}
                        {TIERS.filter((tier) => (item.tiers?.[tier] ?? 0) > 0).map((tier) => (
                          <span key={tier}>
                            {' · '}
                            {t(`composition.${tier}`, { count: item.tiers[tier] ?? 0 })}
                          </span>
                        ))}
                        {item.costEstimate && (
                          <span>
                            {' · '}
                            {t('cost')} :{' '}
                            {item.costEstimate.amount == null
                              ? t('costUnknown')
                              : money.format(Number(item.costEstimate.amount))}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {item.canPrepare && (
                      <Button asChild variant="outline" size="sm">
                        <Link
                          aria-label={t('suggestions.prepareLabel', rowLabel)}
                          href={`/dashboard/marketing/fill-service?date=${encodeURIComponent(item.date)}&service=${item.service}&channel=EMAIL`}
                        >
                          {t('suggestions.prepare')}
                        </Link>
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="transition-all duration-200"
                      aria-label={t('suggestions.dismissLabel', rowLabel)}
                      disabled={dismissing.includes(rowKey(item))}
                      onClick={() => dismiss(item)}
                    >
                      {t('suggestions.dismiss')}
                    </Button>
                  </div>
                  {!item.canPrepare && item.prepareBlockedReason && (
                    <p className="w-full text-xs text-muted-foreground">
                      {t(`suggestions.blocked.${item.prepareBlockedReason}`)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  }

  if (!data) return null;
  if (data.days.length === 0) return null;

  const { summary } = data;
  const threshold = summary.threshold > 0 ? summary.threshold : 3;
  const days = data.days
    .filter((day) => day.isOpen && day.reservationCount < threshold)
    .slice(0, MAX_VISIBLE_DAYS);
  const remainingDays = Math.max(summary.underbookedDays - days.length, 0);

  return (
    <section
      aria-labelledby="empty-slots-title"
      className="rounded-2xl border border-border bg-card p-4 md:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 id="empty-slots-title" className="text-base font-semibold text-foreground">
              Journées peu remplies
            </h2>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Comprendre le seuil des journées peu remplies"
                    className="inline-flex rounded text-muted-foreground transition-all duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Info className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Ce seuil est un repère fixe. Il ne mesure pas le remplissage du restaurant et ne
                  permet pas de chiffrer un manque à gagner.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            7 prochains jours · journées avec moins de {threshold} réservations
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/reservations">Voir les réservations</Link>
        </Button>
      </div>
      {days.length === 0 ? (
        <p className="mt-3 text-sm text-foreground">
          {summary.totalOpenDays === 0
            ? 'Aucun jour d’ouverture renseigné sur les 7 prochains jours.'
            : `Au moins ${threshold} réservations sur chaque journée ouverte.`}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {days.map((day) => (
            <li
              key={day.date}
              className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 py-3 text-sm"
            >
              <div>
                <p className="font-medium text-foreground">
                  {formatDayName(day.date, day.dayName)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatShortDate(day.date)}
                  {day.date === getLocalDateKey(new Date()) ? ' · Aujourd’hui' : ''}
                </p>
              </div>
              <span className="tabular-nums text-foreground">
                {day.reservationCount} réservation{day.reservationCount > 1 ? 's' : ''}
              </span>
              <span className="tabular-nums text-muted-foreground">{day.covers} couverts</span>
              <Button asChild variant="outline" size="sm">
                <Link
                  href={`/dashboard/marketing/fill-service?date=${encodeURIComponent(day.date)}&service=soir`}
                >
                  {t('openFromQuietDay')}
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
      {remainingDays > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          +{remainingDays} autre{remainingDays > 1 ? 's' : ''} jour{remainingDays > 1 ? 's' : ''}
        </p>
      )}
    </section>
  );
}
