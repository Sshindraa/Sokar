'use client';

import { ChevronLeft, ChevronRight, Gift, Heart } from 'lucide-react';
import {
  primaryBtnClass,
  secondaryBtnClass,
  inputClass,
  panelClass,
  headingClass,
  labelClass,
} from './shared';
import type { GiftCardFlow } from './use-gift-card-flow';

type Props = {
  flow: GiftCardFlow;
};

export function GiftCardInfoStep({ flow }: Props) {
  const {
    honeypot,
    setHoneypot,
    occasion,
    setOccasion,
    senderName,
    setSenderName,
    senderEmail,
    setSenderEmail,
    senderPhone,
    setSenderPhone,
    recipientName,
    setRecipientName,
    recipientEmail,
    setRecipientEmail,
    recipientPhone,
    setRecipientPhone,
    message,
    setMessage,
    bookNow,
    setBookNow,
    setStep,
    handleNextFromInfo,
  } = flow;

  return (
    <div className="space-y-4">
      {/* Honeypot anti-bot — caché visuellement */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
        value={honeypot}
        onChange={(e) => setHoneypot(e.target.value)}
      />

      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[hsl(var(--reservation-soft))]">
          Étape 2
        </p>
        <h2 className={headingClass}>Informations</h2>
      </div>

      <div>
        <label className={labelClass}>Occasion (optionnel)</label>
        <input
          type="text"
          placeholder="Anniversaire, remerciement..."
          value={occasion}
          onChange={(e) => setOccasion(e.target.value)}
          className={`${inputClass} mt-2`}
        />
      </div>

      {/* Expéditeur */}
      <div className={panelClass}>
        <div className="mb-3 flex items-center gap-2">
          <Heart size={16} className="text-[hsl(var(--reservation-blue))]" />
          <p className="text-[13px] font-bold text-[hsl(var(--reservation-ink))]">Expéditeur</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            type="text"
            placeholder="Nom"
            value={senderName}
            onChange={(e) => setSenderName(e.target.value)}
            className={inputClass}
          />
          <input
            type="email"
            placeholder="Email"
            value={senderEmail}
            onChange={(e) => setSenderEmail(e.target.value)}
            className={inputClass}
          />
          <input
            type="tel"
            placeholder="Téléphone"
            value={senderPhone}
            onChange={(e) => setSenderPhone(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {/* Destinataire */}
      <div className={panelClass}>
        <div className="mb-3 flex items-center gap-2">
          <Gift size={16} className="text-[hsl(var(--reservation-blue))]" />
          <p className="text-[13px] font-bold text-[hsl(var(--reservation-ink))]">Destinataire</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            type="text"
            placeholder="Nom"
            value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)}
            className={inputClass}
          />
          <input
            type="email"
            placeholder="Email"
            value={recipientEmail}
            onChange={(e) => setRecipientEmail(e.target.value)}
            className={inputClass}
          />
          <input
            type="tel"
            placeholder="Téléphone"
            value={recipientPhone}
            onChange={(e) => setRecipientPhone(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className={labelClass}>Message personnalisé (optionnel)</label>
        <textarea
          placeholder="Joyeux anniversaire !"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          className={`${inputClass} mt-2 resize-none`}
        />
      </div>

      {/* Book now toggle */}
      <label
        className={`flex cursor-pointer items-center gap-3 rounded-[1.1rem] border p-4 transition-all duration-200 ${
          bookNow
            ? 'border-[hsl(var(--reservation-ink))] bg-white/80 shadow-md'
            : 'border-[hsl(var(--reservation-line))] bg-white/50 hover:bg-white/70'
        }`}
      >
        <input
          type="checkbox"
          checked={bookNow}
          onChange={(e) => setBookNow(e.target.checked)}
          className="h-5 w-5 rounded accent-[hsl(var(--reservation-ink))]"
        />
        <div>
          <p className="text-[14px] font-bold text-[hsl(var(--reservation-ink))]">
            Proposer directement des créneaux au destinataire
          </p>
          <p className="mt-0.5 text-[12px] font-medium text-[hsl(var(--reservation-soft))]">
            Le destinataire verra 3 créneaux et pourra réserver en un clic.
          </p>
        </div>
      </label>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setStep('type')}
          className={`${secondaryBtnClass} w-auto px-5`}
        >
          <ChevronLeft size={18} />
          Retour
        </button>
        <button type="button" onClick={handleNextFromInfo} className={primaryBtnClass}>
          Continuer
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20">
            <ChevronRight size={17} />
          </span>
        </button>
      </div>
    </div>
  );
}
