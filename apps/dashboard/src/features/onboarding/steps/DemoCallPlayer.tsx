'use client';

import { useEffect, useState } from 'react';
import { Loader2, Play, AudioLines, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/types/api';
import { useApi } from '@/lib/api';
import { isLiveCallSupported } from '../live-call/live-call-session';
import { LiveCallPanel } from './LiveCallPanel';

// ─── DEMO CALL PLAYER ──────────────────────────────────────────
// Aha moment mid-onboarding : l'utilisateur appelle son assistant vocal depuis le navigateur,
// avec sa personnalité courante, avant d'avoir fini la config (mode « live »).
// Repli « scripted » : aperçu pré-enregistré (navigateur sans micro, service indisponible).
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

export function DemoCallPlayer({
  onPlayed,
  beforePlay,
  styleLabel,
  rhythmLabel,
}: {
  styleLabel?: string;
  rhythmLabel?: string;
  onPlayed?: () => void;
  beforePlay?: () => Promise<void>;
}) {
  const { siteId } = useApi();
  const [mode, setMode] = useState<'live' | 'scripted'>('live');
  const [notice, setNotice] = useState<string | null>(null);
  const [activeScript, setActiveScript] = useState<'reservation' | 'cancellation' | 'menu'>(
    'reservation',
  );
  const [demo, setDemo] = useState<DemoCallState>(INITIAL_DEMO_STATE);

  // Sans API micro/audio (navigateur ancien), l'appel en direct est impossible : aperçu seul.
  useEffect(() => {
    if (!isLiveCallSupported()) {
      setMode('scripted');
      setNotice('L’appel en direct n’est pas disponible sur ce navigateur.');
    }
  }, []);

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
      await beforePlay?.();
      const res = await fetch('/api/proxy/restaurant/onboarding/demo-call', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(siteId ? { 'X-Sokar-Site-ID': siteId } : {}),
        },
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
    <div className="overflow-hidden rounded-3xl border border-border bg-background shadow-sm">
      <div className="px-6 py-4 sm:px-8">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Votre réceptionniste prend vie
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xl font-semibold tracking-tight text-foreground">Écoutez Sokar</h3>
          {styleLabel && (
            <span className="rounded-full border border-border bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
              {styleLabel} · rythme {rhythmLabel?.toLowerCase()}
            </span>
          )}
        </div>
      </div>
      {mode === 'live' ? (
        <LiveCallPanel
          beforeCall={beforePlay}
          onCompleted={onPlayed}
          onUnavailable={(message) => {
            setNotice(message);
            setMode('scripted');
          }}
        />
      ) : (
        <div className="relative mx-3 overflow-hidden rounded-2xl bg-foreground px-5 py-6 text-center text-background sm:px-7">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full border border-background/10"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-24 -left-12 h-64 w-64 rounded-full border border-background/10"
          />
          <p className="relative flex items-center justify-center gap-2 text-xs font-medium text-background/60">
            <Phone size={13} aria-hidden="true" />
            Un client appelle…
          </p>
          <p className="mx-auto mt-3 max-w-md text-xl font-medium leading-7 tracking-tight text-background [text-wrap:balance]">
            «{' '}
            {activeScript === 'reservation'
              ? 'Bonjour, avez-vous une table pour deux ce soir ?'
              : activeScript === 'cancellation'
                ? 'Bonjour, je souhaite annuler ma réservation.'
                : 'Bonjour, proposez-vous des plats végétariens ?'}{' '}
            »
          </p>
          {demo.audioUrl || demo.transcript ? (
            <div className="my-4 text-left">
              {demo.audioUrl && (
                <audio
                  controls
                  autoPlay
                  onEnded={onPlayed}
                  src={demo.audioUrl}
                  className="mt-3 w-full"
                >
                  <track kind="captions" />
                </audio>
              )}

              {demo.transcript && (
                <div className="mt-3 rounded-md border border-border bg-background p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {demo.fallback ? 'Aperçu écrit · audio indisponible' : 'Réponse de Sokar'}
                  </p>
                  <p className="mt-1 text-sm italic text-foreground">
                    &laquo;&nbsp;{demo.transcript}&nbsp;&raquo;
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div
              className="my-4 flex items-center justify-center gap-1.5 text-background/70"
              aria-hidden="true"
            >
              {[12, 20, 32, 18, 40, 28, 48, 32, 20, 38, 24, 16, 28, 12, 20].map((height, index) => (
                <span
                  key={index}
                  style={{ height: height * 0.65 }}
                  className={cn(
                    'w-1 rounded-full bg-current',
                    demo.loading && 'animate-pulse motion-reduce:animate-none',
                  )}
                />
              ))}
            </div>
          )}
          <Button
            type="button"
            onClick={handlePlay}
            disabled={demo.loading}
            className="relative min-h-11 gap-3 rounded-full bg-background px-7 text-foreground shadow-sm transition-all duration-200 hover:bg-background/90"
          >
            {demo.loading ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} />}
            {demo.loading
              ? 'Préparation de votre aperçu…'
              : demo.audioUrl || demo.transcript
                ? 'Réécouter Sokar'
                : 'Écouter Sokar'}
          </Button>
          <p className="relative mt-3 text-xs text-background/60">
            Avec le ton et le rythme que vous avez choisis.
          </p>
        </div>
      )}
      <div className="px-6 py-4 sm:px-8">
        {mode === 'scripted' && (
          <>
            <p className="text-xs font-medium text-muted-foreground">
              Essayez une autre conversation
            </p>
            {/* Sélecteur de scénario — montre comment les choix de personnalité
          se traduisent en comportement sur 3 types d'appels différents. */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {DEMO_SCRIPTS.map((script) => (
                <button
                  key={script.id}
                  type="button"
                  disabled={demo.loading}
                  aria-pressed={activeScript === script.id}
                  onClick={() => setActiveScript(script.id)}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-200',
                    activeScript === script.id
                      ? 'border-foreground/30 bg-muted text-foreground'
                      : 'border-border bg-background/60 text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  {script.label}
                </button>
              ))}
            </div>
          </>
        )}

        {notice && mode === 'scripted' && (
          <p role="status" className="mt-3 text-sm text-muted-foreground">
            {notice}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
          {mode === 'live' ? (
            <button
              type="button"
              onClick={() => setMode('scripted')}
              className="text-xs font-medium text-muted-foreground underline underline-offset-4 transition-all duration-200 hover:text-foreground"
            >
              Écouter un exemple pré-enregistré
            </button>
          ) : (
            isLiveCallSupported() && (
              <button
                type="button"
                onClick={() => {
                  setNotice(null);
                  setMode('live');
                }}
                className="text-xs font-medium text-muted-foreground underline underline-offset-4 transition-all duration-200 hover:text-foreground"
              >
                Appeler Sokar en direct
              </button>
            )
          )}
        </div>

        {demo.error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {demo.error}
          </p>
        )}
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <AudioLines size={14} />
          Une démonstration, sans réservation réelle.
        </p>
      </div>
    </div>
  );
}
