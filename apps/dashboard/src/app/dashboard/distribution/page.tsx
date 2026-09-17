'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Link2,
  RefreshCw,
  Share2,
  ShieldAlert,
  Webhook,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi } from '@/lib/api';
import { getErrorMessage } from '@/types/api';

type Provider = 'GOOGLE_RESERVE' | 'META_RESERVE' | 'PUBLIC_API';
type ConnectionStatus = 'DISCONNECTED' | 'PENDING' | 'ACTIVE' | 'PAUSED' | 'ERROR';
type SyncDirection = 'PUSH' | 'PULL' | 'BIDIRECTIONAL';
type SyncStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'NEEDS_REVIEW';
type LinkStatus = 'ACTIVE' | 'CANCELLED' | 'NEEDS_REVIEW';
type WebhookStatus = 'RECEIVED' | 'PROCESSED' | 'IGNORED' | 'FAILED';

type Connection = {
  id: string;
  provider: Provider;
  externalAccountLast4: string | null;
  credentialReferencePresent: boolean;
  configHash: string;
  status: ConnectionStatus;
  cursorPresent: boolean;
  lastSyncAt: string | null;
  lastErrorCode: string | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  updatedAt: string;
};

type SyncRun = {
  id: string;
  connectionId: string;
  provider: Provider;
  direction: SyncDirection;
  status: SyncStatus;
  windowStart: string | null;
  windowEnd: string | null;
  pushedCount: number;
  pulledCount: number;
  failedCount: number;
  errorCode: string | null;
  createdAt: string;
  finishedAt: string | null;
};

type Availability = {
  id: string;
  connectionId: string;
  provider: Provider;
  slotKey: string;
  serviceDate: string;
  startsAt: string;
  endsAt: string;
  partySize: number;
  available: number;
  capacity: number;
  sourceRevision: string | null;
  observedAt: string;
};

type ReservationLink = {
  id: string;
  connectionId: string;
  provider: Provider;
  reservationId: string;
  externalIdLast4: string;
  status: LinkStatus;
  source: string;
  linkedAt: string;
};

type Webhook = {
  id: string;
  connectionId: string | null;
  provider: Provider;
  eventType: string;
  payloadHash: string;
  status: WebhookStatus;
  errorCode: string | null;
  receivedAt: string;
  processedAt: string | null;
};

type ListResponse<T> = { data?: T[] };
type MutationResponse<T> = { data?: T };

const providerLabels: Record<Provider, string> = {
  GOOGLE_RESERVE: 'Google Reserve',
  META_RESERVE: 'Meta Reserve',
  PUBLIC_API: 'API publique',
};

const statusLabels: Record<ConnectionStatus | SyncStatus | LinkStatus | WebhookStatus, string> = {
  DISCONNECTED: 'Déconnectée',
  PENDING: 'En attente',
  ACTIVE: 'Active',
  PAUSED: 'En pause',
  ERROR: 'Erreur',
  QUEUED: 'En file',
  RUNNING: 'En cours',
  SUCCEEDED: 'Réussie',
  FAILED: 'Échouée',
  NEEDS_REVIEW: 'À vérifier',
  CANCELLED: 'Annulée',
  RECEIVED: 'Reçue',
  PROCESSED: 'Traitée',
  IGNORED: 'Ignorée',
};

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

function statusVariant(
  status: ConnectionStatus | SyncStatus | LinkStatus | WebhookStatus,
): 'default' | 'secondary' | 'destructive' {
  if (status === 'ACTIVE' || status === 'SUCCEEDED' || status === 'PROCESSED') return 'default';
  if (status === 'ERROR' || status === 'FAILED' || status === 'NEEDS_REVIEW') return 'destructive';
  return 'secondary';
}

function LoadingRows() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map((row) => (
        <Skeleton key={row} className="h-12 w-full rounded-xl" />
      ))}
    </div>
  );
}

