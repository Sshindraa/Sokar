'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  RefreshCw,
  ShieldAlert,
  Ticket,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi } from '@/lib/api';
import { getErrorMessage } from '@/types/api';

type EventStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
type SessionStatus = 'OPEN' | 'CLOSED' | 'CANCELLED';
type TicketTypeStatus = 'ACTIVE' | 'INACTIVE';
type OrderStatus = 'CONFIRMED' | 'CANCELLED' | 'REFUND_PENDING' | 'REFUNDED';
type TicketStatus = 'ISSUED' | 'CHECKED_IN' | 'CANCELLED' | 'REFUNDED';

type SokarEvent = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  timezone: string;
  status: EventStatus;
  sessionCount: number;
  ticketTypeCount: number;
  orderCount: number;
  waitlistCount: number;
};
type Session = {
  id: string;
  eventId: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  status: SessionStatus;
  event: { key: string; name: string; status: EventStatus };
  orderCount: number;
  ticketCount: number;
  waitlistCount: number;
};
type TicketType = {
  id: string;
  eventId: string;
  key: string;
  name: string;
  priceCents: number;
  currency: string;
  maxPerOrder: number;
  status: TicketTypeStatus;
  orderCount: number;
  ticketCount: number;
};
type Order = {
  id: string;
  eventId: string;
  sessionId: string;
  ticketTypeId: string;
  quantity: number;
  unitPriceCents: number;
  totalPriceCents: number;
  currency: string;
  status: OrderStatus;
  invoiceNumber: string | null;
  invoicedAt: string | null;
  refundedAt: string | null;
  cancelledAt: string | null;
  event: { key: string; name: string };
  session: { startsAt: string; endsAt: string };
  ticketType: { key: string; name: string; priceCents: number; currency: string };
  customerName: string | null;
  phoneLast4: string | null;
  ticketCount: number;
};
type EventTicket = {
  id: string;
  eventId: string;
  sessionId: string;
  orderId: string;
  ticketTypeId: string;
  codeLast4: string;
  status: TicketStatus;
  checkedInAt: string | null;
  event: { key: string; name: string };
  session: { startsAt: string; endsAt: string };
  ticketType: { key: string; name: string };
  customerName: string | null;
  phoneLast4: string | null;
};
type ListResponse<T> = { data?: T[] };
type MutationResponse<T> = { data?: T };

function formatEur(cents: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}
function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}
function defaultDateTime(offsetHours: number): string {
  const date = new Date(Date.now() + offsetHours * 3_600_000);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  return date.toISOString().slice(0, 16);
}
function statusLabel(
  status: EventStatus | SessionStatus | TicketTypeStatus | OrderStatus | TicketStatus,
): string {
  return {
    DRAFT: 'Brouillon',
    ACTIVE: 'Actif',
    ARCHIVED: 'Archivé',
    OPEN: 'Ouverte',
    CLOSED: 'Fermée',
    CANCELLED: 'Annulée',
    INACTIVE: 'Inactive',
    CONFIRMED: 'Confirmée',
    REFUND_PENDING: 'Remboursement en attente',
    REFUNDED: 'Remboursée',
    ISSUED: 'Émis',
    CHECKED_IN: 'Contrôlé',
  }[status];
}
function statusVariant(
  status: EventStatus | SessionStatus | TicketTypeStatus | OrderStatus | TicketStatus,
): 'default' | 'secondary' | 'destructive' {
  if (
    status === 'ACTIVE' ||
    status === 'OPEN' ||
    status === 'CONFIRMED' ||
    status === 'ISSUED' ||
    status === 'CHECKED_IN'
  )
    return 'default';
  if (
    status === 'ARCHIVED' ||
    status === 'CANCELLED' ||
    status === 'INACTIVE' ||
    status === 'REFUNDED'
  )
    return 'secondary';
  return 'destructive';
}

