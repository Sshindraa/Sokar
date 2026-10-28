'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, Check, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { FeatureLockCard } from '@/components/FeatureLockCard';
import { useApi } from '@/lib/api';
import { featureLockFromError, type FeatureLock } from '@/lib/api-error';
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

/** Motifs d'exclusion de l'aperçu d'audience, en français. */
const EXCLUSION_LABELS: Record<string, string> = {
  NO_CONTACT: 'Sans coordonnées pour ce canal',
  NO_CONSENT: 'Consentement non recueilli',
  OPTED_OUT: 'Désinscrits',
  FREQUENCY_CAP: 'Déjà contactés récemment',
};

function exclusionLabel(reason: string): string {
  if (reason.startsWith('SUPPRESSED:')) return 'Liste d’opposition';
  return EXCLUSION_LABELS[reason] ?? 'Autre motif';
}

function encodingLabel(encoding: CampaignPreview['usage']['encoding']): string {
  if (encoding === 'gsm7') return 'SMS standard';
  if (encoding === 'ucs2') return 'SMS avec caractères spéciaux';
  return '1 message par destinataire';
}

const MAX_BODY_LENGTH: Record<MarketingChannel, number> = {
  SMS: 918,
  WHATSAPP: 918,
  EMAIL: 10_000,
};

const TIMEZONES: Array<[string, string]> = [
  ['Europe/Paris', 'Paris (métropole)'],
  ['Europe/Brussels', 'Bruxelles'],
  ['Europe/Zurich', 'Zurich'],
  ['Europe/London', 'Londres'],
  ['America/Martinique', 'Martinique'],
  ['America/Guadeloupe', 'Guadeloupe'],
  ['America/Cayenne', 'Guyane'],
  ['Indian/Reunion', 'La Réunion'],
  ['Indian/Mayotte', 'Mayotte'],
  ['Pacific/Tahiti', 'Polynésie française'],
  ['Pacific/Noumea', 'Nouvelle-Calédonie'],
];

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

/** Contrôles avant l'appel API : on dit quoi corriger plutôt que d'attendre un refus en anglais. */
function draftProblem(draft: Draft): string | null {
  if (!draft.name.trim() || !draft.objective.trim() || !draft.segmentId) {
    return 'Renseignez le nom, l’objectif et le segment de la campagne.';
  }
  if (draft.channel === 'EMAIL' && !draft.subject.trim()) return 'Ajoutez un objet à votre e-mail.';
  if (!draft.bodyTemplate.trim()) return 'Rédigez le message de la campagne.';
  if (!draft.bodyTemplate.includes('{{unsubscribeUrl}}')) {
    return 'Gardez {{unsubscribeUrl}} dans le message : le lien de désinscription est obligatoire.';
  }
  if (draft.bodyTemplate.length > MAX_BODY_LENGTH[draft.channel]) {
    return 'Votre message dépasse la longueur autorisée pour ce canal. Raccourcissez-le.';
  }
  return null;
}

const CAMPAIGN_ERRORS: Record<string, string> = {
  SEGMENT_NOT_FOUND: 'Ce segment n’existe plus. Choisissez-en un autre.',
  AUDIENCE_TOO_LARGE:
    'Cette audience dépasse la taille maximale d’une campagne. Choisissez un segment plus restreint.',
};

