'use client';

import { useEffect, useState } from 'react';
import { Loader2, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/types/api';

// ─── DEMO CALL PLAYER ──────────────────────────────────────────
// Aha moment mid-onboarding : l'utilisateur écoute l'assistant vocal
// avec sa personnalité courante avant d'avoir fini la config.
// Fallback transcript-only si Cartesia n'est pas configurée (dev local).

type DemoCallState = {
  loading: boolean;
  audioUrl: string | null;
  transcript: string | null;
  fallback: boolean;
  error: string | null;
};

const INITIAL_DEMO_STATE: DemoCallState = {
  loading: false,
  audioUrl: null,
  transcript: null,
  fallback: false,
  error: null,
};

const DEMO_SCRIPTS = [
  { id: 'reservation', label: 'Réservation' },
  { id: 'cancellation', label: 'Annulation' },
  { id: 'menu', label: 'Question menu' },
] as const;

export function DemoCallPlayer({ onPlayed }: { onPlayed?: () => void }) {
  const [activeScript, setActiveScript] = useState<'reservation' | 'cancellation' | 'menu'>(
    'reservation',
  );
  const [demo, setDemo] = useState<DemoCallState>(INITIAL_DEMO_STATE);

  // Révoque l'object URL précédente pour éviter les fuites mémoire.
  useEffect(() => {
    return () => {
      if (demo.audioUrl) URL.revokeObjectURL(demo.audioUrl);
    };
  }, [demo.audioUrl]);

  // Reset l'audio quand on change de script.
  useEffect(() => {
    if (demo.audioUrl) URL.revokeObjectURL(demo.audioUrl);
    setDemo(INITIAL_DEMO_STATE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeScript]);

  async function handlePlay() {
    setDemo({ ...INITIAL_DEMO_STATE, loading: true });
    try {
      const res = await fetch('/api/proxy/restaurant/onboarding/demo-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptId: activeScript }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Erreur ${res.status}`);
      }

      const contentType = res.headers.get('content-type') ?? '';

      if (contentType.includes('audio/')) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setDemo({ loading: false, audioUrl: url, transcript: null, fallback: false, error: null });
        onPlayed?.();
      } else {
        const data = await res.json();
        setDemo({
          loading: false,
          audioUrl: null,
          transcript: data.transcript ?? null,
          fallback: Boolean(data.fallback),
          error: null,
        });
        onPlayed?.();
      }
    } catch (err: unknown) {
      setDemo({ ...INITIAL_DEMO_STATE, error: getErrorMessage(err, 'Erreur inconnue') });
    }
  }

  return (
    <div className="rounded-lg border border-border bg-background/60 p-4 transition-colors duration-200">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <Volume2 size={18} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">Écouter un appel démo</p>
          <p className="text-xs text-muted-foreground">
            Voici comment Sokar répondra avec le ton et la vitesse que vous avez choisis.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handlePlay}
          disabled={demo.loading}
          className="transition-colors duration-200"
        >
          {demo.loading ? <Loader2 size={16} className="animate-spin" /> : <Volume2 size={16} />}
          {demo.loading ? 'Génération…' : demo.audioUrl || demo.transcript ? 'Rejouer' : 'Écouter'}
        </Button>
      </div>

      {/* Sélecteur de scénario — montre comment les choix de personnalité
          se traduisent en comportement sur 3 types d'appels différents. */}
      <div className="mt-3 flex gap-1.5">
        {DEMO_SCRIPTS.map((script) => (
          <button
            key={script.id}
            type="button"
            onClick={() => setActiveScript(script.id)}
            className={cn(
              'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors duration-200',
              activeScript === script.id
                ? 'border-primary/50 bg-primary/10 text-foreground'
                : 'border-border bg-background/60 text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {script.label}
          </button>
        ))}
      </div>

      {demo.audioUrl && (
        <audio controls autoPlay src={demo.audioUrl} className="mt-3 w-full">
          <track kind="captions" />
        </audio>
      )}

      {demo.transcript && (
        <div className="mt-3 rounded-md border border-border bg-background p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {demo.fallback ? 'Transcript (audio indisponible en local)' : 'Transcript'}
          </p>
          <p className="mt-1 text-sm italic text-foreground">
            &laquo;&nbsp;{demo.transcript}&nbsp;&raquo;
          </p>
        </div>
      )}

      {demo.error && <p className="mt-3 text-sm text-destructive">{demo.error}</p>}
    </div>
  );
}
