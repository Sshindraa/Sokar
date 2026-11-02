'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { DataFetchError } from '@/components/DataFetchError';
import { FeatureLockCard } from '@/components/FeatureLockCard';
import { takeCampaignDraft } from '@/features/companion/campaign-draft';
import { parisToday } from '@/lib/paris-date';
import { useApi } from '@/lib/api';
import { featureLockFromError, type FeatureLock } from '@/lib/api-error';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/types/api';

type Service = 'midi' | 'soir';
type Channel = 'SMS' | 'EMAIL';

type FillPreview = {
  date: string;
  service: Service;
  channel: Channel;
  status: 'CAPACITY_UNKNOWN' | 'SERVICE_CLOSED' | 'SERVICE_FULL' | 'PLANNED';
  full: boolean;
  capacityKnown: boolean;
  freePlaces?: number;
  emptyPlaces?: number;
  forecastSource?: 'historique' | 'simple';
  candidateCount?: number;
  excludedSameDay?: number;
  excludedNearby?: number;
  tiers?: Partial<Record<'CRENEAU' | 'REGULIER' | 'CONNU', number>>;
  budgetExhausted?: boolean;
  excludedByReason?: Record<string, number>;
  audience?: number;
  holdout?: number;
  sends?: number;
  costEstimate?: { amount: number | string | null; status: string };
  template: { subject: string | null; bodyTemplate: string };
};

// useSearchParams est nul pendant le prérendu : la vue est donc rendue sous une frontière Suspense.
export default function FillServicePage() {
  return (
    <Suspense fallback={null}>
      <FillServiceView />
    </Suspense>
  );
}

