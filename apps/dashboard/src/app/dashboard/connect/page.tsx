'use client';

import { useEffect, useState, useCallback, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, ExternalLink, Info } from 'lucide-react';
import { toast } from 'sonner';
import { useApi } from '@/lib/api';
import { ApiError } from '@/lib/api-error';
import { DataFetchError } from '@/components/DataFetchError';
import { StatusBadge } from '@/components/StatusBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { OnboardingLockBanner } from '@/features/onboarding/onboarding-guard';
import { cn } from '@/lib/utils';
import { CustomDomainCard, type Props as CustomDomainCardProps } from './custom-domain-card';
import { SubdomainCard } from './subdomain-card';
import { TestBookingCard } from './test-booking-card';

// ── Types ──────────────────────────────────────────────

type ConnectSettings = {
  restaurantId: string;
  slug: string;
  name: string;
  connectPublished: boolean;
  connectAgentic: boolean;
  connectPublishedAt: string | null;
  pageUrl: string;
  customDomain?: string | null;
  customDomainStatus?: string | null;
};

type ScoreItem = {
  key: string;
  label: string;
  weight: number;
  done: boolean;
  icon?: string;
};

type ConnectScore = {
  score: number;
  level: 'starter' | 'progress' | 'almost' | 'premium';
  message: string;
  items: ScoreItem[];
  missing: ScoreItem[];
  completed: number;
  total: number;
};

// ── Petits composants ──────────────────────────────────

const percentFormat = new Intl.NumberFormat('fr-FR', { style: 'percent' });

// « 45 % » : format français, espace fine insécable comprise.
function formatPercent(value: number): string {
  return percentFormat.format(value / 100);
}

function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className="inline-flex text-muted-foreground transition-all duration-200 hover:text-foreground"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{children}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ── Page principale ────────────────────────────────────

