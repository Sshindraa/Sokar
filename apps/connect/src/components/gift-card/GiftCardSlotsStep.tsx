'use client';

import { Calendar, ChevronLeft, ChevronRight, Clock, Users } from 'lucide-react';
import {
  primaryBtnClass,
  secondaryBtnClass,
  inputClass,
  panelClass,
  headingClass,
  labelClass,
  todayIso,
} from './shared';
import type { GiftCardFlow } from './use-gift-card-flow';

type Props = {
  flow: GiftCardFlow;
};

export function GiftCardSlotsStep({ flow }: Props) {
  const {
    preferredDate,
    setPreferredDate,
    preferredPartySize,
    setPreferredPartySize,
    preferredTime,
    setPreferredTime,
    setStep,
    handleNextFromSlots,
  } = flow;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[hsl(var(--reservation-soft))]">
          Étape 3
        </p>
        <h2 className={headingClass}>Préférences de réservation</h2>
      </div>
      <p className="text-[13px] font-medium text-[hsl(var(--reservation-soft))]">
        Ces informations aideront à proposer les meilleurs créneaux au destinataire.
      </p>

      <div className={panelClass}>
        <label className={labelClass}>
          <Calendar size={12} className="mr-1 inline" />
          Date préférée
        </label>
        <input
          type="date"
          min={todayIso()}
          value={preferredDate}
          onChange={(e) => setPreferredDate(e.target.value)}
          className={`${inputClass} mt-2`}
        />
      </div>

      <div className={panelClass}>
        <label className={labelClass}>
          <Users size={12} className="mr-1 inline" />
          Nombre de personnes
        </label>
        <input
          type="number"
          min="1"
          max="20"
          value={preferredPartySize}
          onChange={(e) => setPreferredPartySize(e.target.value)}
          className={`${inputClass} mt-2`}
        />
      </div>

      <div className={panelClass}>
        <label className={labelClass}>
          <Clock size={12} className="mr-1 inline" />
          Heure préférée (optionnel)
        </label>
        <input
          type="time"
          value={preferredTime}
          onChange={(e) => setPreferredTime(e.target.value)}
          className={`${inputClass} mt-2`}
        />
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setStep('info')}
          className={`${secondaryBtnClass} w-auto px-5`}
        >
          <ChevronLeft size={18} />
          Retour
        </button>
        <button type="button" onClick={handleNextFromSlots} className={primaryBtnClass}>
          Continuer
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20">
            <ChevronRight size={17} />
          </span>
        </button>
      </div>
    </div>
  );
}
