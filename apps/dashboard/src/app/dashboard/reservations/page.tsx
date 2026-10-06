'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useApi } from '../../../lib/api';
import {
  getErrorMessage,
  type Reservation,
  type ReservationState,
  type WaitingListEntry,
  type WaitingListStatus,
} from '@/types/api';
import { useIsMobile } from '@/lib/useMediaQuery';
import { cn } from '@/lib/utils';
import MobileDataCard from '@/components/MobileDataCard';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CalendarCheck, CalendarDays, ListOrdered } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataFetchError } from '@/components/DataFetchError';

const reservationState = (reservation: Reservation): ReservationState =>
  reservation.state ?? reservation.status;

const isActiveForTable = (state: ReservationState | string) =>
  state === 'PENDING' || state === 'CONFIRMED' || state === 'SEATED';

type ReservationAction = 'confirm' | 'allocate' | 'seat' | 'honor' | 'cancel' | 'no-show';

function actionsForReservation(reservation: Reservation): {
  primary: ReservationAction | null;
  secondary: ReservationAction[];
} {
  const state = reservationState(reservation);
  if (state === 'PENDING') return { primary: 'confirm', secondary: ['cancel'] };
  if (state === 'CONFIRMED') {
    return {
      primary: reservation.tableId ? 'seat' : 'allocate',
      secondary: [
        'cancel',
        ...(new Date(reservation.reservedAt) <= new Date() ? ['no-show' as const] : []),
      ],
    };
  }
  if (state === 'SEATED') {
    return { primary: 'honor', secondary: ['no-show'] };
  }
  return { primary: null, secondary: [] };
}

const actionLabels: Record<ReservationAction, string> = {
  confirm: 'Confirmer',
  allocate: 'Allouer',
  seat: 'Installer',
  honor: 'Terminer le service',
  cancel: 'Annuler',
  'no-show': 'Marquer absent',
};

type Tab = 'reservations' | 'waiting-list';

type WaitingListApiEntry = WaitingListEntry & {
  preferredSection?: { name: string } | null;
};

function mapWaitingListEntries(data: unknown[]): WaitingListEntry[] {
  return data.map((item) => {
    const entry = item as WaitingListApiEntry;
    return {
      ...entry,
      preferredSectionName: entry.preferredSectionName ?? entry.preferredSection?.name ?? null,
    };
  });
}

