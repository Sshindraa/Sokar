'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  GitMerge,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { FeatureLockCard } from '@/components/FeatureLockCard';
import { useApi } from '@/lib/api';
import { featureLockFromError, type FeatureLock } from '@/lib/api-error';
import { getErrorMessage } from '@/types/api';

type DuplicateCustomer = {
  id: string;
  name: string | null;
  phone: string;
  emailNormalized: string | null;
  /** Honoured visits from the reservations. */
  visits?: number;
  isVip: boolean;
};

type DuplicateReason = { code: string; points: number; label: string };
type DuplicateCandidate = {
  id: string;
  score: number;
  reasons: DuplicateReason[];
  left: DuplicateCustomer;
  right: DuplicateCustomer;
};

type MergePreview = {
  target: DuplicateCustomer & { notes: string | null };
  sources: Array<DuplicateCustomer & { notes: string | null }>;
  conflicts: {
    identities: Array<{ type: string; normalizedValue: string; customerIds: string[] }>;
    preferences: Array<{
      key: string;
      values: Array<{ customerId: string; value: unknown; updatedAt: string }>;
      resolutionRequired: true;
    }>;
    profileFields: Array<{
      field: string;
      values: Array<{ customerId: string; value: unknown }>;
      resolution: 'target_wins';
    }>;
    permissions: Array<{
      channel: string;
      statuses: Array<{ customerId: string; status: string }>;
      restrictiveStatus: string;
    }>;
    campaignAudience: Array<{ campaignId: string; customerIds: string[] }>;
  };
  impact: {
    reservations: number;
    giftCards: number;
    timelineEvents: number;
    identities: number;
    preferences: number;
    tags: number;
    permissions: number;
    marketingMessages: number;
    conversions: number;
  };
};

