'use client';

import { useState } from 'react';
import { Check, ChevronDown, Globe, Gem, Waves, Gauge, Zap, Heart, AudioLines } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { useOnboarding } from '../onboarding-provider';
import {
  StepHeader,
  Field,
  OnboardingAction,
  PROFILE_OPTIONS,
  FILLER_OPTIONS,
  SUGGESTIONS,
} from '../ui';
import { DemoCallPlayer } from './DemoCallPlayer';
import type { StepProps } from '../types';
import { getErrorMessage } from '@/types/api';
import { KNOWLEDGE_TEXT_MAX_LENGTH } from '@/constants/ui';

export function KnowledgeStep({ onComplete }: StepProps) {
  const { patch, orgId } = useApi();
  const { state, updateTask } = useOnboarding();
  const personality = state?.restaurant.personality;

  const [profileType, setProfileType] = useState(personality?.profileType || 'BISTROT_BRASSERIE');
  const [fillerStyle, setFillerStyle] = useState(personality?.fillerStyle || 'CASUAL');
  const [speakingRate, setSpeakingRate] = useState(() => {
    const rate = Number(personality?.speakingRate || 1);
    return [0.85, 1, 1.15].reduce((nearest, value) =>
      Math.abs(value - rate) < Math.abs(nearest - rate) ? value : nearest,
    );
  });
  const [systemPromptExtra, setSystemPromptExtra] = useState(personality?.systemPromptExtra || '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [demoPlayed, setDemoPlayed] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await patch(`restaurants/${orgId}/personality`, {
        profileType,
        fillerStyle,
        speakingRate,
        systemPromptExtra,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleContinue() {
    setSaving(true);
    try {
      await updateTask('complete', 'knowledge');
      onComplete('calendar');
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de continuer. Réessayez.'));
    } finally {
      setSaving(false);
    }
  }

  function adjust(change: () => void) {
    change();
    setDemoPlayed(false);
  }

  return (
    <div className="space-y-3">
      <StepHeader
        icon={Globe}
        title="Consignes & démo"
        body="Donnez à Sokar la manière de parler qui correspond à votre restaurant."
      />
      <div className="grid max-w-6xl items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12">
        <div className="min-w-0 space-y-5 py-1">
          <Segmented
            label="Style de votre restaurant"
            value={profileType}
            options={PROFILE_OPTIONS}
            onChange={(value) => adjust(() => setProfileType(value))}
          />
          <Segmented
            label="Ton de voix"
            value={fillerStyle}
            options={FILLER_OPTIONS.map((option) => ({
              ...option,
              description:
                option.value === 'WARM'
                  ? 'Convivial'
                  : option.value === 'FORMAL'
                    ? 'Soigné'
                    : 'Spontané',
            }))}
            onChange={(value) => adjust(() => setFillerStyle(value))}
          />

          <Segmented
            label="Rythme de parole"
            rhythm
            value={String(speakingRate)}
            options={[
              { value: '0.85', label: 'Calme' },
              { value: '1', label: 'Modéré' },
              { value: '1.15', label: 'Dynamique' },
            ]}
            onChange={(value) => adjust(() => setSpeakingRate(Number(value)))}
          />

          {/* Progressive disclosure : le champ systemPromptExtra est intimidant
            pour un gérant non-tech. On le fold derrière un toggle, et on ne
            le révèle qu'aux utilisateurs qui veulent affiner. */}
          <div className="space-y-3">
            <button
              type="button"
              aria-expanded={showAdvanced}
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors duration-200 hover:text-foreground"
            >
              <ChevronDown
                size={16}
                className={cn('transition-transform duration-200', showAdvanced && 'rotate-180')}
              />
              Affiner le comportement (optionnel)
            </button>

            {showAdvanced && (
              <Field label="Consignes particulières (ex: suggestions, plats signatures)">
                <textarea
                  value={systemPromptExtra}
                  onChange={(e) => adjust(() => setSystemPromptExtra(e.target.value))}
                  placeholder="Exemple : Toujours proposer notre formule midi en semaine. Parler de notre terrasse ombragée."
                  className="flex min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  maxLength={KNOWLEDGE_TEXT_MAX_LENGTH}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() =>
                        adjust(() =>
                          setSystemPromptExtra((current) =>
                            `${current} ${s}`.trim().slice(0, KNOWLEDGE_TEXT_MAX_LENGTH),
                          ),
                        )
                      }
                      className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      + {s}
                    </button>
                  ))}
                </div>
              </Field>
            )}
          </div>
          {demoPlayed && (
            <div className="border-t border-border pt-4">
              <p className="text-sm font-medium">Comment trouvez-vous Sokar ?</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={handleContinue} disabled={saving}>
                  Parfait
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => adjust(() => setFillerStyle('WARM'))}
                >
                  Plus chaleureux
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => adjust(() => setFillerStyle('FORMAL'))}
                >
                  Plus formel
                </Button>
              </div>
            </div>
          )}
        </div>
        <div className="min-w-0 space-y-3">
          <DemoCallPlayer
            key={JSON.stringify([profileType, fillerStyle, speakingRate, systemPromptExtra])}
            styleLabel={FILLER_OPTIONS.find((option) => option.value === fillerStyle)?.label}
            rhythmLabel={speakingRate < 1 ? 'Calme' : speakingRate > 1 ? 'Dynamique' : 'Modéré'}
            beforePlay={handleSave}
            onPlayed={() => setDemoPlayed(true)}
          />
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <OnboardingAction>
        <Button
          type="button"
          onClick={handleContinue}
          disabled={!demoPlayed || saving}
          className="transition-all duration-200"
        >
          Ça me convient → Continuer vers le planning
        </Button>
      </OnboardingAction>
    </div>
  );
}

function Segmented({
  label,
  value,
  options,
  onChange,
  rhythm = false,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string; description?: string }>;
  onChange: (value: string) => void;
  rhythm?: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div
        className={cn('flex gap-2', rhythm && 'rounded-xl bg-muted/60 p-1')}
        role="group"
        aria-label={label}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl border px-2 py-2.5 text-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              option.description && 'relative flex-col gap-1 py-3',
              value === option.value
                ? 'border-foreground/25 bg-background font-medium text-foreground shadow-sm'
                : rhythm
                  ? 'border-transparent bg-transparent text-muted-foreground hover:text-foreground'
                  : 'border-border bg-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground',
            )}
          >
            {option.description ? (
              <span className="mb-1 text-foreground/70">
                {option.value === 'WARM' ? (
                  <Heart size={18} aria-hidden="true" />
                ) : option.value === 'FORMAL' ? (
                  <Gem size={18} aria-hidden="true" />
                ) : (
                  <AudioLines size={18} aria-hidden="true" />
                )}
              </span>
            ) : rhythm ? (
              option.value === '0.85' ? (
                <Waves size={15} aria-hidden="true" />
              ) : option.value === '1' ? (
                <Gauge size={15} aria-hidden="true" />
              ) : (
                <Zap size={15} aria-hidden="true" />
              )
            ) : value === option.value ? (
              <Check size={14} aria-hidden="true" />
            ) : null}
            {option.label}
            {option.description && (
              <span className="text-xs font-normal text-muted-foreground">
                {option.description}
              </span>
            )}
            {option.description && value === option.value && (
              <Check size={12} aria-hidden="true" className="absolute right-2 top-2" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
