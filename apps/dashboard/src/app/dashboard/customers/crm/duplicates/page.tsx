'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  GitMerge,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi } from '@/lib/api';
import { getErrorMessage } from '@/types/api';

type DuplicateCustomer = {
  id: string;
  name: string | null;
  phone: string;
  emailNormalized: string | null;
  visitCount: number;
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

  const loadCandidates = useCallback(async () => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await get<{ data: DuplicateCandidate[] }>(
        'crm/duplicates?minScore=60&limit=50',
      );
      setCandidates(Array.isArray(response.data) ? response.data : []);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de charger les doublons CRM'));
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
    const sourceCustomerId =
      candidate.left.id === targetCustomerId ? candidate.right.id : candidate.left.id;
    try {
      const response = await post<{ data: MergePreview }>(
        `crm/customers/${targetCustomerId}/merge-preview`,
        { sourceCustomerIds: [sourceCustomerId] },
      );
      setPreview(response.data ?? null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de préparer la fusion'));
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
      setError('Choisissez une résolution pour chaque préférence en conflit.');
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
          ? 'La demande de fusion a été rejouée sans nouvelle mutation.'
          : 'Fusion confirmée. Les profils sources sont archivés et l’audit est conservé.',
      );
      setSelected(null);
      setPreview(null);
      setResolutions({});
      await loadCandidates();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'La fusion n’a pas été confirmée'));
    } finally {
      setAction('');
    }
  }

  const forbidden = error.toLowerCase().includes('formule') || error.includes('CAPABILITY');

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
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Doublons CRM</h1>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Les suggestions utilisent le téléphone ou l’email normalisé. Le nom seul ne déclenche
            jamais une fusion.
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

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-3 pt-6 text-sm text-destructive">
            <AlertCircle className="mt-0.5 shrink-0" size={18} />
            <div className="space-y-2">
              <p>{error}</p>
              {forbidden ? (
                <p className="text-muted-foreground">
                  La détection et la fusion sont incluses dans le CRM Pro. Le fichier client de base
                  reste disponible dans l’espace Clients.
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {loading ? (
        <LoadingCandidates />
      ) : candidates.length === 0 && !error ? (
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
                    <CardTitle className="text-base">Deux profils rapprochés</CardTitle>
                    <CardDescription>
                      Score {candidate.score}/100 ·{' '}
                      {candidate.reasons.map((reason) => reason.label).join(' · ')}
                    </CardDescription>
                  </div>
                  <Badge variant={candidate.score >= 90 ? 'default' : 'secondary'}>
                    {candidate.score}/100
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
                          {customer.visitCount} visite(s) · ID {customer.id}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={Boolean(action)}
                            onClick={() => void openPreview(candidate, customer.id)}
                          >
                            Garder ce profil
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="h-fit xl:sticky xl:top-6">
            <CardHeader>
              <CardTitle className="text-base">Aperçu de fusion</CardTitle>
              <CardDescription>
                {selected
                  ? `Cible : ${customerLabel(selected.candidate.left.id === selected.targetCustomerId ? selected.candidate.left : selected.candidate.right)}`
                  : 'Sélectionnez le profil à conserver.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {!selected || !preview ? (
                <p className="text-sm text-muted-foreground">
                  Le serveur calculera les impacts avant toute écriture.
                </p>
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
                      <span className="text-xs text-muted-foreground">permissions</span>
                    </div>
                    <div className="rounded-lg bg-muted/40 p-3">
                      <strong className="block text-lg">{preview.impact.conversions}</strong>
                      <span className="text-xs text-muted-foreground">conversions</span>
                    </div>
                  </div>

                  {preview.conflicts.identities.length > 0 ? (
                    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                      <p className="font-medium">Identités communes</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Les identités identiques seront dédupliquées dans la transaction.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {preview.conflicts.identities.map((identity) => (
                          <Badge
                            key={`${identity.type}:${identity.normalizedValue}`}
                            variant="secondary"
                          >
                            {identity.type}
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
                          Une résolution explicite protège les informations saisies par l’équipe.
                        </p>
                      </div>
                      {preview.conflicts.preferences.map((conflict) => (
                        <label key={conflict.key} className="block text-sm">
                          <span className="font-medium">{conflict.key}</span>
                          <select
                            aria-label={`Résolution ${conflict.key}`}
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
                            <option value="target">Conserver la cible</option>
                            <option value="source">Conserver la source</option>
                            <option value="latest">Valeur la plus récente</option>
                          </select>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {conflict.values
                              .map((value) => `${value.customerId}: ${displayValue(value.value)}`)
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
                        L’état le plus restrictif est conservé par canal :{' '}
                        {preview.conflicts.permissions
                          .map(
                            (permission) =>
                              `${permission.channel} → ${permission.restrictiveStatus}`,
                          )
                          .join(' · ')}
                      </p>
                    </div>
                  ) : null}

                  <div className="flex flex-col gap-2 border-t border-border pt-4">
                    <Button
                      type="button"
                      disabled={action === 'merge'}
                      onClick={() => void confirmMerge()}
                    >
                      <GitMerge size={16} />
                      {action === 'merge' ? 'Fusion en cours…' : 'Confirmer la fusion'}
                    </Button>
                    <p className="text-center text-xs text-muted-foreground">
                      Confirmation réservée au propriétaire du site · audit idempotent conservé
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
