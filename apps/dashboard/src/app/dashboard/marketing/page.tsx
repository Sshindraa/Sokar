'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  Clock3,
  Download,
  ListFilter,
  Megaphone,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { useApi } from '@/lib/api';
import { getErrorMessage } from '@/types/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

type AutomationType = 'AFTER_FIRST_HONORED' | 'DORMANT' | 'BIRTHDAY';
type MarketingChannel = 'SMS' | 'EMAIL' | 'WHATSAPP';

type AutomationConfig = {
  bodyTemplate: string;
  subject: string | null;
  timezone: string;
  delayHours?: number;
  inactiveDays?: number;
  daysBefore?: number;
  sendHour?: number;
};

type Automation = {
  id: string;
  type: AutomationType;
  channel: MarketingChannel;
  config: AutomationConfig;
  version: number;
  enabled: boolean;
  lastEvaluatedAt: string | null;
};

type Campaign = {
  id: string;
  name: string;
  objective: string;
  channel: MarketingChannel;
  status: string;
  audienceCount: number;
  acceptedCount: number;
  deliveredCount: number;
  failedCount: number;
  conversionCount: number;
  scheduledAt: string | null;
  completedAt: string | null;
  lastErrorCode: string | null;
  updatedAt: string;
};

type CampaignReport = {
  delivery: {
    pending: number;
    accepted: number;
    sent: number;
    delivered: number;
    failed: number;
    cancelled: number;
    bounced: number;
    complained: number;
    clicked: number;
    unsubscribed: number;
  };
  attribution: {
    reservationsCreated: number;
    visitsHonored: number;
    estimatedRevenue: number;
    confirmedRevenue: number;
  };
  cost: { amount: number | string | null; currency: string; status: string };
};

type ProviderReadiness = {
  sendsEnabled: boolean;
  sendGate: { enabled: boolean; missing: string[] };
  sms: {
    configured: boolean;
    callbackConfigured: boolean;
    missing: string[];
    callbackMissing: string[];
  };
  email: {
    configured: boolean;
    callbackConfigured: boolean;
    missing: string[];
    callbackMissing: string[];
  };
  whatsapp: {
    configured: boolean;
    callbackConfigured: boolean;
    missing: string[];
    callbackMissing: string[];
  };
};

type Draft = {
  enabled: boolean;
  channel: MarketingChannel;
  bodyTemplate: string;
  subject: string;
  timezone: string;
  delayHours: string;
  inactiveDays: string;
  daysBefore: string;
  sendHour: string;
};

const AUTOMATION_META: Record<AutomationType, { title: string; description: string }> = {
  AFTER_FIRST_HONORED: {
    title: 'Après la première visite',
    description: 'Remerciez un nouveau client après une visite honorée.',
  },
  DORMANT: {
    title: 'Client dormant',
    description: 'Relancez les clients sans visite récente et sans réservation future.',
  },
  BIRTHDAY: {
    title: 'Anniversaire',
    description: 'Proposez une attention avant la date anniversaire renseignée.',
  },
};

const AUTOMATION_ORDER: AutomationType[] = ['AFTER_FIRST_HONORED', 'DORMANT', 'BIRTHDAY'];

function emptyDraft(type: AutomationType): Draft {
  return {
    enabled: false,
    channel: 'SMS',
    bodyTemplate:
      type === 'AFTER_FIRST_HONORED'
        ? 'Merci {{customer.firstName}} pour votre visite chez {{restaurant.name}}. {{unsubscribeUrl}}'
        : type === 'DORMANT'
          ? 'Bonjour {{customer.firstName}}, vous nous manquez. {{unsubscribeUrl}}'
          : 'Joyeux anniversaire {{customer.firstName}} ! {{unsubscribeUrl}}',
    subject: '',
    timezone: 'Europe/Paris',
    delayHours: '24',
    inactiveDays: '90',
    daysBefore: '7',
    sendHour: '10',
  };
}