function FillServiceView() {
  const t = useTranslations('fillService');
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const { post, orgId } = useApi();
  const [date, setDate] = useState(() => params?.get('date') ?? parisToday());
  const [service, setService] = useState<Service>(
    params?.get('service') === 'midi' ? 'midi' : 'soir',
  );
  const [channel, setChannel] = useState<Channel>('SMS');
  // Texte modifié par le gérant ; `null` tant qu'il n'a rien touché : on affiche le modèle par défaut.
  const [subject, setSubject] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [preview, setPreview] = useState<FillPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [featureLock, setFeatureLock] = useState<FeatureLock | null>(null);

  // Brouillon rédigé par Companion : repris une fois, pour le texte seulement.
  useEffect(() => {
    const stored = takeCampaignDraft();
    if (!stored) return;
    setChannel(stored.channel);
    setBody(stored.body);
    if (stored.channel === 'EMAIL') setSubject(stored.subject ?? '');
  }, []);

  useEffect(() => {
    if (!orgId || !date) return;
    let mounted = true;
    async function loadPreview() {
      setLoading(true);
      setError('');
      try {
        const response = await post<{ data: FillPreview }>('marketing/fill-service/preview', {
          date,
          service,
          channel,
        });
        if (mounted) setPreview(response.data);
      } catch (err: unknown) {
        if (!mounted) return;
        const lock = featureLockFromError(err);
        if (lock) setFeatureLock(lock);
        else setError(getErrorMessage(err, t('errorTitle')));
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void loadPreview();
    return () => {
      mounted = false;
    };
  }, [post, orgId, date, service, channel, reloadKey, t]);

  if (featureLock) {
    return (
      <div className="space-y-6 p-6 md:p-8">
        <FeatureLockCard lock={featureLock} feature={t('title')} />
      </div>
    );
  }

  const bodyValue = body ?? preview?.template.bodyTemplate ?? '';
  const subjectValue = subject ?? preview?.template.subject ?? '';
  const planned = preview?.status === 'PLANNED' && (preview.candidateCount ?? 0) > 0;
  const canCreate = planned && !creating && bodyValue.trim().length > 0;
  // Texte de composition produit ici (pluriels ICU) : le serveur ne renvoie que des comptes.
  const composition = (['CRENEAU', 'REGULIER', 'CONNU'] as const)
    .filter((tier) => (preview?.tiers?.[tier] ?? 0) > 0)
    .map((tier) => t(`composition.${tier}`, { count: preview?.tiers?.[tier] ?? 0 }))
    .join(', ');
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' });

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreate) return;
    setCreating(true);
    setCreateError('');
    try {
      const response = await post<{ data: { id: string } }>('marketing/fill-service', {
        date,
        service,
        channel,
        subject: channel === 'EMAIL' ? subjectValue : null,
        bodyTemplate: bodyValue,
      });
      router.push(`/dashboard/marketing?campaign=${encodeURIComponent(response.data.id)}`);
    } catch (err: unknown) {
      const lock = featureLockFromError(err);
      if (lock) setFeatureLock(lock);
      else setCreateError(getErrorMessage(err, t('errorTitle')));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6 p-6 md:p-8">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-all duration-200 hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t('back')}
      </Link>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
      </header>

      <Card>
        <CardContent className="grid gap-4 p-4 md:grid-cols-3 md:p-5">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">{t('date')}</span>
            <Input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="transition-all duration-200"
            />
          </label>
          <div className="space-y-1 text-sm">
            <span className="text-muted-foreground">{t('service')}</span>
            <div className="flex gap-2">
              {(['midi', 'soir'] as const).map((value) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={service === value ? 'default' : 'outline'}
                  aria-pressed={service === value}
                  onClick={() => setService(value)}
                  className="transition-all duration-200"
                >
                  {t(value)}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1 text-sm">
            <span className="text-muted-foreground">{t('channel')}</span>
            <div className="flex gap-2">
              {(['SMS', 'EMAIL'] as const).map((value) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={channel === value ? 'default' : 'outline'}
                  aria-pressed={channel === value}
                  onClick={() => setChannel(value)}
                  className="transition-all duration-200"
                >
                  {value === 'SMS' ? t('sms') : t('email')}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {!orgId ? null : loading && !preview ? (
        <section aria-busy="true" aria-label={t('loading')} className="space-y-3">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t('loading')}
          </p>
          <div className="grid gap-3 md:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((index) => (
              <Skeleton key={index} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        </section>
      ) : error ? (
        <DataFetchError
          message={error}
          onRetry={() => setReloadKey((key) => key + 1)}
          retrying={loading}
        />
      ) : preview?.status === 'CAPACITY_UNKNOWN' ? (
        <Notice tone="muted">{t('capacityUnknown')}</Notice>
      ) : preview?.status === 'SERVICE_CLOSED' ? (
        <Notice tone="muted">{t('closed')}</Notice>
      ) : preview?.status === 'SERVICE_FULL' ? (
        <Notice tone="warning">{t('full')}</Notice>
      ) : preview?.budgetExhausted ? (
        <Notice tone="warning">{t('budgetExhausted')}</Notice>
      ) : preview?.emptyPlaces === 0 ? (
        <Notice tone="muted">{t('noEmptyPlaces')}</Notice>
      ) : preview && (preview.candidateCount ?? 0) === 0 ? (
        <Notice tone="muted">
          <p>{t('noCandidate')}</p>
          <p className="mt-1 text-xs">
            {t('noCandidateReasons', {
              noConsent: preview.excludedByReason?.NO_CONSENT ?? 0,
              optedOut:
                (preview.excludedByReason?.OPTED_OUT ?? 0) +
                (preview.excludedByReason?.OPTED_OUT_REGISTER ?? 0),
              sameDay: preview.excludedSameDay ?? 0,
              nearby: preview.excludedNearby ?? 0,
              frequency: preview.excludedByReason?.FREQUENCY_CAP ?? 0,
            })}
          </p>
        </Notice>
      ) : preview ? (
        <form onSubmit={create} className="space-y-6">
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Figure label={t('freePlaces')} value={preview.freePlaces ?? 0} />
            <Figure label={t('emptyPlaces')} value={preview.emptyPlaces ?? 0} />
            <Figure label={t('candidates')} value={preview.candidateCount ?? 0} />
            <Figure label={t('audience')} value={preview.audience ?? 0} />
            <Figure label={t('holdout')} value={preview.holdout ?? 0} />
            <Figure label={t('sends')} value={preview.sends ?? 0} />
            <Figure
              label={t('cost')}
              value={
                preview.costEstimate?.amount == null
                  ? t('costUnknown')
                  : formatter.format(Number(preview.costEstimate.amount))
              }
            />
          </dl>

          {composition && <p className="text-sm text-foreground">{composition}</p>}
          <div className="space-y-1 text-xs text-muted-foreground">
            {preview.forecastSource === 'simple' && <p>{t('forecastSimple')}</p>}
            <p>{t('estimateNote')}</p>
          </div>

          <Card>
            <CardContent className="space-y-4 p-4 md:p-5">
              {channel === 'EMAIL' && (
                <label className="block space-y-1 text-sm">
                  <span className="text-muted-foreground">{t('subject')}</span>
                  <Input
                    value={subjectValue}
                    onChange={(event) => setSubject(event.target.value)}
                    maxLength={200}
                  />
                </label>
              )}
              <label className="block space-y-1 text-sm">
                <span className="text-muted-foreground">{t('body')}</span>
                <textarea
                  value={bodyValue}
                  onChange={(event) => setBody(event.target.value)}
                  rows={5}
                  className="w-full rounded-md border border-input bg-background p-3 text-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <p className="text-xs text-muted-foreground">{t('bodyHelp')}</p>
              {createError && (
                <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4" aria-hidden="true" />
                  {createError}
                </p>
              )}
              <div className="flex justify-end">
                <Button type="submit" disabled={!canCreate} className="transition-all duration-200">
                  {creating ? t('creating') : t('create')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      ) : null}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function Notice({ tone, children }: { tone: 'muted' | 'warning'; children: ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        'rounded-xl border p-4 text-sm',
        tone === 'warning'
          ? 'border-destructive/30 bg-destructive/5 text-foreground'
          : 'border-border bg-muted/30 text-foreground',
      )}
    >
      {children}
    </div>
  );
}
