'use client';

import { useTranslations } from 'next-intl';

export type ServiceFillGroup = { customers: number; covers: number; coversPerCustomer: number };

/** Mesure d'une campagne de remplissage : couverts par client, destinataires contre témoin. */
export type ServiceFillReportData = {
  treated: ServiceFillGroup;
  holdout: ServiceFillGroup;
  difference: number;
  conclusive: boolean;
};

export function ServiceFillReport({ fill }: { fill: ServiceFillReportData }) {
  const t = useTranslations('fillService.report');
  const sign = fill.difference > 0 ? '+' : '';
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
      {!fill.conclusive && <p className="mt-2 text-muted-foreground">{t('inconclusive')}</p>}
    </div>
  );
}
