'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Calendar } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useApi } from '@/lib/api';
import { useOnboarding } from '../onboarding-provider';
import { StepHeader, Field, SubmitButton, DAY_LABELS } from '../ui';
import type { StepProps } from '../types';

export function HoursStep({ onComplete }: StepProps) {
  const { patch, orgId } = useApi();
  const { state, updateTask } = useOnboarding();
  const initial = useMemo(() => {
    const current = state?.restaurant.openingHours ?? {};
    return Object.keys(current).length > 0 ? current : (state?.defaultHours ?? {});
  }, [state?.defaultHours, state?.restaurant.openingHours]);
  const [hours, setHours] = useState(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setHours(initial);
  }, [initial]);

  function updateDay(day: string, value: { open: string; close: string } | null) {
    setHours((current) => ({ ...current, [day]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await patch(`restaurants/${orgId}`, { openingHours: hours });
      await updateTask('complete', 'hours');
      onComplete('knowledge');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
      <StepHeader
        icon={Calendar}
        title="Quand répondre et réserver"
        body="Nous proposons une base réaliste, jamais une identité inventée. Ajustez les créneaux et Sokar suivra."
      />
      <div className="space-y-3">
        {DAY_LABELS.map(([day, label]) => {
          const value = hours[day];
          const open = Boolean(value);

          return (
            <div
              key={day}
              className="grid gap-3 rounded-lg border border-border bg-background/60 p-3 transition-colors duration-200 md:grid-cols-[8rem_1fr]"
            >
              <label className="flex items-center gap-2 text-sm font-medium font-semibold select-none cursor-pointer">
                <input
                  type="checkbox"
                  checked={open}
                  onChange={(e) =>
                    updateDay(day, e.target.checked ? { open: '12:00', close: '22:00' } : null)
                  }
                  className="rounded border-border bg-background text-primary focus:ring-primary"
                />
                {label}
              </label>

              {open && value && (
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    value={value.open}
                    onChange={(e) => updateDay(day, { ...value, open: e.target.value })}
                    className="w-24 text-center"
                    required
                  />
                  <span className="text-xs text-muted-foreground">à</span>
                  <Input
                    type="time"
                    value={value.close}
                    onChange={(e) => updateDay(day, { ...value, close: e.target.value })}
                    className="w-24 text-center"
                    required
                  />
                </div>
              )}
              {!open && (
                <span className="text-xs italic text-muted-foreground self-center">Fermé</span>
              )}
            </div>
          );
        })}
        <div className="pt-3">
          <SubmitButton saving={saving}>Valider et passer à l&apos;assistant</SubmitButton>
        </div>
      </div>
    </form>
  );
}
