'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  CheckCircle2,
  Clock3,
  Loader2,
  PhoneForwarded,
  Save,
  Sparkles,
  Store,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { SyncOrganization } from '@/app/dashboard/SyncOrganization';
import { OnboardingProvider, useOnboarding } from '@/features/onboarding/onboarding-provider';
import { OnboardingStepper } from '@/features/onboarding/onboarding-dashboard';
import type { OnboardingTaskKey } from '@/features/onboarding/types';

const STEP_KEYS: OnboardingTaskKey[] = ['restaurant', 'hours', 'knowledge', 'calendar', 'phone'];

const DAY_LABELS = [
  ['mon', 'Lundi'],
  ['tue', 'Mardi'],
  ['wed', 'Mercredi'],
  ['thu', 'Jeudi'],
  ['fri', 'Vendredi'],
  ['sat', 'Samedi'],
  ['sun', 'Dimanche'],
] as const;

const PROFILE_OPTIONS = [
  { value: 'BISTROT_BRASSERIE', label: 'Bistrot' },
  { value: 'SEMI_GASTRO', label: 'Semi-gastro' },
  { value: 'GASTRONOMIQUE', label: 'Gastronomique' },
];

const FILLER_OPTIONS = [
  { value: 'WARM', label: 'Chaleureux' },
  { value: 'CASUAL', label: 'Naturel' },
  { value: 'FORMAL', label: 'Formel' },
];

const SUGGESTIONS = [
  'Proposer la formule midi en semaine.',
  'Mentionner la terrasse quand elle est disponible.',
  'Prévenir que le vendredi soir part vite.',
];
const hasClerkKey = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export default function OnboardingStepPage() {
  return (
    <OnboardingProvider>
      {hasClerkKey && <SyncOrganization />}
      <OnboardingStepContent />
    </OnboardingProvider>
  );
}

function OnboardingStepContent() {
  const params = useParams();
  const router = useRouter();
  const step = params.step as OnboardingTaskKey;
  const { state, loading, error, openStep } = useOnboarding();

  useEffect(() => {
    if (!STEP_KEYS.includes(step)) {
      router.replace('/onboarding/restaurant');
    }
  }, [router, step]);

  const currentIndex = STEP_KEYS.indexOf(step);
  const prev = currentIndex > 0 ? STEP_KEYS[currentIndex - 1] : null;

  if (loading || !state) {
    return (
      <main className="dark sokar-page min-h-screen p-6 pt-28 md:p-8 md:pt-32">
        <div className="mx-auto max-w-6xl space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </main>
    );
  }

  return (
    <main className="dark sokar-page relative min-h-screen overflow-hidden p-4 pt-28 md:p-8 md:pt-32">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,hsl(var(--foreground)/0.10),transparent_36%),linear-gradient(hsl(var(--border)/0.18)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border)/0.14)_1px,transparent_1px)] bg-[auto,72px_72px,72px_72px] opacity-70" />
      <div className="relative z-10 mx-auto max-w-6xl space-y-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Sokar OS</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">
              Mise en service de l’assistant
            </h1>
          </div>
          <Button variant="outline" asChild className="transition-all duration-200">
            <Link href="/dashboard">Retour au dashboard</Link>
          </Button>
        </div>

        <OnboardingStepper />

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive transition-all duration-200">
            {error}
          </div>
        )}

        <section className="rounded-lg border border-border bg-card/90 p-4 shadow-xl backdrop-blur-xl transition-all duration-200 md:p-6">
          {step === 'restaurant' && <RestaurantStep />}
          {step === 'hours' && <HoursStep />}
          {step === 'knowledge' && <KnowledgeStep />}
          {step === 'calendar' && <CalendarStep />}
          {step === 'phone' && <PhoneStep />}
        </section>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            disabled={!prev}
            onClick={() => prev && openStep(prev)}
            className="transition-all duration-200"
          >
            <ArrowLeft size={16} />
            Étape précédente
          </Button>
          <p className="text-sm text-muted-foreground">
            {state.completedCount}/{state.totalCount} étapes validées · {state.progress}% prêt
          </p>
        </div>
      </div>
    </main>
  );
}