function draftFromAutomation(automation: Automation): Draft {
  const config = automation.config ?? emptyDraft(automation.type);
  return {
    enabled: automation.enabled,
    channel: automation.channel,
    bodyTemplate: config.bodyTemplate ?? '',
    subject: config.subject ?? '',
    timezone: config.timezone ?? 'Europe/Paris',
    delayHours: String(config.delayHours ?? 24),
    inactiveDays: String(config.inactiveDays ?? 90),
    daysBefore: String(config.daysBefore ?? 7),
    sendHour: String(config.sendHour ?? 10),
  };
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Jamais';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatEur(value: number | string | null): string {
  if (value === null) return 'À rapprocher';
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 'À rapprocher';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(numeric);
}

function channelLabel(channel: MarketingChannel): string {
  return channel === 'SMS' ? 'SMS' : channel === 'EMAIL' ? 'Email' : 'WhatsApp';
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    DRAFT: 'Brouillon',
    READY: 'Prête',
    SCHEDULED: 'Programmée',
    SENDING: 'Envoi en cours',
    SENT: 'Envoyée',
    FAILED: 'Échec',
    CANCELLED: 'Annulée',
    PAUSED: 'En pause',
  };
  return labels[status] ?? status;
}

function statusClass(status: string): string {
  if (status === 'SENT') return 'bg-success/15 text-success';
  if (status === 'FAILED') return 'bg-destructive/15 text-destructive';
  if (status === 'SENDING' || status === 'SCHEDULED') return 'bg-warning/15 text-warning';
  return 'bg-muted text-muted-foreground';
}

function readinessLabel(value: boolean): string {
  return value ? 'Prêt' : 'À configurer';
}

