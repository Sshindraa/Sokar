'use client';

import { useCallback, useEffect, useState } from 'react';
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
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { cn } from '@/lib/utils';

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

const OUTCOME_LABELS: Record<string, string> = {
  RESERVED: 'Réservation prise',
  INFO: 'Information donnée',
  NO_ACTION: 'Sans suite',
  HANDOFF: 'Transféré',
  ERROR: 'Erreur',
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

export default function AdminHealthPage() {
  const { get } = useApi();

  const [loadingList, setLoadingList] = useState(true);
  const [restaurants, setRestaurants] = useState<RestaurantListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [health, setHealth] = useState<RestaurantHealth | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setLoadingHealth(true);
      setError(null);
      try {
        const res = await get<{ ok: boolean; health: RestaurantHealth }>(
          `admin/restaurants/${restaurantId}/health`,
        );
        setHealth(res.health);
      } catch (err: unknown) {
        setHealth(null);
        setError(
          err instanceof Error
            ? err.message
            : 'Erreur lors du chargement de la santé du restaurant',
        );
      } finally {
        setLoadingHealth(false);
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
        <div className="flex items-center gap-2">
          <Select value={selectedId ?? undefined} onValueChange={setSelectedId}>
            <SelectTrigger className="w-64" aria-label="Choisir un restaurant">
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
                  <Badge variant="outline">{health.phone.provisioningStatus}</Badge>
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
                          ? (OUTCOME_LABELS[health.lastCall.outcome] ?? health.lastCall.outcome)
                          : 'Sans outcome'}
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
                      <Badge variant="outline">{health.lastReservation.status}</Badge>
                      <Badge variant="outline">{health.lastReservation.channel}</Badge>
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
    </div>
  );
}
