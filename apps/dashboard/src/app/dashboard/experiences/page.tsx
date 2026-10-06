'use client';
import { useSearchParams } from 'next/navigation';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MoreHorizontal,
  Copy,
  Archive,
  Trash2,
  AlertCircle,
  CheckCircle2,
  ShieldAlert,
  Ticket,
  Plus,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi } from '@/lib/api';
import { getErrorMessage } from '@/types/api';

type ExperienceStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
type SessionStatus = 'OPEN' | 'CLOSED' | 'CANCELLED';
type ReservationStatus = 'CONFIRMED' | 'CANCELLED';
type ExperienceAccessBlock = 'pilot' | 'plan' | null;
type ExperiencePaymentReadiness = {
  canBook: boolean;
  blocker:
    | 'pilot_closed'
    | 'restaurant_unpublished'
    | 'stripe_not_configured'
    | 'stripe_unavailable'
    | 'stripe_not_ready'
    | 'commission_not_configured'
    | null;
};

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
  paymentStatus?:
    | 'OPEN'
    | 'PAID'
    | 'FREE'
    | 'EXPIRED'
    | 'REFUND_PENDING'
    | 'REFUNDED'
    | 'REFUND_FAILED'
    | null;
  experience: { key: string; name: string; priceCents: number; currency: string };
  session: { startsAt: string; endsAt: string };
  customerName: string | null;
  phoneLast4: string | null;
  cancelledAt: string | null;
  refundStatus?: 'not_required' | 'pending' | 'refunded';
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