function RestaurantStep() {
  const router = useRouter();
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
      router.push('/onboarding/hours');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
      <StepHeader
        icon={Store}
        title="Identité du restaurant"
        body="On valide uniquement les informations utiles pour contacter le gérant et signer les messages."
      />
      <div className="space-y-4">
        <Field label="Nom du restaurant">
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Téléphone du gérant">
          <Input
            type="tel"
            value={managerPhone}
            onChange={(e) => setManagerPhone(e.target.value)}
            required
          />
        </Field>
        <Field label="Email du gérant">
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

function HoursStep() {
  const router = useRouter();
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
      router.push('/onboarding/knowledge');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
      <StepHeader
        icon={Clock3}
        title="Quand répondre et réserver"
        body="On propose une base réaliste, jamais une identité inventée. Ajustez les créneaux et Sokar suivra."
      />
      <div className="space-y-3">
        {DAY_LABELS.map(([day, label]) => {
          const value = hours[day];
          const open = Boolean(value);

          return (
            <div
              key={day}
              className="grid gap-3 rounded-lg border border-border bg-background/60 p-3 transition-all duration-200 md:grid-cols-[8rem_1fr]"
            >
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={open}
                  onChange={(e) =>
                    updateDay(day, e.target.checked ? { open: '12:00', close: '22:00' } : null)
                  }
                  className="h-4 w-4 rounded border-border"
                />
                {label}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="time"
                  disabled={!open}
                  value={value?.open ?? '12:00'}
                  onChange={(e) =>
                    updateDay(day, { open: e.target.value, close: value?.close ?? '22:00' })
                  }
                />
                <Input
                  type="time"
                  disabled={!open}
                  value={value?.close ?? '22:00'}
                  onChange={(e) =>
                    updateDay(day, { open: value?.open ?? '12:00', close: e.target.value })
                  }
                />
              </div>
            </div>
          );
        })}
        <SubmitButton saving={saving}>Enregistrer les horaires</SubmitButton>
      </div>
    </form>
  );
}

function KnowledgeStep() {
  const router = useRouter();
  const { patch, orgId } = useApi();
  const { state, updateTask } = useOnboarding();
  const personality = state?.restaurant.personality;
  const [profileType, setProfileType] = useState(personality?.profileType ?? 'BISTROT_BRASSERIE');
  const [fillerStyle, setFillerStyle] = useState(personality?.fillerStyle ?? 'WARM');
  const [systemPromptExtra, setSystemPromptExtra] = useState(personality?.systemPromptExtra ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await patch(`restaurants/${orgId}/personality`, {
        profileType,
        fillerStyle,
        systemPromptExtra: systemPromptExtra || undefined,
      });
      await updateTask('complete', 'knowledge');
      router.push('/onboarding/calendar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
      <StepHeader
        icon={Sparkles}
        title="Ce que l’assistant doit savoir"
        body="Pas de carte inventée : on règle le ton, puis vous ajoutez seulement les consignes fiables."
      />
      <div className="space-y-5">
        <Segmented
          label="Type de service"
          value={profileType}
          options={PROFILE_OPTIONS}
          onChange={setProfileType}
        />
        <Segmented
          label="Ton par défaut"
          value={fillerStyle}
          options={FILLER_OPTIONS}
          onChange={setFillerStyle}
        />
        <Field label="Instructions personnalisées">
          <textarea
            value={systemPromptExtra}
            onChange={(e) => setSystemPromptExtra(e.target.value)}
            rows={6}
            className="min-h-32 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-all duration-200 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            placeholder="Ex : proposer la formule midi, mentionner la terrasse, préciser les horaires de cuisine."
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <Button
              key={suggestion}
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setSystemPromptExtra((current) => `${current}${current ? '\n' : ''}${suggestion}`)
              }
              className="transition-all duration-200"
            >
              {suggestion}
            </Button>
          ))}
        </div>
        <SubmitButton saving={saving}>Enregistrer la personnalité</SubmitButton>
      </div>
    </form>
  );
}

