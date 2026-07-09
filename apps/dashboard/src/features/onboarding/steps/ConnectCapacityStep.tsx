'use client';

import { FormEvent, useState } from 'react';
import { Gauge } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useApi } from '@/lib/api';
import { useOnboarding } from '../onboarding-provider';
import { StepHeader, Field, SubmitButton } from '../ui';
import type { StepProps } from '../types';

export function ConnectCapacityStep({ onComplete }: StepProps) {
  const { patch, orgId } = useApi();
  const { state, updateTask } = useOnboarding();
  const restaurant = state!.restaurant;
  const exposure = restaurant.exposureSettings;
  const specials = (exposure?.capacitySpecials as Record<string, any>) || {};

  const [totalCapacity, setTotalCapacity] = useState<number>(specials.totalCapacity || 40);
  const [maxPartySize, setMaxPartySize] = useState<number>(exposure?.maxPartySize || 12);
  const [serviceDuration, setServiceDuration] = useState<number>(specials.serviceDuration || 90);
  const [cancellationPolicy, setCancellationPolicy] = useState<string>(
    specials.cancellationPolicy || "Annulation gratuite jusqu'à 2 heures avant le service.",
  );

  const [depositRequired, setDepositRequired] = useState<boolean>(
    specials.depositRequired || false,
  );
  const [depositAmount, setDepositAmount] = useState<number>(specials.depositAmount || 15);
  const [depositThreshold, setDepositThreshold] = useState<number>(specials.depositThreshold || 0);

  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
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
      await updateTask('complete', 'connect-capacity');
      onComplete('connect-activation');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <StepHeader
        icon={Gauge}
        title="Capacité & règles"
        body="Contrôlez le flux des réservations internet et protégez votre activité contre les no-shows."
      />
      <div className="space-y-4">
        <div className="grid gap-3 grid-cols-3">
          <Field label="Capacité d'accueil totale">
            <Input
              type="number"
              value={totalCapacity}
              onChange={(e) => setTotalCapacity(Number(e.target.value))}
              required
            />
          </Field>

          <Field label="Taille max de groupe">
            <Input
              type="number"
              value={maxPartySize}
              onChange={(e) => setMaxPartySize(Number(e.target.value))}
              required
            />
          </Field>

          <Field label="Durée de repas (minutes)">
            <Input
              type="number"
              value={serviceDuration}
              onChange={(e) => setServiceDuration(Number(e.target.value))}
              required
            />
          </Field>
        </div>

        <Field label="Politique d'annulation (280 caractères max)">
          <textarea
            value={cancellationPolicy}
            onChange={(e) => setCancellationPolicy(e.target.value)}
            className="flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2"
            maxLength={280}
            required
          />
        </Field>

        <div className="rounded-lg border border-border bg-background/40 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Garantie par acompte bancaire</p>
              <p className="text-xs text-muted-foreground">
                Demandez une empreinte de carte à vos clients.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={depositRequired}
                onChange={(e) => setDepositRequired(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>

          {depositRequired && (
            <div className="grid gap-3 grid-cols-2 pt-2 border-t border-border/40">
              <Field label="Montant par couvert (€)">
                <Input
                  type="number"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(Number(e.target.value))}
                  required
                />
              </Field>

              <Field label="Acompte requis au-dessus de (N personnes)">
                <Input
                  type="number"
                  value={depositThreshold}
                  onChange={(e) => setDepositThreshold(Number(e.target.value))}
                  placeholder="0 = toujours requis"
                  required
                />
              </Field>
            </div>
          )}
        </div>

        <SubmitButton saving={saving}>Enregistrer et continuer</SubmitButton>
      </div>
    </form>
  );
}
