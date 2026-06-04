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
  ArrowRight,
  Phone,
  User,
  Mail,
  Utensils
} from 'lucide-react';
import Image from 'next/image';

const FRENCH_DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const FRENCH_MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

export default function ReservationWidget({ params }: { params: { restaurantId: string } }) {
  const { get, post } = useApi();
  const restaurantId = params.restaurantId;

  // Restaurant public metadata
  const [restaurant, setRestaurant] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Booking Flow State
  const [step, setStep] = useState<1 | 2>(1); // Step 1: Date/Time/Pax, Step 2: Contact Info
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
        // Default select today
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
      return []; // Restaurant closed on this day
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

    // Combine selected date and time to ISO datetime
    const [hours, minutes] = selectedTime.split(':').map(Number);
    const reservedAt = new Date(selectedDate);
    reservedAt.setHours(hours, minutes, 0, 0);

    try {
      const res = await post('reservations', {
        restaurantId,
        reservedAt: reservedAt.toISOString(),
        partySize,
        customerName,
        customerPhone: customerPhone.startsWith('+') ? customerPhone : `+33${customerPhone.replace(/^0/, '')}`,
      });
      
      setConfirmedReservation(res);
      setSuccess(true);
    } catch (err: any) {
      if (err.message === 'SLOT_NOT_AVAILABLE') {
        setError('Ce créneau horaire vient de se faire réserver ou n\'est plus disponible. Veuillez choisir une autre heure.');
      } else {
        setError(err.message || 'Une erreur est survenue lors de la réservation.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col justify-between text-zinc-100 p-6">
        <div className="space-y-4 pt-10">
          <Skeleton className="h-16 w-16 rounded-full bg-zinc-800" />
          <Skeleton className="h-8 w-48 bg-zinc-800" />
          <Skeleton className="h-4 w-32 bg-zinc-800" />
        </div>
        <div className="bg-zinc-900 rounded-t-[2.5rem] -mx-6 p-6 space-y-6">
          <Skeleton className="h-6 w-40 bg-zinc-800" />
          <div className="flex gap-3 overflow-x-hidden">
            <Skeleton className="h-[90px] w-[70px] rounded-2xl flex-shrink-0 bg-zinc-800" />
            <Skeleton className="h-[90px] w-[70px] rounded-2xl flex-shrink-0 bg-zinc-800" />
            <Skeleton className="h-[90px] w-[70px] rounded-2xl flex-shrink-0 bg-zinc-800" />
            <Skeleton className="h-[90px] w-[70px] rounded-2xl flex-shrink-0 bg-zinc-800" />
          </div>
          <Skeleton className="h-[50px] w-full rounded-full bg-zinc-800" />
        </div>
      </div>
    );
  }

  if (error && !restaurant) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-6 text-zinc-100 text-center">
        <AlertCircle size={48} className="text-destructive mb-4" />
        <h1 className="text-xl font-bold">Oups !</h1>
        <p className="text-sm text-zinc-400 mt-2">{error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans antialiased relative overflow-hidden flex flex-col justify-between">
      
      {/* Top Banner (Atmospheric) */}
      <div className="relative h-[40vh] w-full flex flex-col justify-end p-6 pb-12">
        <div className="absolute inset-0 z-0">
          <Image 
            src="https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?q=80&w=1000" 
            alt="Restaurant background" 
            fill
            className="object-cover opacity-30 blur-[2px]"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/60 to-transparent" />
        </div>

        {/* Restaurant Profile Header */}
        <div className="relative z-10 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-lg backdrop-blur-md">
              <Utensils size={22} />
            </div>
            <div>
              <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary backdrop-blur-md">
                RÉSERVATION TABLE
              </span>
            </div>
          </div>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight uppercase mt-1">
              {restaurant?.name || 'Notre Restaurant'}
            </h1>
            <p className="text-sm text-zinc-400 mt-1">
              Réservez votre table en quelques clics
            </p>
          </div>
        </div>
      </div>

      {/* Floating White Card at bottom */}
      <div className="relative z-10 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 rounded-t-[2.5rem] px-6 pt-8 pb-10 flex-1 flex flex-col justify-between shadow-[0_-15px_30px_rgba(0,0,0,0.4)] transition-all duration-300">
        
        {success ? (
          /* Confirmation / Success view */
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-6 py-6 animate-fade-in">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-emerald-500/10 blur-xl animate-pulse" />
              <CheckCircle2 size={72} className="text-emerald-500 relative z-10 animate-bounce" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold tracking-tight">Table réservée !</h2>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                Votre réservation chez <strong>{restaurant?.name}</strong> est bien confirmée.
              </p>
            </div>

            <div className="w-full bg-secondary/40 rounded-3xl p-5 space-y-4 border border-border text-left">
              <div className="flex justify-between items-center pb-2 border-b border-border/50">
                <span className="text-xs text-muted-foreground uppercase font-semibold">Date</span>
                <span className="text-sm font-semibold">{selectedDate && formatDateFull(selectedDate)}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-border/50">
                <span className="text-xs text-muted-foreground uppercase font-semibold">Heure</span>
                <span className="text-sm font-semibold">{selectedTime}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-border/50">
                <span className="text-xs text-muted-foreground uppercase font-semibold">Couverts</span>
                <span className="text-sm font-semibold">{partySize} personne(s)</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground uppercase font-semibold">Nom</span>
                <span className="text-sm font-semibold">{customerName}</span>
              </div>
            </div>

            <div className="pt-4 w-full">
              <p className="text-xs text-muted-foreground mb-4">
                Un SMS de confirmation a été envoyé au {customerPhone}.
              </p>
              <Button 
                onClick={() => {
                  setSuccess(false);
                  setStep(1);
                  setSelectedTime('');
                  setCustomerName('');
                  setCustomerPhone('');
                }}
                className="w-full rounded-full py-6 transition-all duration-200"
              >
                Faire une autre réservation
              </Button>
            </div>
          </div>
        ) : (
          /* Form views */
          <div className="flex-1 flex flex-col justify-between">
            {error && (
              <div className="mb-4 p-4 rounded-xl border border-destructive/20 bg-destructive/10 text-destructive flex items-center gap-2 text-sm animate-fade-in">
                <AlertCircle size={16} className="flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {step === 1 ? (
              /* Step 1: Pax, Date & Time Selection */
              <div className="space-y-6 flex-1 animate-fade-in">
                
                {/* Party Size Selector */}
                <div className="space-y-3">
                  <label className="text-xs uppercase font-bold tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Users size={14} />
                    Nombre de personnes
                  </label>
                  <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((size) => (
                      <button
                        key={size}
                        onClick={() => setPartySize(size)}
                        className={`flex-shrink-0 h-11 w-11 rounded-full border text-sm font-semibold transition-all duration-200 ${
                          partySize === size
                            ? 'border-primary bg-primary text-primary-foreground scale-105 shadow-md'
                            : 'border-input hover:bg-secondary/80 text-muted-foreground'
                        }`}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Date Selector (Horizontal Scroll) */}
                <div className="space-y-3">
                  <label className="text-xs uppercase font-bold tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <CalendarIcon size={14} />
                    Sélectionner la date
                  </label>
                  <div className="flex gap-3 overflow-x-auto pb-2 snap-x scrollbar-none">
                    {days.map((date, idx) => {
                      const isSelected = selectedDate?.toDateString() === date.toDateString();
                      return (
                        <button
                          key={idx}
                          onClick={() => {
                            setSelectedDate(date);
                            setSelectedTime(''); // Reset selected time slot
                          }}
                          className={`flex-shrink-0 flex flex-col items-center justify-center min-w-[70px] h-[90px] rounded-2xl border transition-all duration-200 snap-center ${
                            isSelected
                              ? 'border-primary bg-primary/5 text-primary scale-105 font-bold shadow-md'
                              : 'border-border bg-card text-card-foreground hover:bg-secondary/40'
                          }`}
                        >
                          <span className="text-2xl font-extrabold tracking-tight">
                            {date.getDate()}
                          </span>
                          <span className="text-xs uppercase tracking-wide opacity-80 mt-1">
                            {FRENCH_DAYS[date.getDay()].substring(0, 3)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Time Slot Selector */}
                <div className="space-y-3">
                  <label className="text-xs uppercase font-bold tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Clock size={14} />
                    Créneau horaire
                  </label>
                  {timeSlots.length > 0 ? (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 max-h-[160px] overflow-y-auto pr-1">
                      {timeSlots.map((time) => {
                        const isSelected = selectedTime === time;
                        return (
                          <button
                            key={time}
                            onClick={() => setSelectedTime(time)}
                            className={`py-3 px-1 rounded-xl text-sm font-semibold transition-all duration-200 text-center border ${
                              isSelected
                                ? 'border-primary bg-primary text-primary-foreground font-bold shadow-md'
                                : 'border-border bg-card text-muted-foreground hover:bg-secondary/60'
                            }`}
                          >
                            {time.replace(':', 'h')}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center p-6 border border-dashed border-border rounded-2xl text-muted-foreground">
                      <AlertCircle size={20} className="mb-2 opacity-55" />
                      <span className="text-sm">Restaurant fermé à cette date.</span>
                    </div>
                  )}
                </div>

              </div>
            ) : (
              /* Step 2: Contact Information Form */
              <form onSubmit={handleSubmit} className="space-y-5 flex-1 animate-fade-in pt-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                  <Button 
                    type="button" 
                    variant="ghost" 
                    onClick={() => setStep(1)} 
                    className="p-1.5 h-auto rounded-full hover:bg-secondary"
                  >
                    <ChevronLeft size={20} />
                  </Button>
                  <span>
                    {selectedDate && formatDateFull(selectedDate)} à {selectedTime.replace(':', 'h')} ({partySize} pers.)
                  </span>
                </div>

                {/* Name */}
                <div className="space-y-2">
                  <label className="text-xs uppercase font-bold tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <User size={14} />
                    Votre Nom complet *
                  </label>
                  <Input
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Ex: Alice Martin"
                    required
                    className="h-12 rounded-xl focus-visible:ring-primary transition-all duration-200"
                  />
                </div>

                {/* Phone */}
                <div className="space-y-2">
                  <label className="text-xs uppercase font-bold tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Phone size={14} />
                    Numéro de Téléphone *
                  </label>
                  <Input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="Ex: 0612345678"
                    required
                    className="h-12 rounded-xl focus-visible:ring-primary transition-all duration-200"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Utilisé pour vous envoyer un SMS de confirmation gratuit.
                  </p>
                </div>

                {/* Email */}
                <div className="space-y-2">
                  <label className="text-xs uppercase font-bold tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Mail size={14} />
                    Adresse Email (optionnel)
                  </label>
                  <Input
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="Ex: client@sokar.fr"
                    className="h-12 rounded-xl focus-visible:ring-primary transition-all duration-200"
                  />
                </div>
              </form>
            )}

            {/* Action Footer Button */}
            <div className="mt-8">
              {step === 1 ? (
                <Button
                  onClick={() => setStep(2)}
                  disabled={!selectedTime}
                  className="w-full py-6 rounded-full bg-primary text-primary-foreground font-semibold transition-all duration-200 hover:bg-primary/95 active:scale-95 shadow-lg flex items-center justify-center gap-2"
                >
                  Continuer
                  <ChevronRight size={18} />
                </Button>
              ) : (
                <Button
                  onClick={handleSubmit}
                  disabled={submitting || !customerName || !customerPhone}
                  className="w-full py-6 rounded-full bg-primary text-primary-foreground font-semibold transition-all duration-200 hover:bg-primary/95 active:scale-95 shadow-lg flex items-center justify-center gap-2"
                >
                  {submitting ? 'Validation...' : 'Valider la réservation'}
                  <CheckCircle2 size={18} />
                </Button>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
