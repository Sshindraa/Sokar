'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelPublicExperienceCheckout,
  createPublicExperienceCheckout,
  fetchPublicExperiences,
  fetchPublicExperienceCheckoutStatus,
  type PublicExperience,
  type PublicExperienceCheckoutStatus,
} from '@/lib/api/experiences';

type Props = {
  slug: string;
  restaurantName: string;
  returnState: string | undefined;
  checkoutId: string | undefined;
  stripeSessionId: string | undefined;
};

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(cents / 100);
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  });
}

export function ExperienceBooking({
  slug,
  restaurantName,
  returnState,
  checkoutId,
  stripeSessionId,
}: Props) {
  const [experiences, setExperiences] = useState<PublicExperience[]>([]);
  const [selectedExperienceId, setSelectedExperienceId] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [checkoutStatus, setCheckoutStatus] = useState<PublicExperienceCheckoutStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const idempotency = useRef<{ signature: string; key: string } | null>(null);

  useEffect(() => {
    let current = true;
    void fetchPublicExperiences(slug)
      .then((response) => {
        if (!current) return;
        setExperiences(response.experiences);
        setSelectedExperienceId(response.experiences[0]?.id ?? '');
        setSelectedSessionId(response.experiences[0]?.sessions[0]?.id ?? '');
        setError('');
      })
      .catch((cause: unknown) => {
        if (!current) return;
        setError(cause instanceof Error ? cause.message : 'Impossible de charger les expériences.');
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [slug]);

  useEffect(() => {
    if (returnState !== 'cancelled' || !checkoutId || !stripeSessionId) return;
    void cancelPublicExperienceCheckout({
      slug,
      checkoutId,
      sessionId: stripeSessionId,
    }).catch(() => {
      setError('Les places seront libérées automatiquement à l’expiration du paiement.');
    });
  }, [checkoutId, returnState, slug, stripeSessionId]);

  useEffect(() => {
    if (returnState !== 'success' || !checkoutId || !stripeSessionId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    const refresh = async () => {
      try {
        const result = await fetchPublicExperienceCheckoutStatus({
          slug,
          checkoutId,
          sessionId: stripeSessionId,
        });
        if (stopped) return;
        setCheckoutStatus(result);
        if (result.status === 'OPEN' && attempts++ < 45) {
          timer = setTimeout(() => void refresh(), 2_000);
        }
      } catch {
        if (!stopped)
          setError(
            'Le statut du paiement ne peut pas encore être vérifié. Réessayez dans un instant.',
          );
      }
    };

    void refresh();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [checkoutId, returnState, slug, stripeSessionId]);

  const selectedExperience = useMemo(
    () => experiences.find((item) => item.id === selectedExperienceId) ?? null,
    [experiences, selectedExperienceId],
  );
  const selectedSession =
    selectedExperience?.sessions.find((session) => session.id === selectedSessionId) ?? null;
  const remaining = selectedSession?.remaining ?? 0;
  const totalCents = (selectedExperience?.priceCents ?? 0) * quantity;

  function chooseExperience(experience: PublicExperience) {
    setSelectedExperienceId(experience.id);
    setSelectedSessionId(experience.sessions[0]?.id ?? '');
    setQuantity(1);
    idempotency.current = null;
  }

  async function startCheckout() {
    if (!selectedExperience || !selectedSession || submitting) return;
    setSubmitting(true);
    setError('');
    const signature = `${selectedExperience.id}:${selectedSession.id}:${quantity}`;
    if (!idempotency.current || idempotency.current.signature !== signature) {
      idempotency.current = { signature, key: crypto.randomUUID() };
    }
    try {
      const checkout = await createPublicExperienceCheckout({
        slug,
        experienceId: selectedExperience.id,
        sessionId: selectedSession.id,
        quantity,
        idempotencyKey: idempotency.current.key,
      });
      window.location.assign(checkout.url);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message === 'EXPERIENCE_CAPACITY_EXCEEDED'
            ? 'Il ne reste pas assez de places pour cette date. Choisissez-en une autre.'
            : cause.message === 'EXPERIENCE_PAYMENT_NOT_CONFIGURED' ||
                cause.message === 'EXPERIENCE_STRIPE_NOT_READY'
              ? 'La réservation en ligne n’est pas encore ouverte pour cette expérience.'
              : 'Le paiement n’a pas pu être préparé. Réessayez dans un instant.'
          : 'Le paiement n’a pas pu être préparé. Réessayez dans un instant.',
      );
      setSubmitting(false);
    }
  }

  const returnMessage =
    returnState === 'cancelled'
      ? 'Paiement interrompu. Aucune réservation n’a été confirmée.'
      : checkoutStatus?.status === 'PAID' || checkoutStatus?.status === 'FREE'
        ? 'Votre réservation est confirmée.'
        : checkoutStatus?.status === 'REFUND_PENDING'
          ? 'Le paiement a été reçu, mais le remboursement est en cours de traitement.'
          : checkoutStatus?.status === 'REFUNDED'
            ? 'Le paiement a été remboursé. Aucune réservation n’a été confirmée.'
            : checkoutStatus?.status === 'REFUND_FAILED'
              ? 'Le paiement nécessite une vérification par le restaurant. Contactez-le pour être accompagné.'
              : checkoutStatus?.status === 'EXPIRED'
                ? 'Cette tentative a expiré. Aucune réservation n’a été confirmée.'
                : returnState === 'success'
                  ? 'Vérification du paiement en cours…'
                  : null;

  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
      <a href={`/restaurant/${encodeURIComponent(slug)}`} className="text-sm text-blue underline">
        ← Retour à {restaurantName}
      </a>
      <header className="mb-8 mt-5">
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {restaurantName}
        </p>
        <h1 className="mt-2 text-3xl font-bold text-ink sm:text-4xl">Ateliers et événements</h1>
        <p className="mt-3 max-w-xl text-muted-foreground">
          Choisissez une expérience et une date. Le paiement ou la réservation gratuite confirme
          votre place.
        </p>
      </header>

      {returnMessage && (
        <section
          role="status"
          className="mb-6 rounded-xl border border-border bg-cream p-4 text-sm text-ink"
        >
          <p className="font-semibold">{returnMessage}</p>
          {checkoutStatus?.reservation &&
            (checkoutStatus.status === 'PAID' || checkoutStatus.status === 'FREE') && (
              <p className="mt-2 text-muted-foreground">
                {checkoutStatus.reservation.experience.name} ·{' '}
                {formatDate(checkoutStatus.reservation.session.startsAt)} ·{' '}
                {checkoutStatus.quantity} {checkoutStatus.quantity > 1 ? 'personnes' : 'personne'}
              </p>
            )}
        </section>
      )}

      {error && (
        <p
          role="alert"
          className="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {loading ? (
        <p
          role="status"
          className="rounded-xl border border-border bg-background p-6 text-sm text-muted-foreground"
        >
          Chargement des expériences…
        </p>
      ) : experiences.length === 0 ? (
        <section className="rounded-xl border border-border bg-background p-8 text-center">
          <h2 className="text-lg font-semibold text-ink">Aucune date disponible</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Le restaurant n’a pas encore publié d’expérience réservable.
          </p>
        </section>
      ) : (
        <div className="space-y-4">
          {experiences.map((experience) => (
            <article
              key={experience.id}
              className={`rounded-xl border bg-background p-5 transition-all duration-200 ${
                selectedExperienceId === experience.id
                  ? 'border-ink ring-1 ring-ink/10'
                  : 'border-border'
              }`}
            >
              <button
                type="button"
                onClick={() => chooseExperience(experience)}
                className="w-full text-left"
                aria-pressed={selectedExperienceId === experience.id}
              >
                <span className="flex flex-wrap items-start justify-between gap-3">
                  <span>
                    <span className="block text-lg font-semibold text-ink">{experience.name}</span>
                    {experience.description && (
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {experience.description}
                      </span>
                    )}
                    <span className="mt-2 block text-sm text-muted-foreground">
                      {experience.durationMinutes} min · {experience.capacity} places
                    </span>
                  </span>
                  <span className="font-semibold text-ink">
                    {formatPrice(experience.priceCents, experience.currency)} / personne
                  </span>
                </span>
              </button>

              {selectedExperienceId === experience.id && (
                <div className="mt-5 border-t border-border pt-4">
                  <label
                    className="block text-sm font-medium text-ink"
                    htmlFor={`session-${experience.id}`}
                  >
                    Choisissez une date
                  </label>
                  <select
                    id={`session-${experience.id}`}
                    value={selectedSessionId}
                    onChange={(event) => {
                      setSelectedSessionId(event.target.value);
                      setQuantity(1);
                      idempotency.current = null;
                    }}
                    className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-3 text-ink"
                    disabled={experience.sessions.length === 0}
                  >
                    {experience.sessions.length === 0 ? (
                      <option value="">Aucune date disponible</option>
                    ) : (
                      experience.sessions.map((session) => (
                        <option
                          key={session.id}
                          value={session.id}
                          disabled={session.remaining === 0}
                        >
                          {formatDate(session.startsAt)} · {session.remaining} place
                          {session.remaining > 1 ? 's' : ''} restante
                          {session.remaining > 1 ? 's' : ''}
                        </option>
                      ))
                    )}
                  </select>

                  <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
                    <label
                      className="text-sm font-medium text-ink"
                      htmlFor={`quantity-${experience.id}`}
                    >
                      Nombre de personnes
                      <input
                        id={`quantity-${experience.id}`}
                        type="number"
                        min={1}
                        max={Math.min(remaining, 20)}
                        value={quantity}
                        onChange={(event) => {
                          setQuantity(Math.max(1, Number(event.target.value) || 1));
                          idempotency.current = null;
                        }}
                        className="mt-2 block w-28 rounded-lg border border-border bg-background px-3 py-2 text-ink"
                        disabled={!selectedSession || remaining === 0}
                      />
                    </label>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">
                        {totalCents === 0 ? 'Prix' : 'Total à régler'}
                      </p>
                      <p className="text-lg font-semibold text-ink">
                        {formatPrice(totalCents, experience.currency)}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {selectedExperience && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-cream p-4">
          <p className="text-sm text-muted-foreground">
            Les places sont réservées pendant 35 minutes le temps du paiement.
          </p>
          <button
            type="button"
            onClick={() => void startCheckout()}
            disabled={
              submitting ||
              !selectedSession ||
              remaining === 0 ||
              quantity > remaining ||
              quantity > 20
            }
            className="inline-flex items-center justify-center rounded-lg bg-ink px-5 py-3 text-sm font-semibold text-white transition-all duration-200 hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting
              ? 'Préparation…'
              : totalCents === 0
                ? 'Réserver gratuitement'
                : 'Réserver et payer'}
          </button>
        </div>
      )}
    </main>
  );
}
