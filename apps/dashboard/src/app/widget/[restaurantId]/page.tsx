'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
  Loader2,
  X,
  CalendarCheck,
  Download,
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
const FRENCH_DAYS_SHORT = ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM'];
const DAYS_MAP = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
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
const FRENCH_MONTHS_SHORT = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
];
const FALLBACK_RESTAURANT_IMAGE =
  'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=80';
const FALLBACK_DISH_IMAGE =
  'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=600&q=80';

function formatLongFrenchDate(date: Date) {
  return `${FRENCH_DAYS[date.getDay()]} ${date.getDate()} ${FRENCH_MONTHS[
    date.getMonth()
  ].toLowerCase()}`;
}

function escapeICS(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function formatShortFrenchDate(date: Date) {
  return `${date.getDate()} ${FRENCH_MONTHS_SHORT[date.getMonth()]}`;
}

function triggerHaptic() {
  if (typeof window === 'undefined') return;
  navigator.vibrate?.(8);
}

interface OpeningHours {
  open: string;
  close: string;
}

interface RestaurantPublic {
  name: string;
  openingHours: Record<string, OpeningHours | null>;
  heroImageUrl?: string;
  imageUrl?: string;
  coverImageUrl?: string;
  galleryImages?: string[];
  cuisine?: string;
  city?: string;
  address?: string;
  tags?: string[];
}

interface ConfirmedReservation {
  id: string;
  restaurantId: string;
  reservedAt: string;
  partySize: number;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  status: string;
}

export default function ReservationWidget({ params }: { params: { restaurantId: string } }) {
  const { get, post } = useApi();
  const restaurantId = params.restaurantId;

  // Restaurant public metadata
  const [restaurant, setRestaurant] = useState<RestaurantPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Booking Flow State
  const [step, setStep] = useState<1 | 2>(1);
  const [partySize, setPartySize] = useState<number>(2);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string>('');
  const [activeSection, setActiveSection] = useState<'party' | 'date' | 'time'>('party');
  const [availabilityRefreshing, setAvailabilityRefreshing] = useState(false);
  const timeSectionRef = useRef<HTMLDivElement | null>(null);

  // Contact details
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [confirmedReservation, setConfirmedReservation] = useState<ConfirmedReservation | null>(
    null,
  );
  const [showCalendarMenu, setShowCalendarMenu] = useState(false);

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
  const days = useMemo(() => {
    const result: Date[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      result.push(d);
    }
    return result;
  }, []);

  // Generate 30-min time slots based on opening hours
  const getSlotsForDate = useCallback(
    (date: Date) => {
      if (!restaurant?.openingHours) return [];
      const dayName = DAYS_MAP[date.getDay()];
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
    },
    [restaurant],
  );

  const timeSlots = useMemo(() => {
    if (!selectedDate) return [];
    return getSlotsForDate(selectedDate);
  }, [selectedDate, getSlotsForDate]);

  useEffect(() => {
    if (!selectedDate || success) return;
    setAvailabilityRefreshing(true);
    const timeout = window.setTimeout(() => setAvailabilityRefreshing(false), 220);
    return () => window.clearTimeout(timeout);
  }, [selectedDate, partySize, success]);

  const nextAvailability = useMemo(() => {
    for (const date of days) {
      if (selectedDate && date.toDateString() === selectedDate.toDateString()) continue;
      const slots = getSlotsForDate(date);
      if (slots.length > 0) {
        return { date, time: slots[0] };
      }
    }
    return null;
  }, [days, selectedDate, getSlotsForDate]);

  const lunchSlots = useMemo(
    () =>
      timeSlots.filter((time) => {
        const hour = Number(time.split(':')[0]);
        return hour >= 11 && hour < 15;
      }),
    [timeSlots],
  );
  const dinnerSlots = useMemo(
    () =>
      timeSlots.filter((time) => {
        const hour = Number(time.split(':')[0]);
        return hour >= 18;
      }),
    [timeSlots],
  );
  const otherSlots = useMemo(
    () =>
      timeSlots.filter((time) => {
        const hour = Number(time.split(':')[0]);
        return hour < 11 || (hour >= 15 && hour < 18);
      }),
    [timeSlots],
  );

  const labelClass =
    'flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--reservation-soft))] sm:text-[12px]';
  const softPillClass =
    'border border-white/60 bg-white/[0.52] text-[hsl(var(--reservation-soft))] shadow-sm backdrop-blur-2xl transition-all duration-200 hover:-translate-y-0.5 hover:border-white/80 hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--reservation-blue)/0.22)]';
  const selectedPillClass =
    'scale-105 border-[hsl(var(--reservation-ink))] bg-[hsl(var(--reservation-ink))] text-[hsl(var(--reservation-panel))] shadow-lg shadow-black/10';
  const fieldClass =
    'h-[3.25rem] w-full rounded-2xl border border-white/60 bg-white/38 px-5 text-sm font-medium text-[hsl(var(--reservation-ink))] shadow-inner outline-none backdrop-blur-2xl transition-all duration-200 placeholder:text-[hsl(var(--reservation-muted))] focus:border-white/80 focus:bg-white/62 focus:ring-2 focus:ring-[hsl(var(--reservation-blue)/0.18)]';

  const backgroundClass =
    'relative min-h-screen overflow-hidden bg-[hsl(var(--reservation-bg))] font-sans text-[hsl(var(--reservation-ink))] antialiased';
  const backgroundStyle = {
    ...reservationTheme,
    backgroundImage:
      'radial-gradient(circle at 50% 20%, hsl(var(--reservation-glow)/0.2), transparent 18rem), linear-gradient(145deg, hsl(var(--reservation-wash)) 0%, hsl(var(--reservation-bg)) 46%, hsl(34 20% 86%) 100%)',
  };
  const consoleClass =
    // Mobile: bottom sheet — opaque enough for Safari, scrollable, and safe-area aware.
    'absolute bottom-0 left-1/2 -translate-x-1/2 z-10 w-full max-h-[min(68dvh,36rem)] sm:max-h-[50dvh] lg:max-h-[50dvh] overflow-y-auto scrollbar-none rounded-t-[2.25rem] rounded-b-none border border-white/70 bg-[hsl(var(--reservation-wash)/0.96)] px-3.5 pb-[calc(env(safe-area-inset-bottom)+6.5rem)] pt-2 shadow-[0_-24px_80px_rgba(0,0,0,0.18)] backdrop-blur-2xl ' +
    // Tablet+: bottom sheet styling and layout spacing
    'sm:p-6 sm:pb-8 sm:max-w-[48rem] ' +
    // Desktop: larger, compact reservation console that fits in one viewport.
    'lg:bottom-4 lg:max-h-[calc(100dvh-2rem)] lg:max-w-[74rem] lg:overflow-visible lg:rounded-[1.75rem] lg:p-5';
  const glassCardClass =
    'rounded-[1.6rem] border border-white/[0.62] bg-white/[0.58] shadow-sm backdrop-blur-2xl sm:bg-white/[0.34]';

  // Generate Google and ICS Calendar exports
  const calendarUrls = useMemo(() => {
    if (!selectedDate || !selectedTime || !restaurant) return { google: '', ics: '' };
    try {
      const [hours, minutes] = selectedTime.split(':').map(Number);
      const start = new Date(selectedDate);
      start.setHours(hours, minutes, 0, 0);

      // End is 2 hours later
      const end = new Date(start);
      end.setHours(end.getHours() + 2);

      const formatUTC = (date: Date) => {
        return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      };

      const dtStart = formatUTC(start);
      const dtEnd = formatUTC(end);
      const title = `Table chez ${restaurant.name}`;
      const details = `Réservation pour ${partySize} personnes.\nNom : ${customerName}\nTéléphone : ${customerPhone}`;
      const location = restaurant.address || restaurant.name;

      const googleUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${dtStart}/${dtEnd}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(location)}`;

      const icsContent = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        `SUMMARY:${escapeICS(title)}`,
        `DTSTART:${dtStart}`,
        `DTEND:${dtEnd}`,
        `DESCRIPTION:${escapeICS(details)}`,
        `LOCATION:${escapeICS(location)}`,
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const icsUrl = `data:text/calendar;charset=utf-8,${encodeURIComponent(icsContent)}`;

      return { google: googleUrl, ics: icsUrl };
    } catch (e) {
      return { google: '', ics: '' };
    }
  }, [selectedDate, selectedTime, restaurant, partySize, customerName, customerPhone]);

  // Submit Reservation
  async function handleSubmit() {
    if (!selectedDate || !selectedTime || !customerName || !customerPhone) {
      setError('Veuillez remplir tous les champs requis');
      return;
    }

    const phoneDigits = customerPhone.replace(/\D/g, '');
    if (phoneDigits.length < 10) {
      setError('Veuillez entrer un numéro de téléphone valide (10 chiffres minimum).');
      return;
    }

    setSubmitting(true);
    setError('');

    const [hours, minutes] = selectedTime.split(':').map(Number);
    const reservedAt = new Date(selectedDate);
    reservedAt.setHours(hours, minutes, 0, 0);

    try {
      const normalizedPhone = customerPhone.replace(/\s/g, '');
      const res = await post('reservations', {
        restaurantId,
        reservedAt: reservedAt.toISOString(),
        partySize,
        customerName,
        customerPhone: normalizedPhone.startsWith('+')
          ? normalizedPhone
          : `+33${normalizedPhone.replace(/^0/, '')}`,
        customerEmail: customerEmail || undefined,
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
        <div
          className="absolute inset-x-0 top-0 z-[1] h-[50dvh] bg-cover bg-center lg:h-[42dvh]"
          style={{
            backgroundImage: `linear-gradient(rgba(0,0,0,0.42), rgba(0,0,0,0.1), rgba(0,0,0,0.5)), url("${FALLBACK_RESTAURANT_IMAGE}")`,
          }}
        />
        <div className="absolute inset-x-0 top-0 z-[2] flex h-[46dvh] flex-col items-center justify-center px-6 text-center lg:h-[24dvh]">
          <Skeleton className="h-4 w-20 bg-white/30" />
          <Skeleton className="mt-2 h-10 w-48 bg-white/30" />
          <Skeleton className="mt-2 h-4 w-32 bg-white/30" />
        </div>
        <main className="relative h-[100dvh] w-full overflow-hidden">
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
        </main>
      </div>
    );
  }

  if (error && !restaurant) {
    return (
      <div className={backgroundClass} style={backgroundStyle}>
        <main className="relative h-[100dvh] w-full overflow-hidden">
          <div className={cn(consoleClass, 'p-6 text-center flex flex-col items-center justify-center min-h-[30dvh]')}>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-destructive/50 bg-destructive/10 text-destructive">
              <AlertCircle size={28} />
            </div>
            <h1 className="text-xl font-bold text-[hsl(var(--reservation-ink))]">Oups !</h1>
            <p className="mt-2 text-sm text-[hsl(var(--reservation-soft))]">{error}</p>
          </div>
        </main>
      </div>
    );
  }

  const restaurantImage =
    restaurant?.heroImageUrl ||
    restaurant?.coverImageUrl ||
    restaurant?.imageUrl ||
    FALLBACK_RESTAURANT_IMAGE;
  const cardImage =
    restaurant?.imageUrl || restaurant?.coverImageUrl || restaurantImage || FALLBACK_DISH_IMAGE;
  const restaurantSubtitle =
    restaurant?.cuisine && restaurant?.city
      ? `${restaurant.cuisine} · ${restaurant.city}`
      : restaurant?.tags?.length
        ? restaurant.tags.slice(0, 3).join(' · ')
        : restaurant?.city || restaurant?.address || 'Dîner · Terrasse · Cocktails';
  const selectedDateLong = selectedDate ? formatLongFrenchDate(selectedDate) : 'Date à choisir';
  const selectedDateShort = selectedDate ? formatShortFrenchDate(selectedDate) : 'Date';
  const hasService = timeSlots.length > 0;
  // TODO: brancher sur vraie API GET /restaurants/:id/availability?date=&partySize=
  const isFullyBooked = false;
  const serviceLabel =
    dinnerSlots.length > 0 && lunchSlots.length > 0
      ? 'Table'
      : dinnerSlots.length > 0
        ? 'Dîner'
        : lunchSlots.length > 0
          ? 'Déjeuner'
          : 'Réservation';
  const reservationStatus = selectedTime
    ? 'À confirmer'
    : isFullyBooked
      ? 'Complet'
      : hasService
        ? 'Disponible'
        : 'Indisponible';
  const reservationTitle = selectedTime
    ? `Table à ${selectedTime.replace(':', 'h')}`
    : isFullyBooked
      ? 'Toutes les tables sont réservées'
      : hasService
        ? `${serviceLabel} au ${restaurant?.name || 'restaurant'}`
        : 'Aucun service ce jour-là';
  const nextAvailabilityLabel = nextAvailability
    ? `${formatLongFrenchDate(nextAvailability.date)} · ${nextAvailability.time.replace(':', 'h')}`
    : '';

  const canProceed =
    step === 1 ? Boolean(selectedTime) : Boolean(!submitting && customerName && customerPhone);
  const primaryCtaLabel =
    step === 1
      ? selectedTime
        ? `Continuer · ${selectedTime.replace(':', 'h')}`
        : isFullyBooked
          ? nextAvailability
            ? 'Voir les prochaines disponibilités'
            : 'Voir les autres dates'
          : hasService
            ? 'Sélectionnez un horaire'
            : nextAvailability
              ? 'Voir les prochaines disponibilités'
              : 'Voir les autres dates'
      : submitting
        ? 'Validation...'
        : 'Valider la réservation';
  const primaryCtaDisabled = step === 1 ? false : !canProceed;

  function goToNextAvailability() {
    if (!nextAvailability) return;
    triggerHaptic();
    setSelectedDate(nextAvailability.date);
    setSelectedTime('');
    setActiveSection('time');
    setTimeout(() => {
      timeSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);
  }

  function handlePrimaryAction() {
    if (step === 1 && !selectedTime && (!hasService || isFullyBooked)) {
      goToNextAvailability();
      return;
    }

    if (step === 1 && hasService && !selectedTime && !isFullyBooked) {
      setError('Choisissez un créneau horaire pour continuer.');
      setActiveSection('time');
      setTimeout(() => {
        timeSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 80);
      return;
    }

    if (step === 1 && selectedTime) {
      triggerHaptic();
      setStep(2);
      setError('');
      return;
    }

    if (step === 2) {
      handleSubmit();
    }
  }

  return (
    <div className={backgroundClass} style={backgroundStyle}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-white/30 to-transparent" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[34rem] w-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[hsl(var(--reservation-glow)/0.11)] blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,hsl(var(--reservation-ink)/0.025)_1px,transparent_1px)] bg-[length:96px_96px] opacity-30" />

      <main className="relative h-[100dvh] w-full overflow-hidden">
        <div
          className="absolute inset-x-0 top-0 z-[1] h-[50dvh] bg-cover bg-center"
          style={{
            backgroundImage: `linear-gradient(rgba(0,0,0,0.42), rgba(0,0,0,0.1), rgba(0,0,0,0.5)), url("${restaurantImage}")`,
          }}
        />

        <div className="absolute inset-x-0 top-0 z-[2] flex h-[46dvh] flex-col items-center justify-center px-6 text-center">
          <p className="text-[10px] sm:text-xs font-bold uppercase tracking-[0.22em] text-white/70">
            {success ? 'Confirmation' : 'Réserver'}
          </p>
          <h1 className="mt-1 text-[2.35rem] sm:text-4xl md:text-5xl font-black leading-none tracking-[-0.04em] text-white drop-shadow-lg">
            {restaurant?.name || 'Restaurant'}
          </h1>
          <p className="mt-2 max-w-[18rem] sm:max-w-md text-sm sm:text-base font-semibold text-white/78 drop-shadow">
            {restaurantSubtitle}
          </p>
        </div>
        <section className={consoleClass}>
          {/* Drag handle — mobile only */}
          <div className="mx-auto mb-1.5 mt-0.5 h-1 w-10 shrink-0 rounded-full bg-black/10 sm:hidden" />

          {/* Progress bar — mobile only */}
          <div className="mx-auto mb-3 grid grid-cols-2 gap-2 px-1 sm:hidden">
            <div className="h-1.5 rounded-full bg-[hsl(var(--reservation-ink))]" />
            <div
              className={cn(
                'h-1.5 rounded-full transition-colors',
                step === 2 ? 'bg-[hsl(var(--reservation-ink))]' : 'bg-black/10',
              )}
            />
          </div>

          {/* Close button — mobile only */}
          <button
            type="button"
            onClick={() => {
              try {
                if (window.parent) {
                  window.parent.postMessage({ type: 'sokar-widget-close' }, '*');
                }
              } catch (e) {}
              try {
                window.close();
              } catch (e) {}
            }}
            className="absolute right-3.5 top-2 z-30 flex h-12 w-12 items-center justify-center rounded-full border border-white/70 bg-white/75 text-[hsl(var(--reservation-ink)/0.55)] shadow-[0_8px_24px_rgba(0,0,0,0.08)] backdrop-blur-2xl transition-all duration-200 hover:bg-white/85 active:scale-95 sm:hidden"
            aria-label="Fermer"
          >
            <X size={18} />
          </button>
          <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent" />
          <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-[hsl(var(--reservation-glow)/0.16)] blur-3xl" />

          <div className="relative z-10 space-y-2 sm:space-y-6">
            {/* Header — visible partout pour indiquer le nom du restaurant */}
            <header className="hidden items-center justify-between gap-3 sm:flex lg:hidden">
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
              <span className="hidden sm:inline-block shrink-0 rounded-full border border-white/70 bg-white/44 px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[hsl(var(--reservation-muted))] shadow-sm backdrop-blur-2xl">
                Réservation
              </span>
            </header>

            {success ? (
              <div className="animate-in fade-in zoom-in-95 duration-500 space-y-5 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-white/70 bg-white/46 text-[hsl(var(--reservation-success))] shadow-lg shadow-black/5 backdrop-blur-2xl">
                  <CheckCircle2 size={34} />
                </div>
                <div>
                  <h2 className="text-2xl font-bold tracking-normal text-[hsl(var(--reservation-ink))]">
                    Table réservée !
                  </h2>
                  <p className="mx-auto mt-1 max-w-xs text-xs text-[hsl(var(--reservation-muted))]">
                    Un SMS de confirmation a été envoyé au{' '}
                    {confirmedReservation?.customerPhone || customerPhone}.
                  </p>
                  {confirmedReservation?.id && (
                    <p className="mt-2 text-[10px] font-mono text-[hsl(var(--reservation-soft))]">
                      N° de réservation : {confirmedReservation.id.slice(0, 12)}...
                    </p>
                  )}
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

                {/* Agenda Export Button & Dropdown */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowCalendarMenu(!showCalendarMenu)}
                    className="flex w-full items-center justify-center gap-2 rounded-full border border-white/70 bg-white/44 py-3.5 text-sm font-semibold text-[hsl(var(--reservation-ink))] shadow-sm backdrop-blur-2xl transition-all duration-200 hover:bg-white/60 active:scale-[0.98]"
                  >
                    <CalendarCheck size={16} />
                    Ajouter à mon agenda
                  </button>

                  {showCalendarMenu && (
                    <div className="animate-in fade-in slide-in-from-top-2 duration-200 absolute left-0 right-0 z-20 mt-2 rounded-2xl border border-white/60 bg-white/90 p-2 shadow-xl backdrop-blur-2xl flex flex-col gap-1">
                      <a
                        href={calendarUrls.google}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setShowCalendarMenu(false)}
                        className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-left text-sm font-medium text-[hsl(var(--reservation-ink))] hover:bg-black/5 transition-colors"
                      >
                        <span className="h-2 w-2 rounded-full bg-blue-500" />
                        Google Calendar
                      </a>
                      <a
                        href={calendarUrls.ics}
                        download={`reservation-${restaurant?.name.replace(/\s+/g, '-').toLowerCase()}.ics`}
                        onClick={() => setShowCalendarMenu(false)}
                        className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-left text-sm font-medium text-[hsl(var(--reservation-ink))] hover:bg-black/5 transition-colors"
                      >
                        <Download size={14} className="text-[hsl(var(--reservation-soft))]" />
                        Apple Calendar / Outlook (.ics)
                      </a>
                    </div>
                  )}
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
                    setCustomerEmail('');
                    setPartySize(2);
                    setError('');
                    setConfirmedReservation(null);
                    setShowCalendarMenu(false);
                    const today = new Date();
                    setSelectedDate(today);
                  }}
                  className="w-full rounded-full bg-[hsl(var(--reservation-ink))] py-4 text-sm font-semibold text-white shadow-lg shadow-black/10 transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.97]"
                >
                  Faire une autre réservation
                </button>
              </div>
            ) : (
              <div className="space-y-2 lg:grid lg:grid-cols-[minmax(19rem,0.82fr)_minmax(0,1.68fr)] lg:gap-5 lg:space-y-0">
                {/* Colonne gauche — inclut le header sur desktop */}
                <div className="space-y-2 sm:space-y-4 lg:space-y-2">
                  {/* Header desktop — intégré dans la colonne gauche */}
                  <div className="hidden items-center gap-3 lg:flex">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/70 bg-white/50 text-[hsl(var(--reservation-soft))] shadow-sm backdrop-blur-2xl">
                      <Utensils size={16} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-[hsl(var(--reservation-ink))]">
                        {restaurant?.name || 'Restaurant'}
                      </p>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--reservation-muted))]">
                        Réserver
                      </p>
                    </div>
                  </div>

                  <div className="relative overflow-hidden rounded-[1.75rem] border border-white/70 bg-[hsl(var(--reservation-line)/0.72)] p-2 shadow-sm backdrop-blur-2xl sm:rounded-[2rem] sm:p-3 lg:rounded-[1.35rem] lg:p-2">
                    <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-[hsl(var(--reservation-glow)/0.16)] blur-2xl" />
                    <p className="px-1 pb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--reservation-soft))] sm:text-xs lg:pb-1">
                      {step === 2 ? 'Résumé' : 'Votre réservation'}
                    </p>
                    <div className="relative flex gap-3 lg:gap-2.5">
                      <div
                        className="h-24 w-24 shrink-0 rounded-[1.45rem] bg-cover bg-center shadow-sm sm:h-28 sm:w-28 sm:rounded-[1.6rem] lg:h-[4.9rem] lg:w-[4.9rem] lg:rounded-[1.1rem]"
                        style={{ backgroundImage: `url("${cardImage}")` }}
                      />
                      <div className="min-w-0 flex-1 py-1 pr-1">
                        <span
                          className={cn(
                            'inline-flex rounded-full bg-white/75 px-3 py-1 text-[11px] font-extrabold text-[hsl(var(--reservation-ink))] shadow-sm backdrop-blur-xl',
                            reservationStatus === 'Disponible'
                              ? 'text-[hsl(var(--reservation-success))]'
                              : reservationStatus === 'Indisponible'
                                ? 'text-[hsl(var(--reservation-soft))]'
                                : reservationStatus === 'Complet'
                                  ? 'text-red-600'
                                  : 'text-[hsl(var(--reservation-ink))]',
                          )}
                        >
                          {reservationStatus}
                        </span>
                        <h2 className="mt-2 line-clamp-2 text-[17px] font-black leading-tight tracking-[-0.03em] text-[hsl(var(--reservation-ink))] sm:text-lg lg:mt-1 lg:text-[15px]">
                          {reservationTitle}
                        </h2>
                        <p className="mt-1 text-[12px] font-semibold leading-snug text-[hsl(var(--reservation-soft))] sm:text-sm lg:mt-0 lg:text-xs">
                          {selectedDateLong} · {partySize}{' '}
                          {partySize > 1 ? 'personnes' : 'personne'}
                        </p>
                        {selectedTime && (
                          <p className="mt-0.5 text-[12px] font-bold text-[hsl(var(--reservation-ink))]">
                            Créneau sélectionné · {selectedTime.replace(':', 'h')}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-[1.4rem] border border-white/60 bg-white/40 p-3 shadow-sm backdrop-blur-2xl lg:rounded-[1.1rem] lg:p-2">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--reservation-soft))]">
                        Ambiance
                      </p>
                      <div className="mt-2 flex items-center lg:mt-1.5">
                        {(restaurant?.galleryImages?.length
                          ? restaurant.galleryImages.slice(0, 3)
                          : [cardImage, restaurantImage, FALLBACK_DISH_IMAGE]
                        ).map((img, idx) => (
                          <div
                            key={idx}
                            className="-mr-2 h-8 w-8 rounded-full border-2 border-white/80 bg-cover bg-center shadow-sm lg:h-7 lg:w-7"
                            style={{ backgroundImage: `url("${img}")` }}
                          />
                        ))}
                        <span className="ml-3 text-[11px] font-extrabold text-[hsl(var(--reservation-soft))]">
                          {restaurant?.tags?.slice(0, 2).join(' · ') || 'Terrasse'}
                        </span>
                      </div>
                    </div>
                    <div className="h-12 w-px bg-[hsl(var(--reservation-line))] lg:h-10" />
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[hsl(var(--reservation-soft))]">
                        Votre date
                      </p>
                      <p className="mt-1 text-sm font-black leading-tight text-[hsl(var(--reservation-ink))]">
                        {selectedDateShort}
                      </p>
                      <p className="text-xs font-semibold text-[hsl(var(--reservation-soft))]">
                        {partySize} pers.
                      </p>
                    </div>
                  </div>

                  {step === 2 && (
                    <div className={cn(glassCardClass, 'flex overflow-hidden')}>
                      <div className="flex w-[6.5rem] flex-col items-center justify-center border-r border-white/50 bg-white/24 p-3 text-center">
                        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[hsl(var(--reservation-muted))]">
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
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[hsl(var(--reservation-blue))]">
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
                <div className="space-y-3 sm:space-y-5 lg:space-y-2.5">
                  {/* Badge Réservation — desktop only, aligns with left col header */}
                  <div className="hidden lg:flex lg:items-center lg:justify-end">
                    <span className="rounded-full border border-white/70 bg-white/44 px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[hsl(var(--reservation-muted))] shadow-sm backdrop-blur-2xl">
                      Réservation
                    </span>
                  </div>
                  {error && (
                    <div className="flex items-center gap-2 rounded-2xl border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                      <AlertCircle size={16} className="shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}

                  {step === 1 ? (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-300 space-y-3 sm:space-y-5 lg:space-y-2.5">
                      <div
                        className={cn(
                          'space-y-2 sm:space-y-2.5 transition-opacity duration-200',
                          activeSection !== 'party' && 'opacity-90',
                        )}
                        onClickCapture={() => setActiveSection('party')}
                      >
                        <label className={cn(labelClass)}>
                          <Users size={13} />
                          Nombre de personnes
                        </label>
                        <div className="scrollbar-none flex gap-2 overflow-x-auto pb-1 lg:grid lg:grid-cols-8 lg:overflow-visible lg:pb-0">
                          {[1, 2, 3, 4, 5, 6, 7, 8].map((size) => (
                            <button
                              key={size}
                              type="button"
                              aria-label={`${size} ${size > 1 ? 'personnes' : 'personne'}`}
                              aria-pressed={partySize === size}
                              onClick={() => {
                                triggerHaptic();
                                setPartySize(size);
                                setSelectedTime('');
                                setError('');
                                setActiveSection('date');
                              }}
                              className={cn(
                                'h-12 w-12 shrink-0 rounded-full text-[15px] font-extrabold transition-all duration-200 active:scale-95 sm:h-14 sm:w-14 sm:text-base lg:h-10 lg:w-10',
                                softPillClass,
                                partySize === size ? selectedPillClass : '',
                              )}
                            >
                              {size}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div
                        className={cn(
                          'space-y-1.5 sm:space-y-2.5 transition-opacity duration-200',
                          activeSection !== 'date' && 'opacity-90',
                        )}
                        onClickCapture={() => setActiveSection('date')}
                      >
                        <label className={cn(labelClass)}>
                          <CalendarIcon size={13} />
                          Sélectionner la date
                        </label>
                        <div className="scrollbar-none flex snap-x gap-2 overflow-x-auto pb-1 lg:grid lg:grid-cols-7 lg:overflow-visible lg:pb-0">
                          {days.map((date, idx) => {
                            const isSelected = selectedDate?.toDateString() === date.toDateString();
                            const dateSlots = getSlotsForDate(date);
                            const isAvailable = dateSlots.length > 0;
                            return (
                              <button
                                key={idx}
                                type="button"
                                aria-label={`${formatLongFrenchDate(date)} ${isAvailable ? 'disponible' : 'indisponible'}`}
                                aria-pressed={isSelected}
                                onClick={() => {
                                  triggerHaptic();
                                  setSelectedDate(date);
                                  setSelectedTime('');
                                  setError('');
                                  setActiveSection('time');
                                  setTimeout(() => {
                                    timeSectionRef.current?.scrollIntoView({
                                      behavior: 'smooth',
                                      block: 'nearest',
                                    });
                                  }, 80);
                                }}
                                aria-disabled={!isAvailable}
                                className={cn(
                                  'relative flex h-[4.4rem] min-w-[4.75rem] shrink-0 snap-center flex-col items-center justify-center overflow-hidden rounded-[1.35rem] text-center transition-all duration-200 active:scale-95 sm:h-[4.8rem] sm:min-w-[5rem] sm:rounded-[1.45rem] lg:h-[3.35rem] lg:min-w-0 lg:rounded-[1rem]',
                                  softPillClass,
                                  !isAvailable && !isSelected ? 'opacity-45' : '',
                                  isSelected
                                    ? 'border-[hsl(var(--reservation-ink))] bg-[hsl(var(--reservation-ink))] text-[hsl(var(--reservation-panel))] shadow-lg shadow-black/10 hover:bg-[hsl(var(--reservation-ink))] hover:text-[hsl(var(--reservation-panel))]'
                                    : '',
                                )}
                              >
                                {isAvailable && !isSelected && (
                                  <span className="absolute bottom-2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[hsl(var(--reservation-glow))]" />
                                )}
                                {!isAvailable && !isSelected && (
                                  <span className="absolute bottom-2 left-1/2 h-1 w-5 -translate-x-1/2 rounded-full bg-black/15" />
                                )}
                                {isSelected && (
                                  <span className="absolute bottom-1.5 left-1/2 h-1 w-6 -translate-x-1/2 rounded-full bg-[hsl(var(--reservation-blue))]" />
                                )}
                                <span className="text-[22px] font-black leading-none tracking-normal sm:text-2xl lg:text-lg">
                                  {date.getDate()}
                                </span>
                                <span className="mt-1 text-[10px] font-extrabold uppercase tracking-[0.12em] opacity-75">
                                  {FRENCH_DAYS_SHORT[date.getDay()]}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div
                        ref={timeSectionRef}
                        className={cn(
                          'space-y-2 sm:space-y-2.5 transition-opacity duration-200',
                          activeSection !== 'time' && 'opacity-90',
                        )}
                        onClickCapture={() => setActiveSection('time')}
                      >
                        <label className={cn(labelClass)}>
                          <Clock size={13} />
                          Créneau horaire
                        </label>
                        {availabilityRefreshing ? (
                          <div className="animate-in fade-in slide-in-from-right-2 duration-200 grid grid-cols-3 gap-2 lg:grid-cols-6">
                            {[1, 2, 3, 4, 5, 6].map((item) => (
                              <Skeleton key={item} className="h-12 rounded-full bg-white/55" />
                            ))}
                          </div>
                        ) : timeSlots.length > 0 ? (
                          <div className="scrollbar-none max-h-[12rem] space-y-3 overflow-y-auto pr-1 lg:max-h-[7.5rem] lg:space-y-2">
                            {[
                              { title: 'Déjeuner', slots: lunchSlots },
                              { title: 'Dîner', slots: dinnerSlots },
                              { title: 'Autres horaires', slots: otherSlots },
                            ]
                              .filter((group) => group.slots.length > 0)
                              .map((group) => (
                                <div key={group.title} className="space-y-2">
                                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[hsl(var(--reservation-muted))]">
                                    {group.title}
                                  </p>
                                  <div className="grid grid-cols-3 gap-2 lg:grid-cols-6">
                                    {group.slots.map((time) => {
                                      const isSelected = selectedTime === time;
                                      return (
                                        <button
                                          key={time}
                                          type="button"
                                          aria-label={`Choisir le créneau ${time.replace(':', 'h')}`}
                                          aria-pressed={isSelected}
                                          onClick={() => {
                                            triggerHaptic();
                                            setSelectedTime(time);
                                            setError('');
                                          }}
                                          className={cn(
                                            'h-12 rounded-full px-4 text-center text-sm font-extrabold transition-all duration-200 active:scale-95 lg:h-10',
                                            softPillClass,
                                            isSelected ? selectedPillClass : '',
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
                          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 rounded-[1.5rem] border border-white/70 bg-white/50 p-3 shadow-sm backdrop-blur-2xl sm:p-5 lg:rounded-[1.1rem] lg:p-2.5">
                            <div className="flex items-start gap-3">
                              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/60 text-[hsl(var(--reservation-muted))] shadow-inner lg:h-9 lg:w-9">
                                <Utensils size={18} className="opacity-70" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-black tracking-tight text-[hsl(var(--reservation-ink))]">
                                  {isFullyBooked
                                    ? 'Complet ce jour-là'
                                    : 'Aucun service ce jour-là'}
                                </p>
                                <p className="mt-1 text-xs font-semibold leading-snug text-[hsl(var(--reservation-soft))]">
                                  {isFullyBooked
                                    ? 'Toutes les tables sont réservées. Essayez une autre date.'
                                    : nextAvailabilityLabel
                                      ? `Prochaine disponibilité : ${nextAvailabilityLabel}`
                                      : 'Essayez une autre date ou une autre taille de table.'}
                                </p>
                              </div>
                            </div>
                            {nextAvailability && (
                              <button
                                type="button"
                                onClick={goToNextAvailability}
                                className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-full bg-white/70 px-4 text-sm font-extrabold text-[hsl(var(--reservation-ink))] shadow-sm transition-all duration-200 hover:-translate-y-0.5 active:scale-95"
                              >
                                Voir les prochaines disponibilités
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="animate-in fade-in slide-in-from-right-4 duration-300 space-y-3">
                      <button
                        type="button"
                        onClick={() => {
                          setStep(1);
                          setError('');
                        }}
                        className={cn(
                          'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold',
                          softPillClass,
                        )}
                      >
                        <ChevronLeft size={18} />
                        Retour aux créneaux
                      </button>

                      <div className="space-y-1.5">
                        <label htmlFor="customerName" className={cn(labelClass, 'ml-2')}>
                          <User size={12} />
                          Nom complet *
                        </label>
                        <input
                          id="customerName"
                          value={customerName}
                          onChange={(e) => setCustomerName(e.target.value)}
                          placeholder="Alice Martin"
                          required
                          className={fieldClass}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label htmlFor="customerPhone" className={cn(labelClass, 'ml-2')}>
                          <Phone size={12} />
                          Téléphone *
                        </label>
                        <input
                          id="customerPhone"
                          type="tel"
                          value={customerPhone}
                          onChange={(e) => setCustomerPhone(e.target.value)}
                          placeholder="0612345678"
                          required
                          className={fieldClass}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label htmlFor="customerEmail" className={cn(labelClass, 'ml-2')}>
                          <Mail size={12} />
                          Adresse Email (optionnel)
                        </label>
                        <input
                          id="customerEmail"
                          type="email"
                          value={customerEmail}
                          onChange={(e) => setCustomerEmail(e.target.value)}
                          placeholder="client@sokar.fr"
                          className={fieldClass}
                        />
                      </div>
                    </div>
                  )}

                  {step === 2 && selectedDate && selectedTime && (
                    <div className="rounded-2xl border border-white/70 bg-white/45 p-3 text-sm font-semibold text-[hsl(var(--reservation-soft))] shadow-sm backdrop-blur-2xl">
                      <p className="font-black text-[hsl(var(--reservation-ink))]">
                        {selectedDateLong} · {selectedTime.replace(':', 'h')}
                      </p>
                      <p>
                        {partySize} {partySize > 1 ? 'personnes' : 'personne'} · {restaurant?.name}
                      </p>
                    </div>
                  )}

                  <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-20 pt-2 lg:static lg:pt-0">
                    <button
                      type="button"
                      onClick={handlePrimaryAction}
                      disabled={primaryCtaDisabled}
                      className={cn(
                        'flex h-14 w-full items-center justify-center gap-2 rounded-full text-[17px] font-extrabold shadow-lg transition-all duration-200 active:scale-[0.97] lg:h-11 lg:text-[15px]',
                        primaryCtaDisabled
                          ? 'cursor-not-allowed bg-white/60 text-[hsl(var(--reservation-soft))] shadow-sm'
                          : 'bg-[hsl(var(--reservation-ink))] text-white shadow-black/15 hover:-translate-y-0.5',
                      )}
                    >
                      {primaryCtaLabel}
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/12">
                        {submitting ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : step === 1 ? (
                          <ChevronRight size={17} />
                        ) : (
                          <CheckCircle2 size={17} />
                        )}
                      </span>
                    </button>
                    <p className="mt-2 px-4 text-center text-[11px] font-medium leading-snug text-[hsl(var(--reservation-soft))] lg:mt-1">
                      {step === 1
                        ? 'Choisissez un créneau pour continuer votre réservation.'
                        : 'Vous recevrez une confirmation par SMS après validation.'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="hidden sm:flex items-center justify-center gap-1.5 pt-0 lg:pt-1">
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
