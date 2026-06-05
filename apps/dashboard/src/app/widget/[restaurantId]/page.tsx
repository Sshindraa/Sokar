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
  '--reservation-glow': '31 92% 62%',
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
    'flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[hsl(var(--reservation-muted))]';
  const softPillClass =
    'border border-white/60 bg-white/36 text-[hsl(var(--reservation-soft))] shadow-sm backdrop-blur-2xl transition-all duration-200 hover:-translate-y-0.5 hover:border-white/80 hover:bg-white/56 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--reservation-blue)/0.22)]';
  const selectedPillClass =
    'border-[hsl(var(--reservation-ink))] bg-[hsl(var(--reservation-ink))] text-[hsl(var(--reservation-panel))] shadow-lg shadow-black/10';
  const fieldClass =
    'h-[3.25rem] w-full rounded-[1.35rem] border border-white/60 bg-white/38 px-5 text-sm font-medium text-[hsl(var(--reservation-ink))] shadow-inner outline-none backdrop-blur-2xl transition-all duration-200 placeholder:text-[hsl(var(--reservation-muted))] focus:border-white/80 focus:bg-white/62 focus:ring-2 focus:ring-[hsl(var(--reservation-blue)/0.18)]';

  const backgroundClass =
    'relative min-h-screen overflow-hidden bg-[hsl(var(--reservation-bg))] font-sans text-[hsl(var(--reservation-ink))] antialiased';
  const backgroundStyle = {
    ...reservationTheme,
    backgroundImage:
      'radial-gradient(circle at 50% 20%, hsl(var(--reservation-glow)/0.2), transparent 18rem), linear-gradient(145deg, hsl(var(--reservation-wash)) 0%, hsl(var(--reservation-bg)) 46%, hsl(34 20% 86%) 100%)',
  };
  const consoleClass =
    'relative z-10 w-full max-w-[33rem] overflow-hidden rounded-[2.15rem] border border-white/60 bg-white/42 p-4 shadow-2xl shadow-black/10 backdrop-blur-2xl sm:p-5 lg:max-w-[56rem] lg:p-8';
  const glassCardClass =
    'rounded-[1.6rem] border border-white/58 bg-white/34 shadow-sm backdrop-blur-2xl';

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

  if (loading) {
    return (
      <div className={backgroundClass} style={backgroundStyle}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-white/60 to-transparent" />
        <div className="flex min-h-screen items-center justify-center p-4 sm:p-8">
          <div className={consoleClass}>
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-11 w-11 rounded-full bg-white/50" />
                  <Skeleton className="h-4 w-36 bg-white/50" />
                </div>
                <Skeleton className="h-8 w-28 rounded-full bg-white/50" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-14 w-36 bg-white/50" />
                <Skeleton className="h-14 w-48 bg-white/50" />
              </div>
              <div className={cn(glassCardClass, 'space-y-4 p-4')}>
                <Skeleton className="h-4 w-32 bg-white/50" />
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-10 w-10 rounded-full bg-white/50" />
                  ))}
                </div>
                <div className="flex gap-2">
                  {[1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="h-16 w-14 rounded-2xl bg-white/50" />
                  ))}
                </div>
              </div>
              <Skeleton className="h-[3.25rem] w-full rounded-full bg-white/50" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error && !restaurant) {
    return (
      <div className={backgroundClass} style={backgroundStyle}>
        <div className="flex min-h-screen items-center justify-center p-4 sm:p-8">
          <div className={cn(consoleClass, 'p-6 text-center')}>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-destructive/50 bg-destructive/10 text-destructive">
              <AlertCircle size={28} />
            </div>
            <h1 className="text-xl font-bold text-[hsl(var(--reservation-ink))]">Oups !</h1>
            <p className="mt-2 text-sm text-[hsl(var(--reservation-soft))]">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  const dateTitle =
    selectedDate && !success ? FRENCH_DAYS[selectedDate.getDay()].substring(0, 3) : 'Votre';
  const dateSubtitle =
    selectedDate && !success
      ? `${selectedDate.getDate()} ${FRENCH_MONTHS[selectedDate.getMonth()].substring(0, 3)}`
      : 'table.';

  return (
    <div className={backgroundClass} style={backgroundStyle}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-white/60 to-transparent" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[34rem] w-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[hsl(var(--reservation-glow)/0.11)] blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,hsl(var(--reservation-ink)/0.025)_1px,transparent_1px)] bg-[length:96px_96px] opacity-30" />

      <main className="relative z-10 flex min-h-screen items-center justify-center p-4 sm:p-8">
        <section className={consoleClass}>
          <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent" />
          <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-[hsl(var(--reservation-glow)/0.16)] blur-3xl" />

          <div className="relative z-10 space-y-5 lg:space-y-6">
            <header className="flex items-center justify-between gap-3 lg:mb-1">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/70 bg-white/50 text-[hsl(var(--reservation-soft))] shadow-sm backdrop-blur-2xl">
                  <Utensils size={18} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-[hsl(var(--reservation-ink))]">
                    {restaurant?.name || 'Restaurant'}
                  </p>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--reservation-muted))]">
                    {success ? 'Confirmation' : 'Réserver'}
                  </p>
                </div>
              </div>
              <span className="shrink-0 rounded-full border border-white/70 bg-white/44 px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[hsl(var(--reservation-muted))] shadow-sm backdrop-blur-2xl">
                Réservation
              </span>
            </header>

            {success ? (
              <div className="space-y-5 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-white/70 bg-white/46 text-[hsl(var(--reservation-success))] shadow-lg shadow-black/5 backdrop-blur-2xl">
                  <CheckCircle2 size={34} />
                </div>
                <div>
                  <h2 className="text-2xl font-bold tracking-normal text-[hsl(var(--reservation-ink))]">
                    Table réservée !
                  </h2>
                  <p className="mx-auto mt-1 max-w-xs text-xs text-[hsl(var(--reservation-muted))]">
                    Un SMS de confirmation a été envoyé au {customerPhone}.
                  </p>
                </div>

                <div className={cn(glassCardClass, 'flex overflow-hidden text-left')}>
                  <div className="flex w-[7rem] flex-col items-center justify-center border-r border-white/50 bg-white/26 p-4">
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
                  <div className="min-w-0 flex-1 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[hsl(var(--reservation-blue))]">
                      Réservation
                    </p>
                    <h4 className="mt-1 truncate text-sm font-extrabold text-[hsl(var(--reservation-ink))]">
                      {restaurant?.name}
                    </h4>
                    <p className="mt-1 text-xs font-semibold text-[hsl(var(--reservation-soft))]">
                      {partySize} personne(s)
                    </p>
                    <p className="truncate text-xs font-semibold text-[hsl(var(--reservation-soft))]">
                      Nom : {customerName}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-center gap-2 text-[hsl(var(--reservation-ink))]">
                  <Heart size={14} fill="currentColor" />
                  <span className="text-xs font-semibold text-[hsl(var(--reservation-soft))]">
                    {restaurant?.name}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setSuccess(false);
                    setStep(1);
                    setSelectedTime('');
                    setCustomerName('');
                    setCustomerPhone('');
                  }}
                  className="w-full rounded-full bg-[hsl(var(--reservation-ink))] py-4 text-sm font-semibold text-white shadow-lg shadow-black/10 transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.97]"
                >
                  Faire une autre réservation
                </button>
              </div>
            ) : (
              <div className="space-y-5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:gap-8 lg:space-y-0">
                {/* Colonne gauche */}
                <div className="space-y-5">
                  <div className={cn(glassCardClass, 'relative overflow-hidden p-5 lg:p-5')}>
                    <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-[hsl(var(--reservation-glow)/0.12)] blur-2xl" />
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[hsl(var(--reservation-muted))]">
                      {step === 2 ? 'Résumé' : 'Choisissez votre table'}
                    </p>
                    <div className="mt-3 flex items-end justify-between gap-3">
                      <div className="min-w-0">
                        <h1 className="truncate text-[3.2rem] font-black leading-[0.85] tracking-normal text-[hsl(var(--reservation-ink))] lg:text-[2.2rem] lg:leading-[0.9]">
                          {dateTitle}
                        </h1>
                        <p className="mt-1 truncate text-[2rem] font-black leading-none tracking-normal text-[hsl(var(--reservation-muted))] lg:text-[1.5rem]">
                          {dateSubtitle}
                        </p>
                      </div>
                      <div className="mb-1 shrink-0 rounded-[1.15rem] border border-white/60 bg-white/38 px-3.5 py-2.5 text-right shadow-sm backdrop-blur-2xl lg:px-4 lg:py-3">
                        <p className="text-xl font-black leading-none text-[hsl(var(--reservation-ink))] lg:text-lg">
                          {partySize}
                        </p>
                        <p className="mt-0.5 text-[10px] font-semibold text-[hsl(var(--reservation-soft))]">
                          pers.
                        </p>
                      </div>
                    </div>
                  </div>

                  {step === 2 && (
                    <div className={cn(glassCardClass, 'flex overflow-hidden')}>
                      <div className="flex w-[6.5rem] flex-col items-center justify-center border-r border-white/50 bg-white/24 p-4 text-center">
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
                      <div className="min-w-0 flex-1 p-4">
                        <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[hsl(var(--reservation-blue))]">
                          Résumé
                        </p>
                        <h4 className="mt-1 truncate text-sm font-extrabold text-[hsl(var(--reservation-ink))]">
                          {restaurant?.name}
                        </h4>
                        <p className="mt-1 text-xs font-semibold text-[hsl(var(--reservation-soft))]">
                          {partySize} personne(s)
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Colonne droite */}
                <div className="space-y-5">
                  {error && (
                    <div className="flex items-center gap-2 rounded-2xl border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                      <AlertCircle size={16} className="shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}

                  {step === 1 ? (
                    <div className="space-y-5">
                      <div className="space-y-2.5">
                        <label className={labelClass}>
                          <Users size={13} />
                          Nombre de personnes
                        </label>
                        <div className="scrollbar-none flex gap-2 overflow-x-auto pb-1 lg:grid lg:grid-cols-8 lg:overflow-visible">
                          {[1, 2, 3, 4, 5, 6, 7, 8].map((size) => (
                            <button
                              key={size}
                              type="button"
                              onClick={() => setPartySize(size)}
                              className={cn(
                                'h-10 w-10 shrink-0 rounded-full text-sm font-semibold lg:h-9 lg:w-auto',
                                softPillClass,
                                partySize === size && selectedPillClass,
                              )}
                            >
                              {size}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-2.5">
                        <label className={labelClass}>
                          <CalendarIcon size={13} />
                          Sélectionner la date
                        </label>
                        <div className="scrollbar-none flex snap-x gap-2 overflow-x-auto pb-1 lg:grid lg:grid-cols-5 lg:overflow-visible">
                          {days.map((date, idx) => {
                            const isSelected = selectedDate?.toDateString() === date.toDateString();
                            return (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => {
                                  setSelectedDate(date);
                                  setSelectedTime('');
                                }}
                                className={cn(
                                  'relative flex h-[4.65rem] min-w-[4.15rem] shrink-0 snap-center flex-col items-center justify-center overflow-hidden rounded-[1.25rem] text-center transition-all duration-200 lg:h-[4rem] lg:min-w-0',
                                  softPillClass,
                                  isSelected &&
                                    'border-[hsl(var(--reservation-ink))] bg-white/58 text-[hsl(var(--reservation-ink))] shadow-lg shadow-black/10',
                                )}
                              >
                                {isSelected && (
                                  <span className="absolute bottom-2 left-1/2 h-1 w-5 -translate-x-1/2 rounded-full bg-[hsl(var(--reservation-blue))]" />
                                )}
                                <span className="text-[23px] font-black leading-none tracking-normal">
                                  {date.getDate()}
                                </span>
                                <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] opacity-75">
                                  {FRENCH_DAYS[date.getDay()].substring(0, 3)}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-2.5">
                        <label className={labelClass}>
                          <Clock size={13} />
                          Créneau horaire
                        </label>
                        {timeSlots.length > 0 ? (
                          <div className="scrollbar-none max-h-[12rem] space-y-3 overflow-y-auto pr-1 lg:max-h-none">
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
                                  <div className="grid grid-cols-3 gap-2 lg:grid-cols-4">
                                    {group.slots.map((time) => {
                                      const isSelected = selectedTime === time;
                                      return (
                                        <button
                                          key={time}
                                          type="button"
                                          onClick={() => setSelectedTime(time)}
                                          className={cn(
                                            'rounded-[1rem] px-1 py-3 text-center text-sm font-semibold',
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
                          <div
                            className={cn(glassCardClass, 'flex items-center gap-3 p-4 text-left')}
                          >
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/42 text-[hsl(var(--reservation-muted))]">
                              <Clock size={20} className="opacity-50" />
                            </div>
                            <div>
                              <p className="text-sm font-bold text-[hsl(var(--reservation-soft))]">
                                Aucun service ce jour-là
                              </p>
                              <p className="mt-0.5 text-xs text-[hsl(var(--reservation-muted))]">
                                Choisissez une autre date.
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <button
                        type="button"
                        onClick={() => setStep(1)}
                        className={cn(
                          'inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold',
                          softPillClass,
                        )}
                      >
                        <ChevronLeft size={18} />
                        Retour aux créneaux
                      </button>

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

                  <button
                    type="button"
                    onClick={step === 1 ? () => setStep(2) : handleSubmit}
                    disabled={
                      step === 1 ? !selectedTime : submitting || !customerName || !customerPhone
                    }
                    className={cn(
                      'flex w-full items-center justify-center gap-2 rounded-full py-4 text-sm font-semibold shadow-lg shadow-black/10 transition-all duration-200 active:scale-[0.97]',
                      (step === 1 ? selectedTime : !submitting && customerName && customerPhone)
                        ? 'bg-[hsl(var(--reservation-ink))] text-white hover:-translate-y-0.5'
                        : 'cursor-not-allowed bg-white/42 text-[hsl(var(--reservation-muted))] opacity-80 shadow-none',
                    )}
                  >
                    {step === 1
                      ? 'Continuer'
                      : submitting
                        ? 'Validation...'
                        : 'Valider la réservation'}
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/12">
                      {step === 1 ? <ChevronRight size={16} /> : <CheckCircle2 size={16} />}
                    </span>
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-center gap-1.5 pt-1 lg:pt-2">
              <span className="text-[10px] tracking-wide text-[hsl(var(--reservation-muted)/0.72)]">
                Propulsé par
              </span>
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[hsl(var(--reservation-muted))]">
                Sokar
              </span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
