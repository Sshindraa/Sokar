'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, Check, Eye, Info, Loader2, Megaphone } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi } from '@/lib/api';
import { getErrorMessage } from '@/types/api';

type MarketingChannel = 'SMS' | 'EMAIL' | 'WHATSAPP';

type Segment = {
  id: string;
  name: string;
  definitionVersion: number;
  isSystem: boolean;
  systemDescription?: string | null;
  lastCount?: number | null;
};

type AudiencePreview = {
  channel: MarketingChannel;
  audienceVersion: number;
  candidateCount: number;
  eligibleCount: number;
  excludedByReason: Record<string, number>;
  sample: Array<{ id: string; name: string | null; isVip: boolean; inclusionReason: string }>;
};

type CampaignPreview = {
  campaign: {
    id: string;
    name: string;
    objective: string;
    channel: MarketingChannel;
    status: string;
    subject: string | null;
    bodyTemplate: string;
    scheduledAt: string | null;
    timezone: string;
  };
  audience: { captured: number; eligible: number; sampleCustomer: string | null };
  render: { subject: string | null; body: string; usedFallbackCustomer: boolean };
  usage: {
    category: 'SMS_SEGMENTS' | 'WHATSAPP_MESSAGES' | 'EMAIL_MESSAGES';
    unitsPerMessage: number;
    totalUnits: number;
    encoding: 'gsm7' | 'ucs2' | 'message';
  };
  costEstimate: {
    amount: number | string | null;
    currency: string;
    status: string;
    reason: string;
    tariffId?: string;
    pricePerUnit?: string;
  };
};

type CampaignTestPreview = {
  mode: 'DRY_RUN';
  providerContacted: false;
  recipient: 'MANAGER';
  reason: string;
  preview: CampaignPreview;
};

type Draft = {
  name: string;
  objective: string;
  channel: MarketingChannel;
  segmentId: string;
  subject: string;
  bodyTemplate: string;
  timezone: string;
  scheduledAt: string;
};

const CHANNEL_LABELS: Record<MarketingChannel, string> = {
  SMS: 'SMS',
  EMAIL: 'Email',
  WHATSAPP: 'WhatsApp',
};

const DEFAULT_BODY: Record<MarketingChannel, string> = {
  SMS: 'Bonjour {{customer.firstName}}, réservez chez {{restaurant.name}} : {{reservationLink}} {{unsubscribeUrl}}',
  EMAIL:
    'Bonjour {{customer.firstName}},\n\nNous serions heureux de vous revoir chez {{restaurant.name}}.\nRéservez ici : {{reservationLink}}\n\n{{unsubscribeUrl}}',
  WHATSAPP:
    'Bonjour {{customer.firstName}}, vous nous manquez chez {{restaurant.name}}. Réservez ici : {{reservationLink}} {{unsubscribeUrl}}',
};

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatEur(value: number | string | null): string {
  if (value === null) return '—';
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(numeric);
}

function channelUsageLabel(category: CampaignPreview['usage']['category']): string {
  if (category === 'SMS_SEGMENTS') return 'segments SMS';
  if (category === 'WHATSAPP_MESSAGES') return 'messages WhatsApp';
  return 'emails';
}

function initialDraft(): Draft {
  return {
    name: '',
    objective: '',
    channel: 'SMS',
    segmentId: '',
    subject: '',
    bodyTemplate: DEFAULT_BODY.SMS,
    timezone: 'Europe/Paris',
    scheduledAt: '',
  };
}

