'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export type ServiceFillGroup = {
  customers: number;
  covers: number;
  coversPerCustomer: number;
  reservedCustomers?: number;
};

const TIERS = ['CRENEAU', 'REGULIER', 'CONNU', 'SANS_VISITE'] as const;
type Tier = (typeof TIERS)[number];
type TierGroup = { customers: number; reservedCustomers: number };

/** Points arrondis, avec le signe moins typographique. */
function points(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return '0';
  return rounded > 0 ? `+${rounded}` : `−${Math.abs(rounded)}`;
}

/** Mesure d'une campagne de remplissage : couverts par client, destinataires contre témoin. */
export type ServiceFillReportData = {
  treated: ServiceFillGroup;
  holdout: ServiceFillGroup;
  difference: number;
  conclusive: boolean;
  // Optionnels : absents des anciennes réponses de l'API.
  effect?: { difference: number; margin95: number } | null;
  byTier?: Partial<Record<Tier, { treated: TierGroup; holdout: TierGroup }>>;
  netEffect30d?: {
    treatedCoversPerCustomer: number;
    holdoutCoversPerCustomer: number;
    difference: number;
  } | null;
  truncated?: boolean;
  /** Règle des 5 réservants calculée par l'API ; absent des anciennes réponses. */
  proven?: boolean;
};

export function ServiceFillReport({ fill }: { fill: ServiceFillReportData }) {
  const t = useTranslations('fillService.report');
  const sign = fill.difference > 0 ? '+' : '';
  const effect = fill.effect;
  // Au moins 5 réservants par groupe : 4 sur 40 contre 0 sur 20 n'est pas une preuve.
  const proven =
    fill.proven ??
    (!!effect &&
      fill.conclusive &&
      !fill.truncated &&
      effect.difference - effect.margin95 > 0 &&
      (fill.treated.reservedCustomers ?? 0) >= 5 &&
      (fill.holdout.reservedCustomers ?? 0) >= 5);
  const tiers = TIERS.filter((tier) => fill.byTier?.[tier]);
  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3 text-xs">
      <p className="font-medium text-foreground">{t('title')}</p>
      <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">
            {t('treated')} ({fill.treated.customers})
          </dt>
          <dd className="tabular-nums text-foreground">
            {fill.treated.coversPerCustomer.toFixed(2)} {t('perCustomer')}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            {t('holdout')} ({fill.holdout.customers})
          </dt>
          <dd className="tabular-nums text-foreground">
            {fill.holdout.coversPerCustomer.toFixed(2)} {t('perCustomer')}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('difference')}</dt>
          <dd className="tabular-nums text-foreground">
            {sign}
            {fill.difference.toFixed(2)}
          </dd>
        </div>
      </dl>
      {effect && (
        <div className="mt-2 space-y-1">
          <p className="tabular-nums text-foreground">
            {t('effectRange', {
              low: points(effect.difference - effect.margin95),
              high: points(effect.difference + effect.margin95),
            })}
          </p>
          <p className={cn('font-medium', proven ? 'text-foreground' : 'text-muted-foreground')}>
            {proven ? t('proof') : t('noProof')}
          </p>
        </div>
      )}
      {fill.truncated ? (
        <p className="mt-2 text-muted-foreground">{t('truncated')}</p>
      ) : (
        !fill.conclusive && <p className="mt-2 text-muted-foreground">{t('inconclusive')}</p>
      )}
      {tiers.length > 0 && (
        <div className="mt-2">
          <p className="text-muted-foreground">{t('byTierTitle')}</p>
          <ul className="tabular-nums text-foreground">
            {tiers.map((tier) => {
              const row = fill.byTier![tier]!;
              return (
                <li key={tier}>
                  {t('byTierRow', {
                    tier: t(`tiers.${tier}`),
                    treatedReserved: row.treated.reservedCustomers,
                    treatedCustomers: row.treated.customers,
                    holdoutReserved: row.holdout.reservedCustomers,
                    holdoutCustomers: row.holdout.customers,
                  })}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {fill.netEffect30d !== undefined && (
        <p className="mt-2 text-muted-foreground">
          {fill.netEffect30d === null
            ? t('netPending')
            : `${t('netTitle')} : ${t('netValue', {
                treated: fill.netEffect30d.treatedCoversPerCustomer.toFixed(2),
                holdout: fill.netEffect30d.holdoutCoversPerCustomer.toFixed(2),
              })}`}
        </p>
      )}
    </div>
  );
}