export default function DistributionPage() {
  const { get, post } = useApi();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [links, setLinks] = useState<ReservationLink[]>([]);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [connectionForm, setConnectionForm] = useState({
    provider: 'GOOGLE_RESERVE' as Provider,
    externalAccountId: '',
    credentialReference: '',
  });
  const [direction, setDirection] = useState<SyncDirection>('BIDIRECTIONAL');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [connectionResponse, runResponse, linkResponse, webhookResponse] = await Promise.all([
        get<ListResponse<Connection>>('distribution/connections?limit=100'),
        get<ListResponse<SyncRun>>('distribution/sync-runs?limit=100'),
        get<ListResponse<ReservationLink>>('distribution/reservation-links?limit=100'),
        get<ListResponse<Webhook>>('distribution/webhooks?limit=100'),
      ]);
      const nextConnections = Array.isArray(connectionResponse.data) ? connectionResponse.data : [];
      const nextSelected =
        selectedConnectionId && nextConnections.some((item) => item.id === selectedConnectionId)
          ? selectedConnectionId
          : (nextConnections[0]?.id ?? '');
      setConnections(nextConnections);
      setRuns(Array.isArray(runResponse.data) ? runResponse.data : []);
      setLinks(Array.isArray(linkResponse.data) ? linkResponse.data : []);
      setWebhooks(Array.isArray(webhookResponse.data) ? webhookResponse.data : []);
      setSelectedConnectionId(nextSelected);
      if (nextSelected) {
        const availabilityResponse = await get<ListResponse<Availability>>(
          `distribution/connections/${nextSelected}/availability?limit=100`,
        );
        setAvailability(Array.isArray(availabilityResponse.data) ? availabilityResponse.data : []);
      } else {
        setAvailability([]);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de charger les canaux partenaires'));
      setConnections([]);
      setRuns([]);
      setAvailability([]);
      setLinks([]);
      setWebhooks([]);
    } finally {
      setLoading(false);
    }
  }, [get, selectedConnectionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedConnection = useMemo(
    () => connections.find((item) => item.id === selectedConnectionId) ?? null,
    [connections, selectedConnectionId],
  );
  const locked =
    error.includes('DISTRIBUTION_DISABLED') || error.includes('CAPABILITY_NOT_INCLUDED');
  const selectedRuns = runs.filter((run) => run.connectionId === selectedConnectionId);
  const selectedLinks = links.filter((link) => link.connectionId === selectedConnectionId);
  const selectedWebhooks = webhooks.filter(
    (webhook) => webhook.connectionId === selectedConnectionId,
  );

  async function createConnection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await post<MutationResponse<Connection>>('distribution/connections', {
        provider: connectionForm.provider,
        externalAccountId: connectionForm.externalAccountId || undefined,
        credentialReference: connectionForm.credentialReference || undefined,
        configFingerprint: { mode: 'local-dry-run' },
      });
      if (response.data) {
        setConnections((current) => [response.data!, ...current]);
        setSelectedConnectionId(response.data.id);
      }
      setConnectionForm({
        provider: 'GOOGLE_RESERVE',
        externalAccountId: '',
        credentialReference: '',
      });
      setNotice(
        'Connexion enregistrée en qualification locale. Aucun fournisseur externe n’a été appelé.',
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible d’enregistrer la connexion'));
    } finally {
      setBusy(false);
    }
  }

  async function disconnectConnection() {
    if (!selectedConnection) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await post(`distribution/connections/${selectedConnection.id}/disconnect`);
      setNotice('Connexion déconnectée. Les snapshots et runs restent consultables.');
      await load();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de déconnecter la connexion'));
    } finally {
      setBusy(false);
    }
  }

  async function queueSync() {
    if (!selectedConnection) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await post(
        `distribution/connections/${selectedConnection.id}/sync-runs`,
        { direction },
        { headers: { 'Idempotency-Key': `dashboard-distribution-${Date.now()}` } },
      );
      setNotice(
        'Run local mis en file. Un adaptateur fournisseur devra encore être validé par pilote.',
      );
      await load();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de mettre le run en file'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full space-y-6">
      <header className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="flex items-center gap-2">
            <Share2 className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">Canaux partenaires</h1>
            <Badge variant="secondary">Pro</Badge>
          </div>
          <p className="mt-1 max-w-4xl text-sm text-muted-foreground">
            Préparez Google Reserve, Meta Reserve ou l’API publique avec des données tenant-scoped,
            des snapshots d’ouverture et des runs rejouables. Les appels fournisseurs et les
            webhooks publics restent verrouillés pendant la qualification.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading || busy}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Actualiser
        </Button>
      </header>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>{notice}</span>
        </div>
      )}

      {locked ? (
        <Card>
          <CardContent className="flex items-start gap-3 p-6 text-sm text-muted-foreground">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="font-medium text-foreground">Canaux partenaires verrouillés</p>
              <p className="mt-1">
                Le flag DISTRIBUTION_ENABLED ou l’entitlement Pro doit être ouvert après la preuve
                d’un pilote. Aucun compte externe ni secret ne sera utilisé avant cette étape.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <Card>
              <CardHeader>
                <CardTitle>Connexions</CardTitle>
                <CardDescription>
                  Une connexion par fournisseur et par établissement. Seuls le hash du compte, les
                  quatre derniers caractères et la référence opaque du secret sont conservés.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <form
                  className="grid gap-3 rounded-xl border border-border p-4"
                  onSubmit={createConnection}
                >
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <Label htmlFor="distribution-provider">Fournisseur</Label>
                      <select
                        id="distribution-provider"
                        value={connectionForm.provider}
                        onChange={(event) =>
                          setConnectionForm({
                            ...connectionForm,
                            provider: event.target.value as Provider,
                          })
                        }
                        className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        {Object.entries(providerLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="distribution-account">Identifiant externe</Label>
                      <Input
                        id="distribution-account"
                        value={connectionForm.externalAccountId}
                        onChange={(event) =>
                          setConnectionForm({
                            ...connectionForm,
                            externalAccountId: event.target.value,
                          })
                        }
                        placeholder="location-1234"
                      />
                    </div>
                    <div>
                      <Label htmlFor="distribution-credential">Référence du secret</Label>
                      <Input
                        id="distribution-credential"
                        value={connectionForm.credentialReference}
                        onChange={(event) =>
                          setConnectionForm({
                            ...connectionForm,
                            credentialReference: event.target.value,
                          })
                        }
                        placeholder="vault/distribution/google"
                      />
                    </div>
                  </div>
                  <Button type="submit" disabled={busy}>
                    Enregistrer en qualification
                  </Button>
                </form>

                {loading ? (
                  <LoadingRows />
                ) : connections.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                    Aucune connexion préparée.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {connections.map((connection) => (
                      <button
                        type="button"
                        key={connection.id}
                        onClick={() => setSelectedConnectionId(connection.id)}
                        className={`w-full rounded-xl border p-3 text-left transition-all duration-200 ${
                          connection.id === selectedConnectionId
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:bg-accent'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium">{providerLabels[connection.provider]}</span>
                          <Badge variant={statusVariant(connection.status)}>
                            {statusLabels[connection.status]}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Compte •••• {connection.externalAccountLast4 ?? '—'} · secret{' '}
                          {connection.credentialReferencePresent ? 'référencé' : 'absent'} ·
                          dernière activité {formatDate(connection.lastSyncAt)}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Run de synchronisation</CardTitle>
                <CardDescription>
                  Le run est une trace idempotente et rejouable. Tant qu’un adaptateur n’est pas
                  qualifié, il reste une opération locale sans appel réseau.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {selectedConnection ? (
                  <>
                    <div className="rounded-xl border border-border p-4 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">
                          {providerLabels[selectedConnection.provider]}
                        </span>
                        <Badge variant={statusVariant(selectedConnection.status)}>
                          {statusLabels[selectedConnection.status]}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Curseur {selectedConnection.cursorPresent ? 'présent' : 'absent'} · hash de
                        configuration {selectedConnection.configHash.slice(0, 12)}…
                      </p>
                      <Button
                        variant="outline"
                        className="mt-3"
                        onClick={() => void disconnectConnection()}
                        disabled={busy || selectedConnection.status === 'DISCONNECTED'}
                      >
                        Déconnecter
                      </Button>
                    </div>
                    <div>
                      <Label htmlFor="distribution-direction">Direction</Label>
                      <select
                        id="distribution-direction"
                        value={direction}
                        onChange={(event) => setDirection(event.target.value as SyncDirection)}
                        className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="BIDIRECTIONAL">Bidirectionnelle</option>
                        <option value="PUSH">Vers le canal</option>
                        <option value="PULL">Depuis le canal</option>
                      </select>
                    </div>
                    <Button
                      onClick={() => void queueSync()}
                      disabled={busy || selectedConnection.status === 'DISCONNECTED'}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Mettre un run local en file
                    </Button>
                  </>
                ) : (
                  <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                    Sélectionnez une connexion pour préparer un run.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Snapshots de disponibilité</CardTitle>
                <CardDescription>
                  Données bornées et non autoritaires, utiles pour vérifier le mapping avant de
                  publier une disponibilité.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <LoadingRows />
                ) : availability.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Aucun snapshot pour cette connexion.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {availability.slice(0, 12).map((slot) => (
                      <div key={slot.id} className="rounded-xl border border-border p-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">
                            {formatDate(slot.startsAt)} · {slot.partySize} couvert(s)
                          </span>
                          <Badge variant="secondary">
                            {slot.available}/{slot.capacity} disponibles
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {slot.slotKey} · source {slot.sourceRevision ?? '—'} · observé{' '}
                          {formatDate(slot.observedAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Historique de runs</CardTitle>
                <CardDescription>
                  Les compteurs et erreurs sont conservés pour la revue du pilote.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {selectedRuns.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucun run pour cette connexion.</p>
                ) : (
                  <div className="space-y-2">
                    {selectedRuns.slice(0, 12).map((run) => (
                      <div key={run.id} className="rounded-xl border border-border p-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">
                            {run.direction} · {formatDate(run.createdAt)}
                          </span>
                          <Badge variant={statusVariant(run.status)}>
                            {statusLabels[run.status]}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          poussés {run.pushedCount} · reçus {run.pulledCount} · erreurs{' '}
                          {run.failedCount}
                          {run.errorCode ? ` · ${run.errorCode}` : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Link2 className="h-4 w-4" /> Liens de réservations
                </CardTitle>
                <CardDescription>
                  Une association explicite entre une réservation Sokar et une référence partenaire.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {selectedLinks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucun lien associé.</p>
                ) : (
                  <div className="space-y-2">
                    {selectedLinks.slice(0, 12).map((link) => (
                      <div
                        key={link.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-border p-3 text-sm"
                      >
                        <span>
                          Réservation {link.reservationId} · partenaire •••• {link.externalIdLast4}
                        </span>
                        <Badge variant={statusVariant(link.status)}>
                          {statusLabels[link.status]}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Webhook className="h-4 w-4" /> Webhooks
                </CardTitle>
                <CardDescription>
                  Enveloppes hachées reçues pour préparer un contrat signé. Les callbacks publics ne
                  sont pas encore exposés.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {selectedWebhooks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucun webhook reçu.</p>
                ) : (
                  <div className="space-y-2">
                    {selectedWebhooks.slice(0, 12).map((webhook) => (
                      <div key={webhook.id} className="rounded-xl border border-border p-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{webhook.eventType}</span>
                          <Badge variant={statusVariant(webhook.status)}>
                            {statusLabels[webhook.status]}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          reçu {formatDate(webhook.receivedAt)} · payload{' '}
                          {webhook.payloadHash.slice(0, 12)}…
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="flex items-start gap-3 p-5 text-sm text-muted-foreground">
              <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p>
                État de la preuve : fondation locale livrée. Il manque encore l’adaptateur choisi,
                l’authentification signée, le mapping de disponibilité et un pilote observé avant
                toute ouverture du canal en production.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