export default function NewMarketingCampaignPage() {
  const { get, post, orgId } = useApi();
  const [segments, setSegments] = useState<Segment[]>([]);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [audience, setAudience] = useState<AudiencePreview | null>(null);
  const [campaignPreview, setCampaignPreview] = useState<CampaignPreview | null>(null);
  const [testPreview, setTestPreview] = useState<CampaignTestPreview | null>(null);
  const [createdCampaignId, setCreatedCampaignId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<'audience' | 'create' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadSegments = useCallback(async () => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await get<{ data: Segment[] }>('marketing/segments');
      const loaded = Array.isArray(response.data) ? response.data : [];
      setSegments(loaded);
      setDraft((previous) => ({
        ...previous,
        segmentId: previous.segmentId || loaded[0]?.id || '',
      }));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de charger les segments marketing'));
    } finally {
      setLoading(false);
    }
  }, [get, orgId]);

  useEffect(() => {
    void loadSegments();
  }, [loadSegments]);

  const selectedSegment = useMemo(
    () => segments.find((segment) => segment.id === draft.segmentId) ?? null,
    [draft.segmentId, segments],
  );

  function updateDraft(patch: Partial<Draft>) {
    setDraft((previous) => ({ ...previous, ...patch }));
    setNotice('');
  }

  function updateChannel(channel: MarketingChannel) {
    updateDraft({
      channel,
      bodyTemplate: DEFAULT_BODY[channel],
      subject: channel === 'EMAIL' ? draft.subject : '',
    });
    setAudience(null);
    setCampaignPreview(null);
    setTestPreview(null);
  }

  async function previewAudience() {
    if (!draft.segmentId) {
      setError('Sélectionnez un segment avant de prévisualiser l’audience.');
      return;
    }
    setAction('audience');
    setError('');
    setNotice('');
    try {
      const response = await post<AudiencePreview>('marketing/campaigns/audience-preview', {
        channel: draft.channel,
        segmentId: draft.segmentId,
        sampleLimit: 5,
      });
      setAudience(response);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de calculer cette audience'));
      setAudience(null);
    } finally {
      setAction(null);
    }
  }

  async function createCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.name.trim() || !draft.objective.trim() || !draft.segmentId) {
      setError('Renseignez le nom, l’objectif et le segment de la campagne.');
      return;
    }
    setAction('create');
    setError('');
    setNotice('');
    try {
      const response = await post<{ data: { id: string } }>('marketing/campaigns', {
        name: draft.name.trim(),
        objective: draft.objective.trim(),
        channel: draft.channel,
        segmentId: draft.segmentId,
        subject: draft.channel === 'EMAIL' ? draft.subject.trim() || null : null,
        bodyTemplate: draft.bodyTemplate,
        timezone: draft.timezone.trim() || 'Europe/Paris',
        scheduledAt: draft.scheduledAt ? new Date(draft.scheduledAt).toISOString() : null,
      });
      const id = response.data?.id;
      if (!id) throw new Error('La campagne créée ne possède pas d’identifiant.');
      setCreatedCampaignId(id);
      const previewResponse = await post<{ data: CampaignPreview }>(
        `marketing/campaigns/${id}/preview`,
      );
      setCampaignPreview(previewResponse.data ?? null);
      setTestPreview(null);
      setNotice('Brouillon enregistré et rendu de contrôle généré.');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de créer cette campagne'));
    } finally {
      setAction(null);
    }
  }

  async function testForManager() {
    if (!createdCampaignId) return;
    setAction('create');
    setError('');
    setNotice('');
    try {
      const response = await post<{ data: CampaignTestPreview }>(
        `marketing/campaigns/${createdCampaignId}/test`,
      );
      setTestPreview(response.data ?? null);
      setNotice('Rendu de test gérant généré en mode dry-run.');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de générer le test gérant'));
    } finally {
      setAction(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-72 rounded-xl" />
        <Skeleton className="h-[520px] rounded-2xl" />
      </div>
    );
  }

  const forbidden =
    error.includes('CAPABILITY_NOT_INCLUDED') || error.toLowerCase().includes('formule');

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Nouvelle campagne</h1>
            <Badge variant="secondary">Marketing Pro</Badge>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Construisez un brouillon, contrôlez l’audience et vérifiez le rendu avant toute
            préparation d’envoi.
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="transition-all duration-200">
          <Link href="/dashboard/marketing">
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Retour au marketing
          </Link>
        </Button>
      </header>

      <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm">
        <Info className="mt-0.5 h-4 w-4 flex-none text-warning" />
        <p className="text-muted-foreground">
          Brouillon local : aucun fournisseur n&apos;est contacté tant que l&apos;envoi reste
          désactivé.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
          <div>
            <p>{error}</p>
            {forbidden && (
              <p className="mt-1 text-muted-foreground">
                Les campagnes et le contrôle d’audience sont inclus dans la formule Pro.
              </p>
            )}
          </div>
        </div>
      )}
      {notice && (
        <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
          <Check className="h-4 w-4" /> {notice}
        </div>
      )}

      <form className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]" onSubmit={createCampaign}>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Contenu et ciblage</CardTitle>
            <CardDescription>
              Les variables acceptées sont remplacées côté serveur au moment du rendu.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1 text-sm font-medium">
                Nom interne
                <Input
                  value={draft.name}
                  onChange={(event) => updateDraft({ name: event.target.value })}
                  placeholder="Relance déjeuner de septembre"
                  maxLength={100}
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Canal
                <select
                  aria-label="Canal"
                  value={draft.channel}
                  onChange={(event) => updateChannel(event.target.value as MarketingChannel)}
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-all duration-200 focus:ring-2 focus:ring-ring"
                >
                  {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block space-y-1 text-sm font-medium">
              Objectif
              <Input
                value={draft.objective}
                onChange={(event) => updateDraft({ objective: event.target.value })}
                placeholder="Remplir le service du midi"
                maxLength={120}
              />
            </label>

            <label className="block space-y-1 text-sm font-medium">
              Segment
              <select
                aria-label="Segment"
                value={draft.segmentId}
                onChange={(event) => {
                  updateDraft({ segmentId: event.target.value });
                  setAudience(null);
                  setCampaignPreview(null);
                  setTestPreview(null);
                }}
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-all duration-200 focus:ring-2 focus:ring-ring"
              >
                <option value="">Sélectionner un segment</option>
                {segments.map((segment) => (
                  <option key={segment.id} value={segment.id}>
                    {segment.name}
                    {segment.isSystem ? ' · système' : ''}
                  </option>
                ))}
              </select>
              {selectedSegment?.systemDescription && (
                <span className="block text-xs font-normal text-muted-foreground">
                  {selectedSegment.systemDescription}
                </span>
              )}
            </label>

            {draft.channel === 'EMAIL' && (
              <label className="block space-y-1 text-sm font-medium">
                Objet email
                <Input
                  value={draft.subject}
                  onChange={(event) => updateDraft({ subject: event.target.value })}
                  placeholder="Une attention pour votre prochaine visite"
                  maxLength={200}
                />
              </label>
            )}

            <label className="block space-y-1 text-sm font-medium">
              Message
              <textarea
                value={draft.bodyTemplate}
                onChange={(event) => updateDraft({ bodyTemplate: event.target.value })}
                rows={9}
                maxLength={draft.channel === 'EMAIL' ? 10_000 : 918}
                className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition-all duration-200 focus:ring-2 focus:ring-ring"
              />
              <span className="block text-xs font-normal text-muted-foreground">
                Variables : {'{{customer.firstName}}'}, {'{{customer.name}}'},
                {' {{restaurant.name}}'}, {' {{reservationLink}}'}, {' {{unsubscribeUrl}}'}.
              </span>
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1 text-sm font-medium">
                Fuseau IANA
                <Input
                  value={draft.timezone}
                  onChange={(event) => updateDraft({ timezone: event.target.value })}
                  placeholder="Europe/Paris"
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Date indicative (facultative)
                <Input
                  type="datetime-local"
                  value={draft.scheduledAt}
                  onChange={(event) => updateDraft({ scheduledAt: event.target.value })}
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void previewAudience()}
                disabled={action !== null || !draft.segmentId}
                className="transition-all duration-200"
              >
                {action === 'audience' ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Eye className="mr-1 h-4 w-4" />
                )}
                Prévisualiser l’audience
              </Button>
              <Button
                type="submit"
                disabled={action !== null}
                className="transition-all duration-200"
              >
                {action === 'create' ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-1 h-4 w-4" />
                )}
                Créer et prévisualiser
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Audience calculée</CardTitle>
              <CardDescription>
                Le consentement, les suppressions et le plafond de fréquence sont appliqués côté
                API.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {audience ? (
                <div className="space-y-3 text-sm">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg border border-border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">Profils candidats</p>
                      <p className="mt-1 text-xl font-semibold">{audience.candidateCount}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground">Éligibles</p>
                      <p className="mt-1 text-xl font-semibold">{audience.eligibleCount}</p>
                    </div>
                  </div>
                  {Object.keys(audience.excludedByReason).length > 0 && (
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <p className="font-medium text-foreground">Exclusions</p>
                      {Object.entries(audience.excludedByReason).map(([reason, count]) => (
                        <p key={reason} className="flex justify-between gap-2">
                          <span>{reason}</span>
                          <strong>{count}</strong>
                        </p>
                      ))}
                    </div>
                  )}
                  {audience.sample.length > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Exemples :{' '}
                      {audience.sample.map((item) => item.name || 'Client sans nom').join(' · ')}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Aucun profil éligible sur cet aperçu.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Lancez un aperçu pour vérifier la taille et les exclusions avant de créer le
                  brouillon.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Rendu serveur</CardTitle>
              <CardDescription>
                Le preview utilise un membre du snapshot après création, sans envoi externe.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {campaignPreview ? (
                <div className="space-y-3 text-sm">
                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    {campaignPreview.render.subject && (
                      <p className="mb-2 font-medium">{campaignPreview.render.subject}</p>
                    )}
                    <p className="whitespace-pre-wrap">{campaignPreview.render.body}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary">
                      {campaignPreview.audience.eligible} destinataires
                    </Badge>
                    <Badge variant="secondary">
                      {campaignPreview.usage.totalUnits}{' '}
                      {channelUsageLabel(campaignPreview.usage.category)}
                    </Badge>
                    <Badge variant="secondary">
                      {campaignPreview.usage.encoding === 'message'
                        ? 'unité message'
                        : campaignPreview.usage.encoding.toUpperCase()}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {campaignPreview.costEstimate.amount === null
                      ? `Coût : non rapproché (${campaignPreview.costEstimate.reason}).`
                      : `Coût fournisseur estimé : ${formatEur(campaignPreview.costEstimate.amount)} (${campaignPreview.costEstimate.pricePerUnit ?? 'tarif versionné'} / unité).`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {campaignPreview.render.usedFallbackCustomer
                      ? 'Le rendu utilise un client de démonstration faute de membre dans le snapshot.'
                      : `Exemple basé sur ${campaignPreview.audience.sampleCustomer ?? 'un client du snapshot'}.`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Brouillon {createdCampaignId ? `· ${createdCampaignId}` : ''} · prévu{' '}
                    {formatDate(campaignPreview.campaign.scheduledAt)}
                  </p>
                  {createdCampaignId && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void testForManager()}
                      disabled={action !== null}
                      className="transition-all duration-200"
                    >
                      {action === 'create' ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Eye className="mr-1 h-3.5 w-3.5" />
                      )}
                      Tester le rendu gérant
                    </Button>
                  )}
                  {testPreview && (
                    <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                      Dry-run confirmé : aucun fournisseur contacté ({testPreview.reason}).
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Le rendu apparaîtra après la création du brouillon.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </form>
    </div>
  );
}
