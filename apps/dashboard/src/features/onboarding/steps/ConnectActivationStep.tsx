'use client';

import { FormEvent, useState } from 'react';
import { Check, Copy, ExternalLink, Globe, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApi } from '@/lib/api';
import { useOnboarding } from '../onboarding-provider';
import { ConnectReviewLayout, ConnectStepAction } from '../ui';
import type { StepProps } from '../types';
import { CLIPBOARD_RESET_DELAY_MS } from '@/constants/ui';

const CONNECT_HOST =
  process.env.NODE_ENV === 'development'
    ? 'http://localhost:4002'
    : (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sokar.tech');

export function ConnectActivationStep({ onComplete }: StepProps) {
  const { patch, orgId } = useApi();
  const { state, updateTask } = useOnboarding();
  const restaurant = state!.restaurant;
  const exposure = restaurant.exposureSettings;

  const [connectPublished, setConnectPublished] = useState<boolean>(
    exposure?.connectPublished || false,
  );
  const [connectAgentic, setConnectAgentic] = useState<boolean>(exposure?.connectAgentic || false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const previewUrl = `${CONNECT_HOST}/restaurant/${encodeURIComponent(restaurant.slug || '')}?preview=1`;
  const publicUrl = `${CONNECT_HOST}/restaurant/${encodeURIComponent(restaurant.slug || '')}`;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await patch(`restaurants/${orgId}/connect`, {
        connectPublished: true,
        connectAgentic,
      });
      setConnectPublished(true);
      const updated = await updateTask('complete', 'connect-activation');
      if (!updated) throw new Error('completion failed');
      if (connectPublished) {
        onComplete(null);
      } else {
        setCelebrate(true);
      }
    } catch {
      setEditing(true);
      setError('L’activation n’a pas abouti. Vos réglages sont conservés, réessayez.');
    } finally {
      setSaving(false);
    }
  }

  function handleCopy() {
    void navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), CLIPBOARD_RESET_DELAY_MS);
  }

  const summary = (
    <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
      <div className="flex flex-col justify-between gap-5">
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
              <Globe size={20} aria-hidden="true" />
            </span>
            <div>
              <p className="font-semibold text-foreground">
                {connectPublished ? 'Votre page est en ligne' : 'Votre page est prête à publier'}
              </p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {connectPublished
                  ? 'Vos clients peuvent consulter votre fiche et réserver.'
                  : 'Vérifiez son aperçu puis publiez-la lorsque vous êtes prêt.'}
              </p>
            </div>
          </div>

          <div className="rounded-xl bg-muted/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Adresse publique
            </p>
            <div className="mt-2 flex items-center gap-2">
              <a
                href={publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate text-sm font-medium text-foreground underline-offset-4 transition-all duration-200 hover:underline"
              >
                {publicUrl.replace(/^https?:\/\//, '')}
              </a>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleCopy}
                aria-label="Copier l’adresse publique"
                className="h-9 w-9 shrink-0"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </Button>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-border px-4 py-3">
            <Sparkles size={17} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-foreground">
                Découverte par les assistants IA
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {connectAgentic ? 'Activée' : 'Désactivée'} · modifiable à tout moment.
              </p>
            </div>
          </div>
        </div>

        {connectPublished && (
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm font-medium text-foreground transition-all duration-200 hover:underline"
          >
            Voir ma page publique <ExternalLink size={15} />
          </a>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-muted/30">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
          <p className="text-sm font-semibold text-foreground">Aperçu client</p>
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
            {restaurant.name}
          </span>
        </div>
        <iframe
          src={previewUrl}
          className="h-[320px] w-full border-0 bg-background"
          title="Aperçu de votre page publique"
        />
      </div>
    </div>
  );

  return (
    <form
      id="connect-activation-form"
      data-review={!editing}
      data-wide-review={!editing}
      onSubmit={handleSubmit}
      className="mx-auto w-full max-w-2xl space-y-4"
    >
      <ConnectReviewLayout
        editing={editing}
        onEditingChange={(next) => {
          setEditing(next);
          setError('');
        }}
        icon={Globe}
        title="Publication de votre page"
        summary={summary}
        wide
      >
        <div className="space-y-4">
          <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-border bg-background p-4">
            <span className="flex items-start gap-3">
              <Sparkles size={18} className="mt-0.5 text-primary" aria-hidden="true" />
              <span>
                <span className="block text-sm font-semibold text-foreground">
                  Découverte par les assistants IA
                </span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  Autoriser Google, ChatGPT et Perplexity à lire les informations publiques de votre
                  restaurant.
                </span>
              </span>
            </span>
            <input
              type="checkbox"
              aria-label="Activer la découverte IA"
              checked={connectAgentic}
              onChange={(event) => setConnectAgentic(event.target.checked)}
              className="mt-1 h-4 w-4 accent-primary"
            />
          </label>
          <p className="text-xs leading-5 text-muted-foreground">
            La publication de la page reste votre décision. Vous pourrez modifier ce réglage
            ensuite.
          </p>
        </div>
      </ConnectReviewLayout>
      {error && (
        <p role="alert" className="mx-auto w-full max-w-2xl text-sm text-destructive">
          {error}
        </p>
      )}
      <ConnectStepAction
        formId="connect-activation-form"
        saving={saving}
        label={connectPublished ? 'Terminer la mise en service' : 'Publier ma page'}
      />

      {celebrate && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div
            className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-6 text-center shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="connect-published-title"
          >
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Check size={28} />
            </div>
            <h3 id="connect-published-title" className="text-xl font-bold text-foreground">
              Votre restaurant est en ligne !
            </h3>
            <p className="text-sm leading-6 text-muted-foreground">
              Votre page est accessible et prête à recevoir des réservations.
            </p>
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => onComplete(null)}
              >
                Terminer la mise en service
              </Button>
              <Button asChild className="flex-1">
                <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                  Voir ma page <ExternalLink size={15} />
                </a>
              </Button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
