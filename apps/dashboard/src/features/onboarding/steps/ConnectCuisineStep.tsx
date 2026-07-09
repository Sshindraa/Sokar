'use client';

import { FormEvent, useState } from 'react';
import { Utensils } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { useOnboarding } from '../onboarding-provider';
import {
  StepHeader,
  Field,
  SubmitButton,
  CUISINES_PRESETS,
  DIETARY_PRESETS,
  FEATURES_PRESETS,
} from '../ui';
import type { StepProps } from '../types';

export function ConnectCuisineStep({ onComplete }: StepProps) {
  const { patch, orgId } = useApi();
  const { state, updateTask } = useOnboarding();
  const restaurant = state!.restaurant;

  const [cuisineType, setCuisineType] = useState<string[]>(restaurant.cuisineType || []);
  const [priceRange, setPriceRange] = useState<number>(restaurant.priceRange || 2);
  const [dietary, setDietary] = useState<string[]>(restaurant.dietary || []);
  const [ambiance, setAmbiance] = useState<string[]>(restaurant.ambiance || []);

  const [customCuisine, setCustomCuisine] = useState('');
  const [saving, setSaving] = useState(false);

  function toggleItem(list: string[], setList: (v: string[]) => void, item: string) {
    if (list.includes(item)) {
      setList(list.filter((x) => x !== item));
    } else {
      setList([...list, item]);
    }
  }

  function addCustomCuisine(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && customCuisine.trim()) {
      e.preventDefault();
      const val = customCuisine.trim();
      if (!cuisineType.includes(val)) {
        setCuisineType([...cuisineType, val]);
      }
      setCustomCuisine('');
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await patch(`restaurants/${orgId}/connect`, {
        cuisineType,
        priceRange,
        dietary,
        ambiance,
      });
      await updateTask('complete', 'connect-cuisine');
      onComplete('connect-capacity');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
      <StepHeader
        icon={Utensils}
        title="Cuisine & ambiance"
        body="Dites-nous ce que vous servez et dans quel cadre pour correspondre aux attentes des utilisateurs d'assistants IA."
      />
      <div className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Types de cuisine</label>
          <div className="flex flex-wrap gap-2 mb-2">
            {CUISINES_PRESETS.map((c) => {
              const active = cuisineType.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleItem(cuisineType, setCuisineType, c)}
                  className={cn(
                    'px-3 py-1 text-xs rounded-full border border-border bg-background hover:border-primary/50 transition-colors',
                    active && 'border-primary/50 bg-primary/10 text-primary',
                  )}
                >
                  {c}
                </button>
              );
            })}
          </div>
          <Input
            value={customCuisine}
            onChange={(e) => setCustomCuisine(e.target.value)}
            onKeyDown={addCustomCuisine}
            placeholder="Saisis une autre cuisine et appuie sur Entrée..."
          />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {cuisineType
              .filter((c) => !CUISINES_PRESETS.includes(c))
              .map((c) => (
                <span
                  key={c}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground"
                >
                  {c}
                  <button
                    type="button"
                    onClick={() => setCuisineType(cuisineType.filter((x) => x !== c))}
                    className="hover:text-foreground"
                  >
                    ×
                  </button>
                </span>
              ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Gamme de prix</label>
          <div className="grid grid-cols-4 gap-2">
            {[1, 2, 3, 4].map((p) => {
              const active = priceRange === p;
              const labels = ['Budget (€)', 'Modéré (€€)', 'Chic (€€€)', 'Prestige (€€€€)'];
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriceRange(p)}
                  className={cn(
                    'px-3 py-2 text-xs rounded-lg border border-border bg-background hover:bg-accent transition-colors font-medium',
                    active && 'border-primary/50 bg-primary/10 text-primary',
                  )}
                >
                  {labels[p - 1]}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Régimes alimentaires proposés
          </label>
          <div className="flex flex-wrap gap-2">
            {DIETARY_PRESETS.map((d) => {
              const active = dietary.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleItem(dietary, setDietary, d)}
                  className={cn(
                    'px-3 py-1 text-xs rounded-full border border-border bg-background hover:border-primary/50 transition-colors capitalize',
                    active && 'border-primary/50 bg-primary/10 text-primary',
                  )}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Atouts de l&apos;établissement
          </label>
          <div className="flex flex-wrap gap-2">
            {FEATURES_PRESETS.map((f) => {
              const active = ambiance.includes(f);
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => toggleItem(ambiance, setAmbiance, f)}
                  className={cn(
                    'px-3 py-1 text-xs rounded-full border border-border bg-background hover:border-primary/50 transition-colors capitalize',
                    active && 'border-primary/50 bg-primary/10 text-primary',
                  )}
                >
                  {f}
                </button>
              );
            })}
          </div>
        </div>

        <div className="pt-2">
          <SubmitButton saving={saving}>Enregistrer et continuer</SubmitButton>
        </div>
      </div>
    </form>
  );
}