function campaignErrorMessage(err: unknown, fallback: string): string {
  const message = getErrorMessage(err, fallback);
  return CAMPAIGN_ERRORS[message] ?? message;
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
  const [action, setAction] = useState<'audience' | 'create' | 'test' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // Échec du chargement des segments : séparé de `error` (actions) pour rester affiché avec son « Réessayer ».
  const [segmentsError, setSegmentsError] = useState('');
  const [lock, setLock] = useState<FeatureLock | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  const loadSegments = useCallback(async () => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setSegmentsError('');
    setLock(null);
    try {
      const response = await get<{ data: Segment[] }>('marketing/segments');
      const loaded = Array.isArray(response.data) ? response.data : [];
      setSegments(loaded);
      setDraft((previous) => ({
        ...previous,
        segmentId: previous.segmentId || loaded[0]?.id || '',
      }));
    } catch (err: unknown) {
      setLock(featureLockFromError(err));
      setSegmentsError(getErrorMessage(err, 'Impossible de charger les segments marketing.'));
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
    setDraft((previous) => ({
      ...previous,
      channel,
      // Le message rédigé par le gérant est conservé ; seul le texte par défaut suit le canal.
      bodyTemplate:
        !previous.bodyTemplate.trim() || previous.bodyTemplate === DEFAULT_BODY[previous.channel]
          ? DEFAULT_BODY[channel]
          : previous.bodyTemplate,
    }));
    setNotice('');
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
      setError(campaignErrorMessage(err, 'Impossible de calculer cette audience.'));
      setAudience(null);
    } finally {
      setAction(null);
    }
  }

  async function generatePreview(id: string) {
    setAction('create');
    setPreviewFailed(false);
    try {
      const previewResponse = await post<{ data: CampaignPreview }>(
        `marketing/campaigns/${id}/preview`,
      );
      setCampaignPreview(previewResponse.data ?? null);
      setTestPreview(null);
      setNotice('Brouillon enregistré. Vérifiez le rendu ci-contre.');
    } catch {
      // Le brouillon existe déjà : on ne refait jamais « Créer », on propose de relancer l'aperçu.
      setPreviewFailed(true);
      setNotice('');
    } finally {
      setAction(null);
    }
  }

  async function createCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createdCampaignId) return;
    const problem = draftProblem(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setAction('create');
    setError('');
    setNotice('');
    let id: string | undefined;
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
      id = response.data?.id;
      if (!id) throw new Error('La campagne créée ne possède pas d’identifiant.');
      setCreatedCampaignId(id);
    } catch (err: unknown) {
      setError(campaignErrorMessage(err, 'Impossible de créer cette campagne.'));
      setAction(null);
      return;
    }
    await generatePreview(id);
  }

  async function testForManager() {
    if (!createdCampaignId) return;
    setAction('test');
    setError('');
    setNotice('');
    try {
      const response = await post<{ data: CampaignTestPreview }>(
        `marketing/campaigns/${createdCampaignId}/test`,
      );
      setTestPreview(response.data ?? null);
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

  const frozen = createdCampaignId !== null;

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="-ml-3 w-fit transition-all duration-200"
        >
          <Link href="/dashboard/marketing">
            <ArrowLeft className="h-4 w-4" />
            Retour au marketing
          </Link>
        </Button>
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Nouvelle campagne</h1>
      </header>

      {lock && <FeatureLockCard lock={lock} feature="Campagnes" />}
      {!lock && segmentsError && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
            <p>{segmentsError}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="transition-all duration-200"
            onClick={() => void loadSegments()}
          >
            Réessayer
          </Button>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
          <p>{error}</p>
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
          </CardHeader>
          <CardContent className="space-y-4">
            {frozen && (
              <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                Brouillon enregistré : les modifications se font depuis la liste des campagnes.
              </p>
            )}
            <fieldset disabled={frozen} className="space-y-4 border-0 p-0">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1 text-sm font-medium">
                  Nom
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
                  <option value="">
                    {segmentsError ? 'Segments indisponibles' : 'Sélectionner un segment'}
                  </option>
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
                  maxLength={MAX_BODY_LENGTH[draft.channel]}
                  className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition-all duration-200 focus:ring-2 focus:ring-ring"
                />
                <span className="block text-xs font-normal text-muted-foreground">
                  Variables : {'{{customer.firstName}}'}, {'{{customer.name}}'},
                  {' {{restaurant.name}}'}, {' {{reservationLink}}'}, {' {{unsubscribeUrl}}'}.
                </span>
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1 text-sm font-medium">
                  Fuseau horaire
                  <select
                    value={draft.timezone}
                    onChange={(event) => updateDraft({ timezone: event.target.value })}
                    className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-all duration-200 focus:ring-2 focus:ring-ring"
                  >
                    {TIMEZONES.some(([value]) => value === draft.timezone) ? null : (
                      <option value={draft.timezone}>{draft.timezone}</option>
                    )}
                    {TIMEZONES.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
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
                  disabled={action !== null || !draft.segmentId || frozen}
                  className="transition-all duration-200"
                >
                  {action === 'audience' && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                  Prévisualiser l’audience
                </Button>
                <Button
                  type="submit"
                  disabled={action !== null || frozen || segmentsError !== ''}
                  className="transition-all duration-200"
                >
                  {action === 'create' && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                  Créer et prévisualiser
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Rien n&apos;est envoyé à cette étape.</p>
            </fieldset>
            {frozen && (
              <Button asChild variant="outline" className="transition-all duration-200">
                <Link href="/dashboard/marketing">Voir dans Marketing</Link>
              </Button>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          {audience && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Audience calculée</CardTitle>
              </CardHeader>
              <CardContent>
                {audience ? (
                  <div className="space-y-3 text-sm">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-border bg-muted/30 p-3">
                        <p className="text-xs text-muted-foreground">Clients candidats</p>
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
                            <span>{exclusionLabel(reason)}</span>
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
                        Aucun client éligible sur cet aperçu.
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
          )}

          {campaignPreview && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Aperçu du message</CardTitle>
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
                        {encodingLabel(campaignPreview.usage.encoding)}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {campaignPreview.costEstimate.amount === null
                        ? 'Coût : estimation indisponible pour le moment.'
                        : `Coût fournisseur estimé : ${formatEur(campaignPreview.costEstimate.amount)} (${campaignPreview.costEstimate.pricePerUnit ?? 'tarif indisponible'} / unité).`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {campaignPreview.render.usedFallbackCustomer
                        ? 'L’aperçu utilise un client fictif, faute de client dans l’audience.'
                        : `Exemple basé sur ${campaignPreview.audience.sampleCustomer ?? 'un client de l’audience'}.`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Brouillon enregistré · prévu le{' '}
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
                        {action === 'test' && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                        Tester l’aperçu
                      </Button>
                    )}
                    {testPreview && (
                      <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                        Test effectué : aucun message n’a été envoyé.
                      </p>
                    )}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )}
          {previewFailed && createdCampaignId && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                Brouillon créé, mais l’aperçu n’a pas pu être généré.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void generatePreview(createdCampaignId)}
                disabled={action !== null}
                className="transition-all duration-200"
              >
                Réessayer l’aperçu
              </Button>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
