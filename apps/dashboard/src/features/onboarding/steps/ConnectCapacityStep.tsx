'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Gauge } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useApi } from '@/lib/api';
import { useOnboarding } from '../onboarding-provider';
import { ConnectReviewLayout, ConnectStepAction, Field } from '../ui';
import type { StepProps } from '../types';

export function ConnectCapacityStep({ onComplete }: StepProps) {
  const { patch, orgId } = useApi();
  const { state, updateTask } = useOnboarding();
  const restaurant = state!.restaurant;
  const exposure = restaurant.exposureSettings;
  const specials = exposure?.capacitySpecials ?? {};

  const [totalCapacity, setTotalCapacity] = useState<number>(Number(specials.totalCapacity) || 40);
  const [maxPartySize, setMaxPartySize] = useState<number>(exposure?.maxPartySize || 7);
  const [serviceDuration, setServiceDuration] = useState<number>(
    Number(specials.serviceDuration) || 90,
  );
  const [cancellationPolicy, setCancellationPolicy] = useState<string>(
    typeof specials.cancellationPolicy === 'string'
      ? specials.cancellationPolicy
      : "Annulation gratuite jusqu'à 2 heures avant le service.",
  );
  const [depositRequired, setDepositRequired] = useState<boolean>(
    Boolean(specials.depositRequired ?? exposure?.depositRequired),
  );
  const [depositAmount, setDepositAmount] = useState<number>(Number(specials.depositAmount) || 15);
  const [depositThreshold, setDepositThreshold] = useState<number>(
    Number(specials.depositThreshold) || 0,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const capacityReady = Boolean(
    Number.isInteger(totalCapacity) &&
    totalCapacity > 0 &&
    Number.isInteger(maxPartySize) &&
    maxPartySize > 0 &&
    maxPartySize <= totalCapacity &&
    Number.isInteger(serviceDuration) &&
    serviceDuration > 0 &&
    cancellationPolicy.trim() &&
    (!depositRequired ||
      (Number.isFinite(depositAmount) &&
        depositAmount > 0 &&
        Number.isInteger(depositThreshold) &&
        depositThreshold >= 0)),
  );
  const [editing, setEditing] = useState(() => !capacityReady);

  useEffect(() => {
    if (!capacityReady) setEditing(true);
  }, [capacityReady]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError('');
    if (!capacityReady) {
      setEditing(true);
      setError('Complétez les règles de réservation avant de continuer.');
      return;
    }
    setSaving(true);
    try {
      await patch(`restaurants/${orgId}/connect`, {
        maxPartySize,
        capacitySpecials: {
          totalCapacity,
          serviceDuration,
          cancellationPolicy,
          depositRequired,
          depositAmount,
          depositThreshold,
        },
      });
      const updated = await updateTask('complete', 'connect-capacity');
      if (!updated) throw new Error('completion failed');
      onComplete('connect-activation');
    } catch {
      setEditing(true);
      setError('La sauvegarde a échoué. Vos règles sont conservées, réessayez.');
    } finally {
      setSaving(false);
    }
  }

  const summary = (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Capacité', value: `${totalCapacity} couverts` },
          { label: 'Groupe maximum', value: `${maxPartySize} personnes` },
          { label: 'Durée moyenne', value: `${serviceDuration} min` },
        ].map((item) => (
          <div key={item.label} className="rounded-xl bg-muted/50 p-4">
            <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
            <p className="mt-1 font-semibold text-foreground">{item.value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Annulation
          </p>
          <p className="text-sm leading-6 text-foreground">{cancellationPolicy}</p>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Garantie de réservation
          </p>
          <p className="text-sm leading-6 text-foreground">
            {depositRequired
              ? `${depositAmount} € par personne${depositThreshold > 0 ? ` à partir de ${depositThreshold} personnes` : ''}`
              : 'Aucun acompte demandé'}
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <form
      id="connect-capacity-form"
      data-review={!editing}
      noValidate
      onSubmit={handleSubmit}
      className="mx-auto w-full max-w-2xl space-y-4"
    >
      <ConnectReviewLayout
        editing={editing}
        onEditingChange={(next) => {
          setEditing(next);
          setError('');
        }}
        icon={Gauge}
        title="Règles de réservation"
        summary={summary}
        canExitEditing={capacityReady}
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Capacité totale">
              <Input
                type="number"
                min={1}
                value={totalCapacity}
                onChange={(event) => setTotalCapacity(Number(event.target.value))}
                required
              />
            </Field>
            <Field label="Groupe maximum">
              <Input
                type="number"
                min={1}
                value={maxPartySize}
                onChange={(event) => setMaxPartySize(Number(event.target.value))}
                required
              />
            </Field>
            <Field label="Durée (minutes)">
              <Input
                type="number"
                min={1}
                value={serviceDuration}
                onChange={(event) => setServiceDuration(Number(event.target.value))}
                required
              />
            </Field>
          </div>

          <Field label="Politique d’annulation">
            <textarea
              value={cancellationPolicy}
              onChange={(event) => setCancellationPolicy(event.target.value)}
              className="flex min-h-24 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              maxLength={280}
              required
            />
            <span className="block text-right text-xs text-muted-foreground">
              {cancellationPolicy.length}/280
            </span>
          </Field>

          <section className="space-y-4 rounded-xl border border-border bg-muted/30 p-4">
            <label className="flex cursor-pointer items-start justify-between gap-4">
              <span>
                <span className="block text-sm font-semibold text-foreground">
                  Demander un acompte
                </span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  Ajoutez une garantie pour les réservations concernées.
                </span>
              </span>
              <input
                type="checkbox"
                aria-label="Demander un acompte"
                checked={depositRequired}
                onChange={(event) => setDepositRequired(event.target.checked)}
                className="mt-1 h-4 w-4 accent-primary"
              />
            </label>
            {depositRequired && (
              <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
                <Field label="Montant par personne (€)">
                  <Input
                    type="number"
                    min={1}
                    value={depositAmount}
                    onChange={(event) => setDepositAmount(Number(event.target.value))}
                    required
                  />
                </Field>
                <Field label="À partir de (personnes)">
                  <Input
                    type="number"
                    min={0}
                    value={depositThreshold}
                    onChange={(event) => setDepositThreshold(Number(event.target.value))}
                    required
                  />
                </Field>
              </div>
            )}
          </section>
        </div>
      </ConnectReviewLayout>
      {error && (
        <p role="alert" className="mx-auto w-full max-w-2xl text-sm text-destructive">
          {error}
        </p>
      )}
      <ConnectStepAction
        formId="connect-capacity-form"
        saving={saving}
        label={
          capacityReady
            ? 'Continuer vers la vérification de la page'
            : 'Compléter les règles de réservation'
        }
      />
    </form>
  );
}
