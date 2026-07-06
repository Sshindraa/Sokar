'use client';

/**
 * Sokar Connect — GiftCardTemplatePicker.
 *
 * Permet de choisir un template visuel pour la carte cadeau.
 * 3 templates par défaut + upload d'image personnalisée (optionnel P2).
 *
 * Design aligné avec le widget de réservation Sokar.
 */

import { useState } from 'react';
import { Check, ImageIcon } from 'lucide-react';

type Template = {
  id: string;
  name: string;
  gradient: string;
  emoji: string;
};

const TEMPLATES: Template[] = [
  {
    id: 'classic',
    name: 'Classique',
    gradient: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
    emoji: '🎁',
  },
  {
    id: 'festive',
    name: 'Festif',
    gradient: 'linear-gradient(135deg, #EA580C 0%, #F59E0B 100%)',
    emoji: '🎉',
  },
  {
    id: 'elegant',
    name: 'Élégant',
    gradient: 'linear-gradient(135deg, #1E3A5F 0%, #0D9488 100%)',
    emoji: '✨',
  },
];

type Props = {
  selectedTemplate: string | null;
  onSelect: (templateId: string) => void;
  primaryColor?: string;
  accentColor?: string;
};

export function GiftCardTemplatePicker({
  selectedTemplate,
  onSelect,
  primaryColor = '#0F172A',
  accentColor = '#0284C7',
}: Props) {
  const [customImageUrl, setCustomImageUrl] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {TEMPLATES.map((tpl) => {
          const isSelected = selectedTemplate === tpl.id;
          return (
            <button
              key={tpl.id}
              type="button"
              onClick={() => {
                onSelect(tpl.id);
                setCustomImageUrl(null);
              }}
              className={`relative overflow-hidden rounded-[1rem] border-2 transition-all duration-200 active:scale-[0.97] ${
                isSelected ? 'shadow-lg' : 'border-transparent hover:scale-[1.02]'
              }`}
              style={{
                aspectRatio: '3 / 2',
                background: tpl.gradient,
                ...(isSelected ? { borderColor: 'hsl(var(--reservation-ink))' } : {}),
              }}
            >
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[1.75rem]">{tpl.emoji}</span>
                <span className="mt-1 text-[11px] font-bold text-white">{tpl.name}</span>
              </div>
              {isSelected && (
                <div className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-[hsl(var(--reservation-ink))] text-white shadow-md">
                  <Check size={12} strokeWidth={3} />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Upload d'image personnalisée */}
      <div className="space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[hsl(var(--reservation-soft))]">
          Ou utilisez votre propre image (optionnel)
        </p>
        <div className="relative">
          <ImageIcon
            size={16}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[hsl(var(--reservation-muted))]"
          />
          <input
            type="url"
            placeholder="https://exemple.com/mon-image.jpg"
            value={customImageUrl ?? ''}
            onChange={(e) => {
              setCustomImageUrl(e.target.value || null);
              if (e.target.value) {
                onSelect('custom');
              }
            }}
            className="w-full rounded-xl border border-[hsl(var(--reservation-line))] bg-white/70 py-3 pl-11 pr-4 text-[14px] font-medium text-[hsl(var(--reservation-ink))] placeholder:text-[hsl(var(--reservation-muted))] transition-all duration-200 focus:border-white/80 focus:bg-white/62 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--reservation-blue)/0.18)]"
          />
        </div>
        {customImageUrl && (
          <div
            className="relative overflow-hidden rounded-[1rem] border-2"
            style={{
              aspectRatio: '3 / 2',
              borderColor: 'hsl(var(--reservation-ink))',
              backgroundImage: `url(${customImageUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          >
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <span className="text-[12px] font-bold text-white">Image personnalisée</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export { TEMPLATES };
