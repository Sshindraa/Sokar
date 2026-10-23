'use client';

import { FormEvent, useEffect, useState, type ReactNode } from 'react';
import {
  Check,
  Code2,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  Share2,
  ShieldCheck,
  Sparkles,
  Ticket,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { openTestBooking, type TestBookingOutcome } from '@/lib/test-booking';
import { buildWidgetSnippet } from '@/lib/widget-snippet';
import { useOnboarding } from '../onboarding-provider';
import { ConnectStepAction } from '../ui';
import type { StepProps } from '../types';
import { CLIPBOARD_RESET_DELAY_MS } from '@/constants/ui';

const CONNECT_HOST =
  process.env.NODE_ENV === 'development'
    ? 'http://localhost:4002'
    : (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sokar.tech');

const LEAD_TIME_OPTIONS = [
  { value: 0, label: 'Aucun' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 h' },
  { value: 120, label: '2 h' },
  { value: 240, label: '4 h' },
  { value: 1440, label: '24 h' },
];

const PLATFORM_GUIDES = [
  {
    key: 'wordpress',
    label: 'WordPress',
    steps: [
      'Ouvrez la page où afficher le bouton.',
      'Ajoutez un bloc « HTML personnalisé » et collez le code.',
      'Mettez la page à jour.',
    ],
  },
  {
    key: 'wix',
    label: 'Wix',
    steps: [
      'Dans l’éditeur, choisissez Ajouter › Intégrer du code › Intégrer HTML.',
      'Collez le code dans le bloc.',
      'Publiez votre site.',
    ],
  },
  {
    key: 'squarespace',
    label: 'Squarespace',
    steps: [
      'Ajoutez un bloc « Code » à la page (selon votre formule Squarespace).',
      'Collez le code et enregistrez.',
      'Publiez la page.',
    ],
  },
  {
    key: 'other',
    label: 'Autre site',
    steps: [
      'Collez le code juste avant la balise </body> de vos pages.',
      'Ou transmettez-le à la personne qui gère votre site.',
    ],
  },
] as const;

type PlatformKey = (typeof PLATFORM_GUIDES)[number]['key'];

/** Conditions propres au web, partagées par la page, le bouton du site et les assistants IA. */
type OnlineRules = {
  maxPartySize: number;
  minLeadTimeMinutes: number;
  requireManualValidation: boolean;
};

type OptInStatus = { mcp: boolean; openaiReserve: boolean };

function leadTimeHint(minutes: number) {
  if (minutes === 0) return 'Vos clients peuvent réserver jusqu’à la dernière minute.';
  const option = LEAD_TIME_OPTIONS.find((item) => item.value === minutes);
  return `Une table qui commence dans moins de ${option?.label ?? `${minutes} min`} ne peut plus être réservée en ligne.`;
}

function Panel({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Globe;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="space-y-4 rounded-[1.75rem] bg-card p-5 transition-all duration-200 sm:p-6"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
          <Icon size={18} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-tight text-foreground">{title}</h3>
          {description && (
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

export function ConnectActivationStep({ onComplete, onNavigate }: StepProps) {
  const { get, put, post, patch, orgId } = useApi();
  const { state, updateTask, placeImportDraft } = useOnboarding();
  const restaurant = state!.restaurant;
  const exposure = restaurant.exposureSettings;
  const pageReady =
    Boolean(restaurant.slug) &&
    state!.steps.some((step) => step.key === 'connect-identity' && step.status === 'completed');
  const missingForBooking =
    state!.readiness?.checks
      .filter((check) => !check.ok)
      .map((check) => check.label.toLowerCase()) ?? [];

  const [connectPublished, setConnectPublished] = useState<boolean>(
    exposure?.connectPublished || false,
  );
  const [justPublished, setJustPublished] = useState(false);
  const [rules, setRules] = useState<OnlineRules | null>(null);
  const [savedRules, setSavedRules] = useState<OnlineRules | null>(null);
  const [optIn, setOptIn] = useState<OptInStatus | null>(null);
  const [aiEnabled, setAiEnabled] = useState<boolean>(exposure?.connectAgentic || false);
  const [savedAgentic, setSavedAgentic] = useState<boolean>(exposure?.connectAgentic || false);
  const [rulesError, setRulesError] = useState(false);
  const [platform, setPlatform] = useState<PlatformKey>('wordpress');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<'link' | 'widget' | null>(null);
  const [error, setError] = useState('');
  const [testBookingLoading, setTestBookingLoading] = useState(false);
  const [testBookingOutcome, setTestBookingOutcome] = useState<TestBookingOutcome>(null);

  const previewUrl = `${CONNECT_HOST}/restaurant/${encodeURIComponent(restaurant.slug || '')}?preview=1`;
  const publicUrl = `${CONNECT_HOST}/restaurant/${encodeURIComponent(restaurant.slug || '')}`;
  async function handleTestBooking() {
    setTestBookingLoading(true);
    setTestBookingOutcome(null);
    try {
      setTestBookingOutcome(await openTestBooking({ post: (path) => post(path) }, publicUrl));
    } finally {
      setTestBookingLoading(false);
    }
  }

  const snippet = restaurant.slug ? buildWidgetSnippet(restaurant.slug) : '';
  const guide = PLATFORM_GUIDES.find((item) => item.key === platform) ?? PLATFORM_GUIDES[0];

  // Les conditions et l'état IA vivent dans les réglages agentic existants ; un échec de lecture
  // n'empêche pas la publication, il masque seulement ce qu'on ne peut pas afficher fidèlement.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [settings, status] = (await Promise.all([
          get('api/agentic/exposure-settings'),
          get('api/agentic/opt-in'),
        ])) as [OnlineRules, OptInStatus];
        if (cancelled) return;
        const loaded = {
          maxPartySize: settings.maxPartySize,
          minLeadTimeMinutes: settings.minLeadTimeMinutes,
          requireManualValidation: settings.requireManualValidation,
        };
        setRules(loaded);
        setSavedRules(loaded);
        setOptIn(status);
        setAiEnabled((current) => current || status.mcp);
      } catch {
        if (!cancelled) setRulesError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [get]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!pageReady) {
      onNavigate?.('connect-identity');
      setError('Enregistrez votre page avant de la publier.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (
        rules &&
        savedRules &&
        (rules.minLeadTimeMinutes !== savedRules.minLeadTimeMinutes ||
          rules.requireManualValidation !== savedRules.requireManualValidation)
      ) {
        await put('api/agentic/exposure-settings', {
          minLeadTimeMinutes: rules.minLeadTimeMinutes,
          requireManualValidation: rules.requireManualValidation,
        });
        setSavedRules(rules);
      }
      // Avant la publication : l'opt-in restaurant et `mcpEnabled` sont posés ensemble.
      if (optIn && aiEnabled !== optIn.mcp) {
        const next = (await post('api/agentic/opt-in', {
          mcp: aiEnabled,
          openaiReserve: aiEnabled ? optIn.openaiReserve : false,
        })) as OptInStatus;
        setOptIn(next);
      }
      // Première publication : on reste sur l'étape pour montrer la diffusion. La tâche n'est
      // validée qu'à « Continuer » : terminer le dernier canal ouvre aussitôt le dashboard.
      if (!connectPublished || aiEnabled !== savedAgentic) {
        await patch(`restaurants/${orgId}/connect`, {
          connectPublished: true,
          connectAgentic: aiEnabled,
        });
        setSavedAgentic(aiEnabled);
      }
      if (!connectPublished) {
        setConnectPublished(true);
        setJustPublished(true);
        return;
      }
      const updated = await updateTask('complete', 'connect-activation');
      if (!updated) throw new Error('completion failed');
      onComplete(null);
    } catch {
      setError('La mise en ligne n’a pas abouti. Vos réglages sont conservés, réessayez.');
    } finally {
      setSaving(false);
    }
  }

  async function handleCopy(kind: 'link' | 'widget') {
    if (!restaurant.slug) return;
    try {
      await navigator.clipboard.writeText(kind === 'link' ? publicUrl : snippet);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), CLIPBOARD_RESET_DELAY_MS);
    } catch {
      setError('Copie impossible : sélectionnez et copiez manuellement.');
    }
  }

  if (!pageReady) {
    return (
      <form
        id="connect-activation-form"
        onSubmit={handleSubmit}
        className="w-full max-w-3xl space-y-4"
      >
        <section className="space-y-4 rounded-[1.75rem] bg-card p-6">
          <p className="text-xl font-semibold tracking-tight">
            {restaurant.name ||
              placeImportDraft?.displayName ||
              placeImportDraft?.name ||
              'Votre page'}
          </p>
          <p className="text-sm text-muted-foreground">
            Enregistrez votre page avant de la publier.
          </p>
          <Button
            type="button"
            onClick={() => onNavigate?.('connect-identity')}
            className="rounded-full transition-all duration-200"
          >
            Revenir à ma page
          </Button>
        </section>
        <ConnectStepAction
          formId="connect-activation-form"
          saving={saving}
          label="Compléter ma page"
        />
      </form>
    );
  }

  const rulesPanel = (
    <Panel
      icon={Users}
      title="Vos conditions en ligne"
      description="Elles s’appliquent à votre page, au bouton de votre site et aux assistants IA."
    >
      {rulesError ? (
        <p role="status" className="text-sm text-muted-foreground">
          Vos conditions n’ont pas pu être chargées. Vous pourrez les régler depuis votre espace,
          rubrique Assistant IA.
        </p>
      ) : !rules ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Chargement de vos
          conditions…
        </p>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-muted/50 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Groupe maximum</p>
              <p className="text-xs text-muted-foreground">Réglé dans Salle et règles.</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{rules.maxPartySize} personnes</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onNavigate?.('floor')}
                className="rounded-full transition-all duration-200"
              >
                Modifier
              </Button>
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Délai minimum avant l’arrivée</legend>
            <div className="flex flex-wrap gap-2">
              {LEAD_TIME_OPTIONS.map((option) => {
                const active = rules.minLeadTimeMinutes === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setRules({ ...rules, minLeadTimeMinutes: option.value })}
                    className={cn(
                      'h-10 rounded-full px-4 text-sm font-medium transition-all duration-200',
                      active
                        ? 'bg-foreground text-background'
                        : 'bg-muted/60 text-foreground/75 hover:bg-foreground/10',
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              {leadTimeHint(rules.minLeadTimeMinutes)}
            </p>
          </fieldset>

          <div className="flex items-start justify-between gap-4">
            <div>
              <label htmlFor="online-manual-validation" className="text-sm font-medium">
                Valider chaque réservation à la main
              </label>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Les réservations en ligne arrivent en attente : vous les confirmez depuis vos
                réservations.
              </p>
            </div>
            <Switch
              id="online-manual-validation"
              checked={rules.requireManualValidation}
              onCheckedChange={(checked) =>
                setRules({ ...rules, requireManualValidation: checked })
              }
            />
          </div>
        </div>
      )}
    </Panel>
  );

  const aiPanel = (
    <Panel icon={Sparkles} title="Assistants IA">
      <div className="flex items-start justify-between gap-4">
        <div>
          <label htmlFor="online-ai-booking" className="text-sm font-medium">
            Réservable depuis les assistants IA
          </label>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Les assistants compatibles (Claude, ChatGPT…) peuvent proposer votre restaurant et y
            réserver une table pour leurs utilisateurs.
          </p>
        </div>
        <Switch id="online-ai-booking" checked={aiEnabled} onCheckedChange={setAiEnabled} />
      </div>
      <ul className="space-y-1.5 text-xs leading-5 text-muted-foreground">
        {[
          'Aux mêmes conditions que votre page',
          'Avec votre validation, si vous l’avez activée',
          'Désactivable à tout moment',
        ].map((item) => (
          <li key={item} className="flex items-center gap-2">
            <ShieldCheck size={13} aria-hidden="true" className="shrink-0 text-foreground/50" />
            {item}
          </li>
        ))}
      </ul>
    </Panel>
  );

  const diffusion = (
    <div className="space-y-4">
      <Panel icon={Globe} title="Votre lien de réservation">
        <div className="flex items-center gap-2 rounded-2xl bg-muted/50 px-4 py-2">
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 flex-1 truncate text-sm font-medium underline-offset-4 transition-all duration-200 hover:underline"
          >
            {publicUrl.replace(/^https?:\/\//, '')}
          </a>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => void handleCopy('link')}
            aria-label="Copier le lien de réservation"
            className="size-9 shrink-0"
          >
            {copied === 'link' ? <Check size={16} /> : <Copy size={16} />}
          </Button>
        </div>
      </Panel>

      <Panel
        icon={Ticket}
        title="Faites une réservation test"
        description="Faites le parcours d’un client, jusqu’à la confirmation."
      >
        <Button
          type="button"
          variant="outline"
          onClick={() => void handleTestBooking()}
          disabled={testBookingLoading}
          className="rounded-full transition-all duration-200"
        >
          Réserver sur ma page{' '}
          {testBookingLoading ? (
            <Loader2 size={15} className="animate-spin" aria-hidden="true" />
          ) : (
            <ExternalLink size={15} aria-hidden="true" />
          )}
        </Button>
        {testBookingOutcome?.kind === 'error' && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {testBookingOutcome.message}
          </p>
        )}
        {testBookingOutcome?.kind === 'notice' && (
          <p role="status" className="mt-2 text-sm text-muted-foreground">
            {testBookingOutcome.message}
          </p>
        )}
      </Panel>

      <Panel
        icon={Code2}
        title="Le bouton pour votre site"
        description="Vos visiteurs réservent sans quitter votre site."
      >
        <div role="group" aria-label="Votre outil de site" className="flex flex-wrap gap-2">
          {PLATFORM_GUIDES.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={platform === item.key}
              onClick={() => setPlatform(item.key)}
              className={cn(
                'h-9 rounded-full px-3.5 text-sm font-medium transition-all duration-200',
                platform === item.key
                  ? 'bg-foreground text-background'
                  : 'bg-muted/60 text-foreground/75 hover:bg-foreground/10',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-sm leading-6 text-foreground/85">
          {guide.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <div className="flex items-start gap-2 rounded-2xl bg-muted/50 p-3">
          <code className="min-w-0 flex-1 break-all font-mono text-xs leading-5 text-foreground/80">
            {snippet}
          </code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleCopy('widget')}
            className="shrink-0 rounded-full transition-all duration-200"
          >
            {copied === 'widget' ? <Check size={15} /> : <Copy size={15} />}
            {copied === 'widget' ? 'Copié' : 'Copier le code'}
          </Button>
        </div>
      </Panel>

      <Panel icon={Share2} title="Vos réseaux et Google">
        <ul className="space-y-2 text-sm leading-6 text-foreground/85">
          <li>
            <span className="font-medium">Instagram</span> : ajoutez le lien dans votre bio.
          </li>
          <li>
            <span className="font-medium">Google</span> : indiquez-le comme lien de réservation de
            votre fiche.
          </li>
          <li>
            <span className="font-medium">Facebook</span> : ajoutez un bouton « Réserver » vers ce
            lien.
          </li>
        </ul>
      </Panel>
    </div>
  );

  return (
    <form
      id="connect-activation-form"
      onSubmit={handleSubmit}
      className="w-full max-w-6xl space-y-4"
    >
      {missingForBooking.length > 0 && (
        <p
          role="status"
          className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm leading-6 text-foreground"
        >
          Votre page peut être publiée, mais vos clients ne pourront pas réserver tant qu’il manque
          : {missingForBooking.join(', ')}.
        </p>
      )}
      {connectPublished ? (
        <>
          <p
            role="status"
            className="flex items-center gap-2 rounded-full bg-muted/50 px-5 py-3 text-sm font-medium"
          >
            <span className="flex size-6 items-center justify-center rounded-full bg-foreground text-background">
              <Check size={12} aria-hidden="true" />
            </span>
            {justPublished
              ? 'Votre page est en ligne. Partagez-la dès maintenant.'
              : 'Votre page est en ligne.'}
          </p>
          <div className="grid min-w-0 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            {diffusion}
            <div className="space-y-4">
              {rulesPanel}
              {aiPanel}
            </div>
          </div>
        </>
      ) : (
        <div className="grid min-w-0 gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="space-y-4">
            {rulesPanel}
            {aiPanel}
          </div>
          <section aria-label="Aperçu client" className="overflow-hidden rounded-[1.75rem] bg-card">
            <div className="flex items-center justify-between gap-3 px-5 py-4">
              <p className="text-sm font-semibold">Aperçu client</p>
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                {restaurant.name}
              </span>
            </div>
            <iframe
              src={previewUrl}
              className="h-[420px] w-full border-0 bg-background"
              title="Aperçu de votre page publique"
            />
          </section>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <ConnectStepAction
        formId="connect-activation-form"
        saving={saving}
        label={connectPublished ? 'Continuer' : 'Publier ma page'}
      />
    </form>
  );
}
