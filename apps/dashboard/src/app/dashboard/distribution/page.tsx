'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Info, MoreHorizontal, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { StatusBadge, type StatusLevel } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataFetchError } from '@/components/DataFetchError';
import { FeatureLockCard } from '@/components/FeatureLockCard';
import { useApi } from '@/lib/api';
import { featureLockFromError, type FeatureLock } from '@/lib/api-error';
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

const directionLabels: Record<SyncDirection, string> = {
  BIDIRECTIONAL: 'Dans les deux sens',
  PUSH: 'Vers le partenaire',
  PULL: 'Depuis le partenaire',
};

/** Code d'erreur de synchronisation → phrase lisible ; un code inconnu ne fuite jamais à l'écran. */
function syncErrorLabel(code: string | null): string {
  if (!code) return '';
  return 'Synchronisation interrompue';
}

const webhookEventLabels: Record<string, string> = {
  'reservation.created': 'Nouvelle réservation',
  'reservation.updated': 'Réservation modifiée',
  'reservation.cancelled': 'Annulation',
  'reservation.canceled': 'Annulation',
};

function webhookEventLabel(eventType: string): string {
  return webhookEventLabels[eventType] ?? 'Événement partenaire';
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

// Niveau par sens : actif = en cours ; succès = terminé ; à vérifier ou en attente = action ; erreur ou annulé = erreur.
function statusLevel(
  status: ConnectionStatus | SyncStatus | LinkStatus | WebhookStatus,
): StatusLevel {
  if (status === 'SUCCEEDED' || status === 'PROCESSED') return 'done';
  if (status === 'ACTIVE' || status === 'QUEUED' || status === 'RUNNING' || status === 'RECEIVED') {
    return 'progress';
  }
  if (status === 'PENDING' || status === 'NEEDS_REVIEW') return 'action';
  if (status === 'ERROR' || status === 'FAILED' || status === 'CANCELLED') return 'error';
  return 'neutral';
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
  // Échec du chargement (ou module fermé) : on n'affiche ni formulaire ni listes vides.
  const [loadError, setLoadError] = useState('');
  const [lock, setLock] = useState<FeatureLock | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [connectionForm, setConnectionForm] = useState({
    provider: 'GOOGLE_RESERVE' as Provider,
    externalAccountId: '',
    credentialReference: '',
  });
  const [direction, setDirection] = useState<SyncDirection>('BIDIRECTIONAL');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    setLock(null);
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
      setLock(featureLockFromError(err));
      setLoadError(getErrorMessage(err, 'Impossible de charger les canaux partenaires.'));
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
  const selectedRuns = runs.filter((run) => run.connectionId === selectedConnectionId);
  const selectedLinks = links.filter((link) => link.connectionId === selectedConnectionId);
  const selectedWebhooks = webhooks.filter(
    (webhook) => webhook.connectionId === selectedConnectionId,
  );

  async function createConnection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
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
      toast.success('Connexion enregistrée. Aucun partenaire n’a été contacté pour le moment.');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Impossible d’enregistrer la connexion'));
    } finally {
      setBusy(false);
    }
  }

  async function disconnectConnection() {
    if (!selectedConnection) return;
    setBusy(true);
    try {
      await post(`distribution/connections/${selectedConnection.id}/disconnect`);
      toast.success('Connexion déconnectée. L’historique reste consultable.');
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Impossible de déconnecter la connexion'));
    } finally {
      setBusy(false);
      setDisconnectOpen(false);
    }
  }

  async function queueSync() {
    if (!selectedConnection) return;
    setBusy(true);
    try {
      await post(
        `distribution/connections/${selectedConnection.id}/sync-runs`,
        { direction },
        { headers: { 'Idempotency-Key': `dashboard-distribution-${Date.now()}` } },
      );
      toast.success('Synchronisation programmée.');
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Impossible de lancer la synchronisation.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Distribution</h1>
          <Badge variant="secondary">Pro</Badge>
          <InfoTip label="Précision sur la distribution">
            Aucun partenaire n’est contacté tant que le canal n’est pas ouvert sur votre compte.
            Phase pilote : ouvert à tous les établissements après validation.
          </InfoTip>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading || busy}>
          <RefreshCw className="h-4 w-4" />
          Actualiser
        </Button>
      </div>

      {lock ? (
        <FeatureLockCard lock={lock} feature="Distribution" />
      ) : loadError ? (
        <DataFetchError message={loadError} onRetry={() => void load()} retrying={loading} />
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-1.5 text-base">
                  Connexions
                  <InfoTip label="Précision sur les identifiants">
                    Une connexion par partenaire et par établissement. Vos identifiants ne sont
                    jamais affichés en entier.
                  </InfoTip>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <details className="group rounded-lg border border-border">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3 text-sm font-medium transition-all duration-200 [&::-webkit-details-marker]:hidden">
                    Ajouter une connexion
                    <ChevronDown className="h-4 w-4 text-muted-foreground transition-all duration-200 group-open:rotate-180" />
                  </summary>
                  <form
                    className="grid gap-3 border-t border-border p-3"
                    onSubmit={createConnection}
                  >
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="distribution-provider">Partenaire</Label>
                        <select
                          id="distribution-provider"
                          value={connectionForm.provider}
                          onChange={(event) =>
                            setConnectionForm({
                              ...connectionForm,
                              provider: event.target.value as Provider,
                            })
                          }
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        >
                          {Object.entries(providerLabels).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="distribution-account">Identifiant chez le partenaire</Label>
                        <Input
                          id="distribution-account"
                          value={connectionForm.externalAccountId}
                          onChange={(event) =>
                            setConnectionForm({
                              ...connectionForm,
                              externalAccountId: event.target.value,
                            })
                          }
                          placeholder="Fourni par le partenaire"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="distribution-credential">Référence d’accès</Label>
                        <Input
                          id="distribution-credential"
                          value={connectionForm.credentialReference}
                          onChange={(event) =>
                            setConnectionForm({
                              ...connectionForm,
                              credentialReference: event.target.value,
                            })
                          }
                          placeholder="Fournie par l’équipe Sokar"
                        />
                      </div>
                    </div>
                    <Button type="submit" disabled={busy} className="w-full sm:w-auto">
                      Enregistrer la connexion
                    </Button>
                  </form>
                </details>

                {loading ? (
                  <LoadingRows />
                ) : connections.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucune connexion préparée.</p>
                ) : (
                  <div className="space-y-2">
                    {connections.map((connection) => (
                      <button
                        type="button"
                        key={connection.id}
                        onClick={() => setSelectedConnectionId(connection.id)}
                        className={`w-full rounded-xl border p-3 text-left transition-all duration-200 ${
                          connection.id === selectedConnectionId
                            ? 'border-foreground'
                            : 'border-border hover:bg-accent'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium">{providerLabels[connection.provider]}</span>
                          <StatusBadge level={statusLevel(connection.status)}>
                            {statusLabels[connection.status]}
                          </StatusBadge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Compte •••• {connection.externalAccountLast4 ?? '—'} · accès{' '}
                          {connection.credentialReferencePresent ? 'configuré' : 'manquant'} ·
                          dernière activité {formatDate(connection.lastSyncAt)}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-1.5 text-base">
                  Synchronisation
                  <InfoTip label="Précision sur la synchronisation">
                    Chaque synchronisation est enregistrée dans l’historique. Tant que le canal
                    n’est pas ouvert, elle reste interne.
                  </InfoTip>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {selectedConnection ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        {providerLabels[selectedConnection.provider]}
                      </span>
                      <div className="flex items-center gap-2">
                        <StatusBadge level={statusLevel(selectedConnection.status)}>
                          {statusLabels[selectedConnection.status]}
                        </StatusBadge>
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Actions de la connexion"
                              disabled={busy}
                              className="h-8 w-8 transition-all duration-200"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              className="text-destructive"
                              disabled={selectedConnection.status === 'DISCONNECTED'}
                              onSelect={() => setDisconnectOpen(true)}
                            >
                              Déconnecter
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="distribution-direction">Sens</Label>
                      <select
                        id="distribution-direction"
                        value={direction}
                        onChange={(event) => setDirection(event.target.value as SyncDirection)}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="BIDIRECTIONAL">{directionLabels.BIDIRECTIONAL}</option>
                        <option value="PUSH">{directionLabels.PUSH}</option>
                        <option value="PULL">{directionLabels.PULL}</option>
                      </select>
                    </div>
                    <Button
                      onClick={() => void queueSync()}
                      disabled={busy || selectedConnection.status === 'DISCONNECTED'}
                      className="w-full transition-all duration-200 sm:w-auto"
                    >
                      Lancer une synchronisation
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Sélectionnez une connexion.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-1.5 text-base">
                  Disponibilités reçues
                  <InfoTip label="Précision sur les disponibilités">
                    Créneaux vus chez le partenaire, à titre indicatif : Sokar reste la référence.
                  </InfoTip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <LoadingRows />
                ) : availability.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucune disponibilité reçue.</p>
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
                          Observé {formatDate(slot.observedAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Historique des synchronisations</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <LoadingRows />
                ) : selectedRuns.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucune synchronisation.</p>
                ) : (
                  <div className="space-y-2">
                    {selectedRuns.slice(0, 12).map((run) => (
                      <div key={run.id} className="rounded-xl border border-border p-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">
                            {directionLabels[run.direction]} · {formatDate(run.createdAt)}
                          </span>
                          <StatusBadge level={statusLevel(run.status)}>
                            {statusLabels[run.status]}
                          </StatusBadge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          envoyés {run.pushedCount} · reçus {run.pulledCount} · erreurs{' '}
                          {run.failedCount}
                          {run.errorCode ? ` · ${syncErrorLabel(run.errorCode)}` : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Liens de réservations</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <LoadingRows />
                ) : selectedLinks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucun lien associé.</p>
                ) : (
                  <div className="space-y-2">
                    {selectedLinks.slice(0, 12).map((link) => (
                      <div
                        key={link.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-border p-3 text-sm"
                      >
                        <span>Réservation liée · réf. partenaire •••• {link.externalIdLast4}</span>
                        <StatusBadge level={statusLevel(link.status)}>
                          {statusLabels[link.status]}
                        </StatusBadge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-1.5 text-base">
                  Notifications du partenaire
                  <InfoTip label="Précision sur les notifications">
                    Les réceptions automatiques ne sont pas encore ouvertes.
                  </InfoTip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <LoadingRows />
                ) : selectedWebhooks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucune notification reçue.</p>
                ) : (
                  <div className="space-y-2">
                    {selectedWebhooks.slice(0, 12).map((webhook) => (
                      <div key={webhook.id} className="rounded-xl border border-border p-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">
                            {webhookEventLabel(webhook.eventType)}
                          </span>
                          <StatusBadge level={statusLevel(webhook.status)}>
                            {statusLabels[webhook.status]}
                          </StatusBadge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Reçu {formatDate(webhook.receivedAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <ConfirmDialog
            open={disconnectOpen}
            title="Déconnecter cette connexion ?"
            description="Aucune synchronisation ne sera plus lancée. L’historique reste consultable."
            confirmLabel="Déconnecter"
            variant="destructive"
            pending={busy}
            onConfirm={() => void disconnectConnection()}
            onCancel={() => setDisconnectOpen(false)}
          />
        </>
      )}
    </div>
  );
}
