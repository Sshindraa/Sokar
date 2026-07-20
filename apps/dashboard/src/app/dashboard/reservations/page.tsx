'use client';

import { useEffect, useState, useCallback } from 'react';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useApi } from '../../../lib/api';
import {
  getErrorMessage,
  type Reservation,
  type ReservationStatus,
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
import {
  AlertCircle,
  CalendarCheck,
  CalendarDays,
  Check,
  LayoutGrid,
  ListOrdered,
  Trash2,
  X,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ConfirmDialog';

const isActiveForTable = (status: ReservationStatus) =>
  status === 'CONFIRMED' || status === 'SEATED';

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
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [allocatingId, setAllocatingId] = useState<string | null>(null);

  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [entryErrors, setEntryErrors] = useState<Record<string, string>>({});
  const [promotedEntryId, setPromotedEntryId] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;

    async function fetchReservations() {
      try {
        const data = await get<Reservation[]>(`reservations?restaurantId=${orgId}&limit=100`);
        setReservations(Array.isArray(data) ? data : []);
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Impossible de charger les réservations'));
      }
      setLoading(false);
    }
    fetchReservations();
  }, [orgId, get]);

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

  async function updateStatus(id: string, newStatus: string) {
    try {
      setError('');
      await patch(`reservations/${id}`, { status: newStatus });
      setReservations((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: newStatus as Reservation['status'] } : r)),
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de mettre à jour le statut'));
    }
  }

  async function deleteReservation(id: string) {
    setPendingDeleteId(id);
    setConfirmOpen(true);
  }

  async function confirmDeleteReservation() {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    setConfirmOpen(false);
    setPendingDeleteId(null);
    try {
      setError('');
      await del(`reservations/${id}`);
      setReservations((prev) => prev.filter((r) => r.id !== id));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de supprimer la réservation'));
    }
  }

  async function allocateTable(id: string) {
    setAllocatingId(id);
    setError('');
    try {
      const updated = await post<Reservation>(`reservations/${id}/allocate-table`);
      setReservations((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible d’allouer une table'));
    } finally {
      setAllocatingId(null);
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
              onClick={() => setActiveTab('reservations')}
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
              onClick={() => setActiveTab('waiting-list')}
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
        <div className="sokar-error">
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      {activeTab === 'reservations' && (
        <>
          {reservations.length === 0 ? (
            <div className="sokar-empty">
              <CalendarCheck size={40} className="opacity-30" />
              <p className="text-sm">Aucune réservation pour le moment</p>
              <p className="text-xs opacity-60">
                Les réservations prises par votre assistant apparaîtront ici.
              </p>
            </div>
          ) : isMobile ? (
            /* ========== MOBILE: Reservation Card List ========== */
            <div className="space-y-2.5">
              {reservations.map((res) => (
                <MobileDataCard
                  key={res.id}
                  title={res.customerName}
                  subtitle={res.customerPhone || undefined}
                  badge={<StatusBadge status={res.status} />}
                  accentClass={
                    res.status === 'CONFIRMED'
                      ? 'border-l-success'
                      : res.status === 'CANCELLED'
                        ? 'border-l-destructive'
                        : res.status === 'SEATED'
                          ? 'border-l-brand'
                          : 'border-l-border'
                  }
                  actions={[
                    {
                      label: 'Confirmer',
                      icon: <Check size={14} />,
                      colorClass: 'bg-success',
                      onClick: () => updateStatus(res.id, 'CONFIRMED'),
                    },
                    {
                      label: 'Annuler',
                      icon: <X size={14} />,
                      colorClass: 'bg-warning',
                      onClick: () => updateStatus(res.id, 'CANCELLED'),
                    },
                    {
                      label: 'Supprimer',
                      icon: <Trash2 size={14} />,
                      colorClass: 'bg-destructive',
                      onClick: () => deleteReservation(res.id),
                    },
                    ...(!res.tableId && isActiveForTable(res.status)
                      ? [
                          {
                            label: 'Allouer',
                            icon: <LayoutGrid size={14} />,
                            colorClass: 'bg-primary',
                            onClick: () => allocateTable(res.id),
                          },
                        ]
                      : []),
                  ]}
                  details={[
                    {
                      label: 'Date',
                      value: format(new Date(res.reservedAt), 'dd MMM HH:mm', { locale: fr }),
                    },
                    {
                      label: 'Couverts',
                      value: `${res.partySize} pers.`,
                    },
                    {
                      label: 'Table',
                      value: res.tableId ? (
                        (res.table?.name ?? '—')
                      ) : isActiveForTable(res.status) ? (
                        <Badge className="bg-warning text-warning-foreground border-warning">
                          Sans table
                        </Badge>
                      ) : (
                        '—'
                      ),
                    },
                    {
                      label: 'Revenu',
                      value: res.estimatedRevenue ? `${res.estimatedRevenue}€` : '—',
                    },
                  ]}
                />
              ))}
            </div>
          ) : (
            /* ========== DESKTOP: Reservation Table ========== */
            <div className="sokar-card overflow-hidden">
              <div className="mobile-table-wrapper">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead>Téléphone</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Couverts</TableHead>
                      <TableHead>Revenu estimé</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead>Table</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reservations.map((res) => (
                      <TableRow
                        key={res.id}
                        className="transition-all duration-200 hover:bg-accent"
                      >
                        <TableCell className="font-medium">{res.customerName}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {res.customerPhone || <span className="opacity-50">—</span>}
                        </TableCell>
                        <TableCell>
                          {format(new Date(res.reservedAt), 'dd MMM yyyy HH:mm', { locale: fr })}
                        </TableCell>
                        <TableCell>{res.partySize}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {res.estimatedRevenue ? (
                            `${res.estimatedRevenue}€`
                          ) : (
                            <span className="opacity-50">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={res.status}
                            onValueChange={(val) => updateStatus(res.id, val)}
                          >
                            <SelectTrigger className="w-[130px] h-8 bg-transparent border-border text-foreground font-sans text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-popover border-border text-popover-foreground">
                              <SelectItem value="CONFIRMED">Confirmée</SelectItem>
                              <SelectItem value="CANCELLED">Annulée</SelectItem>
                              <SelectItem value="SEATED">Installée</SelectItem>
                              <SelectItem value="NO_SHOW">No-show</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          {res.tableId ? (
                            (res.table?.name ?? '—')
                          ) : isActiveForTable(res.status) ? (
                            <div className="flex items-center gap-2">
                              <Badge className="bg-warning text-warning-foreground border-warning">
                                Sans table
                              </Badge>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={allocatingId === res.id}
                                onClick={() => allocateTable(res.id)}
                              >
                                Allouer
                              </Button>
                            </div>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <button
                            onClick={() => deleteReservation(res.id)}
                            className="p-2 text-muted-foreground hover:text-destructive rounded-lg hover:bg-accent transition-all duration-200"
                            title="Supprimer la réservation"
                          >
                            <Trash2 size={16} />
                          </button>
                        </TableCell>
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
            <div className="sokar-empty">
              <ListOrdered size={40} className="opacity-30" />
              <p className="text-sm">Aucune entrée en file d&apos;attente pour cette date</p>
              <p className="text-xs opacity-60">
                Les demandes en attente apparaîtront ici dès qu&apos;un créneau est plein.
              </p>
            </div>
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
        onConfirm={confirmDeleteReservation}
        onCancel={() => {
          setConfirmOpen(false);
          setPendingDeleteId(null);
        }}
        title="Supprimer la réservation"
        description="Êtes-vous sûr de vouloir supprimer cette réservation ? Cette action est irréversible."
        confirmLabel="Supprimer"
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
