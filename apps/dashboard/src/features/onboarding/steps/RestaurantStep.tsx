'use client';

import { FormEvent, useState } from 'react';
import { Store } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useApi } from '@/lib/api';
import { useOnboarding } from '../onboarding-provider';
import { StepHeader, Field, SubmitButton } from '../ui';
import type { StepProps } from '../types';

export function RestaurantStep({ onComplete }: StepProps) {
  const { patch, orgId } = useApi();
  const { state, updateTask } = useOnboarding();
  const restaurant = state!.restaurant;
  const [name, setName] = useState(restaurant.name || '');
  const [managerPhone, setManagerPhone] = useState(restaurant.managerPhone || '');
  const [managerEmail, setManagerEmail] = useState(restaurant.managerEmail || '');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await patch(`restaurants/${orgId}`, { name, managerPhone, managerEmail });
      await updateTask('complete', 'restaurant');
      onComplete('hours');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
      <StepHeader
        icon={Store}
        title="Identité du restaurant"
        body="Nous validons uniquement les informations utiles pour contacter le restaurant et signer les messages."
      />
      <div className="space-y-4">
        <Field label="Nom du restaurant">
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Téléphone du restaurant">
          <Input
            type="tel"
            value={managerPhone}
            onChange={(e) => setManagerPhone(e.target.value)}
            required
          />
        </Field>
        <Field label="Email du restaurant">
          <Input
            type="email"
            value={managerEmail}
            onChange={(e) => setManagerEmail(e.target.value)}
            required
          />
        </Field>
        <SubmitButton saving={saving}>Valider et passer aux horaires</SubmitButton>
      </div>
    </form>
  );
}
