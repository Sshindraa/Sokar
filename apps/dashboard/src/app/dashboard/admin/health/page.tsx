'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Building2,
  CalendarCheck,
  CheckCircle2,
  Loader2,
  MessageSquareText,
  Phone,
  PhoneCall,
  RefreshCw,
  ServerCog,
  Wrench,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useApi } from '@/lib/api';
import { ApiError } from '@/lib/api-error';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/types/api';

interface RestaurantListItem {
  restaurantId: string;
  restaurantName: string;
}

interface WorkerState {
  queue: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  paused: number;
  status: 'ok' | 'error';
}

interface RestaurantHealth {
  restaurant: { id: string; name: string; slug: string | null };
  phone: {
    number: string;
    carrier: string | null;
    provisioningStatus: string;
    telnyxPhoneNumberId: string | null;
    forwardingConfiguredAt: string | null;
    testCallValidatedAt: string | null;
    firstCallAt: string | null;
    smsConfirmEnabled: boolean;
  };
  lastCall: {
    callSid: string;
    at: string;
    durationSec: number | null;
    outcome: string | null;
    hasTranscript: boolean;
  } | null;
  lastReservation: {
    id: string;
    customerName: string;
    partySize: number;
    reservedAt: string;
    createdAt: string;
    status: string;
    state?: string;
    channel: string;
  } | null;
  lastSms: {
    kind: string;
    at: string;
    reservationId: string | null;
    customerName: string | null;
  } | null;
  workers: WorkerState[];
  generatedAt: string;
}

interface ProjectionRepairPreview {
  changed: boolean;
  reservationCount: number;
}

interface ProjectionRepairResult {
  changed: boolean;
  reservationCount: number;
  replayed?: boolean;
}

const OUTCOME_LABELS: Record<string, string> = {
  RESERVED: 'Réservation prise',
  INFO: 'Information donnée',
  NO_ACTION: 'Sans suite',
  HANDOFF: 'Transféré',
  ERROR: 'Erreur',
};

const PROVISIONING_LABELS: Record<string, string> = {
  PENDING: 'En attente de numéro',
  PHONE_ASSIGNED: 'Numéro attribué',
  WEBHOOK_READY: 'Webhook prêt',
  FORWARDING_CONFIGURED: 'Renvoi configuré',
  TEST_CALL_VALIDATED: 'Appel test validé',
  LIVE: 'En service',
  READY: 'Prêt',
};
const RESERVATION_STATE_LABELS: Record<string, string> = {
  PENDING: 'En attente',
  CONFIRMED: 'Confirmée',
  SEATED: 'Installée',
  HONORED: 'Honorée',
  CANCELLED: 'Annulée',
  NO_SHOW: 'Absent',
};
const CHANNEL_LABELS: Record<string, string> = {
  PHONE: 'Téléphone',
  WEB: 'En ligne',
  WIDGET: 'Widget',
  GOOGLE: 'Google',
  AI: 'Assistant IA',
  MCP: 'Assistant IA',
  STAFF: 'Équipe',
  DASHBOARD: 'Équipe',
};

const SMS_KIND_LABELS: Record<string, string> = {
  reservation_confirmation_sms_sent: 'SMS de confirmation',
  reminder_j1: 'Rappel J-1',
};

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function EmptyHint({ children }: { children: string }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function reservationCount(n: number): string {
  return n === 1 ? '1 réservation' : `${n} réservations`;
}

function repairErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status === 404) {
    return 'Client introuvable dans ce restaurant.';
  }
  return getErrorMessage(err, fallback);
}

