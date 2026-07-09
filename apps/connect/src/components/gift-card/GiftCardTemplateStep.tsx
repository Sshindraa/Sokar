'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { GiftCardTemplatePicker } from '../gift-card-template-picker';
import { primaryBtnClass, secondaryBtnClass, headingClass } from './shared';
import type { GiftCardFlow } from './use-gift-card-flow';

type Props = {
  flow: GiftCardFlow;
  primaryColor: string;
  accentColor: string;
};

export function GiftCardTemplateStep({ flow, primaryColor, accentColor }: Props) {
  const { bookNow, templateId, setTemplateId, setStep, handleNextFromTemplate } = flow;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[hsl(var(--reservation-soft))]">
          Étape {bookNow ? '4' : '3'}
        </p>
        <h2 className={headingClass}>Personnalisez votre carte</h2>
      </div>

      <GiftCardTemplatePicker
        selectedTemplate={templateId}
        onSelect={(id) => {
          setTemplateId(id);
          if (id === 'custom') {
            // L'URL personnalisée est gérée dans le picker
          }
        }}
        primaryColor={primaryColor}
        accentColor={accentColor}
      />

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setStep(bookNow ? 'slots' : 'info')}
          className={`${secondaryBtnClass} w-auto px-5`}
        >
          <ChevronLeft size={18} />
          Retour
        </button>
        <button type="button" onClick={handleNextFromTemplate} className={primaryBtnClass}>
          Continuer
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20">
            <ChevronRight size={17} />
          </span>
        </button>
      </div>
    </div>
  );
}
