'use client';

import { useState } from 'react';
import { Check, Copy, ExternalLink, Globe, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { useOnboarding } from '../onboarding-provider';
import { StepHeader } from '../ui';
import type { StepProps } from '../types';

export function ConnectActivationStep({ onComplete }: StepProps) {
  const { patch, orgId } = useApi();
  const { state, updateTask } = useOnboarding();
  const restaurant = state!.restaurant;
  const exposure = restaurant.exposureSettings;

  const [connectPublished, setConnectPublished] = useState<boolean>(
    exposure?.connectPublished || false,
  );
  const [connectAgentic, setConnectAgentic] = useState<boolean>(exposure?.connectAgentic || false);
  const [saving, setSaving] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [copied, setCopied] = useState(false);

  const previewUrl = `http://localhost:4002/r/${restaurant.slug}?preview=1`;
  const publicUrl = `http://localhost:4002/r/${restaurant.slug}`;

  async function handleToggleActivation() {
    setSaving(true);
    try {
      const nextPublished = !connectPublished;
      await patch(`restaurants/${orgId}/connect`, {
        connectPublished: nextPublished,
        connectAgentic: nextPublished ? connectAgentic : false,
      });
      setConnectPublished(nextPublished);
      if (!nextPublished) setConnectAgentic(false);

      if (nextPublished) {
        await updateTask('complete', 'connect-activation');
        setCelebrate(true);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleAgentic() {
    setSaving(true);
    try {
      const nextAgentic = !connectAgentic;
      await patch(`restaurants/${orgId}/connect`, {
        connectAgentic: nextAgentic,
      });
      setConnectAgentic(nextAgentic);
    } finally {
      setSaving(false);
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSkip() {
    await updateTask('skip', 'connect-activation', { reason: 'Publication reportée' });
    onComplete(null);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <StepHeader
        icon={Globe}
        title="Activation & preview"
        body="Validez le rendu final de votre fiche publique et activez son référencement en ligne."
      />
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-background/40 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Publier la page internet</p>
              <p className="text-xs text-muted-foreground">
                La page devient accessible et réservable en ligne.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={connectPublished}
                onChange={handleToggleActivation}
                disabled={saving || !restaurant.slug}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>

          <div
            className={cn(
              'flex items-center justify-between transition-opacity duration-200',
              !connectPublished && 'opacity-40 pointer-events-none',
            )}
          >
            <div>
              <p className="text-sm font-semibold">Découverte IA</p>
              <p className="text-xs text-muted-foreground">
                Rend la page indexable par Google, ChatGPT et Perplexity.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={connectAgentic}
                onChange={handleToggleAgentic}
                disabled={saving || !connectPublished}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>
        </div>

        <div className="flex gap-2">
          {connectPublished ? (
            <Button asChild>
              <a
                href={publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1"
              >
                Voir ma page publique
                <ExternalLink size={14} />
              </a>
            </Button>
          ) : (
            <Button
              onClick={handleToggleActivation}
              disabled={saving || !restaurant.slug}
              className="bg-warning text-warning-foreground hover:opacity-90"
            >
              {saving ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
              Activer Connect
            </Button>
          )}
          <Button onClick={handleSkip} variant="ghost">
            Plus tard
          </Button>
        </div>

        {restaurant.slug && (
          <div className="space-y-2 pt-2">
            <p className="text-sm font-medium text-foreground">Aperçu en direct</p>
            <div className="border border-border rounded-xl overflow-hidden shadow-2xl h-[400px] w-full bg-background/50 relative">
              <iframe
                src={previewUrl}
                className="w-full h-full border-0"
                title="Public Page Live Preview Iframe"
              />
            </div>
          </div>
        )}

        {celebrate && (
          <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm transition-all animate-fade-in">
            <div className="bg-card border border-border rounded-xl max-w-md w-full p-6 text-center shadow-2xl space-y-4">
              <div className="text-5xl">🎉</div>
              <h3 className="text-xl font-bold text-foreground">Votre restaurant est en ligne !</h3>
              <p className="text-sm text-muted-foreground">
                La page de votre établissement est maintenant prête à recevoir ses premières
                réservations en ligne et à être découverte par les assistants IA.
              </p>
              <div className="bg-background/60 border border-border rounded-lg p-3 text-sm font-mono flex items-center justify-between select-all">
                <span className="truncate mr-2">{publicUrl}</span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
                >
                  {copied ? <Check className="text-success" size={16} /> : <Copy size={16} />}
                </button>
              </div>
              <div className="flex gap-2 pt-2">
                <Button className="flex-1" asChild>
                  <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                    Voir ma page
                  </a>
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setCelebrate(false);
                    onComplete(null);
                  }}
                >
                  Fermer
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