function eurosToCents(value: string): number | null {
  const match = value
    .trim()
    .replace(',', '.')
    .match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

function getAccessBlock(message: string): ExperienceAccessBlock {
  if (message.includes('CAPABILITY_NOT_INCLUDED')) return 'plan';
  const normalized = message
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (
    message.includes('EXPERIENCES_DISABLED') ||
    normalized.includes('experiences restent desactivees')
  ) {
    return 'pilot';
  }
  return null;
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

function defaultDateTime(offsetHours: number): string {
  const date = new Date(Date.now() + offsetHours * 60 * 60 * 1_000);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  return localDateTime(date);
}

function localDateTime(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours
    ? `${hours} h${remainder ? ` ${String(remainder).padStart(2, '0')}` : ''}`
    : `${remainder} min`;
}

export default function ExperiencesPage() {
  const createRequested = useSearchParams().get('create') === '1';
  const { get, post, patch, del } = useApi();
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [reservations, setReservations] = useState<ExperienceReservation[]>([]);
  const [paymentReadiness, setPaymentReadiness] = useState<ExperiencePaymentReadiness | null>(null);
  const [selectedExperienceId, setSelectedExperienceId] = useState('');
  const [loading, setLoading] = useState(true);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [destructiveAction, setDestructiveAction] = useState<{
    type: 'archive' | 'delete';
    experience: Experience;
  } | null>(null);
  const [actionError, setActionError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [accessBlock, setAccessBlock] = useState<ExperienceAccessBlock>(null);
  const [notice, setNotice] = useState('');
  const [experienceForm, setExperienceForm] = useState({
    name: '',
    durationMinutes: '90',
    priceEuros: '0',
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
      const [experienceResponse, reservationResponse, readinessResponse] = await Promise.all([
        get<ListResponse<Experience>>('experiences?limit=100'),
        get<ListResponse<ExperienceReservation>>('experience-reservations?limit=100'),
        get<{ data?: ExperiencePaymentReadiness }>('experiences/payment-readiness').catch(
          () => null,
        ),
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
      setPaymentReadiness(readinessResponse?.data ?? null);
      setSelectedExperienceId(nextSelected);
      if (nextSelected) {
        const sessionResponse = await get<ListResponse<Session>>(
          `experiences/${nextSelected}/sessions?status=OPEN&limit=100`,
        );
        setSessions(Array.isArray(sessionResponse.data) ? sessionResponse.data : []);
      } else {
        setSessions([]);
      }
      setDataLoaded(true);
      setAccessBlock(null);
      setError('');
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Impossible de charger les expériences');
      setError(message);
      setAccessBlock(getAccessBlock(message));
      setDataLoaded(false);
      setExperiences([]);
      setSessions([]);
      setReservations([]);
      setPaymentReadiness(null);
    } finally {
      setLoading(false);
    }
  }, [get, selectedExperienceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (typeof window === 'undefined' || loading || !dataLoaded || error || accessBlock) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('create') !== '1') return;
    url.searchParams.delete('create');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    setEditingId(null);
    setFormError('');
    setCreateOpen(true);
  }, [accessBlock, createRequested, dataLoaded, error, loading]);

  const selectedExperience = experiences.find((item) => item.id === selectedExperienceId) ?? null;
  const upcomingSessions = sessions.filter(
    (session) => session.status === 'OPEN' && Date.parse(session.startsAt) > Date.now(),
  );
  const canDeleteSelectedExperience = Boolean(
    selectedExperience &&
    dataLoaded &&
    !loading &&
    selectedExperience.status === 'DRAFT' &&
    selectedExperience.reservationCount === 0 &&
    selectedExperience.sessionCount === sessions.length &&
    sessions.every(
      (session) => session.status === 'OPEN' && Date.parse(session.startsAt) > Date.now(),
    ),
  );
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
    setFormError('');
    const duration = Number(experienceForm.durationMinutes);
    if (duration < 15 || duration > 1440) {
      setFormError('La durée doit être comprise entre 15 minutes et 24 heures.');
      return;
    }
    const priceCents = eurosToCents(experienceForm.priceEuros);
    if (priceCents === null || priceCents > 1_000_000) {
      setFormError('Saisissez un prix entre 0 € et 10 000 €, avec deux décimales maximum.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const fields = {
        name: experienceForm.name.trim(),
        durationMinutes: duration,
        priceCents,
        capacity: Number(experienceForm.capacity),
      };
      const response = editingId
        ? await patch<MutationResponse<Experience>>(`experiences/${editingId}`, fields)
        : await post<MutationResponse<Experience>>('experiences', {
            ...fields,
            key: `${
              fields.name
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '')
                .slice(0, 48) || 'experience'
            }-${crypto.randomUUID().slice(0, 8)}`,
          });
      if (response.data) {
        const updated = response.data;
        setExperiences((current) =>
          editingId
            ? current.map((item) => (item.id === editingId ? updated : item))
            : [updated, ...current],
        );
        setSelectedExperienceId(updated.id);
      }
      setExperienceForm({
        name: '',
        durationMinutes: '90',
        priceEuros: '0',
        capacity: '12',
      });
      setCreateOpen(false);
      setNotice(
        editingId
          ? 'Expérience mise à jour.'
          : 'Expérience créée. Ajoutez maintenant une première date.',
      );
      setEditingId(null);
    } catch (err: unknown) {
      setFormError(
        getErrorMessage(
          err,
          editingId ? 'Impossible de modifier l’expérience' : 'Impossible de créer l’expérience',
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function activateExperience(experience: Experience) {
    if (experience.status === 'DRAFT' && (loading || upcomingSessions.length === 0)) return;
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
    setFormError('');
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
      setSessionOpen(false);
      setNotice('Date ajoutée à votre expérience.');
    } catch (err: unknown) {
      setFormError(getErrorMessage(err, 'Impossible d’ajouter la date'));
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
      setNotice(
        response.data?.refundStatus === 'refunded'
          ? 'Réservation annulée et paiement remboursé.'
          : response.data?.refundStatus === 'pending'
            ? 'Réservation annulée. Le remboursement est en cours de traitement.'
            : 'Réservation d’expérience annulée.',
      );
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Impossible d’annuler la réservation');
      setError(
        message.includes('EXPERIENCE_REFUND_FAILED')
          ? 'Le remboursement a échoué. La réservation reste confirmée ; vérifiez le paiement Stripe avant toute nouvelle action.'
          : message,
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmDestructiveAction() {
    if (!destructiveAction || busy) return;
    setBusy(true);
    setActionError('');
    const { type, experience } = destructiveAction;
    try {
      if (type === 'delete') {
        await del(`experiences/${experience.id}`);
        setExperiences((current) => current.filter((item) => item.id !== experience.id));
        setSelectedExperienceId('');
      } else {
        const response = await patch<MutationResponse<Experience>>(`experiences/${experience.id}`, {
          status: 'ARCHIVED',
        });
        if (response.data)
          setExperiences((current) =>
            current.map((item) => (item.id === experience.id ? response.data! : item)),
          );
      }
      setDestructiveAction(null);
      setNotice(
        type === 'delete'
          ? 'Expérience supprimée.'
          : 'Expérience archivée. Son historique est conservé.',
      );
    } catch (err) {
      const message = getErrorMessage(err);
      setActionError(
        message.includes('EXPERIENCE_DELETE_NOT_ALLOWED')
          ? 'Cette expérience possède une activité ou n’est plus en brouillon. Archivez-la pour conserver son historique.'
          : message.includes('EXPERIENCE_DELETE_CONFLICT')
            ? 'L’expérience a changé pendant la suppression. Actualisez la page avant de réessayer.'
            : message,
      );
    } finally {
      setBusy(false);
    }
  }

  function openCreation() {
    setEditingId(null);
    setExperienceForm({ name: '', durationMinutes: '90', priceEuros: '0', capacity: '12' });
    setFormError('');
    setCreateOpen(true);
  }

  function openSession() {
    if (!selectedExperience) return;
    const startsAt = defaultDateTime(24);
    setSessionForm({
      startsAt,
      endsAt: localDateTime(
        new Date(new Date(startsAt).getTime() + selectedExperience.durationMinutes * 60_000),
      ),
      capacityOverride: '',
    });
    setFormError('');
    setSessionOpen(true);
  }

  return (
    <div className="w-full space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
              Expériences & événements
            </h1>
            <Badge variant="outline" className="font-normal text-muted-foreground">
              Pro
            </Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Proposez des ateliers, menus spéciaux et événements réservables.
          </p>
        </div>
        {dataLoaded && experiences.length > 0 ? (
          <Button
            onClick={openCreation}
            disabled={busy || loading}
            className="transition-all duration-200"
          >
            <Plus size={16} />
            Créer une expérience
          </Button>
        ) : null}
      </header>

      {error ? (
        <Card
          role={accessBlock ? 'status' : 'alert'}
          className={accessBlock ? 'bg-muted/30' : 'border-destructive/30'}
        >
          <CardContent className="flex items-start gap-3 pt-6">
            {accessBlock ? (
              <ShieldAlert className="shrink-0 text-muted-foreground" size={20} />
            ) : (
              <AlertCircle className="shrink-0 text-destructive" size={20} />
            )}
            <div className="space-y-2 text-sm">
              <p className="font-medium">
                {accessBlock === 'pilot'
                  ? 'Expériences bientôt disponibles'
                  : accessBlock === 'plan'
                    ? 'Accès réservé aux formules Pro et Multi-site'
                    : 'Impossible de charger les expériences'}
              </p>
              <p className="text-muted-foreground">
                {accessBlock === 'pilot'
                  ? 'Le module est actuellement en cours de qualification. Vos données ne sont pas modifiées.'
                  : accessBlock === 'plan'
                    ? 'Vérifiez la formule associée à cet établissement.'
                    : error}
              </p>
              {!accessBlock ? (
                <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
                  Réessayer
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
      {notice ? (
        <div
          className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/5 p-3 text-sm text-success"
          role="status"
        >
          <CheckCircle2 size={17} />
          {notice}
        </div>
      ) : null}

      {dataLoaded ? (
        <>
          {paymentReadiness ? (
            <div
              className={cn(
                'flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm',
                paymentReadiness.canBook
                  ? 'border-primary/20 bg-primary/5'
                  : 'border-border bg-muted/30',
              )}
              role="status"
            >
              <div className="flex items-center gap-2">
                {paymentReadiness.canBook ? (
                  <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-primary" />
                ) : (
                  <ShieldAlert aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="font-medium">
                  {paymentReadiness.canBook
                    ? 'Réservations en ligne actives'
                    : paymentReadiness.blocker === 'pilot_closed'
                      ? 'Réservations en ligne désactivées pendant le pilote'
                      : paymentReadiness.blocker === 'restaurant_unpublished'
                        ? 'Publiez votre page restaurant pour ouvrir les réservations'
                        : paymentReadiness.blocker === 'stripe_not_configured'
                          ? 'Configurez Stripe pour encaisser les réservations'
                          : paymentReadiness.blocker === 'stripe_unavailable'
                            ? 'Le statut Stripe est temporairement indisponible'
                            : paymentReadiness.blocker === 'stripe_not_ready'
                              ? 'La configuration Stripe doit être terminée'
                              : 'Les paramètres de paiement sont en cours de configuration'}
                </span>
              </div>
              {(paymentReadiness.blocker === 'stripe_not_configured' ||
                paymentReadiness.blocker === 'stripe_not_ready') && (
                <Button asChild size="sm" variant="outline" className="transition-all duration-200">
                  <Link href="/dashboard/gift-cards">Configurer Stripe</Link>
                </Button>
              )}
            </div>
          ) : (
            <div
              className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm"
              role="status"
            >
              <ShieldAlert aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">
                Le statut des réservations en ligne n’a pas pu être vérifié.
              </span>
            </div>
          )}
          {experiences.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center px-6 py-12 text-center md:py-16">
                <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
                  <Ticket size={28} className="text-muted-foreground" />
                </div>
                <h2 className="text-xl font-semibold">Créez votre première expérience</h2>
                <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
                  Dégustation, brunch spécial, cours de cuisine ou soirée à thème. Créez l’offre,
                  puis ajoutez ses dates.
                </p>
                <Button className="mt-6 transition-all duration-200" onClick={openCreation}>
                  <Plus size={16} />
                  Créer une expérience
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {[
                    ['Expériences actives', metrics.active],
                    ['Dates ouvertes', metrics.openSessions],
                    ['Réservations confirmées', metrics.confirmed],
                    ['Places réservées', metrics.bookedCovers],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl border border-border p-4">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="mt-1 text-2xl font-semibold">{loading ? '—' : value}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Les dates et réservations concernent l’expérience sélectionnée.
                </p>
              </div>
              <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)]">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Vos expériences</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {experiences.map((experience) => (
                      <button
                        key={experience.id}
                        type="button"
                        onClick={() => setSelectedExperienceId(experience.id)}
                        aria-pressed={selectedExperienceId === experience.id}
                        className={cn(
                          'w-full rounded-xl border p-4 text-left transition-all duration-200 hover:bg-muted/50',
                          selectedExperienceId === experience.id
                            ? 'border-primary/20 bg-muted/20'
                            : 'border-border',
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-medium">{experience.name}</span>
                          <Badge variant="secondary">{statusLabel(experience.status)}</Badge>
                        </div>
                        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                          {formatEur(experience.priceCents)} / personne ·{' '}
                          {formatDuration(experience.durationMinutes)} · {experience.capacity}{' '}
                          places
                        </p>
                      </button>
                    ))}
                  </CardContent>
                </Card>
                {selectedExperience ? (
                  <div className="space-y-6">
                    <Card>
                      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
                        <div className="space-y-2">
                          <CardTitle>{selectedExperience.name}</CardTitle>
                          <CardDescription>
                            {formatEur(selectedExperience.priceCents)} / personne ·{' '}
                            {formatDuration(selectedExperience.durationMinutes)} ·{' '}
                            {selectedExperience.capacity} places
                          </CardDescription>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">
                            {statusLabel(selectedExperience.status)}
                          </Badge>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy || loading || selectedExperience.status === 'ARCHIVED'}
                            onClick={() => {
                              setEditingId(selectedExperience.id);
                              setExperienceForm({
                                name: selectedExperience.name,
                                priceEuros: (selectedExperience.priceCents / 100)
                                  .toFixed(2)
                                  .replace('.', ','),
                                durationMinutes: String(selectedExperience.durationMinutes),
                                capacity: String(selectedExperience.capacity),
                              });
                              setFormError('');
                              setCreateOpen(true);
                            }}
                          >
                            Modifier
                          </Button>
                          <details
                            className="relative"
                            onKeyDown={(event) => {
                              if (event.key === 'Escape')
                                event.currentTarget.removeAttribute('open');
                            }}
                          >
                            <summary
                              aria-label="Autres actions"
                              title="Plus d’actions"
                              className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-lg border border-border transition-all duration-200 hover:bg-muted [&::-webkit-details-marker]:hidden"
                            >
                              <MoreHorizontal size={18} />
                            </summary>
                            <div className="absolute right-0 top-11 z-20 w-60 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md">
                              <button
                                type="button"
                                disabled={busy || loading}
                                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-all duration-200 hover:bg-muted disabled:opacity-50"
                                onClick={(event) => {
                                  event.currentTarget.closest('details')?.removeAttribute('open');
                                  setEditingId(null);
                                  setExperienceForm({
                                    name: `${selectedExperience.name.slice(0, 112)} (copie)`,
                                    priceEuros: (selectedExperience.priceCents / 100)
                                      .toFixed(2)
                                      .replace('.', ','),
                                    durationMinutes: String(selectedExperience.durationMinutes),
                                    capacity: String(selectedExperience.capacity),
                                  });
                                  setFormError('');
                                  setCreateOpen(true);
                                }}
                              >
                                <Copy size={15} />
                                Dupliquer
                              </button>
                              {selectedExperience.status !== 'ARCHIVED' ? (
                                <button
                                  type="button"
                                  disabled={busy || loading}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-all duration-200 hover:bg-muted disabled:opacity-50"
                                  onClick={(event) => {
                                    event.currentTarget.closest('details')?.removeAttribute('open');
                                    setActionError('');
                                    setDestructiveAction({
                                      type: 'archive',
                                      experience: selectedExperience,
                                    });
                                  }}
                                >
                                  <Archive size={15} />
                                  Archiver
                                </button>
                              ) : null}
                              {canDeleteSelectedExperience ? (
                                <div className="mt-1 border-t border-border pt-1">
                                  <button
                                    type="button"
                                    disabled={busy || loading}
                                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-destructive transition-all duration-200 hover:bg-destructive/5 disabled:opacity-50"
                                    onClick={(event) => {
                                      event.currentTarget
                                        .closest('details')
                                        ?.removeAttribute('open');
                                      setActionError('');
                                      setDestructiveAction({
                                        type: 'delete',
                                        experience: selectedExperience,
                                      });
                                    }}
                                  >
                                    <Trash2 size={15} />
                                    Supprimer l’expérience
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </details>
                          {selectedExperience.status === 'DRAFT' &&
                          !loading &&
                          upcomingSessions.length > 0 ? (
                            <Button
                              size="sm"
                              disabled={busy || loading}
                              onClick={() => void activateExperience(selectedExperience)}
                            >
                              Activer l’expérience
                            </Button>
                          ) : null}
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="flex flex-col justify-between gap-3 border-t border-border pt-4 sm:flex-row sm:items-center">
                          <div>
                            {upcomingSessions.length === 0 ? (
                              <>
                                <p className="text-sm font-medium">Prochaine étape</p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                  {selectedExperience.status === 'DRAFT'
                                    ? 'Ajoutez une première date avant d’activer cette expérience.'
                                    : 'Ajoutez une première date à cette expérience.'}
                                </p>
                              </>
                            ) : selectedExperience.status === 'DRAFT' ? (
                              <>
                                <p className="text-sm font-medium">Prête à être activée</p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                  Votre expérience contient {upcomingSessions.length}{' '}
                                  {upcomingSessions.length === 1
                                    ? 'date à venir.'
                                    : 'dates à venir.'}
                                </p>
                              </>
                            ) : (
                              <p className="text-sm text-muted-foreground">
                                Ajoutez les prochaines dates de votre expérience.
                              </p>
                            )}
                          </div>
                          <Button
                            variant={
                              selectedExperience.status === 'DRAFT' && upcomingSessions.length === 0
                                ? 'default'
                                : 'outline'
                            }
                            onClick={openSession}
                            disabled={busy || loading || selectedExperience.status === 'ARCHIVED'}
                            className="shrink-0 transition-all duration-200"
                          >
                            <Plus size={16} />
                            Ajouter une date
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Prochaines dates</CardTitle>
                      </CardHeader>
                      <CardContent>
                        {loading ? (
                          <Skeleton className="h-20 w-full" />
                        ) : sessions.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Aucune date ajoutée.</p>
                        ) : (
                          <div className="space-y-3">
                            {sessions.map((session) => (
                              <div
                                key={session.id}
                                className="flex items-center justify-between gap-3 rounded-xl border border-border p-4"
                              >
                                <div>
                                  <p className="text-sm font-medium">
                                    {formatDate(session.startsAt)}
                                  </p>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Jusqu’à{' '}
                                    {new Date(session.endsAt).toLocaleTimeString('fr-FR', {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}{' '}
                                    · {session.capacityOverride ?? selectedExperience.capacity}{' '}
                                    places
                                  </p>
                                </div>
                                <Badge variant="secondary">{statusLabel(session.status)}</Badge>
                              </div>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                    {sessions.length > 0 || selectedReservations.length > 0 ? (
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base">Réservations</CardTitle>
                        </CardHeader>
                        <CardContent>
                          {selectedReservations.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                              Les réservations de cette expérience apparaîtront ici.
                            </p>
                          ) : (
                            <div className="space-y-3">
                              {selectedReservations.map((item) => (
                                <div
                                  key={item.id}
                                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4"
                                >
                                  <div>
                                    <p className="text-sm font-medium">
                                      {item.customerName ?? 'Client sans nom'} · {item.quantity}{' '}
                                      personne(s)
                                    </p>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                      {formatDate(item.session.startsAt)} ·{' '}
                                      {formatEur(item.totalPriceCents)}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Badge variant="secondary">{statusLabel(item.status)}</Badge>
                                    {item.paymentStatus === 'REFUND_PENDING' ? (
                                      <Badge variant="secondary">Remboursement en cours</Badge>
                                    ) : item.paymentStatus === 'REFUND_FAILED' ? (
                                      <Badge variant="destructive">Remboursement à traiter</Badge>
                                    ) : item.paymentStatus === 'REFUNDED' ? (
                                      <Badge variant="secondary">Remboursée</Badge>
                                    ) : null}
                                    {item.status === 'CONFIRMED' ? (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => void cancelReservation(item)}
                                        disabled={busy}
                                      >
                                        <XCircle size={15} />
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
                    ) : null}
                  </div>
                ) : null}
              </div>
            </>
          )}
        </>
      ) : loading && !error ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : null}

      <Dialog
        open={Boolean(destructiveAction)}
        onOpenChange={(open) => {
          if (!open && !busy) setDestructiveAction(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {destructiveAction?.type === 'delete' ? 'Supprimer' : 'Archiver'} «{' '}
              {destructiveAction?.experience.name} » ?
            </DialogTitle>
            <DialogDescription>
              {destructiveAction?.type === 'delete'
                ? 'Cette action est définitive. Les dates associées seront également supprimées.'
                : 'Cette expérience ne pourra plus recevoir de nouvelles réservations. Ses dates et son historique seront conservés.'}
            </DialogDescription>
          </DialogHeader>
          {actionError ? (
            <p role="alert" className="text-sm text-destructive">
              {actionError}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDestructiveAction(null)} disabled={busy}>
              Annuler
            </Button>
            <Button
              variant={destructiveAction?.type === 'delete' ? 'destructive' : 'default'}
              onClick={() => void confirmDestructiveAction()}
              disabled={busy}
            >
              {busy
                ? 'Enregistrement…'
                : destructiveAction?.type === 'delete'
                  ? 'Supprimer'
                  : 'Archiver'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!busy) {
            setCreateOpen(open);
            setFormError('');
          }
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Modifier l’expérience' : 'Nouvelle expérience'}</DialogTitle>
            <DialogDescription>
              {editingId
                ? 'Modifiez les informations de votre offre. Les réservations existantes conservent leur prix initial.'
                : 'Définissez votre offre. Vous ajouterez ses dates à l’étape suivante.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={createExperience} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="experience-name">Nom</Label>
              <Input
                id="experience-name"
                value={experienceForm.name}
                onChange={(event) =>
                  setExperienceForm((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Atelier dégustation"
                maxLength={120}
                required
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="experience-price">Prix par personne (€)</Label>
                <Input
                  id="experience-price"
                  type="text"
                  inputMode="decimal"
                  value={experienceForm.priceEuros}
                  onChange={(event) =>
                    setExperienceForm((current) => ({ ...current, priceEuros: event.target.value }))
                  }
                  placeholder="45,00"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="experience-capacity">Capacité par défaut</Label>
                <Input
                  id="experience-capacity"
                  type="number"
                  min="1"
                  max="1000"
                  value={experienceForm.capacity}
                  onChange={(event) =>
                    setExperienceForm((current) => ({ ...current, capacity: event.target.value }))
                  }
                  required
                />
                <p className="text-xs text-muted-foreground">Nombre de personnes par date.</p>
              </div>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Durée</legend>
              <div className="flex items-center gap-3">
                <Input
                  aria-label="Durée en heures"
                  type="number"
                  min="0"
                  max="24"
                  className="w-24"
                  value={Math.floor(Number(experienceForm.durationMinutes) / 60)}
                  onChange={(event) =>
                    setExperienceForm((current) => ({
                      ...current,
                      durationMinutes: String(
                        Number(event.target.value) * 60 + (Number(current.durationMinutes) % 60),
                      ),
                    }))
                  }
                  required
                />
                <span className="text-sm text-muted-foreground">h</span>
                <Input
                  aria-label="Durée en minutes"
                  type="number"
                  min="0"
                  max="59"
                  className="w-24"
                  value={Number(experienceForm.durationMinutes) % 60}
                  onChange={(event) =>
                    setExperienceForm((current) => ({
                      ...current,
                      durationMinutes: String(
                        Math.floor(Number(current.durationMinutes) / 60) * 60 +
                          Number(event.target.value),
                      ),
                    }))
                  }
                  required
                />
                <span className="text-sm text-muted-foreground">min</span>
              </div>
            </fieldset>
            {formError ? (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
                disabled={busy}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Enregistrement…' : editingId ? 'Enregistrer' : 'Créer l’expérience'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={sessionOpen}
        onOpenChange={(open) => {
          if (!busy) {
            setSessionOpen(open);
            setFormError('');
          }
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Ajouter une date</DialogTitle>
            <DialogDescription>
              {selectedExperience?.name} · La durée et la capacité sont préremplies depuis votre
              offre.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={createSession} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="session-start">Début</Label>
              <Input
                id="session-start"
                type="datetime-local"
                value={sessionForm.startsAt}
                onChange={(event) => {
                  const startsAt = event.target.value;
                  setSessionForm((current) => ({
                    ...current,
                    startsAt,
                    endsAt: startsAt
                      ? localDateTime(
                          new Date(
                            new Date(startsAt).getTime() +
                              (selectedExperience?.durationMinutes ?? 90) * 60_000,
                          ),
                        )
                      : current.endsAt,
                  }));
                }}
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
              <Label htmlFor="session-capacity">Places disponibles</Label>
              <Input
                id="session-capacity"
                type="number"
                min="1"
                max="1000"
                placeholder={String(selectedExperience?.capacity ?? 12)}
                value={sessionForm.capacityOverride}
                onChange={(event) =>
                  setSessionForm((current) => ({
                    ...current,
                    capacityOverride: event.target.value,
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                {selectedExperience?.capacity} places par défaut.
              </p>
            </div>
            {formError ? (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSessionOpen(false)}
                disabled={busy}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Ajout…' : 'Ajouter la date'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