export default function ReservationsPage() {
  const { get, post, patch, del, orgId } = useApi();
  const isMobile = useIsMobile();

  const [activeTab, setActiveTab] = useState<Tab>('reservations');

  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);

  const [waitingList, setWaitingList] = useState<WaitingListEntry[]>([]);
  const [waitingListLoading, setWaitingListLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingCancelId, setPendingCancelId] = useState<string | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);

  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [entryErrors, setEntryErrors] = useState<Record<string, string>>({});
  const [promotedEntryId, setPromotedEntryId] = useState<string | null>(null);

  const fetchReservations = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError('');
    try {
      const data = await get<Reservation[]>(`reservations?restaurantId=${orgId}&limit=100`);
      setReservations(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de charger les réservations'));
    } finally {
      setLoading(false);
    }
  }, [get, orgId]);

  useEffect(() => {
    void fetchReservations();
  }, [fetchReservations]);

  const loadWaitingList = useCallback(async () => {
    if (!orgId) return;
    setWaitingListLoading(true);
    setError('');
    try {
      const date = format(selectedDate, 'yyyy-MM-dd');
      const data = await get<unknown[]>(`restaurants/${orgId}/waiting-list?date=${date}`);
      setWaitingList(mapWaitingListEntries(Array.isArray(data) ? data : []));
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Impossible de charger la file d'attente"));
    } finally {
      setWaitingListLoading(false);
    }
  }, [orgId, get, selectedDate]);

  useEffect(() => {
    if (activeTab !== 'waiting-list') return;
    loadWaitingList();
  }, [activeTab, loadWaitingList]);

  async function updateStatus(id: string, newStatus: Reservation['status']) {
    if (pendingActionId) return;
    setPendingActionId(id);
    try {
      setError('');
      const updated = await patch<Reservation>(`reservations/${id}`, { status: newStatus });
      setReservations((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de mettre à jour le statut'));
    } finally {
      setPendingActionId(null);
    }
  }

  async function transitionState(id: string, state: 'SEATED' | 'HONORED') {
    if (pendingActionId || !orgId) return;
    setPendingActionId(id);
    setError('');
    try {
      await patch<void>(`restaurants/${orgId}/floor-plan/reservations/${id}/state`, { state });
      setReservations((prev) =>
        prev.map((reservation) =>
          reservation.id === id
            ? { ...reservation, state, status: state === 'SEATED' ? 'SEATED' : reservation.status }
            : reservation,
        ),
      );
      try {
        const data = await get<Reservation[]>(`reservations?restaurantId=${orgId}&limit=100`);
        setReservations(Array.isArray(data) ? data : []);
      } catch {
        setError('Statut mis à jour, mais la liste n’a pas pu être actualisée.');
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de mettre à jour la réservation'));
    } finally {
      setPendingActionId(null);
    }
  }

  function runReservationAction(reservation: Reservation, action: ReservationAction) {
    if (pendingActionId) return;
    if (action === 'confirm') return void updateStatus(reservation.id, 'CONFIRMED');
    if (action === 'allocate') return void allocateTable(reservation.id);
    if (action === 'seat') return void transitionState(reservation.id, 'SEATED');
    if (action === 'honor') return void transitionState(reservation.id, 'HONORED');
    if (action === 'cancel') {
      setPendingCancelId(reservation.id);
      setConfirmOpen(true);
      return;
    }
    if (action === 'no-show') return void updateStatus(reservation.id, 'NO_SHOW');
  }

  async function confirmCancelReservation() {
    if (!pendingCancelId || pendingActionId) return;
    const id = pendingCancelId;
    setPendingActionId(id);
    try {
      setError('');
      const updated = await patch<Reservation>(`reservations/${id}`, { status: 'CANCELLED' });
      setReservations((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible d’annuler la réservation'));
    } finally {
      setConfirmOpen(false);
      setPendingCancelId(null);
      setPendingActionId(null);
    }
  }

  async function allocateTable(id: string) {
    if (pendingActionId) return;
    setPendingActionId(id);
    setError('');
    try {
      const updated = await post<Reservation>(`reservations/${id}/allocate-table`);
      setReservations((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible d’allouer une table'));
    } finally {
      setPendingActionId(null);
    }
  }

  async function promoteEntry(entry: WaitingListEntry) {
    setPromotingId(entry.id);
    setPromotedEntryId(null);
    setEntryErrors((prev) => {
      const next = { ...prev };
      delete next[entry.id];
      return next;
    });
    try {
      await post(`restaurants/${orgId}/waiting-list/${entry.id}/promote`);
      setPromotedEntryId(entry.id);
      await loadWaitingList();
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Impossible de proposer une table');
      if (msg === 'no_compatible_table' || msg.includes('no_compatible_table')) {
        setEntryErrors((prev) => ({ ...prev, [entry.id]: 'Aucune table compatible' }));
      } else {
        setError(msg);
      }
    } finally {
      setPromotingId(null);
    }
  }

  async function removeEntry(entry: WaitingListEntry) {
    setRemovingId(entry.id);
    setError('');
    try {
      await del(`restaurants/${orgId}/waiting-list/${entry.id}`);
      setWaitingList((prev) => prev.filter((e) => e.id !== entry.id));
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Impossible de retirer l'entrée"));
    } finally {
      setRemovingId(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-36 rounded-full" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Réservations</h1>
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-xl border border-border bg-secondary p-1">
            <button
              onClick={() => {
                setActiveTab('reservations');
                setError('');
              }}
              className={cn(
                'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200',
                activeTab === 'reservations'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <CalendarDays size={16} />
              Réservations
            </button>
            <button
              onClick={() => {
                setActiveTab('waiting-list');
                setError('');
              }}
              className={cn(
                'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200',
                activeTab === 'waiting-list'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <ListOrdered size={16} />
              File d&apos;attente
            </button>
          </div>
          <span className="text-sm text-muted-foreground">
            {activeTab === 'reservations'
              ? `${reservations.length} réservation${reservations.length > 1 ? 's' : ''}`
              : `${waitingList.length} en attente${waitingList.length > 1 ? 's' : ''}`}
          </span>
        </div>
      </div>

      {error && (
        <DataFetchError
          message={error}
          onRetry={activeTab === 'waiting-list' ? loadWaitingList : fetchReservations}
          retrying={activeTab === 'waiting-list' ? waitingListLoading : loading}
        />
      )}

      {activeTab === 'reservations' && (
        <>
          {reservations.length === 0 ? (
            error ? null : (
              <div className="sokar-empty">
                <CalendarCheck size={40} className="opacity-30" />
                <p className="text-sm">Aucune réservation pour le moment</p>
                <p className="text-xs opacity-60">
                  Les réservations prises par votre assistant apparaîtront ici.
                </p>
                <Button asChild size="sm" variant="outline" className="mt-1">
                  <Link href="/dashboard/widget">Ouvrir le widget</Link>
                </Button>
              </div>
            )
          ) : isMobile ? (
            /* ========== MOBILE: Reservation Card List ========== */
            <div className="space-y-2.5">
              {reservations.map((res) =>
                (() => {
                  const state = reservationState(res);
                  const available = actionsForReservation(res);
                  return (
                    <MobileDataCard
                      key={res.id}
                      title={res.customerName}
                      subtitle={res.customerPhone || undefined}
                      badge={<StatusBadge status={state} />}
                      accentClass={
                        state === 'CONFIRMED'
                          ? 'border-l-success'
                          : state === 'CANCELLED'
                            ? 'border-l-destructive'
                            : state === 'SEATED'
                              ? 'border-l-brand'
                              : 'border-l-border'
                      }
                      primaryAction={
                        available.primary
                          ? {
                              label:
                                pendingActionId === res.id
                                  ? 'En cours…'
                                  : actionLabels[available.primary],
                              disabled: pendingActionId !== null,
                              onClick: () => runReservationAction(res, available.primary!),
                            }
                          : undefined
                      }
                      actions={available.secondary.map((action) => ({
                        label: actionLabels[action],
                        colorClass: 'bg-secondary text-secondary-foreground',
                        onClick: () => runReservationAction(res, action),
                      }))}
                      details={[
                        {
                          label: 'Heure · date',
                          value: (
                            <>
                              <span className="font-semibold tabular-nums text-foreground">
                                {format(new Date(res.reservedAt), 'HH:mm')}
                              </span>
                              <span>
                                {' · '}
                                {format(new Date(res.reservedAt), 'dd MMM yyyy', { locale: fr })}
                              </span>
                            </>
                          ),
                        },
                        {
                          label: 'Couverts',
                          value: <span className="tabular-nums">{res.partySize} pers.</span>,
                        },
                        {
                          label: 'Table',
                          value: res.tableId ? (
                            (res.table?.name ?? '—')
                          ) : isActiveForTable(state) ? (
                            <Badge className="whitespace-nowrap border-warning bg-warning text-warning-foreground">
                              Sans table
                            </Badge>
                          ) : (
                            '—'
                          ),
                        },
                        {
                          label: 'Revenu estimé',
                          value: res.estimatedRevenue ? (
                            <span className="tabular-nums">{res.estimatedRevenue}€</span>
                          ) : (
                            '—'
                          ),
                        },
                      ]}
                    />
                  );
                })(),
              )}
            </div>
          ) : (
            /* ========== DESKTOP: Reservation Table ========== */
            <div className="sokar-card overflow-hidden">
              <div className="mobile-table-wrapper">
                <Table className="[&_th]:px-2 [&_td]:px-2">
                  <TableHeader>
                    <TableRow className="bg-muted/20 hover:bg-muted/20">
                      <TableHead className="min-w-[104px]">Heure · date</TableHead>
                      <TableHead className="min-w-[150px]">Client</TableHead>
                      <TableHead className="w-[92px] text-center">Couverts</TableHead>
                      <TableHead className="hidden min-w-[118px] xl:table-cell">
                        Revenu estimé
                      </TableHead>
                      <TableHead className="min-w-[112px]">Statut</TableHead>
                      <TableHead className="min-w-[96px]">Table</TableHead>
                      <TableHead className="min-w-[196px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reservations.map((res) => (
                      <TableRow
                        key={res.id}
                        className="transition-all duration-200 hover:bg-accent"
                      >
                        {(() => {
                          const state = reservationState(res);
                          return (
                            <>
                              <TableCell className="py-3">
                                <div className="flex flex-col gap-0.5">
                                  <time
                                    dateTime={res.reservedAt}
                                    className="text-sm font-semibold tabular-nums text-foreground"
                                  >
                                    {format(new Date(res.reservedAt), 'HH:mm')}
                                  </time>
                                  <span className="text-xs text-muted-foreground">
                                    {format(new Date(res.reservedAt), 'dd MMM yyyy', {
                                      locale: fr,
                                    })}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="max-w-[220px] py-3">
                                <div className="min-w-0">
                                  <p className="truncate font-medium" title={res.customerName}>
                                    {res.customerName}
                                  </p>
                                  {res.customerPhone ? (
                                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                      {res.customerPhone}
                                    </p>
                                  ) : null}
                                </div>
                              </TableCell>
                              <TableCell className="py-3 text-center font-medium tabular-nums">
                                {res.partySize}
                              </TableCell>
                              <TableCell className="hidden py-3 text-muted-foreground tabular-nums xl:table-cell">
                                {res.estimatedRevenue ? (
                                  `${res.estimatedRevenue}€`
                                ) : (
                                  <span className="opacity-50">—</span>
                                )}
                              </TableCell>
                              <TableCell className="py-3">
                                <StatusBadge status={state} />
                              </TableCell>
                              <TableCell className="py-3">
                                {res.tableId ? (
                                  (res.table?.name ?? '—')
                                ) : isActiveForTable(state) ? (
                                  <div className="flex items-center gap-2">
                                    <Badge className="whitespace-nowrap border-warning bg-warning text-warning-foreground">
                                      Sans table
                                    </Badge>
                                  </div>
                                ) : (
                                  '—'
                                )}
                              </TableCell>
                              <TableCell className="py-3 text-right">
                                {(() => {
                                  const available = actionsForReservation(res);
                                  return (
                                    <div className="flex items-center justify-end gap-2">
                                      {available.primary && (
                                        <Button
                                          size="sm"
                                          disabled={pendingActionId !== null}
                                          onClick={() =>
                                            runReservationAction(res, available.primary!)
                                          }
                                          className="transition-all duration-200"
                                        >
                                          {pendingActionId === res.id
                                            ? 'En cours…'
                                            : actionLabels[available.primary]}
                                        </Button>
                                      )}
                                      {available.secondary.length > 0 && (
                                        <Select
                                          onValueChange={(value) =>
                                            runReservationAction(res, value as ReservationAction)
                                          }
                                          disabled={pendingActionId !== null}
                                        >
                                          <SelectTrigger
                                            aria-label={`Autres actions pour ${res.customerName}`}
                                            className="h-8 w-[105px] bg-transparent text-xs"
                                          >
                                            <SelectValue placeholder="Autres" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {available.secondary.map((action) => (
                                              <SelectItem key={action} value={action}>
                                                {actionLabels[action]}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      )}
                                    </div>
                                  );
                                })()}
                              </TableCell>
                            </>
                          );
                        })()}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === 'waiting-list' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <label htmlFor="waiting-list-date" className="text-sm font-medium">
              Date
            </label>
            <Input
              id="waiting-list-date"
              type="date"
              value={format(selectedDate, 'yyyy-MM-dd')}
              onChange={(e) => setSelectedDate(parseISO(e.target.value))}
              className="w-auto transition-all duration-200"
            />
          </div>

          {waitingListLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-12 w-full rounded-xl" />
              ))}
            </div>
          ) : waitingList.length === 0 ? (
            error ? null : (
              <div className="sokar-empty">
                <ListOrdered size={40} className="opacity-30" />
                <p className="text-sm">Aucune entrée en file d&apos;attente pour cette date</p>
                <p className="text-xs opacity-60">
                  Les demandes en attente apparaîtront ici dès qu&apos;un créneau est plein.
                </p>
              </div>
            )
          ) : (
            <div className="sokar-card overflow-hidden">
              <div className="mobile-table-wrapper">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Position</TableHead>
                      <TableHead>Nom</TableHead>
                      <TableHead>Téléphone</TableHead>
                      <TableHead>Couverts</TableHead>
                      <TableHead>Créneau</TableHead>
                      <TableHead>Section</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {waitingList.map((entry) => (
                      <TableRow
                        key={entry.id}
                        className="transition-all duration-200 hover:bg-accent"
                      >
                        <TableCell className="font-medium">#{entry.position}</TableCell>
                        <TableCell>
                          {`${entry.customerFirstName} ${entry.customerLastName ?? ''}`.trim()}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {entry.customerPhone}
                        </TableCell>
                        <TableCell>{entry.partySize}</TableCell>
                        <TableCell>
                          {format(new Date(entry.slotStart), 'dd MMM HH:mm', { locale: fr })}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {entry.preferredSectionName || <span className="opacity-50">—</span>}
                        </TableCell>
                        <TableCell>
                          <WaitingListStatusBadge status={entry.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            {entry.status === 'PENDING' && (
                              <Button
                                size="sm"
                                disabled={promotingId === entry.id}
                                onClick={() => promoteEntry(entry)}
                              >
                                {promotingId === entry.id ? 'Proposition...' : 'Proposer une table'}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={removingId === entry.id}
                              onClick={() => removeEntry(entry)}
                            >
                              Retirer
                            </Button>
                          </div>
                          {promotedEntryId === entry.id && (
                            <p className="mt-1 text-xs text-success">Table proposée avec succès</p>
                          )}
                          {entryErrors[entry.id] && (
                            <p className="mt-1 text-xs text-destructive">{entryErrors[entry.id]}</p>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        pending={pendingActionId === pendingCancelId && pendingCancelId !== null}
        onConfirm={confirmCancelReservation}
        onCancel={() => {
          setConfirmOpen(false);
          setPendingCancelId(null);
        }}
        title="Annuler la réservation"
        description="Cette réservation passera au statut Annulée. Son historique restera conservé."
        confirmLabel="Annuler la réservation"
        variant="destructive"
      />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'CONFIRMED':
      return (
        <Badge className="border-primary/20 bg-secondary text-foreground hover:bg-accent">
          Confirmée
        </Badge>
      );
    case 'CANCELLED':
      return <Badge variant="destructive">Annulée</Badge>;
    case 'SEATED':
      return (
        <Badge className="border-border bg-secondary text-secondary-foreground hover:bg-accent">
          Installée
        </Badge>
      );
    case 'NO_SHOW':
      return <Badge variant="secondary">No-show</Badge>;
    case 'HONORED':
      return <Badge variant="secondary">Terminée</Badge>;
    case 'FAILED':
      return <Badge variant="secondary">Échouée</Badge>;
    case 'EXPIRED':
      return <Badge variant="secondary">Expirée</Badge>;
    case 'PENDING':
      return (
        <Badge className="bg-warning text-warning-foreground border-warning">En attente</Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function WaitingListStatusBadge({ status }: { status: WaitingListStatus }) {
  switch (status) {
    case 'PENDING':
      return (
        <Badge className="bg-warning text-warning-foreground border-warning">En attente</Badge>
      );
    case 'PROMOTED':
      return <Badge className="bg-success text-success-foreground border-success">Promue</Badge>;
    case 'CANCELLED':
      return <Badge variant="destructive">Annulée</Badge>;
    case 'EXPIRED':
      return <Badge variant="secondary">Expirée</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}
