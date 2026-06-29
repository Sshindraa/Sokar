'use client';

import { FormEvent } from 'react';
import { Loader2, Save, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function StepHeader({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Store;
  title: string;
  body: string;
}) {
  return (
    <div>
      <div className="mb-4 inline-flex rounded-lg bg-primary/10 p-3 text-primary">
        <Icon size={22} />
      </div>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}

export function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-lg border border-border bg-background/60 px-3 py-2 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground',
              value === option.value && 'border-primary/50 bg-primary/10 text-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SubmitButton({ saving, children }: { saving: boolean; children: React.ReactNode }) {
  return (
    <Button type="submit" disabled={saving} className="transition-all duration-200">
      {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
      {children}
    </Button>
  );
}

export const DAY_LABELS = [
  ['mon', 'Lundi'],
  ['tue', 'Mardi'],
  ['wed', 'Mercredi'],
  ['thu', 'Jeudi'],
  ['fri', 'Vendredi'],
  ['sat', 'Samedi'],
  ['sun', 'Dimanche'],
] as const;

export const PROFILE_OPTIONS = [
  { value: 'BISTROT_BRASSERIE', label: 'Bistrot' },
  { value: 'SEMI_GASTRO', label: 'Semi-gastro' },
  { value: 'GASTRONOMIQUE', label: 'Gastronomique' },
];

export const FILLER_OPTIONS = [
  { value: 'WARM', label: 'Chaleureux' },
  { value: 'CASUAL', label: 'Naturel' },
  { value: 'FORMAL', label: 'Formel' },
];

export const SUGGESTIONS = [
  'Proposer la formule midi en semaine.',
  'Mentionner la terrasse quand elle est disponible.',
  'Prévenir que le vendredi soir part vite.',
];

export const CUISINES_PRESETS = [
  'Italien',
  'Japonais',
  'Français',
  'Pizza',
  'Burgers',
  'Végétarien',
];
export const DIETARY_PRESETS = ['végétarien', 'vegan', 'sans gluten', 'halal', 'casher'];
export const FEATURES_PRESETS = [
  'terrasse',
  'groupe',
  'privatisation',
  'anniversaire',
  'ouvert dimanche',
  'brunch',
];

export function resizeImage(file: File, maxWidth: number, maxHeight: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
}