function CalendarStep() {
  const router = useRouter();
  const { get } = useApi();
  const { state, updateTask } = useOnboarding();
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleGoogle() {
    setLoadingGoogle(true);
    try {
      const data = await get<{ url?: string }>('integrations/google-calendar/auth');
      if (data.url) window.location.href = data.url;
    } finally {
      setLoadingGoogle(false);
    }
  }

  async function handleManual() {
    setSaving(true);
    try {
      await updateTask('complete', 'calendar', { metadata: { fallback: 'manual_calendar' } });
      router.push('/onboarding/phone');
    } finally {
      setSaving(false);
    }
  }

  async function handleContinue() {
    setSaving(true);
    try {
      await updateTask('complete', 'calendar');
      router.push('/onboarding/phone');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
      <StepHeader
        icon={Calendar}
        title="Connexion au planning"
        body="Google Calendar permet la lecture des disponibilités. En cas de blocage, vous pouvez continuer avec un agenda manuel."
      />
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-background/60 p-4 transition-all duration-200">
          {state?.restaurant.googleConnected ? (
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 text-emerald-400" size={20} />
              <div>
                <p className="font-semibold">Google Calendar est connecté</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  L’assistant pourra vérifier les créneaux avant de confirmer.
                </p>
              </div>
            </div>
          ) : (
            <div>
              <p className="font-semibold">Agenda non connecté</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Vous pouvez connecter Google maintenant ou continuer avec un suivi manuel.
              </p>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {state?.restaurant.googleConnected ? (
            <Button
              type="button"
              onClick={handleContinue}
              disabled={saving}
              className="transition-all duration-200"
            >
              Continuer
              <ArrowRight size={16} />
            </Button>
          ) : (
            <>
              <Button
                type="button"
                onClick={handleGoogle}
                disabled={loadingGoogle}
                className="transition-all duration-200"
              >
                {loadingGoogle && <Loader2 className="animate-spin" size={16} />}
                Connecter Google
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleManual}
                disabled={saving}
                className="transition-all duration-200"
              >
                Utiliser un autre agenda
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PhoneStep() {
  const router = useRouter();
  const { state, updateTask } = useOnboarding();
  const { post, orgId } = useApi();
  const [calling, setCalling] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const phoneNumber = state?.restaurant.phoneNumber ?? '';
  const hasAssignedPhone = Boolean(state?.restaurant.phoneAssigned);
  const managerPhone = state?.restaurant.managerPhone ?? '';

  async function handleTestCall() {
    if (!managerPhone) {
      setTestError('Numéro du gérant manquant. Revenez à l’étape 1.');
      return;
    }
    setCalling(true);
    setTestError(null);
    setTestResult(null);
    try {
      const res = await post<{ ok: boolean; message: string }>('restaurant/onboarding/test-call', {
        phoneNumber: managerPhone,
      });
      await updateTask('first_call', 'phone');
      await updateTask('complete', 'phone');
      await updateTask('activate');
      setTestResult(`${res.message} Redirection vers le dashboard…`);
      window.setTimeout(() => router.push('/dashboard'), 900);
    } catch (err: any) {
      setTestError(err?.message ?? "L'appel test a échoué. Réessaie ou contacte le support.");
    } finally {
      setCalling(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
      <StepHeader
        icon={PhoneForwarded}
        title="Mise en service des appels"
        body="Le dernier jalon : numéro Sokar, renvoi d’appel opérateur, puis test audible par le gérant."
      />
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-background/60 p-4 transition-all duration-200">
          <p className="text-sm text-muted-foreground">Numéro Sokar attribué</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">
            {hasAssignedPhone ? phoneNumber : 'À attribuer'}
          </p>
          {!hasAssignedPhone && (
            <p className="mt-2 text-sm text-amber-300">
              Le numéro peut être ajouté depuis les réglages ou par l’équipe Sokar avant la mise en
              production.
            </p>
          )}
        </div>
        <div className="rounded-lg border border-border bg-background/60 p-4 text-sm text-muted-foreground transition-all duration-200">
          Activez le renvoi d’appel depuis l’opérateur du restaurant vers le numéro Sokar, puis
          lancez un test.
        </div>

        {testResult && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">
            {testResult}
          </div>
        )}
        {testError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {testError}
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            onClick={handleTestCall}
            disabled={calling || !hasAssignedPhone || !managerPhone}
            className="transition-all duration-200"
          >
            {calling && <Loader2 className="animate-spin" size={16} />}
            {calling ? 'Appel en cours…' : 'Lancer un appel test'}
            <PhoneForwarded size={16} />
          </Button>
        </div>
        {!hasAssignedPhone && (
          <p className="text-xs text-muted-foreground">
            L’appel test sera disponible dès qu’un numéro Sokar sera attribué à ce restaurant.
          </p>
        )}
      </div>
    </div>
  );
}

function StepHeader({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Store;
  title: string;
  body: string;
}) {
  return (
    <div>
      <div className="mb-4 inline-flex rounded-lg bg-primary/10 p-3 text-primary">
        <Icon size={22} />
      </div>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-lg border border-border bg-background/60 px-3 py-2 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground',
              value === option.value && 'border-primary/50 bg-primary/10 text-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SubmitButton({ saving, children }: { saving: boolean; children: React.ReactNode }) {
  return (
    <Button type="submit" disabled={saving} className="transition-all duration-200">
      {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
      {children}
    </Button>
  );
}
