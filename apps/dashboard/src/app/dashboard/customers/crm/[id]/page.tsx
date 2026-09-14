'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  Download,
  Mail,
  Plus,
  Phone,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi } from '@/lib/api';
import { getErrorMessage } from '@/types/api';

type CustomerIdentity = {
  id: string;
  type: string;
  value: string;
  normalizedValue: string;
  source?: string;
  verifiedAt?: string | null;
};

type CustomerPreference = {
  id: string;
  key: string;
  value: unknown;
  source: string;
  confidence: number | string | null;
  updatedAt: string;
};

type CustomerTag = { id: string; key: string; label: string; colorToken?: string | null };
type CustomerTagAssignment = { tag: CustomerTag; source: string; assignedAt: string };

type CustomerMetricSnapshot = {
  honored30d: number;
  honored90d: number;
  honored365d: number;
  cancelled365d: number;
  noShow365d: number;
  covers365d: number;
  estimatedSpend365d: number | string;
  actualSpend365d: number | string | null;
  actualLifetimeSpend: number | string | null;
  lastHonoredAt: string | null;
  nextReservationAt: string | null;
  calculatedAt: string;
};

type TimelineEvent = {
  id: string;
  summaryCode: string;
  eventType: string;
  occurredAt: string;
  metadata?: Record<string, unknown>;
};

type CrmCustomerDetail = {
  id: string;
  name: string | null;
  phone: string;
  emailNormalized: string | null;
  visitCount: number;
  isVip: boolean;
  notes: string | null;
  identities: CustomerIdentity[];
  metricSnapshot: CustomerMetricSnapshot | null;
  metrics: CustomerMetricSnapshot | null;
  preferences: CustomerPreference[];
  tags: CustomerTag[];
  tagAssignments: CustomerTagAssignment[];
  timeline: TimelineEvent[];
};

type ExportVerificationResponse = {
  channel: 'sms' | 'email';
  expiresAt: string;
  rateLimitRemaining: number;
  captchaRequired: boolean;
};

type ExportConfirmationResponse = { verificationToken: string };

type ExportPayload = {
  exportedAt?: string;
  privacyPolicyVersion?: string;
  reservations?: unknown[];
  crmProfiles?: unknown[];
  crmMergeAudits?: unknown[];
  marketingPermissions?: unknown[];
};