export default function MarketingPage() {
  const { get, put, post, orgId } = useApi();
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [drafts, setDrafts] = useState<Record<AutomationType, Draft>>({
    AFTER_FIRST_HONORED: emptyDraft('AFTER_FIRST_HONORED'),
    DORMANT: emptyDraft('DORMANT'),
    BIRTHDAY: emptyDraft('BIRTHDAY'),
  });
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [reports, setReports] = useState<Record<string, CampaignReport>>({});
  const [providerReadiness, setProviderReadiness] = useState<ProviderReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<AutomationType | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [automationResponse, campaignResponse, providerResponse] = await Promise.all([
        get<{ data: Automation[] }>('marketing/automations'),
        get<{ data: Campaign[] }>('marketing/campaigns?limit=20'),
        get<{ data: ProviderReadiness }>('marketing/providers/readiness').catch(() => null),
      ]);
      const loadedAutomations = Array.isArray(automationResponse.data)
        ? automationResponse.data
        : [];
      setAutomations(loadedAutomations);
      setDrafts((previous) => {
        const next = { ...previous };
        for (const automation of loadedAutomations)
          next[automation.type] = draftFromAutomation(automation);
        return next;
      });
      setCampaigns(Array.isArray(campaignResponse.data) ? campaignResponse.data : []);
      const readiness = providerResponse?.data;
      setProviderReadiness(
        readiness && typeof readiness.sendsEnabled === 'boolean' ? readiness : null,
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de charger le marketing Pro'));
    } finally {
      setLoading(false);
    }
  }, [get, orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateDraft(type: AutomationType, patch: Partial<Draft>) {
    setDrafts((previous) => ({ ...previous, [type]: { ...previous[type], ...patch } }));
  }

  async function saveAutomation(type: AutomationType) {
    const draft = drafts[type];
    setSaving(type);
    setError('');
    setNotice('');
    const config: Record<string, unknown> = {
      bodyTemplate: draft.bodyTemplate,
      subject: draft.channel === 'EMAIL' ? draft.subject || null : null,
      timezone: draft.timezone,
    };
    if (type === 'AFTER_FIRST_HONORED') config.delayHours = Number(draft.delayHours);
    if (type === 'DORMANT') config.inactiveDays = Number(draft.inactiveDays);
    if (type === 'BIRTHDAY') {
      config.daysBefore = Number(draft.daysBefore);
      config.sendHour = Number(draft.sendHour);
    }
    try {
      const response = await put<{ data: Automation }>(`marketing/automations/${type}`, {
        enabled: draft.enabled,
        channel: draft.channel,
        config,
      });
      if (response.data) {
        setAutomations((previous) => {
          const without = previous.filter((item) => item.type !== type);
          return [...without, response.data!].sort(
            (left, right) =>
              AUTOMATION_ORDER.indexOf(left.type) - AUTOMATION_ORDER.indexOf(right.type),
          );
        });
        setDrafts((previous) => ({ ...previous, [type]: draftFromAutomation(response.data!) }));
      }
      setNotice(`${AUTOMATION_META[type].title} enregistré.`);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible d’enregistrer cette automation'));
    } finally {
      setSaving(null);
    }
  }

  async function campaignAction(campaign: Campaign, operation: 'prepare' | 'cancel') {
    setAction(`${operation}:${campaign.id}`);
    setError('');
    try {
      const response = await post<{ data: Campaign }>(
        `marketing/campaigns/${campaign.id}/${operation}`,
      );
      if (response.data) {
        setCampaigns((previous) =>
          previous.map((item) => (item.id === campaign.id ? response.data! : item)),
        );
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de modifier la campagne'));
    } finally {
      setAction(null);
    }
  }

  async function loadReport(campaignId: string) {
    setAction(`report:${campaignId}`);
    setError('');
    try {
      const response = await get<{ data: CampaignReport }>(
        `marketing/campaigns/${campaignId}/report`,
      );
      if (response.data) setReports((previous) => ({ ...previous, [campaignId]: response.data! }));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de charger le rapport'));
    } finally {
      setAction(null);
    }
  }

  const enabledCount = useMemo(
    () => automations.filter((automation) => automation.enabled).length,
    [automations],
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64 rounded-xl" />
        <div className="grid gap-4 xl:grid-cols-3">
          {[1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-[410px] rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Marketing Pro</h1>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Automatisez les relances utiles à partir de vos visites, avec consentement et mesure de
            chaque résultat.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" className="transition-all duration-200">
            <Link href="/dashboard/marketing/campaigns/new">
              <Plus className="mr-1 h-3.5 w-3.5" />
              Nouvelle campagne
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="transition-all duration-200">
            <Link href="/dashboard/marketing/segments">
              <ListFilter className="mr-1 h-3.5 w-3.5" />
              Segments Pro
            </Link>
          </Button>
          <Badge className="w-fit bg-primary/15 text-primary">
            {enabledCount}/3 automations actives
          </Badge>
        </div>
      </header>

      <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm">
        <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-warning" />
        <p className="text-muted-foreground">
          Les règles restent en brouillon. Aucun SMS ni email n&apos;est envoyé ici.
        </p>
      </div>

      {providerReadiness && (
        <Card>
          <CardHeader className="pb-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">Readiness des canaux</CardTitle>
                <CardDescription>
                  État des variables de configuration, sans afficher de secret.
                </CardDescription>
              </div>
              <Badge
                className={
                  providerReadiness.sendsEnabled
                    ? 'bg-success/15 text-success'
                    : 'bg-warning/15 text-warning'
                }
              >
                Envois {providerReadiness.sendsEnabled ? 'activables' : 'verrouillés'}
              </Badge>
            </div>
            {providerReadiness.sendGate?.missing?.length ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Porte globale à renseigner : {providerReadiness.sendGate.missing.join(', ')}
              </p>
            ) : null}
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ['SMS', providerReadiness.sms],
                ['Email', providerReadiness.email],
                ['WhatsApp', providerReadiness.whatsapp],
              ] as const
            ).map(([label, channel]) => (
              <div key={label} className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{label}</span>
                  <Badge variant="secondary">{readinessLabel(channel.configured)}</Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Callback : {channel.callbackConfigured ? 'configuré' : 'à configurer'}
                </p>
                {((channel.missing ?? []).length > 0 ||
                  (channel.callbackMissing ?? []).length > 0) && (
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {[...(channel.missing ?? []), ...(channel.callbackMissing ?? [])].map(
                      (variable) => (
                        <li key={variable}>À renseigner : {variable}</li>
                      ),
                    )}
                  </ul>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}
      {notice && (
        <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
          <Check className="h-4 w-4" />
          {notice}
        </div>
      )}

      <section aria-labelledby="automations-title" className="space-y-3">
        <div>
          <h2 id="automations-title" className="text-lg font-semibold">
            Automations
          </h2>
          <p className="text-sm text-muted-foreground">
            Chaque règle est limitée, versionnée et vérifiée juste avant un éventuel envoi.
          </p>
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          {AUTOMATION_ORDER.map((type) => {
            const draft = drafts[type];
            const saved = automations.find((automation) => automation.type === type);
            return (
              <Card key={type} className="flex flex-col">
                <CardHeader className="pb-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">{AUTOMATION_META[type].title}</CardTitle>
                      <CardDescription className="mt-1">
                        {AUTOMATION_META[type].description}
                      </CardDescription>
                    </div>
                    <Switch
                      checked={draft.enabled}
                      onCheckedChange={(enabled) => updateDraft(type, { enabled })}
                      aria-label={`Activer ${AUTOMATION_META[type].title}`}
                    />
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-3">
                  <label className="space-y-1 text-xs font-medium">
                    Canal
                    <select
                      value={draft.channel}
                      onChange={(event) =>
                        updateDraft(type, { channel: event.target.value as MarketingChannel })
                      }
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal outline-none transition-all duration-200 focus:ring-2 focus:ring-ring"
                    >
                      <option value="SMS">SMS</option>
                      <option value="EMAIL">Email</option>
                      <option value="WHATSAPP">WhatsApp</option>
                    </select>
                  </label>
                  {draft.channel === 'EMAIL' && (
                    <label className="space-y-1 text-xs font-medium">
                      Objet
                      <input
                        value={draft.subject}
                        onChange={(event) => updateDraft(type, { subject: event.target.value })}
                        placeholder="Une attention pour vous"
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal outline-none transition-all duration-200 focus:ring-2 focus:ring-ring"
                      />
                    </label>
                  )}
                  <label className="space-y-1 text-xs font-medium">
                    Message
                    <textarea
                      value={draft.bodyTemplate}
                      onChange={(event) => updateDraft(type, { bodyTemplate: event.target.value })}
                      rows={4}
                      className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm font-normal outline-none transition-all duration-200 focus:ring-2 focus:ring-ring"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {type === 'AFTER_FIRST_HONORED' && (
                      <label className="space-y-1 text-xs font-medium">
                        Délai (heures)
                        <input
                          type="number"
                          min={0}
                          max={168}
                          value={draft.delayHours}
                          onChange={(event) =>
                            updateDraft(type, { delayHours: event.target.value })
                          }
                          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal"
                        />
                      </label>
                    )}
                    {type === 'DORMANT' && (
                      <label className="space-y-1 text-xs font-medium">
                        Inactivité (jours)
                        <input
                          type="number"
                          min={30}
                          max={365}
                          value={draft.inactiveDays}
                          onChange={(event) =>
                            updateDraft(type, { inactiveDays: event.target.value })
                          }
                          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal"
                        />
                      </label>
                    )}
                    {type === 'BIRTHDAY' && (
                      <>
                        <label className="space-y-1 text-xs font-medium">
                          Jours avant
                          <input
                            type="number"
                            min={0}
                            max={30}
                            value={draft.daysBefore}
                            onChange={(event) =>
                              updateDraft(type, { daysBefore: event.target.value })
                            }
                            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal"
                          />
                        </label>
                        <label className="space-y-1 text-xs font-medium">
                          Heure locale
                          <input
                            type="number"
                            min={0}
                            max={23}
                            value={draft.sendHour}
                            onChange={(event) =>
                              updateDraft(type, { sendHour: event.target.value })
                            }
                            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal"
                          />
                        </label>
                      </>
                    )}
                    <label className="col-span-2 space-y-1 text-xs font-medium">
                      Fuseau IANA
                      <input
                        value={draft.timezone}
                        onChange={(event) => updateDraft(type, { timezone: event.target.value })}
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal"
                      />
                    </label>
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                    <span className="text-xs text-muted-foreground">
                      {saved
                        ? `v${saved.version} · évaluée ${formatDate(saved.lastEvaluatedAt)}`
                        : 'Pas encore enregistrée'}
                    </span>
                    <Button
                      size="sm"
                      onClick={() => void saveAutomation(type)}
                      disabled={saving === type}
                      className="transition-all duration-200"
                    >
                      {saving === type ? (
                        <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="mr-1 h-3.5 w-3.5" />
                      )}
                      Enregistrer
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="campaigns-title" className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 id="campaigns-title" className="text-lg font-semibold">
              Campagnes et résultats
            </h2>
            <p className="text-sm text-muted-foreground">
              Les campagnes sont des snapshots : l’audience ne change plus après préparation.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
            className="transition-all duration-200"
          >
            <RefreshCw className={cn('mr-1 h-3.5 w-3.5', loading && 'animate-spin')} />
            Actualiser
          </Button>
        </div>
        {campaigns.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
              <Clock3 className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">Aucune campagne préparée</p>
              <p className="max-w-md text-xs text-muted-foreground">
                Une automation active créera une campagne snapshot après son prochain scan, sous
                réserve de consentement et de coordonnées valides.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {campaigns.map((campaign) => {
              const report = reports[campaign.id];
              return (
                <Card key={campaign.id}>
                  <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:p-5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{campaign.name}</p>
                        <Badge className={statusClass(campaign.status)}>
                          {statusLabel(campaign.status)}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {channelLabel(campaign.channel)} · {campaign.audienceCount} destinataires
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Mise à jour {formatDate(campaign.updatedAt)}
                        {campaign.lastErrorCode ? ` · ${campaign.lastErrorCode}` : ''}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                        <span>
                          <strong className="text-foreground">{campaign.acceptedCount}</strong>{' '}
                          acceptés
                        </span>
                        <span>
                          <strong className="text-foreground">{campaign.deliveredCount}</strong>{' '}
                          délivrés
                        </span>
                        <span>
                          <strong className="text-foreground">{campaign.failedCount}</strong> échecs
                        </span>
                        <span>
                          <strong className="text-foreground">{campaign.conversionCount}</strong>{' '}
                          conversions
                        </span>
                      </div>
                      {report && (
                        <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs sm:grid-cols-5">
                          <span>
                            Ouvertures/clics <strong>{report.delivery.clicked}</strong>
                          </span>
                          <span>
                            Réservations <strong>{report.attribution.reservationsCreated}</strong>
                          </span>
                          <span>
                            Visites <strong>{report.attribution.visitsHonored}</strong>
                          </span>
                          <span>
                            CA confirmé{' '}
                            <strong>{report.attribution.confirmedRevenue.toFixed(2)} €</strong>
                          </span>
                          <span>
                            Coût messages <strong>{formatEur(report.cost.amount)}</strong>{' '}
                            <span className="text-muted-foreground">({report.cost.status})</span>
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 md:justify-end">
                      {campaign.status === 'DRAFT' && (
                        <Button
                          size="sm"
                          onClick={() => void campaignAction(campaign, 'prepare')}
                          disabled={action === `prepare:${campaign.id}`}
                          className="transition-all duration-200"
                        >
                          <Check className="mr-1 h-3.5 w-3.5" /> Préparer
                        </Button>
                      )}
                      {['DRAFT', 'READY', 'SCHEDULED'].includes(campaign.status) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void campaignAction(campaign, 'cancel')}
                          disabled={action === `cancel:${campaign.id}`}
                          className="transition-all duration-200"
                        >
                          Annuler
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void loadReport(campaign.id)}
                        disabled={action === `report:${campaign.id}`}
                        className="transition-all duration-200"
                      >
                        <Send className="mr-1 h-3.5 w-3.5" /> Rapport
                      </Button>
                      <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="transition-all duration-200"
                      >
                        <a
                          href={`/api/proxy/marketing/campaigns/${encodeURIComponent(campaign.id)}/report.csv${orgId ? `?siteId=${encodeURIComponent(orgId)}` : ''}`}
                          download
                        >
                          <Download className="mr-1 h-3.5 w-3.5" /> CSV
                        </a>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
