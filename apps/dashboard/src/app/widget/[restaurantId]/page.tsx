'use client';

import { useEffect, useState } from 'react';
import { useApi } from '../../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
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

  // Format date text for display
  const formatDateFull = (date: Date) => {
    return `${FRENCH_DAYS[date.getDay()]} ${date.getDate()} ${FRENCH_MONTHS[date.getMonth()]}`;
  };

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

  // Submit Reservation
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
        className="min-h-screen flex flex-col justify-between p-6"
        style={{ background: '#f5f0ea' }}
      >
        <div className="space-y-4 pt-10">
          <Skeleton className="h-14 w-14 rounded-full" style={{ background: '#e8e0d6' }} />
          <Skeleton className="h-8 w-48" style={{ background: '#e8e0d6' }} />
          <Skeleton className="h-4 w-32" style={{ background: '#e8e0d6' }} />
        </div>
        <div
          className="rounded-t-[2.5rem] -mx-6 p-6 space-y-6 mt-6"
          style={{ background: 'rgba(255,255,255,0.75)' }}
        >
          <Skeleton className="h-6 w-40" style={{ background: '#e8e0d6' }} />
          <div className="flex gap-3 overflow-x-hidden">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton
                key={i}
                className="h-[90px] w-[70px] rounded-2xl flex-shrink-0"
                style={{ background: '#e8e0d6' }}
              />
            ))}
          </div>
          <Skeleton className="h-[50px] w-full rounded-full" style={{ background: '#e8e0d6' }} />
        </div>
      </div>
    );
  }

  /* ─── ERROR STATE ─── */
  if (error && !restaurant) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center p-6 text-center"
        style={{ background: '#f5f0ea', color: '#3f3f46' }}
      >
        <AlertCircle size={48} className="mb-4" style={{ color: '#dc2626' }} />
        <h1 className="text-xl font-bold" style={{ color: '#18181b' }}>
          Oups !
        </h1>
        <p className="text-sm mt-2" style={{ color: '#71717a' }}>
          {error}
        </p>
      </div>
    );
  }

  /* ─── MAIN WIDGET ─── */
  return (
    <div
      className="min-h-screen font-sans antialiased relative overflow-hidden flex flex-col"
      style={{
        background: 'linear-gradient(180deg, #f5f0ea 0%, #ebe4db 40%, #e8e0d6 100%)',
        color: '#3f3f46',
      }}
    >
      {/* Ambient warm radial glows */}
      <div
        className="absolute -left-24 -top-24 w-80 h-80 rounded-full pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(194,168,128,0.25) 0%, transparent 70%)',
          filter: 'blur(60px)',
        }}
      />
      <div
        className="absolute -right-16 top-1/3 w-72 h-72 rounded-full pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(59,130,246,0.12) 0%, transparent 70%)',
          filter: 'blur(80px)',
        }}
      />

      {/* ─── TOP HEADER ─── */}
      <div className="relative z-10 px-6 pt-12 pb-6 flex flex-col gap-4">
        {/* Brand Bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="h-11 w-11 rounded-full flex items-center justify-center"
              style={{
                background: 'rgba(255,255,255,0.7)',
                border: '1px solid rgba(0,0,0,0.06)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              }}
            >
              <Utensils size={18} style={{ color: '#78716c' }} />
            </div>
            <span
              className="text-sm font-semibold tracking-wide"
              style={{ color: '#78716c', letterSpacing: '0.04em' }}
            >
              {restaurant?.name || 'Restaurant'}
            </span>
          </div>
          <span
            className="text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full"
            style={{
              background: 'rgba(255,255,255,0.6)',
              color: '#a8a29e',
              border: '1px solid rgba(0,0,0,0.04)',
              letterSpacing: '0.1em',
            }}
          >
            Réservation
          </span>
        </div>

        {/* Large Title */}
        <div>
          <h1
            className="text-[2.5rem] leading-[0.95] font-extrabold tracking-tight"
            style={{
              color: '#1c1917',
              fontFamily: "'Inter', system-ui, sans-serif",
            }}
          >
            {selectedDate && !success
              ? FRENCH_DAYS[selectedDate.getDay()].substring(0, 3)
              : 'Votre'}
          </h1>
          <h1
            className="text-[2.5rem] leading-[0.95] font-extrabold tracking-tight"
            style={{
              color: '#1c1917',
              fontFamily: "'Inter', system-ui, sans-serif",
            }}
          >
            {selectedDate && !success ? (
              <>
                {selectedDate.getDate()}
                <span style={{ color: '#a8a29e' }}>
                  {' '}
                  {FRENCH_MONTHS[selectedDate.getMonth()].substring(0, 3)}
                </span>
              </>
            ) : (
              <>
                table<span style={{ color: '#a8a29e' }}>.</span>
              </>
            )}
          </h1>
        </div>
      </div>

      {/* ─── GLASSMORPHIC WHITE CARD ─── */}
      <div
        className="relative z-10 rounded-t-[2rem] flex-1 flex flex-col justify-between px-6 pt-7 pb-10"
        style={{
          background: 'rgba(255,255,255,0.82)',
          backdropFilter: 'blur(24px) saturate(140%)',
          WebkitBackdropFilter: 'blur(24px) saturate(140%)',
          borderTop: '1px solid rgba(255,255,255,0.6)',
          boxShadow: '0 -12px 40px rgba(0,0,0,0.06)',
        }}
      >
        {/* Blue accent semi-circle (inspired by Card 2) */}
        <div
          className="absolute -right-5 top-24 w-10 h-20 rounded-l-full pointer-events-none"
          style={{
            background: 'linear-gradient(180deg, #3b82f6 0%, #60a5fa 100%)',
            opacity: 0.18,
          }}
        />
        <div
          className="absolute right-0 top-16 w-32 h-32 rounded-full pointer-events-none"
          style={{
            background: 'radial-gradient(circle, rgba(59,130,246,0.08) 0%, transparent 70%)',
            filter: 'blur(20px)',
          }}
        />

        {success ? (
          /* ─── SUCCESS VIEW ─── */
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-6 py-4">
            <div className="relative">
              <div
                className="absolute inset-0 rounded-full animate-pulse"
                style={{
                  background: 'radial-gradient(circle, rgba(34,197,94,0.15) 0%, transparent 70%)',
                  filter: 'blur(16px)',
                }}
              />
              <CheckCircle2 size={56} className="relative z-10" style={{ color: '#22c55e' }} />
            </div>

            <div className="space-y-1">
              <h2
                className="text-2xl font-bold tracking-tight"
                style={{ color: '#1c1917' }}
              >
                Table réservée !
              </h2>
              <p className="text-xs max-w-xs mx-auto" style={{ color: '#a8a29e' }}>
                Votre réservation a été enregistrée avec succès.
              </p>
            </div>

            {/* Split Ticket Card */}
            <div
              className="w-full flex rounded-3xl overflow-hidden relative"
              style={{
                background: '#ffffff',
                border: '1px solid rgba(0,0,0,0.06)',
                boxShadow: '0 8px 30px rgba(0,0,0,0.06)',
              }}
            >
              {/* Left: Date accent */}
              <div
                className="w-1/3 py-5 px-4 flex flex-col items-center justify-center text-center"
                style={{
                  background: '#fafaf9',
                  borderRight: '1px solid rgba(0,0,0,0.04)',
                }}
              >
                <span
                  className="text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: '#a8a29e' }}
                >
                  {selectedDate && FRENCH_DAYS[selectedDate.getDay()].substring(0, 3)}
                </span>
                <span
                  className="text-4xl font-black tracking-tight my-1"
                  style={{
                    color: '#1c1917',
                    fontFamily: "'Georgia', 'Times New Roman', serif",
                  }}
                >
                  {selectedDate?.getDate()}
                </span>
                <span className="text-xs font-semibold" style={{ color: '#78716c' }}>
                  {selectedTime.replace(':', 'h')}
                </span>
              </div>

              {/* Right: Details with radial glow */}
              <div className="w-2/3 p-5 relative overflow-hidden flex flex-col justify-center">
                <div
                  className="absolute right-0 top-1/2 -translate-y-1/2 w-28 h-28 rounded-full pointer-events-none"
                  style={{
                    background: 'radial-gradient(circle, rgba(59,130,246,0.08) 0%, transparent 70%)',
                    filter: 'blur(12px)',
                  }}
                />
                <div
                  className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-12 rounded-l-full pointer-events-none"
                  style={{ background: '#3b82f6', opacity: 0.15 }}
                />

                <div className="relative z-10 space-y-1 text-left">
                  <p
                    className="text-[10px] uppercase font-bold tracking-widest"
                    style={{ color: '#3b82f6' }}
                  >
                    Réservation
                  </p>
                  <h4
                    className="font-extrabold text-sm truncate"
                    style={{ color: '#1c1917' }}
                  >
                    {restaurant?.name}
                  </h4>
                  <p className="text-xs font-semibold" style={{ color: '#78716c' }}>
                    {partySize} personne(s)
                  </p>
                  <p className="text-xs font-semibold truncate" style={{ color: '#78716c' }}>
                    Nom : {customerName}
                  </p>
                </div>
              </div>
            </div>

            {/* Heart + brand */}
            <div className="flex items-center gap-2">
              <Heart size={14} style={{ color: '#1c1917' }} fill="#1c1917" />
              <span className="text-xs font-semibold" style={{ color: '#78716c' }}>
                {restaurant?.name}
              </span>
            </div>

            <div className="w-full space-y-3">
              <p className="text-xs" style={{ color: '#a8a29e' }}>
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
                className="w-full py-4 rounded-full font-semibold text-sm transition-all duration-200 active:scale-[0.97]"
                style={{
                  background: '#1c1917',
                  color: '#ffffff',
                  boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
                }}
              >
                Faire une autre réservation
              </button>
            </div>
          </div>
        ) : (
          /* ─── FORM VIEWS ─── */
          <div className="flex-1 flex flex-col justify-between">
            {error && (
              <div
                className="mb-4 p-4 rounded-2xl flex items-center gap-2 text-sm"
                style={{
                  background: 'rgba(220,38,38,0.06)',
                  border: '1px solid rgba(220,38,38,0.15)',
                  color: '#dc2626',
                }}
              >
                <AlertCircle size={16} className="flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {step === 1 ? (
              /* ─── STEP 1: Pax, Date & Time ─── */
              <div className="space-y-6 flex-1">
                {/* Party Size */}
                <div className="space-y-3">
                  <label
                    className="text-[11px] uppercase font-bold tracking-wider flex items-center gap-1.5"
                    style={{ color: '#a8a29e' }}
                  >
                    <Users size={13} />
                    Nombre de personnes
                  </label>
                  <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((size) => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => setPartySize(size)}
                        className="flex-shrink-0 h-11 w-11 rounded-full text-sm font-semibold transition-all duration-200"
                        style={
                          partySize === size
                            ? {
                                background: '#1c1917',
                                color: '#ffffff',
                                border: '1px solid #1c1917',
                                transform: 'scale(1.08)',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                              }
                            : {
                                background: 'rgba(250,250,249,0.8)',
                                color: '#57534e',
                                border: '1px solid rgba(0,0,0,0.06)',
                              }
                        }
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Date Selector */}
                <div className="space-y-3">
                  <label
                    className="text-[11px] uppercase font-bold tracking-wider flex items-center gap-1.5"
                    style={{ color: '#a8a29e' }}
                  >
                    <CalendarIcon size={13} />
                    Sélectionner la date
                  </label>
                  <div className="flex gap-3 overflow-x-auto pb-2 snap-x scrollbar-none">
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
                          className="flex-shrink-0 flex flex-col items-center justify-center min-w-[68px] h-[88px] rounded-2xl transition-all duration-200 snap-center"
                          style={
                            isSelected
                              ? {
                                  background: '#1c1917',
                                  color: '#ffffff',
                                  border: '1px solid #1c1917',
                                  transform: 'scale(1.06)',
                                  boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
                                }
                              : {
                                  background: 'rgba(250,250,249,0.7)',
                                  color: '#57534e',
                                  border: '1px solid rgba(0,0,0,0.05)',
                                }
                          }
                        >
                          <span className="text-[22px] font-extrabold tracking-tight">
                            {date.getDate()}
                          </span>
                          <span
                            className="text-[11px] uppercase tracking-wide mt-1"
                            style={{ opacity: 0.75 }}
                          >
                            {FRENCH_DAYS[date.getDay()].substring(0, 3)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Time Slots */}
                <div className="space-y-3">
                  <label
                    className="text-[11px] uppercase font-bold tracking-wider flex items-center gap-1.5"
                    style={{ color: '#a8a29e' }}
                  >
                    <Clock size={13} />
                    Créneau horaire
                  </label>
                  {timeSlots.length > 0 ? (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 max-h-[160px] overflow-y-auto pr-1 scrollbar-none">
                      {timeSlots.map((time) => {
                        const isSelected = selectedTime === time;
                        return (
                          <button
                            key={time}
                            type="button"
                            onClick={() => setSelectedTime(time)}
                            className="py-3 px-1 rounded-xl text-sm font-semibold transition-all duration-200 text-center"
                            style={
                              isSelected
                                ? {
                                    background: '#1c1917',
                                    color: '#ffffff',
                                    border: '1px solid #1c1917',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                                  }
                                : {
                                    background: 'rgba(250,250,249,0.7)',
                                    color: '#57534e',
                                    border: '1px solid rgba(0,0,0,0.05)',
                                  }
                            }
                          >
                            {time.replace(':', 'h')}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div
                      className="flex flex-col items-center justify-center p-6 rounded-2xl"
                      style={{
                        border: '1px dashed rgba(0,0,0,0.1)',
                        color: '#a8a29e',
                      }}
                    >
                      <AlertCircle size={20} className="mb-2" style={{ opacity: 0.5 }} />
                      <span className="text-sm">Restaurant fermé à cette date.</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* ─── STEP 2: Contact Information ─── */
              <div className="space-y-5 flex-1 pt-1">
                {/* Back link */}
                <div className="flex items-center gap-2 text-sm mb-3">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="p-1.5 rounded-full transition-all duration-200"
                    style={{
                      color: '#78716c',
                      background: 'rgba(250,250,249,0.8)',
                      border: '1px solid rgba(0,0,0,0.04)',
                    }}
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <span style={{ color: '#78716c' }}>Retour aux créneaux</span>
                </div>

                {/* Summary Card */}
                <div
                  className="w-full flex rounded-3xl overflow-hidden relative mb-5"
                  style={{
                    background: '#ffffff',
                    border: '1px solid rgba(0,0,0,0.05)',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.04)',
                  }}
                >
                  <div
                    className="w-1/3 py-4 px-4 flex flex-col items-center justify-center text-center"
                    style={{
                      background: '#fafaf9',
                      borderRight: '1px solid rgba(0,0,0,0.04)',
                    }}
                  >
                    <span
                      className="text-[9px] font-bold uppercase tracking-wider"
                      style={{ color: '#a8a29e' }}
                    >
                      {selectedDate && FRENCH_DAYS[selectedDate.getDay()].substring(0, 3)}
                    </span>
                    <span
                      className="text-3xl font-black tracking-tight my-0.5"
                      style={{
                        color: '#1c1917',
                        fontFamily: "'Georgia', 'Times New Roman', serif",
                      }}
                    >
                      {selectedDate?.getDate()}
                    </span>
                    <span className="text-[11px] font-semibold" style={{ color: '#78716c' }}>
                      {selectedTime.replace(':', 'h')}
                    </span>
                  </div>

                  <div className="w-2/3 p-4 flex flex-col justify-center">
                    <div className="space-y-0.5 text-left">
                      <p
                        className="text-[9px] uppercase font-bold tracking-widest"
                        style={{ color: '#3b82f6' }}
                      >
                        Résumé
                      </p>
                      <h4
                        className="font-extrabold text-sm truncate"
                        style={{ color: '#1c1917' }}
                      >
                        {restaurant?.name}
                      </h4>
                      <p className="text-xs font-semibold" style={{ color: '#78716c' }}>
                        {partySize} personne(s)
                      </p>
                    </div>
                  </div>
                </div>

                {/* Name Input */}
                <div className="space-y-1.5">
                  <label
                    className="text-[11px] uppercase font-bold tracking-wider flex items-center gap-1.5 ml-2"
                    style={{ color: '#a8a29e' }}
                  >
                    <User size={12} />
                    Nom complet *
                  </label>
                  <input
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Alice Martin"
                    required
                    className="w-full h-14 rounded-full px-6 text-sm outline-none transition-all duration-300 focus:ring-2"
                    style={{
                      background: 'rgba(250,250,249,0.6)',
                      border: '1px solid rgba(0,0,0,0.06)',
                      color: '#1c1917',
                      boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)',
                    }}
                  />
                </div>

                {/* Phone Input */}
                <div className="space-y-1.5">
                  <label
                    className="text-[11px] uppercase font-bold tracking-wider flex items-center gap-1.5 ml-2"
                    style={{ color: '#a8a29e' }}
                  >
                    <Phone size={12} />
                    Téléphone *
                  </label>
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="0612345678"
                    required
                    className="w-full h-14 rounded-full px-6 text-sm outline-none transition-all duration-300 focus:ring-2"
                    style={{
                      background: 'rgba(250,250,249,0.6)',
                      border: '1px solid rgba(0,0,0,0.06)',
                      color: '#1c1917',
                      boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)',
                    }}
                  />
                </div>

                {/* Email Input */}
                <div className="space-y-1.5">
                  <label
                    className="text-[11px] uppercase font-bold tracking-wider flex items-center gap-1.5 ml-2"
                    style={{ color: '#a8a29e' }}
                  >
                    <Mail size={12} />
                    Adresse Email (optionnel)
                  </label>
                  <input
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="client@sokar.fr"
                    className="w-full h-14 rounded-full px-6 text-sm outline-none transition-all duration-300 focus:ring-2"
                    style={{
                      background: 'rgba(250,250,249,0.6)',
                      border: '1px solid rgba(0,0,0,0.06)',
                      color: '#1c1917',
                      boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)',
                    }}
                  />
                </div>
              </div>
            )}

            {/* ─── ACTION FOOTER ─── */}
            <div className="mt-8">
              {step === 1 ? (
                <button
                  onClick={() => setStep(2)}
                  disabled={!selectedTime}
                  className="w-full py-4 rounded-full font-semibold text-sm transition-all duration-200 active:scale-[0.97] flex items-center justify-center gap-2"
                  style={{
                    background: !selectedTime ? '#d6d3d1' : '#1c1917',
                    color: !selectedTime ? '#a8a29e' : '#ffffff',
                    boxShadow: !selectedTime ? 'none' : '0 4px 14px rgba(0,0,0,0.12)',
                    cursor: !selectedTime ? 'not-allowed' : 'pointer',
                    opacity: !selectedTime ? 0.6 : 1,
                  }}
                >
                  Continuer
                  <ChevronRight size={16} />
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={submitting || !customerName || !customerPhone}
                  className="w-full py-4 rounded-full font-semibold text-sm transition-all duration-200 active:scale-[0.97] flex items-center justify-center gap-2"
                  style={{
                    background:
                      submitting || !customerName || !customerPhone ? '#d6d3d1' : '#1c1917',
                    color:
                      submitting || !customerName || !customerPhone ? '#a8a29e' : '#ffffff',
                    boxShadow:
                      submitting || !customerName || !customerPhone
                        ? 'none'
                        : '0 4px 14px rgba(0,0,0,0.12)',
                    cursor:
                      submitting || !customerName || !customerPhone
                        ? 'not-allowed'
                        : 'pointer',
                    opacity: submitting || !customerName || !customerPhone ? 0.6 : 1,
                  }}
                >
                  {submitting ? 'Validation...' : 'Valider la réservation'}
                  <CheckCircle2 size={16} />
                </button>
              )}
            </div>

            {/* Subtle branding footer */}
            <div className="flex items-center justify-center gap-1.5 mt-5 mb-2">
              <span className="text-[10px] tracking-wide" style={{ color: '#c7c2bc' }}>
                Propulsé par
              </span>
              <span
                className="text-[10px] font-bold tracking-wider uppercase"
                style={{ color: '#a8a29e' }}
              >
                Sokar
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