type ProjectionRepairPreview = {
  customerId: string;
  restaurantId: string;
  calculatedAt: string;
  reservationCount: number;
  changed: boolean;
  current: Record<string, unknown> | null;
  expected: Record<string, unknown>;
  projectionVersion?: number;
  repaired?: boolean;
  replayed?: boolean;
};

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `crm-repair-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('fr-FR') : '—';
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '—';
  try {
    return JSON.stringify(value);
  } catch {
    return '—';
  }
}

export default function CrmCustomerPage() {
  const params = useParams<{ id: string }>();
  const customerId = params?.id;
  const { get, post, put, del, orgId } = useApi();
  const [customer, setCustomer] = useState<CrmCustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [exportCode, setExportCode] = useState('');
  const [exportStep, setExportStep] = useState<'idle' | 'requesting' | 'confirming' | 'done'>(
    'idle',
  );
  const [exportError, setExportError] = useState('');
  const [exportRequest, setExportRequest] = useState<ExportVerificationResponse | null>(null);
  const [exportPayload, setExportPayload] = useState<ExportPayload | null>(null);
  const [repairPreview, setRepairPreview] = useState<ProjectionRepairPreview | null>(null);
  const [repairLoading, setRepairLoading] = useState(false);
  const [repairError, setRepairError] = useState('');
  const [repairNotice, setRepairNotice] = useState('');
  const [preferenceFormOpen, setPreferenceFormOpen] = useState(false);
  const [preferenceKey, setPreferenceKey] = useState('preferred_language');
  const [preferenceValue, setPreferenceValue] = useState('""');
  const [editingPreferenceId, setEditingPreferenceId] = useState<string | null>(null);
  const [tagKey, setTagKey] = useState('');
  const [tagLabel, setTagLabel] = useState('');
  const [crmMutationLoading, setCrmMutationLoading] = useState(false);
  const [crmMutationError, setCrmMutationError] = useState('');
  const [crmMutationNotice, setCrmMutationNotice] = useState('');

  const load = useCallback(async () => {
    if (!orgId || !customerId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await get<{ data: CrmCustomerDetail }>(`crm/customers/${customerId}`);
      setCustomer(response.data ?? null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de charger la fiche CRM'));
      setCustomer(null);
    } finally {
      setLoading(false);
    }
  }, [customerId, get, orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  function downloadExport(payload: ExportPayload): void {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `sokar-crm-export-${customerId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function requestExportCode(): Promise<void> {
    if (!customer?.phone) return;
    setExportStep('requesting');
    setExportError('');
    setExportPayload(null);
    try {
      const response = await post<ExportVerificationResponse>('api/rgpd/request-verification', {
        subject: customer.phone,
        intent: 'export',
      });
      setExportRequest(response);
      setExportCode('');
      setExportStep('confirming');
    } catch (err: unknown) {
      setExportError(getErrorMessage(err, "Impossible d'envoyer le code d'export"));
      setExportStep('idle');
    }
  }

  async function confirmExport(): Promise<void> {
    if (!customer?.phone || !exportCode.trim()) return;
    setExportStep('confirming');
    setExportError('');
    try {
      const confirmation = await post<ExportConfirmationResponse>('api/rgpd/confirm-verification', {
        subject: customer.phone,
        intent: 'export',
        code: exportCode.trim(),
      });
      const payload = await post<ExportPayload>(
        'api/rgpd/export',
        { subject: customer.phone },
        { headers: { 'X-Identity-Token': confirmation.verificationToken } },
      );
      setExportPayload(payload);
      setExportStep('done');
      downloadExport(payload);
    } catch (err: unknown) {
      setExportError(getErrorMessage(err, "Le code n'a pas permis de générer l'export"));
      setExportStep('confirming');
    }
  }

  async function inspectProjection(): Promise<void> {
    if (!customerId) return;
    setRepairLoading(true);
    setRepairError('');
    setRepairNotice('');
    try {
      const response = await get<{ data: ProjectionRepairPreview }>(
        `crm/customers/${customerId}/projection-repair-preview`,
      );
      setRepairPreview(response.data ?? null);
    } catch (err: unknown) {
      setRepairError(getErrorMessage(err, 'Impossible de vérifier la projection CRM'));
      setRepairPreview(null);
    } finally {
      setRepairLoading(false);
    }
  }

  async function repairProjection(): Promise<void> {
    if (!customerId || !repairPreview?.changed) return;
    setRepairLoading(true);
    setRepairError('');
    setRepairNotice('');
    try {
      const response = await post<{ data: ProjectionRepairPreview }>(
        `crm/customers/${customerId}/projection-repair`,
        undefined,
        { headers: { 'Idempotency-Key': newIdempotencyKey() } },
      );
      setRepairPreview(response.data ?? null);
      setRepairNotice(
        response.data?.replayed
          ? 'La réparation a déjà été appliquée pour cette demande.'
          : 'Projection CRM recalculée depuis les réservations.',
      );
    } catch (err: unknown) {
      setRepairError(getErrorMessage(err, 'La réparation de la projection a échoué'));
    } finally {
      setRepairLoading(false);
    }
  }

  function editPreference(preference: CustomerPreference): void {
    setPreferenceFormOpen(true);
    setEditingPreferenceId(preference.id);
    setPreferenceKey(preference.key);
    try {
      setPreferenceValue(JSON.stringify(preference.value));
    } catch {
      setPreferenceValue('""');
    }
    setCrmMutationError('');
    setCrmMutationNotice('');
  }

  function resetPreferenceForm(): void {
    setPreferenceFormOpen(false);
    setEditingPreferenceId(null);
    setPreferenceKey('preferred_language');
    setPreferenceValue('""');
  }

  async function savePreference(): Promise<void> {
    if (!customerId) return;
    let value: unknown;
    try {
      value = JSON.parse(preferenceValue);
    } catch {
      setCrmMutationError('La valeur doit être un JSON valide, par exemple "fr" ou ["terrasse"].');
      return;
    }
    setCrmMutationLoading(true);
    setCrmMutationError('');
    setCrmMutationNotice('');
    try {
      const response = await put<{ data: CustomerPreference }>(
        `crm/customers/${customerId}/preferences/${preferenceKey}`,
        {
          value,
          source: 'MANUAL',
          confidence: 1,
          confirmedAt: new Date().toISOString(),
        },
      );
      const saved = response.data;
      setCustomer((current) => {
        if (!current) return current;
        const preferences = [
          ...current.preferences.filter((item) => item.key !== saved.key),
          saved,
        ].sort((left, right) => left.key.localeCompare(right.key));
        return { ...current, preferences };
      });
      setCrmMutationNotice('Préférence enregistrée dans le CRM.');
      resetPreferenceForm();
    } catch (err: unknown) {
      setCrmMutationError(getErrorMessage(err, 'Impossible d’enregistrer la préférence'));
    } finally {
      setCrmMutationLoading(false);
    }
  }

  async function removePreference(preference: CustomerPreference): Promise<void> {
    if (!customerId) return;
    setCrmMutationLoading(true);
    setCrmMutationError('');
    setCrmMutationNotice('');
    try {
      await del(`crm/customers/${customerId}/preferences/${preference.key}`);
      setCustomer((current) =>
        current
          ? {
              ...current,
              preferences: current.preferences.filter((item) => item.id !== preference.id),
            }
          : current,
      );
      if (editingPreferenceId === preference.id) resetPreferenceForm();
      setCrmMutationNotice('Préférence supprimée.');
    } catch (err: unknown) {
      setCrmMutationError(getErrorMessage(err, 'Impossible de supprimer la préférence'));
    } finally {
      setCrmMutationLoading(false);
    }
  }

  async function saveTag(): Promise<void> {
    if (!customerId || !tagKey.trim() || !tagLabel.trim()) return;
    setCrmMutationLoading(true);
    setCrmMutationError('');
    setCrmMutationNotice('');
    try {
      const response = await post<{
        data: { tag: CustomerTag; assignment: CustomerTagAssignment };
      }>(`crm/customers/${customerId}/tags`, {
        key: tagKey.trim(),
        label: tagLabel.trim(),
        source: 'MANUAL',
      });
      const { tag, assignment } = response.data;
      setCustomer((current) => {
        if (!current) return current;
        const tags = current.tags.some((item) => item.id === tag.id)
          ? current.tags.map((item) => (item.id === tag.id ? tag : item))
          : [...current.tags, tag];
        const tagAssignments = [
          ...current.tagAssignments.filter((item) => item.tag.id !== tag.id),
          assignment,
        ];
        return { ...current, tags, tagAssignments };
      });
      setTagKey('');
      setTagLabel('');
      setCrmMutationNotice('Tag ajouté au profil CRM.');
    } catch (err: unknown) {
      setCrmMutationError(getErrorMessage(err, 'Impossible d’ajouter le tag'));
    } finally {
      setCrmMutationLoading(false);
    }
  }

  async function removeTag(tag: CustomerTag): Promise<void> {
    if (!customerId) return;
    setCrmMutationLoading(true);
    setCrmMutationError('');
    setCrmMutationNotice('');
    try {
      await del(`crm/customers/${customerId}/tags/${tag.id}`);
      setCustomer((current) =>
        current
          ? {
              ...current,
              tags: current.tags.filter((item) => item.id !== tag.id),
              tagAssignments: current.tagAssignments.filter((item) => item.tag.id !== tag.id),
            }
          : current,
      );
      setCrmMutationNotice('Tag retiré du profil CRM.');
    } catch (err: unknown) {
      setCrmMutationError(getErrorMessage(err, 'Impossible de retirer le tag'));
    } finally {
      setCrmMutationLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48 rounded-full" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-48 rounded-2xl lg:col-span-2" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard/customers/crm">
            <ArrowLeft size={16} />
            Retour au CRM
          </Link>
        </Button>
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-3 pt-6 text-sm text-destructive">
            <AlertCircle className="mt-0.5 shrink-0" size={18} />
            <div className="space-y-3">
              <p>{error || 'Client introuvable.'}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                <RefreshCw size={14} />
                Réessayer
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const metrics = customer.metrics ?? customer.metricSnapshot;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div className="space-y-3">
          <Button asChild variant="ghost" size="sm" className="-ml-3">
            <Link href="/dashboard/customers/crm">
              <ArrowLeft size={16} />
              Retour au CRM
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <Sparkles className="text-primary" size={20} />
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
              {customer.name || 'Client sans nom'}
            </h1>
            {customer.isVip ? <Badge variant="outline">VIP</Badge> : null}
          </div>
          <p className="text-sm text-muted-foreground">
            Profil CRM · {customer.visitCount} visite(s)
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard/customers/crm/duplicates">Gérer les doublons</Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Download size={17} />
              Export RGPD
            </CardTitle>
            <CardDescription>
              Export JSON des réservations, du profil CRM et des preuves marketing après
              vérification par SMS.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setExportOpen((value) => !value);
              setExportError('');
            }}
            aria-expanded={exportOpen}
          >
            <ShieldCheck size={15} />
            {exportOpen ? 'Fermer' : 'Préparer un export'}
          </Button>
        </CardHeader>
        {exportOpen ? (
          <CardContent className="space-y-4 border-t border-border pt-4">
            {exportStep === 'idle' ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Un code à six chiffres sera envoyé au {customer.phone}. Il expire après quelques
                  minutes et n’est utilisable qu’une fois.
                </p>
                <Button type="button" onClick={() => void requestExportCode()}>
                  Envoyer le code SMS
                </Button>
              </div>
            ) : null}

            {exportStep === 'requesting' ? (
              <p className="text-sm text-muted-foreground">Envoi du code en cours…</p>
            ) : null}

            {exportStep === 'confirming' && exportRequest ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Code envoyé par {exportRequest.channel === 'sms' ? 'SMS' : 'email'}. Saisissez-le
                  pour télécharger le fichier sans exposer le token de vérification.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    value={exportCode}
                    onChange={(event) =>
                      setExportCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                    }
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    aria-label="Code d’export RGPD"
                    className="sm:max-w-40"
                  />
                  <Button
                    type="button"
                    onClick={() => void confirmExport()}
                    disabled={exportCode.length !== 6}
                  >
                    Télécharger l’export
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => void requestExportCode()}>
                    Renvoyer
                  </Button>
                </div>
              </div>
            ) : null}

            {exportStep === 'done' && exportPayload ? (
              <div className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium text-success">Export téléchargé.</p>
                  <p className="text-muted-foreground">
                    Généré le {formatDate(exportPayload.exportedAt)} · données JSON portables.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => downloadExport(exportPayload)}
                >
                  <Download size={15} />
                  Télécharger à nouveau
                </Button>
              </div>
            ) : null}

            {exportError ? <p className="text-sm text-destructive">{exportError}</p> : null}
          </CardContent>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Coordonnées et identités</CardTitle>
            <CardDescription>Les identités sont conservées avec leur provenance.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-start gap-3">
              <Phone className="mt-0.5 text-muted-foreground" size={18} />
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Téléphone</p>
                <p className="mt-1 font-medium">{customer.phone}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Mail className="mt-0.5 text-muted-foreground" size={18} />
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Email</p>
                <p className="mt-1 font-medium">{customer.emailNormalized || 'Non renseigné'}</p>
              </div>
            </div>
            <div className="sm:col-span-2">
              <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                Identités secondaires
              </p>
              {customer.identities.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune identité secondaire.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {customer.identities.map((identity) => (
                    <Badge key={identity.id} variant="secondary">
                      {identity.type} · {identity.value}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Valeur et récence</CardTitle>
            <CardDescription>Projection recalculable, dépense caisse séparée.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Honorées (365 j)</span>
              <strong>{metrics?.honored365d ?? 0}</strong>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Couverts (365 j)</span>
              <strong>{metrics?.covers365d ?? 0}</strong>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">No-show (365 j)</span>
              <strong>{metrics?.noShow365d ?? 0}</strong>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Dépense encaissée</span>
              <strong>
                {metrics?.actualLifetimeSpend === null || metrics?.actualLifetimeSpend === undefined
                  ? 'Non raccordée'
                  : `${formatNumber(metrics.actualLifetimeSpend)} €`}
              </strong>
            </div>
            <div className="flex items-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
              <CalendarDays size={14} />
              Dernière visite : {formatDate(metrics?.lastHonoredAt)}
            </div>
            <div className="border-t border-border pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Projection CRM
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Comparaison déterministe avec les réservations sources.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void inspectProjection()}
                  disabled={repairLoading}
                >
                  {repairLoading ? 'Vérification…' : 'Vérifier'}
                </Button>
              </div>
              {repairPreview ? (
                <div className="mt-3 space-y-2 text-xs">
                  <p className={repairPreview.changed ? 'text-warning' : 'text-success'}>
                    {repairPreview.changed
                      ? `Écart détecté sur ${repairPreview.reservationCount} réservation(s).`
                      : 'Projection à jour.'}
                  </p>
                  {repairPreview.changed ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void repairProjection()}
                      disabled={repairLoading}
                    >
                      Recalculer la projection
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {repairNotice ? <p className="mt-2 text-xs text-success">{repairNotice}</p> : null}
              {repairError ? <p className="mt-2 text-xs text-destructive">{repairError}</p> : null}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Tag size={17} />
              Préférences et tags
            </CardTitle>
            <CardDescription>Informations structurées utiles pendant le service.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Tags</p>
                <span className="text-xs text-muted-foreground">Owner/Manager</span>
              </div>
              {customer.tags.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucun tag.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {customer.tags.map((tag) => (
                    <span key={tag.id} className="inline-flex items-center gap-1">
                      <Badge variant="secondary">{tag.label}</Badge>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        aria-label={`Retirer le tag ${tag.label}`}
                        onClick={() => void removeTag(tag)}
                        disabled={crmMutationLoading}
                      >
                        <X size={13} />
                      </Button>
                    </span>
                  ))}
                </div>
              )}
              <form
                className="mt-3 flex flex-col gap-2 sm:flex-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveTag();
                }}
              >
                <Input
                  value={tagKey}
                  onChange={(event) => setTagKey(event.target.value)}
                  placeholder="vip_regulier"
                  aria-label="Clé du tag"
                  className="sm:max-w-44"
                  disabled={crmMutationLoading}
                />
                <Input
                  value={tagLabel}
                  onChange={(event) => setTagLabel(event.target.value)}
                  placeholder="VIP régulier"
                  aria-label="Libellé du tag"
                  disabled={crmMutationLoading}
                />
                <Button
                  type="submit"
                  variant="outline"
                  disabled={crmMutationLoading || !tagKey.trim() || !tagLabel.trim()}
                >
                  <Plus size={14} />
                  Ajouter
                </Button>
              </form>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Préférences</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPreferenceFormOpen(true);
                    setEditingPreferenceId(null);
                    setCrmMutationError('');
                    setCrmMutationNotice('');
                  }}
                  disabled={crmMutationLoading}
                >
                  <Plus size={14} />
                  Ajouter
                </Button>
              </div>
              {customer.preferences.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune préférence confirmée.</p>
              ) : (
                <dl className="divide-y divide-border text-sm">
                  {customer.preferences.map((preference) => (
                    <div
                      key={preference.id}
                      className="flex items-center justify-between gap-3 py-2 first:pt-0"
                    >
                      <div className="min-w-0">
                        <dt className="text-muted-foreground">{preference.key}</dt>
                        <dd className="truncate font-medium">{displayValue(preference.value)}</dd>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => editPreference(preference)}
                          disabled={crmMutationLoading}
                        >
                          Modifier
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={`Supprimer la préférence ${preference.key}`}
                          onClick={() => void removePreference(preference)}
                          disabled={crmMutationLoading}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </div>
                  ))}
                </dl>
              )}
              {preferenceFormOpen ? (
                <div className="mt-3 space-y-2 rounded-lg border border-border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium">
                      {editingPreferenceId ? 'Modifier la préférence' : 'Nouvelle préférence'}
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label="Fermer le formulaire de préférence"
                      onClick={resetPreferenceForm}
                    >
                      <X size={14} />
                    </Button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <select
                      value={preferenceKey}
                      onChange={(event) => setPreferenceKey(event.target.value)}
                      aria-label="Clé de préférence"
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      disabled={crmMutationLoading || Boolean(editingPreferenceId)}
                    >
                      {[
                        'preferred_section',
                        'preferred_table',
                        'dietary_restrictions',
                        'accessibility_needs',
                        'preferred_language',
                        'occasion_type',
                        'service_preference',
                        'group_pattern',
                      ].map((key) => (
                        <option key={key} value={key}>
                          {key}
                        </option>
                      ))}
                    </select>
                    <Input
                      value={preferenceValue}
                      onChange={(event) => setPreferenceValue(event.target.value)}
                      placeholder='"terrasse" ou ["sans gluten"]'
                      aria-label="Valeur JSON de préférence"
                      disabled={crmMutationLoading}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    La valeur est envoyée en JSON et contrôlée par l’API avant écriture.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void savePreference()}
                      disabled={crmMutationLoading || !preferenceValue.trim()}
                    >
                      <Save size={14} />
                      Enregistrer
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={resetPreferenceForm}>
                      Annuler
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
            {crmMutationNotice ? <p className="text-xs text-success">{crmMutationNotice}</p> : null}
            {crmMutationError ? (
              <p className="text-xs text-destructive">{crmMutationError}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Chronologie récente</CardTitle>
            <CardDescription>Événements métier dédupliqués par le serveur.</CardDescription>
          </CardHeader>
          <CardContent>
            {customer.timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun événement récent.</p>
            ) : (
              <ol className="space-y-4">
                {customer.timeline.map((event) => (
                  <li key={event.id} className="flex gap-3">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{event.summaryCode}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(event.occurredAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
