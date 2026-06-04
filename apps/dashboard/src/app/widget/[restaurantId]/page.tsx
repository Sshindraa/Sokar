'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useApi } from '../../../lib/api';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  Calendar as CalendarIcon,
  Clock,
  Users,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  ChevronLeft,
  Phone,
  User,
  Mail,
  Utensils,
  Heart,
} from 'lucide-react';

const reservationTheme: CSSProperties & Record<`--${string}`, string> = {
  '--reservation-bg': '34 32% 92%',
  '--reservation-wash': '34 38% 96%',
  '--reservation-panel': '0 0% 100%',
  '--reservation-ink': '24 10% 10%',
  '--reservation-soft': '24 6% 42%',
  '--reservation-muted': '24 5% 64%',
  '--reservation-line': '28 20% 88%',
  '--reservation-blue': '207 92% 52%',
  '--reservation-success': '142 70% 38%',
};

const FRENCH_DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const FRENCH_MONTHS = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
];

export default function ReservationWidget({ params }: { params: { restaurantId: string } }) {
  const { get, post } = useApi();
  const restaurantId = params.restaurantId;

  // Restaurant public metadata
  const [restaurant, setRestaurant] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Booking Flow State
  const [step, setStep] = useState<1 | 2>(1);
  const [partySize, setPartySize] = useState<number>(2);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string>('');

  // Contact details
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [confirmedReservation, setConfirmedReservation] = useState<any>(null);

  // Load public restaurant info
  useEffect(() => {
    if (!restaurantId) return;
    (async () => {
      try {
        const data = await get(`restaurants/${restaurantId}/public`);
        setRestaurant(data);
        const today = new Date();
        setSelectedDate(today);
      } catch (err: any) {
        setError(err.message || 'Impossible de trouver ce restaurant');
      } finally {
        setLoading(false);
      }
    })();
  }, [restaurantId, get]);

  // Generate next 14 days
  const days: Date[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    days.push(d);
  }

  // Generate 30-min time slots based on opening hours
  const generateSlots = (date: Date) => {
    if (!restaurant?.openingHours) return [];
    const daysMap = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const dayName = daysMap[date.getDay()];
    const hours = restaurant.openingHours[dayName];

    if (!hours || !hours.open || !hours.close) {
      return [];
    }

    const slots: string[] = [];
    const [startHour, startMin] = hours.open.split(':').map(Number);
    const [endHour, endMin] = hours.close.split(':').map(Number);

    const start = new Date(date);
    start.setHours(startHour, startMin, 0, 0);

    const end = new Date(date);
    end.setHours(endHour, endMin, 0, 0);

    let current = new Date(start);
    while (current < end) {
      const hourStr = String(current.getHours()).padStart(2, '0');
      const minStr = String(current.getMinutes()).padStart(2, '0');
      slots.push(`${hourStr}:${minStr}`);
      current.setMinutes(current.getMinutes() + 30);
    }

    return slots;
  };

  const timeSlots = selectedDate ? generateSlots(selectedDate) : [];
  const lunchSlots = timeSlots.filter((time) => Number(time.split(':')[0]) < 15);
  const dinnerSlots = timeSlots.filter((time) => Number(time.split(':')[0]) >= 15);

  const labelClass =
    'flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-[hsl(var(--reservation-muted))]';
  const softPillClass =
    'border border-[hsl(var(--reservation-line))] bg-[hsl(var(--reservation-panel)/0.54)] text-[hsl(var(--reservation-soft))] shadow-sm backdrop-blur-xl transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--reservation-ink)/0.18)] hover:bg-[hsl(var(--reservation-panel)/0.78)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--reservation-ink)/0.18)]';
  const selectedPillClass =
    'border-[hsl(var(--reservation-ink))] bg-[hsl(var(--reservation-ink))] text-[hsl(var(--reservation-panel))] shadow-lg shadow-black/10';
  const fieldClass =
    'h-14 w-full rounded-full border border-[hsl(var(--reservation-line))] bg-[hsl(var(--reservation-panel)/0.58)] px-6 text-sm font-medium text-[hsl(var(--reservation-ink))] shadow-inner outline-none backdrop-blur-xl transition-all duration-200 placeholder:text-[hsl(var(--reservation-muted))] focus:border-[hsl(var(--reservation-ink)/0.28)] focus:bg-[hsl(var(--reservation-panel)/0.86)] focus:ring-2 focus:ring-[hsl(var(--reservation-blue)/0.18)]';

  // Submit Reservation
  async function handleSubmit() {
    if (!selectedDate || !selectedTime || !customerName || !customerPhone) {
      setError('Veuillez remplir tous les champs requis');
      return;
    }

    setSubmitting(true);
    setError('');

    const [hours, minutes] = selectedTime.split(':').map(Number);
    const reservedAt = new Date(selectedDate);
    reservedAt.setHours(hours, minutes, 0, 0);

    try {
      const res = await post('reservations', {
        restaurantId,
        reservedAt: reservedAt.toISOString(),
        partySize,
        customerName,
        customerPhone: customerPhone.startsWith('+')
          ? customerPhone
          : `+33${customerPhone.replace(/^0/, '')}`,
      });

      setConfirmedReservation(res);
      setSuccess(true);
    } catch (err: any) {
      if (err.message === 'SLOT_NOT_AVAILABLE') {
        setError(
          "Ce créneau horaire vient de se faire réserver ou n'est plus disponible. Veuillez choisir une autre heure.",
        );
      } else {
        setError(err.message || 'Une erreur est survenue lors de la réservation.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  /* ─── LOADING STATE ─── */
  if (loading) {
    return (
      <div
        className="flex min-h-screen flex-col justify-between bg-[hsl(var(--reservation-bg))] p-6 text-[hsl(var(--reservation-ink))]"
        style={reservationTheme}
      >
        <div className="space-y-4 pt-10">
          <Skeleton className="h-14 w-14 rounded-full bg-[hsl(var(--reservation-line))]" />
          <Skeleton className="h-8 w-48 bg-[hsl(var(--reservation-line))]" />
          <Skeleton className="h-4 w-32 bg-[hsl(var(--reservation-line))]" />
        </div>
        <div className="-mx-6 mt-6 space-y-6 rounded-t-[2rem] border-t border-white/70 bg-[hsl(var(--reservation-panel)/0.72)] p-6 backdrop-blur-2xl">
          <Skeleton className="h-6 w-40 bg-[hsl(var(--reservation-line))]" />
          <div className="flex gap-3 overflow-x-hidden">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton
                key={i}
                className="h-[90px] w-[70px] flex-shrink-0 rounded-2xl bg-[hsl(var(--reservation-line))]"
              />
            ))}
          </div>
          <Skeleton className="h-[50px] w-full rounded-full bg-[hsl(var(--reservation-line))]" />
        </div>
      </div>
    );
  }

  /* ─── ERROR STATE ─── */
  if (error && !restaurant) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center bg-[hsl(var(--reservation-bg))] p-6 text-center text-[hsl(var(--reservation-soft))]"
        style={reservationTheme}
      >
        <div className="mb-4 rounded-full border border-destructive/50 bg-destructive/10 p-4 text-destructive">
          <AlertCircle size={32} />
        </div>
        <h1 className="text-xl font-bold text-[hsl(var(--reservation-ink))]">
          Oups !
        </h1>
        <p className="mt-2 text-sm">
          {error}
        </p>
      </div>
    );
  }

  /* ─── MAIN WIDGET ─── */
  return (
    <div
      className="relative flex min-h-screen flex-col overflow-hidden bg-[hsl(var(--reservation-bg))] font-sans text-[hsl(var(--reservation-ink))] antialiased"
      style={{
        ...reservationTheme,
        backgroundImage:
          'linear-gradient(180deg, hsl(var(--reservation-wash)) 0%, hsl(var(--reservation-bg)) 48%, hsl(34 24% 88%) 100%)',
      }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-white/55 to-transparent" />
      <div className="pointer-events-none absolute -right-28 top-40 h-64 w-64 rounded-l-full border border-white/50 bg-[hsl(var(--reservation-blue)/0.14)] blur-sm" />
      <div className="pointer-events-none absolute left-0 top-0 h-full w-full bg-[linear-gradient(90deg,hsl(var(--reservation-ink)/0.035)_1px,transparent_1px)] bg-[length:84px_84px] opacity-40" />

      <div className="relative z-10 flex flex-col gap-6 px-6 pb-6 pt-12 sm:px-8">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/70 bg-white/65 text-[hsl(var(--reservation-soft))] shadow-sm backdrop-blur-xl">
              <Utensils size={18} />
            </div>
            <span className="max-w-[11rem] truncate text-sm font-semibold tracking-[0.04em] text-[hsl(var(--reservation-soft))]">
              {restaurant?.name || 'Restaurant'}
            </span>
          </div>
          <span className="rounded-full border border-white/70 bg-white/58 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[hsl(var(--reservation-muted))] shadow-sm backdrop-blur-xl">
            Réservation
          </span>
        </div>

        <div className="flex items-end justify-between gap-5">
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-[hsl(var(--reservation-muted))]">
              {success ? 'Confirmation' : 'Choisissez votre table'}
            </p>
            <h1 className="text-[3.25rem] font-black leading-[0.88] tracking-normal text-[hsl(var(--reservation-ink))] sm:text-[4rem]">
              {selectedDate && !success
                ? FRENCH_DAYS[selectedDate.getDay()].substring(0, 3)
                : 'Votre'}
            </h1>
            <h1 className="text-[3.25rem] font-black leading-[0.88] tracking-normal text-[hsl(var(--reservation-ink))] sm:text-[4rem]">
              {selectedDate && !success ? (
                <>
                  {selectedDate.getDate()}
                  <span className="text-[hsl(var(--reservation-muted))]">
                    {' '}
                    {FRENCH_MONTHS[selectedDate.getMonth()].substring(0, 3)}
                  </span>
                </>
              ) : (
                <>
                  table<span className="text-[hsl(var(--reservation-muted))]">.</span>
                </>
              )}
            </h1>
          </div>

          {!success && (
            <div className="mb-1 hidden min-w-[8rem] rounded-[1.5rem] border border-white/70 bg-white/55 p-4 shadow-sm backdrop-blur-xl sm:block">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[hsl(var(--reservation-muted))]">
                En cours
              </p>
              <p className="mt-3 text-2xl font-black leading-none text-[hsl(var(--reservation-ink))]">
                {partySize}
              </p>
              <p className="mt-1 text-xs font-semibold text-[hsl(var(--reservation-soft))]">
                personne{partySize > 1 ? 's' : ''}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="relative z-10 flex flex-1 flex-col justify-between rounded-t-[2rem] border-t border-white/70 bg-[hsl(var(--reservation-panel)/0.76)] px-6 pb-10 pt-7 shadow-2xl shadow-black/5 backdrop-blur-2xl sm:mx-8 sm:mb-8 sm:rounded-[2rem] sm:border sm:px-8">
        <div className="pointer-events-none absolute -right-1 top-24 h-28 w-14 rounded-l-full bg-[hsl(var(--reservation-blue)/0.22)]" />
        <div className="pointer-events-none absolute right-0 top-12 h-56 w-px bg-gradient-to-b from-transparent via-[hsl(var(--reservation-blue)/0.28)] to-transparent" />

        {success ? (
          /* ─── SUCCESS VIEW ─── */
          <div className="flex flex-1 flex-col items-center justify-center space-y-6 py-4 text-center">
            <div className="relative">
              <div className="absolute inset-0 animate-pulse rounded-full bg-[hsl(var(--reservation-success)/0.14)] blur-xl" />
              <CheckCircle2
                size={56}
                className="relative z-10 text-[hsl(var(--reservation-success))]"
              />
            </div>

            <div className="space-y-1">
              <h2 className="text-2xl font-bold tracking-normal text-[hsl(var(--reservation-ink))]">
                Table réservée !
              </h2>
              <p className="mx-auto max-w-xs text-xs text-[hsl(var(--reservation-muted))]">
                Votre réservation a été enregistrée avec succès.
              </p>
            </div>

            <div className="relative flex w-full overflow-hidden rounded-[1.75rem] border border-[hsl(var(--reservation-line))] bg-white/72 shadow-xl shadow-black/5 backdrop-blur-xl">
              <div className="flex w-1/3 flex-col items-center justify-center border-r border-[hsl(var(--reservation-line))] bg-[hsl(var(--reservation-wash)/0.66)] px-4 py-5 text-center">
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[hsl(var(--reservation-muted))]">
                  {selectedDate && FRENCH_DAYS[selectedDate.getDay()].substring(0, 3)}
                </span>
                <span className="my-1 text-4xl font-black tracking-normal text-[hsl(var(--reservation-ink))]">
                  {selectedDate?.getDate()}
                </span>
                <span className="text-xs font-semibold text-[hsl(var(--reservation-soft))]">
                  {selectedTime.replace(':', 'h')}
                </span>
              </div>

              <div className="relative flex w-2/3 flex-col justify-center overflow-hidden p-5">
                <div className="pointer-events-none absolute -right-4 top-1/2 h-20 w-10 -translate-y-1/2 rounded-l-full bg-[hsl(var(--reservation-blue)/0.18)]" />

                <div className="relative z-10 space-y-1 text-left">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[hsl(var(--reservation-blue))]">
                    Réservation
                  </p>
                  <h4 className="truncate text-sm font-extrabold text-[hsl(var(--reservation-ink))]">
                    {restaurant?.name}
                  </h4>
                  <p className="text-xs font-semibold text-[hsl(var(--reservation-soft))]">
                    {partySize} personne(s)
                  </p>
                  <p className="truncate text-xs font-semibold text-[hsl(var(--reservation-soft))]">
                    Nom : {customerName}
                  </p>
                </div>
              </div>
            </div>

            {/* Heart + brand */}
            <div className="flex items-center gap-2 text-[hsl(var(--reservation-ink))]">
              <Heart size={14} fill="currentColor" />
              <span className="text-xs font-semibold text-[hsl(var(--reservation-soft))]">
                {restaurant?.name}
              </span>
            </div>

            <div className="w-full space-y-3">
              <p className="text-xs text-[hsl(var(--reservation-muted))]">
                Un SMS de confirmation a été envoyé au {customerPhone}.
              </p>
              <button
                onClick={() => {
                  setSuccess(false);
                  setStep(1);
                  setSelectedTime('');
                  setCustomerName('');
                  setCustomerPhone('');
                }}
                className="w-full rounded-full bg-[hsl(var(--reservation-ink))] py-4 text-sm font-semibold text-[hsl(var(--reservation-panel))] shadow-lg shadow-black/10 transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.97]"
              >
                Faire une autre réservation
              </button>
            </div>
          </div>
        ) : (
          /* ─── FORM VIEWS ─── */
          <div className="flex flex-1 flex-col justify-between">
            {error && (
              <div className="mb-4 flex items-center gap-2 rounded-2xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
                <AlertCircle size={16} className="flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {step === 1 ? (
              /* ─── STEP 1: Pax, Date & Time ─── */
              <div className="flex-1 space-y-6">
                <div className="space-y-3">
                  <label className={labelClass}>
                    <Users size={13} />
                    Nombre de personnes
                  </label>
                  <div className="scrollbar-none flex gap-2 overflow-x-auto pb-1">
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((size) => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => setPartySize(size)}
                        className={cn(
                          'h-11 w-11 flex-shrink-0 rounded-full text-sm font-semibold',
                          softPillClass,
                          partySize === size && selectedPillClass,
                          partySize === size && 'scale-105',
                        )}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <label className={labelClass}>
                    <CalendarIcon size={13} />
                    Sélectionner la date
                  </label>
                  <div className="scrollbar-none flex snap-x gap-3 overflow-x-auto pb-2">
                    {days.map((date, idx) => {
                      const isSelected =
                        selectedDate?.toDateString() === date.toDateString();
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setSelectedDate(date);
                            setSelectedTime('');
                          }}
                          className={cn(
                            'relative flex h-[92px] min-w-[70px] flex-shrink-0 snap-center flex-col items-center justify-center overflow-hidden rounded-[1.35rem] text-center transition-all duration-200',
                            softPillClass,
                            isSelected && selectedPillClass,
                            isSelected && 'scale-105',
                          )}
                        >
                          {isSelected && (
                            <span className="absolute right-0 top-0 h-full w-3 bg-[hsl(var(--reservation-blue)/0.42)]" />
                          )}
                          <span className="relative text-[24px] font-black tracking-normal">
                            {date.getDate()}
                          </span>
                          <span className="relative mt-1 text-[11px] font-semibold uppercase tracking-[0.1em] opacity-75">
                            {FRENCH_DAYS[date.getDay()].substring(0, 3)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-3">
                  <label className={labelClass}>
                    <Clock size={13} />
                    Créneau horaire
                  </label>
                  {timeSlots.length > 0 ? (
                    <div className="scrollbar-none max-h-[190px] space-y-4 overflow-y-auto pr-1">
                      {[
                        { title: 'Déjeuner', slots: lunchSlots },
                        { title: 'Dîner', slots: dinnerSlots },
                      ]
                        .filter((group) => group.slots.length > 0)
                        .map((group) => (
                          <div key={group.title} className="space-y-2">
                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[hsl(var(--reservation-muted))]">
                              {group.title}
                            </p>
                            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                              {group.slots.map((time) => {
                                const isSelected = selectedTime === time;
                                return (
                                  <button
                                    key={time}
                                    type="button"
                                    onClick={() => setSelectedTime(time)}
                                    className={cn(
                                      'rounded-xl px-1 py-3 text-center text-sm font-semibold transition-all duration-200',
                                      softPillClass,
                                      isSelected && selectedPillClass,
                                    )}
                                  >
                                    {time.replace(':', 'h')}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[hsl(var(--reservation-line))] bg-[hsl(var(--reservation-panel)/0.36)] p-6 text-center text-[hsl(var(--reservation-muted))]">
                      <Clock size={24} className="mb-2 opacity-30" />
                      <span className="text-sm font-semibold">Aucun service ce jour-là</span>
                      <span className="mt-1 text-xs">Essayez une autre date.</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* ─── STEP 2: Contact Information ─── */
              <div className="flex-1 space-y-5 pt-1">
                <div className="mb-3 flex items-center gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className={cn('rounded-full p-1.5', softPillClass)}
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <span className="font-medium text-[hsl(var(--reservation-soft))]">
                    Retour aux créneaux
                  </span>
                </div>

                <div className="relative mb-5 flex w-full overflow-hidden rounded-[1.75rem] border border-[hsl(var(--reservation-line))] bg-white/70 shadow-lg shadow-black/5 backdrop-blur-xl">
                  <div className="flex w-1/3 flex-col items-center justify-center border-r border-[hsl(var(--reservation-line))] bg-[hsl(var(--reservation-wash)/0.7)] px-4 py-4 text-center">
                    <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-[hsl(var(--reservation-muted))]">
                      {selectedDate && FRENCH_DAYS[selectedDate.getDay()].substring(0, 3)}
                    </span>
                    <span className="my-0.5 text-3xl font-black tracking-normal text-[hsl(var(--reservation-ink))]">
                      {selectedDate?.getDate()}
                    </span>
                    <span className="text-[11px] font-semibold text-[hsl(var(--reservation-soft))]">
                      {selectedTime.replace(':', 'h')}
                    </span>
                  </div>

                  <div className="relative flex w-2/3 flex-col justify-center overflow-hidden p-4">
                    <div className="pointer-events-none absolute -right-4 top-1/2 h-20 w-10 -translate-y-1/2 rounded-l-full bg-[hsl(var(--reservation-blue)/0.2)]" />
                    <div className="space-y-0.5 text-left">
                      <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[hsl(var(--reservation-blue))]">
                        Résumé
                      </p>
                      <h4 className="truncate text-sm font-extrabold text-[hsl(var(--reservation-ink))]">
                        {restaurant?.name}
                      </h4>
                      <p className="text-xs font-semibold text-[hsl(var(--reservation-soft))]">
                        {partySize} personne(s)
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className={cn(labelClass, 'ml-2')}>
                    <User size={12} />
                    Nom complet *
                  </label>
                  <input
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Alice Martin"
                    required
                    className={fieldClass}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className={cn(labelClass, 'ml-2')}>
                    <Phone size={12} />
                    Téléphone *
                  </label>
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="0612345678"
                    required
                    className={fieldClass}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className={cn(labelClass, 'ml-2')}>
                    <Mail size={12} />
                    Adresse Email (optionnel)
                  </label>
                  <input
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="client@sokar.fr"
                    className={fieldClass}
                  />
                </div>
              </div>
            )}

            {/* ─── ACTION FOOTER ─── */}
            <div className="mt-8">
              {step === 1 ? (
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  disabled={!selectedTime}
                  className={cn(
                    'flex w-full items-center justify-center gap-2 rounded-full py-4 text-sm font-semibold shadow-lg shadow-black/10 transition-all duration-200 active:scale-[0.97]',
                    selectedTime
                      ? 'bg-[hsl(var(--reservation-ink))] text-[hsl(var(--reservation-panel))] hover:-translate-y-0.5'
                      : 'cursor-not-allowed bg-[hsl(var(--reservation-line))] text-[hsl(var(--reservation-muted))] opacity-70 shadow-none',
                  )}
                >
                  Continuer
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10">
                    <ChevronRight size={16} />
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting || !customerName || !customerPhone}
                  className={cn(
                    'flex w-full items-center justify-center gap-2 rounded-full py-4 text-sm font-semibold shadow-lg shadow-black/10 transition-all duration-200 active:scale-[0.97]',
                    submitting || !customerName || !customerPhone
                      ? 'cursor-not-allowed bg-[hsl(var(--reservation-line))] text-[hsl(var(--reservation-muted))] opacity-70 shadow-none'
                      : 'bg-[hsl(var(--reservation-ink))] text-[hsl(var(--reservation-panel))] hover:-translate-y-0.5',
                  )}
                >
                  {submitting ? 'Validation...' : 'Valider la réservation'}
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10">
                    <CheckCircle2 size={16} />
                  </span>
                </button>
              )}
            </div>

            <div className="mb-2 mt-5 flex items-center justify-center gap-1.5">
              <span className="text-[10px] tracking-wide text-[hsl(var(--reservation-muted)/0.7)]">
                Propulsé par
              </span>
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[hsl(var(--reservation-muted))]">
                Sokar
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