export default function ConnectDashboardPage() {
  const { get, patch, orgId } = useApi();
  const [settings, setSettings] = useState<ConnectSettings | null>(null);
  const [score, setScore] = useState<ConnectScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<'connectPublished' | 'connectAgentic' | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // La page des KPIs du pilote est réservée à l'équipe Sokar : le lien n'existe que pour elle.
  const [isOperator, setIsOperator] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void get<{ allowed?: boolean }>('admin/access')
      .then((response) => {
        if (!cancelled) setIsOperator(response.allowed === true);
      })
      .catch(() => {
        // Par défaut fermé : un contrôle indisponible ne doit jamais révéler une page interne.
        if (!cancelled) setIsOperator(false);
      });
    return () => {
      cancelled = true;
    };
  }, [get]);

  // Charge settings + score en parallèle
  const loadData = useCallback(() => {
    if (!orgId) return;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      get<ConnectSettings>(`restaurants/${orgId}/connect`),
      get<ConnectScore>(`restaurants/${orgId}/connect/score`),
    ])
      .then(([s, sc]) => {
        setSettings(s);
        setScore(sc);
      })
      .catch((err: Error) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, [orgId, get]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function toggle(field: 'connectPublished' | 'connectAgentic') {
    if (!settings || !orgId) return;
    setSaving(field);

    try {
      const newValue = !settings[field];
      await patch(`restaurants/${orgId}/connect`, { [field]: newValue });
      setSettings((prev) => (prev ? { ...prev, [field]: newValue } : prev));
      toast.success(
        field === 'connectPublished'
          ? newValue
            ? 'Connect activé : votre page est en ligne'
            : 'Connect désactivé'
          : newValue
            ? 'Découverte IA activée'
            : 'Découverte IA désactivée',
      );
      // Recharge le score seul après un toggle : la page et l'aperçu restent en place (pas de clignotement).
      setTimeout(() => {
        get<ConnectScore>(`restaurants/${orgId}/connect/score`)
          .then(setScore)
          .catch(() => undefined);
      }, 500);
    } catch (err: unknown) {
      // Publier sans adresse publique (slug) : l'API répond 409 sans texte, on dit quoi faire.
      if (err instanceof ApiError && err.code === 'CONNECT_SLUG_REQUIRED') {
        toast.error(
          'Choisissez d’abord l’adresse publique : complétez le profil du restaurant dans les réglages, puis activez Connect.',
        );
      } else {
        toast.error(err instanceof Error ? err.message : 'Erreur lors de la mise à jour');
      }
    } finally {
      setSaving(null);
    }
  }

  if (!orgId && !loading) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Sélectionnez un restaurant pour configurer Connect.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <OnboardingLockBanner task="connect-identity" />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Connect</h1>
        <div className="flex flex-wrap items-center gap-3">
          {isOperator && (
            <Link
              href="/dashboard/connect/pilot"
              className="inline-flex items-center rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-all duration-200 hover:border-primary/40 hover:bg-accent"
            >
              KPIs pilote P1
            </Link>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : !settings ? (
        <DataFetchError
          message={loadError || 'Impossible de charger les paramètres Connect.'}
          onRetry={loadData}
          retrying={loading}
        />
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
            <div className="space-y-4">
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                  <CardTitle className="text-base">Page publique</CardTitle>
                  <div className="flex items-center gap-3">
                    <StatusBadge level={settings.connectPublished ? 'progress' : 'neutral'}>
                      {settings.connectPublished ? 'En ligne' : 'Inactive'}
                    </StatusBadge>
                    <Switch
                      aria-label="Activer la page publique"
                      checked={settings.connectPublished}
                      disabled={saving !== null}
                      onCheckedChange={() => toggle('connectPublished')}
                    />
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 pt-0 text-sm">
                  {settings.connectPublished ? (
                    <>
                      <a
                        href={settings.pageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-w-0 items-center gap-1.5 break-all font-medium underline underline-offset-2 transition-all duration-200 hover:text-primary"
                      >
                        {settings.pageUrl.replace('https://', '')}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                      {settings.connectPublishedAt && (
                        <p className="text-xs text-muted-foreground">
                          Active depuis le{' '}
                          {new Date(settings.connectPublishedAt).toLocaleDateString('fr-FR', {
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric',
                          })}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-muted-foreground">
                        Activez Connect pour publier votre page.
                      </p>
                      {score && score.score < 60 && (
                        <p className="text-xs text-muted-foreground">
                          Profil complété à {formatPercent(score.score)}. Complétez-le avant
                          d’activer.
                        </p>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>

              <Card
                className={cn(
                  'transition-all duration-200',
                  !settings.connectPublished && 'opacity-60',
                )}
              >
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                  <CardTitle className="flex items-center gap-1.5 text-base">
                    Découverte IA
                    <InfoTip label="Précision sur la découverte IA">
                      Les métadonnées de réservation (ReserveAction) sont exposées aux crawlers d’IA
                      quand l’option est active.
                    </InfoTip>
                  </CardTitle>
                  <div className="flex items-center gap-3">
                    <StatusBadge level={settings.connectAgentic ? 'progress' : 'neutral'}>
                      {settings.connectAgentic ? 'Active' : 'Inactive'}
                    </StatusBadge>
                    <Switch
                      aria-label="Activer la découverte IA"
                      checked={settings.connectAgentic}
                      disabled={saving !== null || !settings.connectPublished}
                      onCheckedChange={() => toggle('connectAgentic')}
                    />
                  </div>
                </CardHeader>
                <CardContent className="pt-0 text-sm text-muted-foreground">
                  {settings.connectAgentic
                    ? 'Visible par ChatGPT, Perplexity et Google AI, avec réservation directe.'
                    : 'Rend votre restaurant visible par ChatGPT, Perplexity et Google AI.'}
                </CardContent>
              </Card>

              {settings.pageUrl && <TestBookingCard publicUrl={settings.pageUrl} />}

              <SubdomainCard slug={settings.slug} connectPublished={settings.connectPublished} />

              <CustomDomainCard
                restaurantId={settings.restaurantId}
                customDomain={settings.customDomain ?? null}
                customDomainStatus={
                  (settings.customDomainStatus as CustomDomainCardProps['customDomainStatus']) ??
                  null
                }
              />
            </div>

            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="text-base">Aperçu en direct</CardTitle>
                {settings.connectPublished && (
                  <Button variant="ghost" size="sm" asChild>
                    <a
                      href={`${settings.pageUrl}?preview=1`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Plein écran
                      <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                    </a>
                  </Button>
                )}
              </CardHeader>
              <CardContent className="pt-0">
                {settings.connectPublished ? (
                  <div className="overflow-hidden rounded-lg border border-border bg-muted">
                    <iframe
                      src={`${settings.pageUrl}?preview=1`}
                      title={`Aperçu — ${settings.name}`}
                      className="h-[420px] w-full"
                      loading="lazy"
                      sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                    />
                  </div>
                ) : (
                  <div className="flex h-[420px] items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
                    Activez Connect pour voir votre page.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {score && (
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="flex items-center gap-1.5 text-base">
                  Complétude du profil
                  <InfoTip label="Précision sur la complétude">{score.message}</InfoTip>
                </CardTitle>
                <span className="text-lg font-semibold tabular-nums">
                  {formatPercent(score.score)}
                </span>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <p className="text-sm text-muted-foreground">
                  {score.completed}/{score.total} éléments complétés
                </p>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-700 ease-out',
                      score.level === 'premium' ? 'bg-success' : 'bg-primary',
                    )}
                    style={{ width: `${score.score}%` }}
                  />
                </div>

                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {score.items.map((item) => (
                    <div
                      key={item.key}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all duration-200',
                        item.done
                          ? 'border-border text-foreground'
                          : 'border-dashed border-border text-muted-foreground',
                      )}
                    >
                      {item.done ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                      ) : (
                        <span className="h-4 w-4 shrink-0 rounded-full border-2 border-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <span className="text-xs text-muted-foreground">
                        +{formatPercent(item.weight)}
                      </span>
                    </div>
                  ))}
                </div>

                {score.missing.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-muted-foreground">À compléter :</span>
                    {score.missing.slice(0, 3).map((item) => (
                      <Link
                        key={item.key}
                        href="/dashboard/settings"
                        className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-foreground transition-all duration-200 hover:border-primary/40 hover:bg-accent"
                      >
                        {item.label}
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
