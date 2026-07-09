'use client';

import { Check, ChevronRight, Gift, Sparkles, Users } from 'lucide-react';
import type { GiftCardPack } from '@/lib/api/gift-cards';
import { GiftCardCrowdfundingCreate } from '../gift-card-crowdfunding-create';
import {
  primaryBtnClass,
  panelClass,
  inputClass,
  headingClass,
  labelClass,
  formatEuro,
} from './shared';
import type { GiftCardFlow } from './use-gift-card-flow';

type Props = {
  flow: GiftCardFlow;
  packs: GiftCardPack[];
  packsLoading: boolean;
  slug: string;
  restaurantId: string;
  restaurantName: string;
  primaryColor: string;
  accentColor: string;
  source: string;
};

export function GiftCardTypeStep({
  flow,
  packs,
  packsLoading,
  slug,
  restaurantId,
  restaurantName,
  primaryColor,
  accentColor,
  source,
}: Props) {
  const { mode, setMode, amount, setAmount, packId, setPackId, handleNextFromType } = flow;

  return (
    <>
      <div className="space-y-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[hsl(var(--reservation-soft))]">
            Étape 1
          </p>
          <h2 className={headingClass}>Choisissez le type de carte</h2>
        </div>

        <div className="space-y-2.5">
          {/* Montant libre */}
          <button
            type="button"
            onClick={() => setMode('free')}
            className={`flex w-full items-center justify-between rounded-[1.1rem] border p-4 text-left transition-all duration-200 active:scale-[0.99] ${
              mode === 'free'
                ? 'border-[hsl(var(--reservation-ink))] bg-white/80 shadow-md'
                : 'border-[hsl(var(--reservation-line))] bg-white/50 hover:bg-white/70'
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors ${
                  mode === 'free'
                    ? 'bg-[hsl(var(--reservation-ink))] text-white'
                    : 'bg-[hsl(var(--reservation-line))] text-[hsl(var(--reservation-soft))]'
                }`}
              >
                <Gift size={20} />
              </div>
              <div>
                <p className="text-[15px] font-extrabold text-[hsl(var(--reservation-ink))]">
                  Montant libre
                </p>
                <p className="text-[13px] font-medium text-[hsl(var(--reservation-soft))]">
                  Choisissez le montant de votre choix
                </p>
              </div>
            </div>
            <div
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                mode === 'free'
                  ? 'border-transparent bg-[hsl(var(--reservation-ink))] text-white'
                  : 'border-[hsl(var(--reservation-line))]'
              }`}
            >
              {mode === 'free' && <Check size={14} strokeWidth={3} />}
            </div>
          </button>

          {/* Pack expérience */}
          <button
            type="button"
            onClick={() => packs.length > 0 && setMode('pack')}
            disabled={packsLoading || packs.length === 0}
            className={`flex w-full items-center justify-between rounded-[1.1rem] border p-4 text-left transition-all duration-200 active:scale-[0.99] disabled:opacity-50 ${
              mode === 'pack'
                ? 'border-[hsl(var(--reservation-ink))] bg-white/80 shadow-md'
                : 'border-[hsl(var(--reservation-line))] bg-white/50 hover:bg-white/70'
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors ${
                  mode === 'pack'
                    ? 'bg-[hsl(var(--reservation-ink))] text-white'
                    : 'bg-[hsl(var(--reservation-line))] text-[hsl(var(--reservation-soft))]'
                }`}
              >
                <Sparkles size={20} />
              </div>
              <div>
                <p className="text-[15px] font-extrabold text-[hsl(var(--reservation-ink))]">
                  Pack expérience
                </p>
                <p className="text-[13px] font-medium text-[hsl(var(--reservation-soft))]">
                  {packsLoading
                    ? 'Chargement...'
                    : packs.length === 0
                      ? 'Aucun pack disponible'
                      : `${packs.length} pack${packs.length > 1 ? 's' : ''} disponible${packs.length > 1 ? 's' : ''}`}
                </p>
              </div>
            </div>
            <div
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                mode === 'pack'
                  ? 'border-transparent bg-[hsl(var(--reservation-ink))] text-white'
                  : 'border-[hsl(var(--reservation-line))]'
              }`}
            >
              {mode === 'pack' && <Check size={14} strokeWidth={3} />}
            </div>
          </button>

          {/* Cagnotte collective */}
          <button
            type="button"
            onClick={() => setMode('crowdfunding')}
            className={`flex w-full items-center justify-between rounded-[1.1rem] border p-4 text-left transition-all duration-200 active:scale-[0.99] ${
              mode === 'crowdfunding'
                ? 'border-[hsl(var(--reservation-ink))] bg-white/80 shadow-md'
                : 'border-[hsl(var(--reservation-line))] bg-white/50 hover:bg-white/70'
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors ${
                  mode === 'crowdfunding'
                    ? 'bg-[hsl(var(--reservation-ink))] text-white'
                    : 'bg-[hsl(var(--reservation-line))] text-[hsl(var(--reservation-soft))]'
                }`}
              >
                <Users size={20} />
              </div>
              <div>
                <p className="text-[15px] font-extrabold text-[hsl(var(--reservation-ink))]">
                  Cagnotte collective
                </p>
                <p className="text-[13px] font-medium text-[hsl(var(--reservation-soft))]">
                  Plusieurs personnes contribuent à une carte cadeau
                </p>
              </div>
            </div>
            <div
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                mode === 'crowdfunding'
                  ? 'border-transparent bg-[hsl(var(--reservation-ink))] text-white'
                  : 'border-[hsl(var(--reservation-line))]'
              }`}
            >
              {mode === 'crowdfunding' && <Check size={14} strokeWidth={3} />}
            </div>
          </button>
        </div>

        {/* Montant libre — input */}
        {mode === 'free' && (
          <div className={panelClass}>
            <label className={labelClass}>Montant (€)</label>
            <div className="relative mt-2">
              <input
                type="number"
                step="0.01"
                min="1"
                placeholder="100"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={inputClass}
              />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[15px] font-bold text-[hsl(var(--reservation-muted))]">
                €
              </span>
            </div>
            {/* Quick amounts */}
            <div className="mt-3 flex gap-2">
              {['25', '50', '100', '200'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setAmount(preset)}
                  className={`flex-1 rounded-full py-2 text-[13px] font-bold transition-all duration-200 active:scale-[0.97] ${
                    amount === preset
                      ? 'bg-[hsl(var(--reservation-ink))] text-white'
                      : 'border border-[hsl(var(--reservation-line))] bg-white/60 text-[hsl(var(--reservation-soft))] hover:bg-white'
                  }`}
                >
                  {preset}€
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Pack sélection — liste */}
        {mode === 'pack' && packs.length > 0 && (
          <div className="space-y-2.5">
            {packs.map((pack) => (
              <button
                key={pack.id}
                type="button"
                onClick={() => setPackId(pack.id)}
                className={`flex w-full items-center justify-between rounded-[1.1rem] border p-4 text-left transition-all duration-200 active:scale-[0.99] ${
                  packId === pack.id
                    ? 'border-[hsl(var(--reservation-ink))] bg-white/80 shadow-md'
                    : 'border-[hsl(var(--reservation-line))] bg-white/50 hover:bg-white/70'
                }`}
              >
                <div className="min-w-0">
                  <p className="text-[15px] font-extrabold text-[hsl(var(--reservation-ink))]">
                    {pack.name}
                  </p>
                  {pack.description && (
                    <p className="mt-0.5 text-[13px] font-medium text-[hsl(var(--reservation-soft))]">
                      {pack.description}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] font-medium text-[hsl(var(--reservation-muted))]">
                    {pack.minPartySize === pack.maxPartySize
                      ? `${pack.minPartySize} pers.`
                      : `${pack.minPartySize}–${pack.maxPartySize} pers.`}
                  </p>
                </div>
                <p className="ml-3 shrink-0 font-display text-[1.25rem] font-black tracking-tight text-[hsl(var(--reservation-blue))]">
                  {formatEuro(pack.amount)}
                </p>
              </button>
            ))}
          </div>
        )}

        {mode !== 'crowdfunding' && (
          <button
            type="button"
            onClick={handleNextFromType}
            disabled={packsLoading}
            className={primaryBtnClass}
          >
            Continuer
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20">
              <ChevronRight size={17} />
            </span>
          </button>
        )}
      </div>

      {/* Étape Cagnotte — formulaire de création */}
      {mode === 'crowdfunding' && (
        <GiftCardCrowdfundingCreate
          slug={slug}
          restaurantId={restaurantId}
          restaurantName={restaurantName}
          primaryColor={primaryColor}
          accentColor={accentColor}
          source={source}
        />
      )}
    </>
  );
}