export default function AdminHealthPage() {
  const { get, post } = useApi();

  const [loadingList, setLoadingList] = useState(true);
  const [restaurants, setRestaurants] = useState<RestaurantListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [health, setHealth] = useState<RestaurantHealth | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const healthRequestId = useRef(0);
  const [error, setError] = useState<string | null>(null);

  const [customerId, setCustomerId] = useState('');
  const [preview, setPreview] = useState<ProjectionRepairPreview | null>(null);
  const [repaired, setRepaired] = useState<ProjectionRepairResult | null>(null);
  const [repairBusy, setRepairBusy] = useState<'preview' | 'repair' | null>(null);
  const [repairError, setRepairError] = useState<string | null>(null);
  // Incrémenté à chaque réinitialisation : une réponse tardive ne doit pas écraser le nouvel état.
  const repairRun = useRef(0);

  const resetRepair = useCallback(() => {
    repairRun.current += 1;
    setPreview(null);
    setRepaired(null);
    setRepairError(null);
    setRepairBusy(null);
  }, []);

  const fetchRestaurants = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const res = await get<{ ok: boolean; restaurants: RestaurantListItem[] }>(
        'admin/provisioning/restaurants',
      );
      const list = res.restaurants ?? [];
      setRestaurants(list);
      if (list.length > 0) {
        setSelectedId((current) => current ?? list[0].restaurantId);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur lors du chargement des restaurants');
    } finally {
      setLoadingList(false);
    }
  }, [get]);

  const fetchHealth = useCallback(
    async (restaurantId: string) => {
      const requestId = ++healthRequestId.current;
      setLoadingHealth(true);
      setError(null);
      // La santé de l'ancien restaurant ne reste pas affichée sous le nom du nouveau.
      setHealth(null);
      try {
        const res = await get<{ ok: boolean; health: RestaurantHealth }>(
          `admin/restaurants/${restaurantId}/health`,
        );
        if (requestId !== healthRequestId.current) return;
        setHealth(res.health);
      } catch (err: unknown) {
        if (requestId !== healthRequestId.current) return;
        setHealth(null);
        setError(
          err instanceof Error
            ? err.message
            : 'Erreur lors du chargement de la santé du restaurant',
        );
      } finally {
        if (requestId === healthRequestId.current) setLoadingHealth(false);
      }
    },
    [get],
  );

  useEffect(() => {
    fetchRestaurants();
  }, [fetchRestaurants]);

  useEffect(() => {
    if (selectedId) {
      fetchHealth(selectedId);
    }
  }, [selectedId, fetchHealth]);

  const checkCustomer = async () => {
    const restaurantId = selectedId;
    const id = customerId.trim();
    if (!restaurantId || !id) return;
    const run = ++repairRun.current;
    setPreview(null);
    setRepaired(null);
    setRepairError(null);
    setRepairBusy('preview');
    try {
      const res = await get<{ data: ProjectionRepairPreview }>(
        `admin/restaurants/${restaurantId}/customers/${encodeURIComponent(id)}/projection-repair-preview`,
      );
      if (run === repairRun.current) setPreview(res.data);
    } catch (err: unknown) {
      if (run === repairRun.current) {
        setRepairError(repairErrorMessage(err, 'Impossible de vérifier ce client'));
      }
    } finally {
      if (run === repairRun.current) setRepairBusy(null);
    }
  };

  const repairCustomer = async () => {
    const restaurantId = selectedId;
    const id = customerId.trim();
    if (!restaurantId || !id) return;
    const run = repairRun.current;
    setRepairBusy('repair');
    setRepairError(null);
    try {
      const res = await post<{ data: ProjectionRepairResult }>(
        `admin/restaurants/${restaurantId}/customers/${encodeURIComponent(id)}/projection-repair`,
        undefined,
        { headers: { 'Idempotency-Key': crypto.randomUUID() } },
      );
      if (run === repairRun.current) {
        setPreview(null);
        setRepaired(res.data);
      }
    } catch (err: unknown) {
      if (run === repairRun.current) {
        setRepairError(repairErrorMessage(err, 'Impossible de recalculer les chiffres'));
      }
    } finally {
      if (run === repairRun.current) setRepairBusy(null);
    }
  };

  if (loadingList) {
    return (
      <div className="flex items-center justify-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="animate-spin" size={18} />
        Chargement des restaurants…
      </div>
    );
  }

  if (restaurants.length === 0 && !error) {
    return (
      <div className="p-8">
        <EmptyHint>Aucun restaurant n’est encore provisionné.</EmptyHint>
      </div>
    );
  }

  const failedWorkers = health?.workers.filter((w) => w.failed > 0 || w.status === 'error') ?? [];

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Activity className="text-primary" size={22} />
          <div>
            <h1 className="text-xl font-semibold text-foreground">Santé du restaurant</h1>
            <p className="text-sm text-muted-foreground">
              Numéro, derniers appels, réservations, SMS et état des workers.
            </p>
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Select
            value={selectedId ?? undefined}
            onValueChange={(id) => {
              setSelectedId(id);
              setCustomerId('');
              resetRepair();
            }}
          >
            <SelectTrigger className="w-full sm:w-64" aria-label="Choisir un restaurant">
              <SelectValue placeholder="Choisir un restaurant" />
            </SelectTrigger>
            <SelectContent>
              {restaurants.map((r) => (
                <SelectItem key={r.restaurantId} value={r.restaurantId}>
                  {r.restaurantName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => selectedId && fetchHealth(selectedId)}
            disabled={loadingHealth || !selectedId}
            className="transition-all duration-200"
          >
            <RefreshCw size={14} className={cn(loadingHealth && 'animate-spin')} />
            Actualiser
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="flex items-center justify-between gap-4 p-4">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle size={16} />
              <p className="text-sm">{error}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => (selectedId ? fetchHealth(selectedId) : fetchRestaurants())}
              className="transition-all duration-200"
            >
              Réessayer
            </Button>
          </CardContent>
        </Card>
      )}

      {loadingHealth && !health && (
        <div className="flex items-center gap-2 p-6 text-muted-foreground">
          <Loader2 className="animate-spin" size={18} />
          Chargement de la santé du restaurant…
        </div>
      )}

      {health && (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {/* Numéro & provisioning */}
            <Card className="transition-all duration-200">
              <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
                <Phone size={16} className="text-primary" />
                <CardTitle className="text-sm font-medium">Numéro</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-lg font-semibold text-foreground">{health.phone.number}</p>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline">
                    {PROVISIONING_LABELS[health.phone.provisioningStatus] ?? 'Étape en cours'}
                  </Badge>
                  {health.phone.carrier && <Badge variant="outline">{health.phone.carrier}</Badge>}
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p className="flex items-center gap-1.5">
                    {health.phone.forwardingConfiguredAt ? (
                      <CheckCircle2 size={12} className="text-success" />
                    ) : (
                      <AlertCircle size={12} className="text-warning" />
                    )}
                    Renvoi d’appel{' '}
                    {health.phone.forwardingConfiguredAt
                      ? `configuré le ${formatDateTime(health.phone.forwardingConfiguredAt)}`
                      : 'non configuré'}
                  </p>
                  <p className="flex items-center gap-1.5">
                    {health.phone.testCallValidatedAt ? (
                      <CheckCircle2 size={12} className="text-success" />
                    ) : (
                      <AlertCircle size={12} className="text-warning" />
                    )}
                    Appel test{' '}
                    {health.phone.testCallValidatedAt
                      ? `validé le ${formatDateTime(health.phone.testCallValidatedAt)}`
                      : 'non validé'}
                  </p>
                  <p className="flex items-center gap-1.5">
                    {health.phone.smsConfirmEnabled ? (
                      <CheckCircle2 size={12} className="text-success" />
                    ) : (
                      <AlertCircle size={12} className="text-warning" />
                    )}
                    SMS de confirmation {health.phone.smsConfirmEnabled ? 'activés' : 'désactivés'}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Dernier appel */}
            <Card className="transition-all duration-200">
              <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
                <PhoneCall size={16} className="text-primary" />
                <CardTitle className="text-sm font-medium">Dernier appel</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {health.lastCall ? (
                  <>
                    <p className="text-lg font-semibold text-foreground">
                      {formatDateTime(health.lastCall.at)}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge
                        variant={health.lastCall.outcome === 'ERROR' ? 'destructive' : 'outline'}
                      >
                        {health.lastCall.outcome
                          ? (OUTCOME_LABELS[health.lastCall.outcome] ?? 'Autre issue')
                          : 'Issue non renseignée'}
                      </Badge>
                      {health.lastCall.durationSec !== null && (
                        <Badge variant="outline">{health.lastCall.durationSec}s</Badge>
                      )}
                    </div>
                    {!health.lastCall.hasTranscript && (
                      <p className="flex items-center gap-1.5 text-xs text-warning">
                        <AlertCircle size={12} />
                        Aucune transcription enregistrée
                      </p>
                    )}
                  </>
                ) : (
                  <EmptyHint>Aucun appel reçu pour le moment.</EmptyHint>
                )}
              </CardContent>
            </Card>

            {/* Dernière réservation */}
            <Card className="transition-all duration-200">
              <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
                <CalendarCheck size={16} className="text-primary" />
                <CardTitle className="text-sm font-medium">Dernière réservation</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {health.lastReservation ? (
                  <>
                    <p className="text-lg font-semibold text-foreground">
                      {health.lastReservation.customerName}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {health.lastReservation.partySize} couverts · le{' '}
                      {formatDateTime(health.lastReservation.reservedAt)}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="outline">
                        {RESERVATION_STATE_LABELS[
                          health.lastReservation.state ?? health.lastReservation.status
                        ] ?? 'À vérifier'}
                      </Badge>
                      <Badge variant="outline">
                        {CHANNEL_LABELS[health.lastReservation.channel.toUpperCase()] ??
                          'Autre canal'}
                      </Badge>
                    </div>
                  </>
                ) : (
                  <EmptyHint>Aucune réservation pour le moment.</EmptyHint>
                )}
              </CardContent>
            </Card>

            {/* Dernier SMS */}
            <Card className="transition-all duration-200">
              <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
                <MessageSquareText size={16} className="text-primary" />
                <CardTitle className="text-sm font-medium">Dernier SMS</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {health.lastSms ? (
                  <>
                    <p className="text-lg font-semibold text-foreground">
                      {formatDateTime(health.lastSms.at)}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="outline">
                        {SMS_KIND_LABELS[health.lastSms.kind] ?? health.lastSms.kind}
                      </Badge>
                    </div>
                    {health.lastSms.customerName && (
                      <p className="text-sm text-muted-foreground">
                        pour {health.lastSms.customerName}
                      </p>
                    )}
                  </>
                ) : (
                  <EmptyHint>Aucun SMS tracé pour le moment.</EmptyHint>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Workers */}
          <Card className="transition-all duration-200">
            <CardHeader className="flex flex-row items-center gap-2 space-y-0">
              <ServerCog size={16} className="text-primary" />
              <CardTitle className="text-sm font-medium">
                Workers{' '}
                {failedWorkers.length > 0 && (
                  <Badge variant="destructive" className="ml-2">
                    {failedWorkers.length} file(s) à vérifier
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead className="text-right">En attente</TableHead>
                    <TableHead className="text-right">Actifs</TableHead>
                    <TableHead className="text-right">Planifiés</TableHead>
                    <TableHead className="text-right">Échoués</TableHead>
                    <TableHead className="text-right">État</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {health.workers.map((w) => (
                    <TableRow key={w.queue}>
                      <TableCell className="font-medium">{w.queue}</TableCell>
                      <TableCell className="text-right">{w.waiting}</TableCell>
                      <TableCell className="text-right">{w.active}</TableCell>
                      <TableCell className="text-right">{w.delayed}</TableCell>
                      <TableCell
                        className={cn(
                          'text-right',
                          w.failed > 0 && 'font-semibold text-destructive',
                        )}
                      >
                        {w.failed}
                      </TableCell>
                      <TableCell className="text-right">
                        {w.status === 'ok' ? (
                          <Badge variant="outline" className="text-success">
                            opérationnel
                          </Badge>
                        ) : (
                          <Badge variant="destructive">inaccessible</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Building2 size={12} />
                État lu le {formatDateTime(health.generatedAt)} — commun à tous les restaurants de
                cette instance.
              </p>
            </CardContent>
          </Card>
        </>
      )}

      {selectedId && (
        <Card className="transition-all duration-200">
          <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
            <Wrench size={16} className="text-primary" />
            <CardTitle className="text-sm font-medium">
              Recalculer les chiffres d’un client
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void checkCustomer();
              }}
            >
              <Input
                aria-label="ID du client"
                placeholder="ID visible dans l’URL de la fiche"
                value={customerId}
                onChange={(e) => {
                  setCustomerId(e.target.value);
                  resetRepair();
                }}
                className="w-full sm:w-80"
              />
              <Button
                type="submit"
                variant="outline"
                size="sm"
                disabled={!customerId.trim() || repairBusy !== null}
                className="transition-all duration-200"
              >
                {repairBusy === 'preview' && <Loader2 className="animate-spin" size={14} />}
                Vérifier
              </Button>
            </form>

            {repairError && <p className="text-sm text-destructive">{repairError}</p>}

            {preview && !preview.changed && (
              <p className="text-sm text-success">
                {`Chiffres à jour (${reservationCount(preview.reservationCount)}).`}
              </p>
            )}

            {preview?.changed && (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-warning">
                  {`Écart sur ${reservationCount(preview.reservationCount)}.`}
                </p>
                <Button
                  size="sm"
                  onClick={() => void repairCustomer()}
                  disabled={repairBusy !== null}
                  className="transition-all duration-200"
                >
                  {repairBusy === 'repair' && <Loader2 className="animate-spin" size={14} />}
                  Recalculer
                </Button>
              </div>
            )}

            {repaired && (
              <p className="text-sm text-success">
                {repaired.replayed ? 'Déjà recalculé.' : 'Chiffres recalculés.'}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