export default function EventsPage() {
  const { get, post, patch } = useApi();
  const [events, setEvents] = useState<SokarEvent[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [tickets, setTickets] = useState<EventTicket[]>([]);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [ticketCodes, setTicketCodes] = useState<string[]>([]);
  const [checkInCode, setCheckInCode] = useState('');
  const [eventForm, setEventForm] = useState({ key: '', name: '' });
  const [sessionForm, setSessionForm] = useState({
    startsAt: defaultDateTime(48),
    endsAt: defaultDateTime(51),
    capacity: '40',
  });
  const [ticketForm, setTicketForm] = useState({
    key: '',
    name: '',
    priceCents: '0',
    maxPerOrder: '10',
  });
  const [orderForm, setOrderForm] = useState({
    sessionId: '',
    ticketTypeId: '',
    customerId: '',
    quantity: '1',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [eventResponse, orderResponse, ticketResponse] = await Promise.all([
        get<ListResponse<SokarEvent>>('events?limit=100'),
        get<ListResponse<Order>>('event-orders?limit=100'),
        get<ListResponse<EventTicket>>('event-tickets?limit=100'),
      ]);
      const nextEvents = Array.isArray(eventResponse.data) ? eventResponse.data : [];
      setEvents(nextEvents);
      setOrders(Array.isArray(orderResponse.data) ? orderResponse.data : []);
      setTickets(Array.isArray(ticketResponse.data) ? ticketResponse.data : []);
      const nextSelected =
        selectedEventId && nextEvents.some((item) => item.id === selectedEventId)
          ? selectedEventId
          : (nextEvents.find((item) => item.status === 'ACTIVE')?.id ?? nextEvents[0]?.id ?? '');
      setSelectedEventId(nextSelected);
      if (nextSelected) {
        const [sessionResponse, ticketTypeResponse] = await Promise.all([
          get<ListResponse<Session>>(`events/${nextSelected}/sessions?limit=100`),
          get<ListResponse<TicketType>>(`events/${nextSelected}/ticket-types?limit=100`),
        ]);
        setSessions(Array.isArray(sessionResponse.data) ? sessionResponse.data : []);
        setTicketTypes(Array.isArray(ticketTypeResponse.data) ? ticketTypeResponse.data : []);
      } else {
        setSessions([]);
        setTicketTypes([]);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de charger les événements'));
      setEvents([]);
      setSessions([]);
      setTicketTypes([]);
      setOrders([]);
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [get, selectedEventId]);
  useEffect(() => {
    void load();
  }, [load]);

  const selectedEvent = events.find((item) => item.id === selectedEventId) ?? null;
  const selectedOrders = useMemo(
    () => orders.filter((item) => item.eventId === selectedEventId),
    [orders, selectedEventId],
  );
  const selectedTickets = useMemo(
    () => tickets.filter((item) => item.eventId === selectedEventId),
    [tickets, selectedEventId],
  );
  const metrics = useMemo(
    () => ({
      active: events.filter((item) => item.status === 'ACTIVE').length,
      openSessions: sessions.filter((item) => item.status === 'OPEN').length,
      confirmed: selectedOrders.filter((item) => item.status === 'CONFIRMED').length,
      checkedIn: selectedTickets.filter((item) => item.status === 'CHECKED_IN').length,
    }),
    [events, selectedOrders, selectedTickets, sessions],
  );

  async function createEvent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await post<MutationResponse<SokarEvent>>('events', eventForm);
      if (response.data) {
        setEvents((current) => [response.data!, ...current]);
        setSelectedEventId(response.data.id);
      }
      setEventForm({ key: '', name: '' });
      setNotice('Événement créé en brouillon. Aucun paiement ni canal externe n’a été activé.');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de créer l’événement'));
    } finally {
      setBusy(false);
    }
  }
  async function createSession(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEventId) return;
    setBusy(true);
    setError('');
    try {
      await post(`events/${selectedEventId}/sessions`, {
        startsAt: new Date(sessionForm.startsAt).toISOString(),
        endsAt: new Date(sessionForm.endsAt).toISOString(),
        capacity: Number(sessionForm.capacity),
      });
      setNotice('Session ajoutée.');
      await load();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de créer la session'));
    } finally {
      setBusy(false);
    }
  }
  async function createTicketType(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEventId) return;
    setBusy(true);
    setError('');
    try {
      await post(`events/${selectedEventId}/ticket-types`, {
        key: ticketForm.key,
        name: ticketForm.name,
        priceCents: Number(ticketForm.priceCents),
        maxPerOrder: Number(ticketForm.maxPerOrder),
      });
      setTicketForm({ key: '', name: '', priceCents: '0', maxPerOrder: '10' });
      setNotice('Tarif ajouté.');
      await load();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de créer le tarif'));
    } finally {
      setBusy(false);
    }
  }
  async function issueOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEventId || !orderForm.sessionId || !orderForm.ticketTypeId) return;
    setBusy(true);
    setError('');
    setTicketCodes([]);
    try {
      const response = await post<MutationResponse<Order & { ticketCodes?: string[] | null }>>(
        `events/${selectedEventId}/sessions/${orderForm.sessionId}/orders`,
        {
          ticketTypeId: orderForm.ticketTypeId,
          customerId: orderForm.customerId || undefined,
          quantity: Number(orderForm.quantity),
        },
        { headers: { 'Idempotency-Key': `dashboard-event-${Date.now()}` } },
      );
      if (response.data?.ticketCodes) setTicketCodes(response.data.ticketCodes);
      setNotice('Commande enregistrée. Conservez les codes billet affichés une seule fois.');
      await load();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible d’enregistrer la commande'));
    } finally {
      setBusy(false);
    }
  }
  async function toggleEvent() {
    if (!selectedEvent) return;
    setBusy(true);
    setError('');
    try {
      await patch(`events/${selectedEvent.id}`, {
        status: selectedEvent.status === 'ACTIVE' ? 'DRAFT' : 'ACTIVE',
      });
      await load();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de changer le statut'));
    } finally {
      setBusy(false);
    }
  }
  async function checkIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('event-tickets/check-in', { code: checkInCode });
      setCheckInCode('');
      setNotice('Billet contrôlé.');
      await load();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Code billet refusé'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">Événements</h1>
            <Badge variant="secondary">Pro</Badge>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Sessions, tarifs, billets et contrôle d’accès avec jauge partagée. Le paiement, les
            remboursements externes et la distribution restent verrouillés pendant la qualification.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading || busy}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Actualiser
        </Button>
      </div>
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm text-foreground"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
          <span>{notice}</span>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading
          ? Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-24 rounded-xl" />
            ))
          : [
              ['Événements actifs', metrics.active],
              ['Sessions ouvertes', metrics.openSessions],
              ['Commandes confirmées', metrics.confirmed],
              ['Billets contrôlés', metrics.checkedIn],
            ].map(([label, value]) => (
              <Card key={label as string}>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">{label}</p>
                  <p className="mt-2 text-2xl font-semibold">{value}</p>
                </CardContent>
              </Card>
            ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Catalogue</CardTitle>
            <CardDescription>
              Créez un événement puis activez-le lorsque ses sessions et tarifs sont prêts.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="space-y-3" onSubmit={createEvent}>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="event-key">Clé</Label>
                  <Input
                    id="event-key"
                    value={eventForm.key}
                    onChange={(e) => setEventForm({ ...eventForm, key: e.target.value })}
                    placeholder="soiree-vins"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="event-name">Nom</Label>
                  <Input
                    id="event-name"
                    value={eventForm.name}
                    onChange={(e) => setEventForm({ ...eventForm, name: e.target.value })}
                    placeholder="Soirée dégustation"
                    required
                  />
                </div>
              </div>
              <Button type="submit" disabled={busy}>
                Créer l’événement
              </Button>
            </form>
            <div className="space-y-2">
              {events.length === 0 && !loading ? (
                <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  Aucun événement.
                </p>
              ) : (
                events.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => setSelectedEventId(item.id)}
                    className={`w-full rounded-lg border p-3 text-left transition-all duration-200 ${item.id === selectedEventId ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{item.name}</span>
                      <Badge variant={statusVariant(item.status)}>{statusLabel(item.status)}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.sessionCount} session(s) · {item.ticketTypeCount} tarif(s) ·{' '}
                      {item.orderCount} commande(s)
                    </p>
                  </button>
                ))
              )}
            </div>
          </CardContent>
        </Card>
        <div className="space-y-6">
          {selectedEvent ? (
            <>
              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-3">
                  <div>
                    <CardTitle>{selectedEvent.name}</CardTitle>
                    <CardDescription>
                      Fuseau {selectedEvent.timezone}. Les jauges sont partagées entre les tarifs.
                    </CardDescription>
                  </div>
                  <Button variant="outline" onClick={() => void toggleEvent()} disabled={busy}>
                    {selectedEvent.status === 'ACTIVE' ? 'Mettre en brouillon' : 'Activer'}
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Badge variant={statusVariant(selectedEvent.status)}>
                      {statusLabel(selectedEvent.status)}
                    </Badge>
                    <span className="text-sm text-muted-foreground">{selectedEvent.key}</span>
                  </div>
                </CardContent>
              </Card>
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Session</CardTitle>
                    <CardDescription>Une session possède une jauge atomique.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form className="space-y-3" onSubmit={createSession}>
                      <div>
                        <Label htmlFor="event-start">Début</Label>
                        <Input
                          id="event-start"
                          type="datetime-local"
                          value={sessionForm.startsAt}
                          onChange={(e) =>
                            setSessionForm({ ...sessionForm, startsAt: e.target.value })
                          }
                          required
                        />
                      </div>
                      <div>
                        <Label htmlFor="event-end">Fin</Label>
                        <Input
                          id="event-end"
                          type="datetime-local"
                          value={sessionForm.endsAt}
                          onChange={(e) =>
                            setSessionForm({ ...sessionForm, endsAt: e.target.value })
                          }
                          required
                        />
                      </div>
                      <div>
                        <Label htmlFor="event-capacity">Jauge</Label>
                        <Input
                          id="event-capacity"
                          type="number"
                          min="1"
                          max="10000"
                          value={sessionForm.capacity}
                          onChange={(e) =>
                            setSessionForm({ ...sessionForm, capacity: e.target.value })
                          }
                          required
                        />
                      </div>
                      <Button type="submit" disabled={busy}>
                        Ajouter la session
                      </Button>
                    </form>
                    <div className="mt-4 space-y-2">
                      {sessions.map((item) => (
                        <div key={item.id} className="rounded-lg border border-border p-3 text-sm">
                          <div className="flex justify-between gap-2">
                            <span>{formatDate(item.startsAt)}</span>
                            <Badge variant={statusVariant(item.status)}>
                              {statusLabel(item.status)}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Jauge {item.capacity} · {item.ticketCount} billet(s)
                          </p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Tarifs</CardTitle>
                    <CardDescription>Le prix est figé dans chaque commande.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form className="space-y-3" onSubmit={createTicketType}>
                      <div>
                        <Label htmlFor="ticket-key">Clé</Label>
                        <Input
                          id="ticket-key"
                          value={ticketForm.key}
                          onChange={(e) => setTicketForm({ ...ticketForm, key: e.target.value })}
                          placeholder="standard"
                          required
                        />
                      </div>
                      <div>
                        <Label htmlFor="ticket-name">Libellé</Label>
                        <Input
                          id="ticket-name"
                          value={ticketForm.name}
                          onChange={(e) => setTicketForm({ ...ticketForm, name: e.target.value })}
                          placeholder="Entrée standard"
                          required
                        />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <Label htmlFor="ticket-price">Prix (centimes)</Label>
                          <Input
                            id="ticket-price"
                            type="number"
                            min="0"
                            value={ticketForm.priceCents}
                            onChange={(e) =>
                              setTicketForm({ ...ticketForm, priceCents: e.target.value })
                            }
                            required
                          />
                        </div>
                        <div>
                          <Label htmlFor="ticket-max">Max/commande</Label>
                          <Input
                            id="ticket-max"
                            type="number"
                            min="1"
                            max="100"
                            value={ticketForm.maxPerOrder}
                            onChange={(e) =>
                              setTicketForm({ ...ticketForm, maxPerOrder: e.target.value })
                            }
                            required
                          />
                        </div>
                      </div>
                      <Button type="submit" disabled={busy}>
                        Ajouter le tarif
                      </Button>
                    </form>
                    <div className="mt-4 space-y-2">
                      {ticketTypes.map((item) => (
                        <div key={item.id} className="rounded-lg border border-border p-3 text-sm">
                          <div className="flex justify-between gap-2">
                            <span>{item.name}</span>
                            <span className="font-medium">{formatEur(item.priceCents)}</span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {item.ticketCount} billet(s) · max {item.maxPerOrder}
                          </p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>Émettre des billets</CardTitle>
                  <CardDescription>
                    Le code brut n’est affiché qu’au moment de l’émission. Seuls son hash et ses
                    quatre derniers caractères sont conservés.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form className="grid gap-3 md:grid-cols-4" onSubmit={issueOrder}>
                    <div>
                      <Label htmlFor="order-session">Session</Label>
                      <select
                        id="order-session"
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={orderForm.sessionId}
                        onChange={(e) => setOrderForm({ ...orderForm, sessionId: e.target.value })}
                        required
                      >
                        <option value="">Choisir</option>
                        {sessions
                          .filter((item) => item.status === 'OPEN')
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {formatDate(item.startsAt)}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="order-type">Tarif</Label>
                      <select
                        id="order-type"
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={orderForm.ticketTypeId}
                        onChange={(e) =>
                          setOrderForm({ ...orderForm, ticketTypeId: e.target.value })
                        }
                        required
                      >
                        <option value="">Choisir</option>
                        {ticketTypes
                          .filter((item) => item.status === 'ACTIVE')
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} · {formatEur(item.priceCents)}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="order-quantity">Quantité</Label>
                      <Input
                        id="order-quantity"
                        type="number"
                        min="1"
                        max="100"
                        value={orderForm.quantity}
                        onChange={(e) => setOrderForm({ ...orderForm, quantity: e.target.value })}
                        required
                      />
                    </div>
                    <div className="flex items-end">
                      <Button type="submit" disabled={busy} className="w-full">
                        <Ticket className="mr-2 h-4 w-4" />
                        Émettre
                      </Button>
                    </div>
                  </form>
                  {ticketCodes.length > 0 && (
                    <div
                      role="status"
                      className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm"
                    >
                      <p className="font-medium">
                        Codes à remettre au participant (affichage unique)
                      </p>
                      <code className="mt-2 block break-all text-xs">
                        {ticketCodes.join(' · ')}
                      </code>
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Contrôle d’accès</CardTitle>
                  <CardDescription>
                    Le contrôle est idempotent : un billet déjà contrôlé ne crée pas de second
                    passage.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form className="flex gap-2" onSubmit={checkIn}>
                    <Input
                      value={checkInCode}
                      onChange={(e) => setCheckInCode(e.target.value)}
                      placeholder="Code 12 caractères"
                      minLength={12}
                      maxLength={64}
                      required
                    />
                    <Button type="submit" disabled={busy}>
                      Contrôler
                    </Button>
                  </form>
                  <div className="mt-4 space-y-2">
                    {selectedTickets.slice(0, 20).map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between rounded-lg border border-border p-3 text-sm"
                      >
                        <span>
                          <span className="font-medium">••••{item.codeLast4}</span>
                          <span className="ml-2 text-muted-foreground">{item.ticketType.name}</span>
                        </span>
                        <Badge variant={statusVariant(item.status)}>
                          {statusLabel(item.status)}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Commandes</CardTitle>
                    <CardDescription>
                      Facture locale et remboursement restent des traces internes.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {selectedOrders.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Aucune commande.</p>
                    ) : (
                      selectedOrders.slice(0, 20).map((item) => (
                        <div key={item.id} className="rounded-lg border border-border p-3 text-sm">
                          <div className="flex justify-between gap-2">
                            <span>
                              {item.customerName ?? 'Participant non lié'} · {item.ticketType.name}{' '}
                              · {item.quantity}
                            </span>
                            <Badge variant={statusVariant(item.status)}>
                              {statusLabel(item.status)}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatEur(item.totalPriceCents)} · {item.ticketCount} billet(s) ·{' '}
                            {item.invoiceNumber ?? 'non facturée'}
                          </p>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Limites actuelles</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-muted-foreground">
                    <p className="flex gap-2">
                      <ShieldAlert className="h-4 w-4 shrink-0 text-primary" />
                      Aucun paiement ou remboursement Stripe n’est appelé.
                    </p>
                    <p className="flex gap-2">
                      <XCircle className="h-4 w-4 shrink-0 text-primary" />
                      Aucun SMS, email, WhatsApp ou partenaire de distribution n’est déclenché.
                    </p>
                    <p className="flex gap-2">
                      <Ticket className="h-4 w-4 shrink-0 text-primary" />
                      Les participants sont reliés au CRM quand un customerId est fourni.
                    </p>
                  </CardContent>
                </Card>
              </div>
            </>
          ) : (
            <Card>
              <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
                <ShieldAlert className="h-5 w-5" />
                Créez un événement pour commencer. Le flag EVENTS_ENABLED reste fermé en production.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