type MergeResult = {
  auditId: string;
  targetCustomerId: string;
  sourceCustomerIds: string[];
  replayed: boolean;
};

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `crm-merge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function customerLabel(customer: DuplicateCustomer): string {
  return customer.name?.trim() || 'Client sans nom';
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

/** Préférences en conflit : libellé français plutôt que clé technique. */
const PREFERENCE_LABELS: Record<string, string> = {
  preferred_section: 'Zone préférée',
  preferred_table: 'Table préférée',
  dietary_restrictions: 'Régimes alimentaires',
  accessibility_needs: 'Accessibilité',
  preferred_language: 'Langue préférée',
  occasion_type: 'Occasion habituelle',
  service_preference: 'Service préféré',
  group_pattern: 'Taille de groupe habituelle',
};

const CHANNEL_LABELS: Record<string, string> = {
  SMS: 'SMS',
  EMAIL: 'e-mail',
  WHATSAPP: 'WhatsApp',
};
const PERMISSION_LABELS: Record<string, string> = {
  OPT_IN: 'accepté',
  OPT_OUT: 'refusé',
  WITHDRAWN: 'retiré',
  UNKNOWN: 'non renseigné',
};

function LoadingCandidates() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((row) => (
        <Skeleton key={row} className="h-36 w-full rounded-2xl" />
      ))}
    </div>
  );
}

export default function CustomerDuplicatesPage() {
  const { get, post, orgId } = useApi();
  const [candidates, setCandidates] = useState<DuplicateCandidate[]>([]);
  const [selected, setSelected] = useState<{
    candidate: DuplicateCandidate;
    targetCustomerId: string;
  } | null>(null);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, 'target' | 'source' | 'latest'>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [lock, setLock] = useState<FeatureLock | null>(null);
  const previewPanelRef = useRef<HTMLDivElement>(null);
  // Échec du chargement de la liste (≠ erreur d'aperçu ou de fusion, où la liste reste affichée).
  const [loadFailed, setLoadFailed] = useState(false);

  const loadCandidates = useCallback(async () => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    setLock(null);
    setLoadFailed(false);
    try {
      const response = await get<{ data: DuplicateCandidate[] }>(
        'crm/duplicates?minScore=60&limit=50',
      );
      setCandidates(Array.isArray(response.data) ? response.data : []);
    } catch (err: unknown) {
      setLock(featureLockFromError(err));
      setLoadFailed(true);
      setError(getErrorMessage(err, 'Impossible de charger les doublons.'));
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  }, [get, orgId]);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  const selectedSource = useMemo(() => {
    if (!selected) return null;
    return selected.candidate.left.id === selected.targetCustomerId
      ? selected.candidate.right
      : selected.candidate.left;
  }, [selected]);

  async function openPreview(candidate: DuplicateCandidate, targetCustomerId: string) {
    setAction(`preview:${candidate.id}:${targetCustomerId}`);
    setError('');
    setNotice('');
    setSelected({ candidate, targetCustomerId });
    setPreview(null);
    setResolutions({});
    // Sous 1280 px, l'aperçu s'affiche sous toute la liste : on y amène le restaurateur, sinon le bouton
    // semble ne rien faire.
    if (typeof window !== 'undefined' && !window.matchMedia?.('(min-width: 1280px)').matches) {
      previewPanelRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }
    const sourceCustomerId =
      candidate.left.id === targetCustomerId ? candidate.right.id : candidate.left.id;
    try {
      const response = await post<{ data: MergePreview }>(
        `crm/customers/${targetCustomerId}/merge-preview`,
        { sourceCustomerIds: [sourceCustomerId] },
      );
      setPreview(response.data ?? null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de préparer la fusion.'));
    } finally {
      setAction('');
    }
  }

  async function confirmMerge() {
    if (!selected || !preview || !selectedSource) return;
    const unresolved = preview.conflicts.preferences.filter(
      (conflict) => !resolutions[conflict.key],
    );
    if (unresolved.length > 0) {
      setError('Choisissez la valeur à garder pour chaque préférence en conflit.');
      return;
    }
    setAction('merge');
    setError('');
    setNotice('');
    try {
      const response = await post<{ data: MergeResult }>(
        `crm/customers/${selected.targetCustomerId}/merge`,
        {
          sourceCustomerIds: [selectedSource.id],
          preferenceResolution: resolutions,
        },
        { headers: { 'Idempotency-Key': newIdempotencyKey() } },
      );
      const result = response.data;
      setNotice(
        result?.replayed
          ? 'Cette fusion avait déjà été effectuée : rien n’a été modifié.'
          : 'Fusion effectuée. L’autre profil est archivé et l’historique est conservé.',
      );
      setSelected(null);
      setPreview(null);
      setResolutions({});
      await loadCandidates();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'La fusion n’a pas été effectuée.'));
    } finally {
      setAction('');
    }
  }

  const sourceCustomerName = (customerId: string): string => {
    if (!selected) return 'Profil';
    const all = [selected.candidate.left, selected.candidate.right];
    const match = all.find((customer) => customer.id === customerId);
    return match ? customerLabel(match) : 'Profil';
  };

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
            <GitMerge className="text-primary" size={20} />
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Doublons</h1>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Les suggestions s’appuient sur le téléphone ou l’e-mail. Le nom seul ne déclenche jamais
            une fusion.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void loadCandidates()}
          disabled={loading}
        >
          <RefreshCw size={15} />
          Actualiser
        </Button>
      </div>

      {notice ? (
        <Card className="border-success/40">
          <CardContent className="flex items-center gap-3 pt-6 text-sm text-success">
            <CheckCircle2 size={18} />
            {notice}
          </CardContent>
        </Card>
      ) : null}

      {lock ? (
        <FeatureLockCard lock={lock} feature="Doublons" />
      ) : error ? (
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-3 pt-6 text-sm text-destructive">
            <AlertCircle className="mt-0.5 shrink-0" size={18} />
            <div className="space-y-2">
              <p role="alert">{error}</p>
              {loadFailed ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="transition-all duration-200"
                  onClick={() => void loadCandidates()}
                >
                  <RefreshCw size={14} />
                  Réessayer
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {loading ? (
        <LoadingCandidates />
      ) : loadFailed || lock ? null : candidates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <ShieldCheck className="text-success" size={36} />
            <p className="font-medium">Aucun doublon probable à traiter</p>
            <p className="text-sm text-muted-foreground">
              Les nouveaux profils seront analysés après leur prochaine interaction.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-3">
            {candidates.map((candidate) => (
              <Card
                key={candidate.id}
                className="transition-all duration-200 hover:border-primary/40"
              >
                <CardHeader className="flex-row items-start justify-between gap-4 pb-3">
                  <div>
                    <CardTitle className="text-base">Deux profils qui se ressemblent</CardTitle>
                    <CardDescription>
                      {candidate.reasons.map((reason) => reason.label).join(' · ')}
                    </CardDescription>
                  </div>
                  <Badge variant={candidate.score >= 90 ? 'default' : 'secondary'}>
                    {candidate.score >= 90 ? 'Très probable' : 'Probable'}
                  </Badge>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 md:grid-cols-2">
                    {[candidate.left, candidate.right].map((customer) => (
                      <div
                        key={customer.id}
                        className="rounded-xl border border-border bg-muted/20 p-4"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium">{customerLabel(customer)}</p>
                          {customer.isVip ? <Badge variant="outline">VIP</Badge> : null}
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">{customer.phone}</p>
                        {customer.emailNormalized ? (
                          <p className="truncate text-xs text-muted-foreground">
                            {customer.emailNormalized}
                          </p>
                        ) : null}
                        <p className="mt-2 text-xs text-muted-foreground">
                          {customer.visits ?? '—'} visite(s)
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={Boolean(action)}
                            onClick={() => void openPreview(candidate, customer.id)}
                          >
                            {action === `preview:${candidate.id}:${customer.id}`
                              ? 'Préparation…'
                              : 'Garder ce profil'}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card ref={previewPanelRef} className="h-fit xl:sticky xl:top-6">
            <CardHeader>
              <CardTitle className="text-base">Aperçu de fusion</CardTitle>
              <CardDescription>
                {selected
                  ? `Cible : ${customerLabel(selected.candidate.left.id === selected.targetCustomerId ? selected.candidate.left : selected.candidate.right)}`
                  : 'Choisissez « Garder ce profil » sur l’un des deux.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {!selected ? (
                <p className="text-sm text-muted-foreground">
                  Vous verrez ce qui sera regroupé avant toute modification.
                </p>
              ) : !preview ? (
                error ? (
                  <p className="text-sm text-muted-foreground">
                    L’aperçu n’a pas pu être calculé. Choisissez de nouveau le profil à garder.
                  </p>
                ) : (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 size={15} className="animate-spin" />
                    Calcul de l’aperçu…
                  </p>
                )
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2 text-center text-sm">
                    <div className="rounded-lg bg-muted/40 p-3">
                      <strong className="block text-lg">{preview.impact.reservations}</strong>
                      <span className="text-xs text-muted-foreground">réservations</span>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-3">
                      <strong className="block text-lg">{preview.impact.timelineEvents}</strong>
                      <span className="text-xs text-muted-foreground">événements</span>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-3">
                      <strong className="block text-lg">{preview.impact.permissions}</strong>
                      <span className="text-xs text-muted-foreground">consentements</span>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-3">
                      <strong className="block text-lg">{preview.impact.conversions}</strong>
                      <span className="text-xs text-muted-foreground">conversions</span>
                    </div>
                  </div>

                  {preview.conflicts.identities.length > 0 ? (
                    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                      <p className="font-medium">Coordonnées en commun</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Les coordonnées identiques ne seront gardées qu’une fois.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {preview.conflicts.identities.map((identity) => (
                          <Badge
                            key={`${identity.type}:${identity.normalizedValue}`}
                            variant="secondary"
                          >
                            {identity.type === 'PHONE'
                              ? 'Téléphone'
                              : identity.type === 'EMAIL'
                                ? 'E-mail'
                                : 'Autre coordonnée'}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {preview.conflicts.preferences.length > 0 ? (
                    <div className="space-y-3">
                      <div>
                        <p className="text-sm font-medium">Préférences en conflit</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Choisissez quelle valeur garder : cela protège les informations saisies
                          par votre équipe.
                        </p>
                      </div>
                      {preview.conflicts.preferences.map((conflict) => (
                        <label key={conflict.key} className="block text-sm">
                          <span className="font-medium">
                            {PREFERENCE_LABELS[conflict.key] ?? 'Autre préférence'}
                          </span>
                          <select
                            aria-label={`Valeur à garder : ${PREFERENCE_LABELS[conflict.key] ?? 'préférence'}`}
                            className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                            value={resolutions[conflict.key] ?? ''}
                            onChange={(event) =>
                              setResolutions((current) => ({
                                ...current,
                                [conflict.key]: event.target.value as
                                  | 'target'
                                  | 'source'
                                  | 'latest',
                              }))
                            }
                          >
                            <option value="" disabled>
                              Choisir une valeur
                            </option>
                            <option value="target">Garder celle du profil conservé</option>
                            <option value="source">Garder celle de l’autre profil</option>
                            <option value="latest">Garder la plus récente</option>
                          </select>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {conflict.values
                              .map(
                                (value) =>
                                  `${sourceCustomerName(value.customerId)} : ${displayValue(value.value)}`,
                              )
                              .join(' · ')}
                          </span>
                        </label>
                      ))}
                    </div>
                  ) : null}

                  {preview.conflicts.permissions.length > 0 ? (
                    <div className="rounded-lg border border-border p-3 text-sm">
                      <p className="font-medium">Consentements</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Le choix le plus protecteur est gardé pour chaque canal :{' '}
                        {preview.conflicts.permissions
                          .map(
                            (permission) =>
                              `${CHANNEL_LABELS[permission.channel] ?? 'canal'} ${PERMISSION_LABELS[permission.restrictiveStatus] ?? 'non renseigné'}`,
                          )
                          .join(' · ')}
                      </p>
                    </div>
                  ) : null}

                  <div className="flex flex-col gap-2 border-t border-border pt-4">
                    <Button
                      type="button"
                      className="transition-all duration-200"
                      disabled={action === 'merge'}
                      onClick={() => void confirmMerge()}
                    >
                      <GitMerge size={16} />
                      {action === 'merge' ? 'Fusion en cours…' : 'Confirmer la fusion'}
                    </Button>
                    <p className="text-center text-xs text-muted-foreground">
                      Réservé au propriétaire du compte · l’historique de la fusion est conservé
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
