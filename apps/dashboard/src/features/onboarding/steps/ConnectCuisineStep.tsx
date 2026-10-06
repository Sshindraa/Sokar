'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Check, Utensils } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { useOnboarding } from '../onboarding-provider';
import {
  ConnectReviewLayout,
  ConnectStepAction,
  CUISINES_PRESETS,
  DIETARY_PRESETS,
  FEATURES_PRESETS,
  Field,
} from '../ui';
import type { StepProps } from '../types';

const PRICE_LABELS = ['Budget · €', 'Modéré · €€', 'Chic · €€€', 'Prestige · €€€€'];

function SummaryTags({ items, emptyLabel }: { items: string[]; emptyLabel: string }) {
  if (!items.length) return <span className="text-sm text-muted-foreground">{emptyLabel}</span>;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-full border border-border bg-background px-3 py-1 text-sm font-medium text-foreground"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

export function ConnectCuisineStep({ onComplete }: StepProps) {
  const { patch, orgId } = useApi();
  const { state, updateTask } = useOnboarding();
  const restaurant = state!.restaurant;

  const [cuisineType, setCuisineType] = useState<string[]>(restaurant.cuisineType || []);
  const [priceRange, setPriceRange] = useState<number>(restaurant.priceRange || 2);
  const [dietary, setDietary] = useState<string[]>(restaurant.dietary || []);
  const [ambiance, setAmbiance] = useState<string[]>(restaurant.ambiance || []);
  const [customCuisine, setCustomCuisine] = useState('');
  const [editing, setEditing] = useState(
    () => !cuisineType.some((cuisine) => cuisine.trim().length > 0),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const cuisineReady = cuisineType.some((cuisine) => cuisine.trim().length > 0);

  useEffect(() => {
    if (!cuisineReady) setEditing(true);
  }, [cuisineReady]);

  function toggleItem(list: string[], setList: (value: string[]) => void, item: string) {
    setList(list.includes(item) ? list.filter((value) => value !== item) : [...list, item]);
  }

  function addCustomCuisine(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || !customCuisine.trim()) return;
    event.preventDefault();
    const value = customCuisine.trim();
    if (!cuisineType.includes(value)) setCuisineType([...cuisineType, value]);
    setCustomCuisine('');
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError('');
    if (!cuisineReady) {
      setEditing(true);
      setError('Choisissez au moins un type de cuisine avant de continuer.');
      return;
    }
    setSaving(true);
    try {
      await patch(`restaurants/${orgId}/connect`, {
        cuisineType,
        priceRange,
        dietary,
        ambiance,
      });
      const updated = await updateTask('complete', 'connect-cuisine');
      if (!updated) throw new Error('completion failed');
      onComplete('connect-capacity');
    } catch {
      setEditing(true);
      setError('La sauvegarde a échoué. Vos informations sont conservées, réessayez.');
    } finally {
      setSaving(false);
    }
  }

  const summary = (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Votre cuisine
        </p>
        <SummaryTags items={cuisineType} emptyLabel="Cuisine à préciser" />
      </div>
      <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Gamme de prix
          </p>
          <p className="font-medium text-foreground">
            {PRICE_LABELS[priceRange - 1] || 'À préciser'}
          </p>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Régimes proposés
          </p>
          <SummaryTags items={dietary} emptyLabel="Aucun renseigné" />
        </div>
      </div>
      <div className="border-t border-border pt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Ambiance et atouts
        </p>
        <SummaryTags items={ambiance} emptyLabel="À compléter si vous le souhaitez" />
      </div>
      <p className="flex items-center gap-2 rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
        <Check size={16} className="shrink-0 text-primary" aria-hidden="true" />
        Ces informations enrichissent votre fiche et aident les clients à choisir.
      </p>
    </div>
  );

  return (
    <form
      id="connect-cuisine-form"
      data-review={!editing}
      onSubmit={handleSubmit}
      className="space-y-4"
    >
      <ConnectReviewLayout
        editing={editing}
        onEditingChange={(next) => {
          setEditing(next);
          setError('');
        }}
        icon={Utensils}
        title="Cuisine & ambiance"
        summary={summary}
        canExitEditing={cuisineReady}
      >
        <div className="space-y-6">
          <div>
            <p className="mb-3 text-sm font-medium text-foreground">Types de cuisine</p>
            <div className="mb-3 flex flex-wrap gap-2">
              {CUISINES_PRESETS.map((cuisine) => {
                const active = cuisineType.includes(cuisine);
                return (
                  <button
                    key={cuisine}
                    type="button"
                    onClick={() => toggleItem(cuisineType, setCuisineType, cuisine)}
                    aria-pressed={active}
                    className={cn(
                      'rounded-full border border-border bg-background px-3 py-1.5 text-sm transition-all duration-200 hover:border-primary/50',
                      active && 'border-primary/50 bg-primary/10 text-primary',
                    )}
                  >
                    {cuisine}
                  </button>
                );
              })}
            </div>
            <Input
              value={customCuisine}
              onChange={(event) => setCustomCuisine(event.target.value)}
              onKeyDown={addCustomCuisine}
              placeholder="Autre cuisine, puis Entrée"
              aria-label="Ajouter un type de cuisine"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {cuisineType
                .filter((cuisine) => !CUISINES_PRESETS.includes(cuisine))
                .map((cuisine) => (
                  <span
                    key={cuisine}
                    className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground"
                  >
                    {cuisine}
                    <button
                      type="button"
                      aria-label={`Retirer ${cuisine}`}
                      onClick={() =>
                        setCuisineType(cuisineType.filter((value) => value !== cuisine))
                      }
                      className="transition-colors duration-200 hover:text-foreground"
                    >
                      ×
                    </button>
                  </span>
                ))}
            </div>
          </div>

          <Field label="Gamme de prix">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {PRICE_LABELS.map((label, index) => {
                const value = index + 1;
                const active = priceRange === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPriceRange(value)}
                    aria-pressed={active}
                    className={cn(
                      'rounded-xl border border-border bg-background px-3 py-3 text-sm font-medium transition-all duration-200 hover:bg-accent',
                      active && 'border-primary/40 bg-primary/10 text-primary',
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <p className="mb-3 text-sm font-medium text-foreground">Régimes alimentaires</p>
              <div className="flex flex-wrap gap-2">
                {DIETARY_PRESETS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => toggleItem(dietary, setDietary, item)}
                    aria-pressed={dietary.includes(item)}
                    className={cn(
                      'rounded-full border border-border bg-background px-3 py-1.5 text-sm capitalize transition-all duration-200 hover:border-primary/50',
                      dietary.includes(item) && 'border-primary/50 bg-primary/10 text-primary',
                    )}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-3 text-sm font-medium text-foreground">Ambiance et atouts</p>
              <div className="flex flex-wrap gap-2">
                {FEATURES_PRESETS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => toggleItem(ambiance, setAmbiance, item)}
                    aria-pressed={ambiance.includes(item)}
                    className={cn(
                      'rounded-full border border-border bg-background px-3 py-1.5 text-sm capitalize transition-all duration-200 hover:border-primary/50',
                      ambiance.includes(item) && 'border-primary/50 bg-primary/10 text-primary',
                    )}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ConnectReviewLayout>
      {error && (
        <p role="alert" className="mx-auto w-full max-w-2xl text-sm text-destructive">
          {error}
        </p>
      )}
      <ConnectStepAction
        formId="connect-cuisine-form"
        saving={saving}
        label={
          cuisineReady ? 'Continuer vers les règles de réservation' : 'Ajouter un type de cuisine'
        }
      />
    </form>
  );
}
