'use client';

import { FormEvent, useState } from 'react';
import { Check, ChevronDown, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { useOnboarding } from '../onboarding-provider';
import {
  StepHeader,
  Field,
  Segmented,
  SubmitButton,
  PROFILE_OPTIONS,
  FILLER_OPTIONS,
  SUGGESTIONS,
} from '../ui';
import { DemoCallPlayer } from './DemoCallPlayer';
import type { StepProps } from '../types';
import { KNOWLEDGE_TEXT_MAX_LENGTH } from '@/constants/ui';

export function KnowledgeStep({ onComplete }: StepProps) {
  const { patch, orgId } = useApi();
  const { state, updateTask } = useOnboarding();
  const personality = state?.restaurant.personality;

  const [profileType, setProfileType] = useState(personality?.profileType || 'BISTROT_BRASSERIE');
  const [fillerStyle, setFillerStyle] = useState(personality?.fillerStyle || 'CASUAL');
  const [speakingRate, setSpeakingRate] = useState(Number(personality?.speakingRate || 1.0));
  const [systemPromptExtra, setSystemPromptExtra] = useState(personality?.systemPromptExtra || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [demoPlayed, setDemoPlayed] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await patch(`restaurants/${orgId}/personality`, {
        profileType,
        fillerStyle,
        speakingRate,
        systemPromptExtra,
      });
      await updateTask('complete', 'knowledge');
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  function handleContinue() {
    onComplete('calendar');
  }

  return (
    <form onSubmit={handleSave} className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <StepHeader
        icon={Globe}
        title="Ce que l'assistant doit savoir"
        body="Vous configurez ici le ton, l'ambiance et les consignes commerciales que l'IA doit respecter."
      />
      <div className="space-y-5">
        <Segmented
          label="Profil d'établissement"
          value={profileType}
          options={PROFILE_OPTIONS}
          onChange={setProfileType}
        />
        <Segmented
          label="Style d'élocution"
          value={fillerStyle}
          options={FILLER_OPTIONS}
          onChange={setFillerStyle}
        />

        <Field label={`Vitesse de parole : ${speakingRate.toFixed(1)}x`}>
          <input
            type="range"
            min="0.7"
            max="1.5"
            step="0.1"
            value={speakingRate}
            onChange={(e) => setSpeakingRate(Number(e.target.value))}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Calme</span>
            <span>Normal</span>
            <span>Dynamique</span>
          </div>
        </Field>

        {/* Progressive disclosure : le champ systemPromptExtra est intimidant
            pour un gérant non-tech. On le fold derrière un toggle, et on ne
            le révèle qu'aux utilisateurs qui veulent affiner. */}
        <div className="space-y-3">
          <button
            type="button"
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
                onChange={(e) => setSystemPromptExtra(e.target.value)}
                placeholder="Exemple : Toujours proposer notre formule midi en semaine. Parler de notre terrasse ombragée."
                className="flex min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                maxLength={KNOWLEDGE_TEXT_MAX_LENGTH}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSystemPromptExtra((current) => `${current} ${s}`.trim())}
                    className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    + {s}
                  </button>
                ))}
              </div>
            </Field>
          )}
        </div>

        {!saved ? (
          <SubmitButton saving={saving}>Sauvegarder et écouter un aperçu</SubmitButton>
        ) : (
          <div className="space-y-4">
            <DemoCallPlayer onPlayed={() => setDemoPlayed(true)} />
            <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success transition-colors duration-200">
              <Check size={16} />
              <span>Personnalité enregistrée. Écoutez l&apos;aperçu, puis continuez.</span>
            </div>

            {demoPlayed && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 transition-opacity duration-300">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                    H
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">
                      Un mot de Hamza, fondateur
                    </p>
                    <p className="text-sm leading-6 text-muted-foreground">
                      Bienvenue chez Sokar. Si l&apos;assistant ne répond pas comme vous le
                      souhaitez — style trop formel, phrase mal coupée, information manquante —
                      écrivez-moi directement à{' '}
                      <a
                        href="mailto:hamza@sokar.tech"
                        className="font-medium text-primary underline-offset-2 hover:underline"
                      >
                        hamza@sokar.tech
                      </a>
                      . J&apos;ajuste la configuration pour vous, sans intermédiaire.
                    </p>
                    <p className="pt-1 text-xs text-muted-foreground">
                      — Hamza, fondateur de Sokar
                    </p>
                  </div>
                </div>
              </div>
            )}

            <Button
              type="button"
              onClick={handleContinue}
              className="w-full transition-colors duration-200"
            >
              Continuer vers l&apos;agenda
            </Button>
          </div>
        )}
      </div>
    </form>
  );
}
