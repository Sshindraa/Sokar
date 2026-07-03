'use client';

/**
 * Sokar Connect — GiftCardTemplatePicker.
 *
 * Permet de choisir un template visuel pour la carte cadeau.
 * 3 templates par défaut + upload d'image personnalisée (optionnel P2).
 */

import { useState } from 'react';

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
  accentColor = '#EA580C',
}: Props) {
  const [customImageUrl, setCustomImageUrl] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold" style={{ color: primaryColor }}>
        Choisissez un design
      </h3>

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
              className={`relative overflow-hidden rounded-lg border-2 transition-all duration-200 ${
                isSelected ? 'ring-2 ring-offset-2' : 'border-border hover:border-muted'
              }`}
              style={{
                aspectRatio: '3 / 2',
                background: tpl.gradient,
                ...(isSelected
                  ? { borderColor: accentColor, boxShadow: `0 0 0 2px ${accentColor}` }
                  : {}),
              }}
            >
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl">{tpl.emoji}</span>
                <span className="mt-1 text-xs font-medium text-white">{tpl.name}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Upload d'image personnalisée (optionnel P2) */}
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Ou utilisez votre propre image (optionnel)</p>
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
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm transition-all duration-200 focus:border-[var(--widget-accent)] focus:outline-none"
        />
        {customImageUrl && (
          <div
            className="relative overflow-hidden rounded-lg border-2"
            style={{
              aspectRatio: '3 / 2',
              borderColor: accentColor,
              backgroundImage: `url(${customImageUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          >
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <span className="text-xs font-medium text-white">Image personnalisée</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export { TEMPLATES };
