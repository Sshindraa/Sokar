'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CalendarCheck,
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

type ExperienceStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
type SessionStatus = 'OPEN' | 'CLOSED' | 'CANCELLED';
type ReservationStatus = 'CONFIRMED' | 'CANCELLED';

type Experience = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceCents: number;
  currency: string;
  capacity: number;
  status: ExperienceStatus;
  sessionCount: number;
  reservationCount: number;
};

type Session = {
  id: string;
  experienceId: string;
  startsAt: string;
  endsAt: string;
  capacityOverride: number | null;
  status: SessionStatus;
  experience: { key: string; name: string; priceCents: number; currency: string; capacity: number };
  reservationCount: number;
};

type ExperienceReservation = {
  id: string;
  experienceId: string;
  sessionId: string;
  quantity: number;
  unitPriceCents: number;
  totalPriceCents: number;
  currency: string;
  status: ReservationStatus;
  experience: { key: string; name: string; priceCents: number; currency: string };
  session: { startsAt: string; endsAt: string };
  customerName: string | null;
  phoneLast4: string | null;
  cancelledAt: string | null;
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

function statusLabel(status: ExperienceStatus | SessionStatus | ReservationStatus): string {
  return {
    DRAFT: 'Brouillon',
    ACTIVE: 'Active',
    ARCHIVED: 'Archivée',
    OPEN: 'Ouverte',
    CLOSED: 'Fermée',
    CANCELLED: 'Annulée',
    CONFIRMED: 'Confirmée',
  }[status];
}

function statusVariant(
  status: ExperienceStatus | SessionStatus | ReservationStatus,
): 'default' | 'secondary' | 'destructive' {
  if (status === 'ACTIVE' || status === 'OPEN' || status === 'CONFIRMED') return 'default';
  if (status === 'CANCELLED' || status === 'ARCHIVED') return 'secondary';
  return 'destructive';
}

function defaultDateTime(offsetHours: number): string {
  const date = new Date(Date.now() + offsetHours * 60 * 60 * 1_000);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  return date.toISOString().slice(0, 16);
}

export default function ExperiencesPage() {
  const { get, post, patch } = useApi();
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [reservations, setReservations] = useState<ExperienceReservation[]>([]);
  const [selectedExperienceId, setSelectedExperienceId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [experienceForm, setExperienceForm] = useState({
    key: '',
    name: '',
    durationMinutes: '90',
    priceCents: '0',
    capacity: '12',
  });
  const [sessionForm, setSessionForm] = useState({
    startsAt: defaultDateTime(24),
    endsAt: defaultDateTime(26),
    capacityOverride: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [experienceResponse, reservationResponse] = await Promise.all([
        get<ListResponse<Experience>>('experiences?limit=100'),
        get<ListResponse<ExperienceReservation>>('experience-reservations?limit=100'),
      ]);
      const nextExperiences = Array.isArray(experienceResponse.data) ? experienceResponse.data : [];
      const nextReservations = Array.isArray(reservationResponse.data)
        ? reservationResponse.data
        : [];
      const nextSelected =
        selectedExperienceId && nextExperiences.some((item) => item.id === selectedExperienceId)
          ? selectedExperienceId
          : (nextExperiences.find((item) => item.status === 'ACTIVE')?.id ??
            nextExperiences[0]?.id ??
            '');
      setExperiences(nextExperiences);
      setReservations(nextReservations);
      setSelectedExperienceId(nextSelected);
      if (nextSelected) {
        const sessionResponse = await get<ListResponse<Session>>(
          `experiences/${nextSelected}/sessions?status=OPEN&limit=100`,
        );
        setSessions(Array.isArray(sessionResponse.data) ? sessionResponse.data : []);
      } else {
        setSessions([]);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de charger les expériences'));
      setExperiences([]);
      setSessions([]);
      setReservations([]);
    } finally {
      setLoading(false);
    }
  }, [get, selectedExperienceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedExperience = experiences.find((item) => item.id === selectedExperienceId) ?? null;
  const selectedReservations = useMemo(
    () => reservations.filter((item) => item.experienceId === selectedExperienceId),
    [reservations, selectedExperienceId],
  );
  const metrics = useMemo(
    () => ({
      active: experiences.filter((item) => item.status === 'ACTIVE').length,
      openSessions: sessions.filter((item) => item.status === 'OPEN').length,
      confirmed: selectedReservations.filter((item) => item.status === 'CONFIRMED').length,
      bookedCovers: selectedReservations
        .filter((item) => item.status === 'CONFIRMED')
        .reduce((sum, item) => sum + item.quantity, 0),
    }),
    [experiences, selectedReservations, sessions],
  );

  async function createExperience(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await post<MutationResponse<Experience>>('experiences', {
        key: experienceForm.key,
        name: experienceForm.name,
        durationMinutes: Number(experienceForm.durationMinutes),
        priceCents: Number(experienceForm.priceCents),
        capacity: Number(experienceForm.capacity),
      });
      if (response.data) {
        setExperiences((current) => [response.data!, ...current]);
        setSelectedExperienceId(response.data.id);
      }
      setExperienceForm({
        key: '',
        name: '',
        durationMinutes: '90',
        priceCents: '0',
        capacity: '12',
      });
      setNotice('Expérience créée en brouillon. Aucun paiement ni canal externe n’a été activé.');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de créer l’expérience'));
    } finally {
      setBusy(false);
    }
  }

  async function activateExperience(experience: Experience) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await patch<MutationResponse<Experience>>(`experiences/${experience.id}`, {
        status: experience.status === 'ACTIVE' ? 'DRAFT' : 'ACTIVE',
      });
      if (response.data) {
        setExperiences((current) =>
          current.map((item) => (item.id === experience.id ? response.data! : item)),
        );
      }
      setNotice(
        experience.status === 'ACTIVE' ? 'Expérience remise en brouillon.' : 'Expérience activée.',
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de modifier l’expérience'));
    } finally {
      setBusy(false);
    }
  }

  async function createSession(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedExperienceId) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await post<MutationResponse<Session>>(
        `experiences/${selectedExperienceId}/sessions`,
        {
          startsAt: new Date(sessionForm.startsAt).toISOString(),
          endsAt: new Date(sessionForm.endsAt).toISOString(),
          ...(sessionForm.capacityOverride
            ? { capacityOverride: Number(sessionForm.capacityOverride) }
            : {}),
        },
      );
      if (response.data) setSessions((current) => [...current, response.data!]);
      setNotice('Session ouverte. La capacité sera protégée transactionnellement.');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de créer la session'));
    } finally {
      setBusy(false);
    }
  }

  async function cancelReservation(item: ExperienceReservation) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await post<MutationResponse<ExperienceReservation>>(
        `experience-reservations/${item.id}/cancel`,
      );
      if (response.data) {
        setReservations((current) =>
          current.map((row) => (row.id === item.id ? response.data! : row)),
        );
      }
      setNotice('Réservation d’expérience annulée.');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible d’annuler la réservation'));
    } finally {
      setBusy(false);
    }
  }

  const locked =
    error.includes('EXPERIENCES_DISABLED') || error.includes('CAPABILITY_NOT_INCLUDED');

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="flex items-center gap-2">
            <CalendarCheck className="text-primary" size={20} aria-hidden="true" />
            <h1 className="text-2xl font-semibold tracking-tight">Expériences</h1>
            <Badge variant="secondary">Pro</Badge>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Publiez des ateliers et des événements avec des sessions à capacité contrôlée. Le prix
            est figé à la réservation ; les paiements et les canaux externes restent désactivés.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading || busy}>
          <RefreshCw className={loading ? 'animate-spin' : undefined} aria-hidden="true" />
          Actualiser
        </Button>
      </header>

      {error ? (
        <Card className="border-destructive/30 bg-destructive/5" role="alert">
          <CardContent className="flex items-start gap-3 pt-6 text-sm text-destructive">
            {locked ? <ShieldAlert size={18} /> : <AlertCircle size={18} />}
            <div className="space-y-2">
              <p>{error}</p>
              {locked ? (
                <p className="text-muted-foreground">
                  Les expériences sont réservées à Pro et restent verrouillées pendant le gel
                  jusqu’à la qualification du paiement et du pilote.
                </p>
              ) : null}
              <Button variant="outline" size="sm" onClick={() => void load()}>
                Réessayer
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {notice ? (
        <div
          className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/5 p-3 text-sm text-success"
          role="status"
        >
          <CheckCircle2 size={17} aria-hidden="true" />
          {notice}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Expériences actives</CardDescription>
            <CardTitle className="text-3xl">{loading ? '—' : metrics.active}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Sessions ouvertes</CardDescription>
            <CardTitle className="text-3xl">{loading ? '—' : metrics.openSessions}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Réservations confirmées</CardDescription>
            <CardTitle className="text-3xl">{loading ? '—' : metrics.confirmed}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Places réservées</CardDescription>
            <CardTitle className="text-3xl">{loading ? '—' : metrics.bookedCovers}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Créer une expérience</CardTitle>
            <CardDescription>Catalogue local, prix et capacité par défaut.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={createExperience}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="experience-key">Clé</Label>
                  <Input
                    id="experience-key"
                    value={experienceForm.key}
                    onChange={(event) =>
                      setExperienceForm((current) => ({ ...current, key: event.target.value }))
                    }
                    placeholder="atelier-vins"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="experience-name">Nom</Label>
                  <Input
                    id="experience-name"
                    value={experienceForm.name}
                    onChange={(event) =>
                      setExperienceForm((current) => ({ ...current, name: event.target.value }))
                    }
                    placeholder="Atelier vins"
                    required
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="experience-duration">Durée (min)</Label>
                  <Input
                    id="experience-duration"
                    type="number"
                    min="15"
                    value={experienceForm.durationMinutes}
                    onChange={(event) =>
                      setExperienceForm((current) => ({
                        ...current,
                        durationMinutes: event.target.value,
                      }))
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="experience-price">Prix (centimes)</Label>
                  <Input
                    id="experience-price"
                    type="number"
                    min="0"
                    value={experienceForm.priceCents}
                    onChange={(event) =>
                      setExperienceForm((current) => ({
                        ...current,
                        priceCents: event.target.value,
                      }))
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="experience-capacity">Capacité</Label>
                  <Input
                    id="experience-capacity"
                    type="number"
                    min="1"
                    value={experienceForm.capacity}
                    onChange={(event) =>
                      setExperienceForm((current) => ({ ...current, capacity: event.target.value }))
                    }
                    required
                  />
                </div>
              </div>
              <Button type="submit" disabled={busy}>
                <Ticket aria-hidden="true" />
                Créer l’expérience
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Catalogue</CardTitle>
            <CardDescription>Activez une fiche avant d’ouvrir ses sessions.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-24 w-full rounded-xl" />
            ) : experiences.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune expérience créée.</p>
            ) : (
              <div className="space-y-3">
                {experiences.map((experience) => (
                  <div
                    key={experience.id}
                    className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${selectedExperienceId === experience.id ? 'border-primary/60 bg-primary/5' : 'border-border'}`}
                  >
                    <button
                      type="button"
                      className="min-w-0 text-left"
                      onClick={() => setSelectedExperienceId(experience.id)}
                    >
                      <p className="truncate font-medium">{experience.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatEur(experience.priceCents)} · {experience.capacity} places ·{' '}
                        {experience.sessionCount} session(s)
                      </p>
                    </button>
                    <div className="flex items-center gap-2">
                      <Badge variant={statusVariant(experience.status)}>
                        {statusLabel(experience.status)}
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void activateExperience(experience)}
                        disabled={busy || experience.status === 'ARCHIVED'}
                      >
                        {experience.status === 'ACTIVE' ? 'Brouillon' : 'Activer'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Sessions {selectedExperience ? `— ${selectedExperience.name}` : ''}
            </CardTitle>
            <CardDescription>Chaque occurrence possède sa propre capacité.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {selectedExperienceId ? (
              <form
                className="grid gap-3 rounded-xl border border-dashed p-4 sm:grid-cols-2"
                onSubmit={createSession}
              >
                <div className="space-y-2">
                  <Label htmlFor="session-start">Début</Label>
                  <Input
                    id="session-start"
                    type="datetime-local"
                    value={sessionForm.startsAt}
                    onChange={(event) =>
                      setSessionForm((current) => ({ ...current, startsAt: event.target.value }))
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="session-end">Fin</Label>
                  <Input
                    id="session-end"
                    type="datetime-local"
                    value={sessionForm.endsAt}
                    onChange={(event) =>
                      setSessionForm((current) => ({ ...current, endsAt: event.target.value }))
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="session-capacity">Capacité spécifique</Label>
                  <Input
                    id="session-capacity"
                    type="number"
                    min="1"
                    placeholder={
                      selectedExperience ? String(selectedExperience.capacity) : 'Capacité'
                    }
                    value={sessionForm.capacityOverride}
                    onChange={(event) =>
                      setSessionForm((current) => ({
                        ...current,
                        capacityOverride: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="flex items-end">
                  <Button type="submit" disabled={busy}>
                    <CalendarCheck aria-hidden="true" />
                    Ouvrir la session
                  </Button>
                </div>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">
                Sélectionnez une expérience pour ouvrir une session.
              </p>
            )}
            {sessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune session ouverte.</p>
            ) : (
              <div className="space-y-2">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    className="flex items-center justify-between rounded-xl border p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{formatDate(session.startsAt)}</p>
                      <p className="text-xs text-muted-foreground">
                        Jusqu’à {formatDate(session.endsAt)} ·{' '}
                        {session.capacityOverride ?? selectedExperience?.capacity ?? '—'} places
                      </p>
                    </div>
                    <Badge variant={statusVariant(session.status)}>
                      {statusLabel(session.status)}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Réservations</CardTitle>
            <CardDescription>Les annulations libèrent immédiatement la capacité.</CardDescription>
          </CardHeader>
          <CardContent>
            {selectedReservations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucune réservation pour cette expérience.
              </p>
            ) : (
              <div className="space-y-2">
                {selectedReservations.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {item.customerName ?? 'Client sans nom'}{' '}
                        {item.phoneLast4 ? `· •${item.phoneLast4}` : ''}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(item.session.startsAt)} · {item.quantity} place(s) ·{' '}
                        {formatEur(item.totalPriceCents)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={statusVariant(item.status)}>{statusLabel(item.status)}</Badge>
                      {item.status === 'CONFIRMED' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void cancelReservation(item)}
                          disabled={busy}
                        >
                          <XCircle aria-hidden="true" />
                          Annuler
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
