'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Gauge,
  Globe,
  Loader2,
  MapPin,
  PhoneForwarded,
  Store,
  Utensils,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { useOnboarding } from './onboarding-provider';
import type { OnboardingTaskKey } from './types';
import {
  StepHeader,
  Field,
  Segmented,
  SubmitButton,
  DAY_LABELS,
  PROFILE_OPTIONS,
  FILLER_OPTIONS,
  SUGGESTIONS,
  CUISINES_PRESETS,
  DIETARY_PRESETS,
  FEATURES_PRESETS,
  resizeImage,
} from './ui';

export type StepProps = {
  onComplete: (nextStep: OnboardingTaskKey | null) => void;
};

// ─── VOICE STEPS ──────────────────────────────────────────────

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
              className="grid gap-3 rounded-lg border border-border bg-background/60 p-3 transition-all duration-200 md:grid-cols-[8rem_1fr]"
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

export function KnowledgeStep({ onComplete }: StepProps) {
  const { patch, orgId } = useApi();
  const { state, updateTask } = useOnboarding();
  const personality = state?.restaurant.personality;

  const [profileType, setProfileType] = useState(personality?.profileType || 'BISTROT_BRASSERIE');
  const [fillerStyle, setFillerStyle] = useState(personality?.fillerStyle || 'CASUAL');
  const [speakingRate, setSpeakingRate] = useState(Number(personality?.speakingRate || 1.0));
  const [systemPromptExtra, setSystemPromptExtra] = useState(personality?.systemPromptExtra || '');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
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
      onComplete('calendar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
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

        <Field label="Consignes particulières (ex: suggestions, plats signatures)">
          <textarea
            value={systemPromptExtra}
            onChange={(e) => setSystemPromptExtra(e.target.value)}
            placeholder="Exemple : Toujours proposer notre formule midi en semaine. Parler de notre terrasse ombragée."
            className="flex min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            maxLength={1000}
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

        <SubmitButton saving={saving}>Valider et connecter l&apos;agenda</SubmitButton>
      </div>
    </form>
  );
}

export function CalendarStep({ onComplete }: StepProps) {
  const { state, updateTask } = useOnboarding();
  const connected = Boolean(state?.restaurant.googleConnected);
  const calendarId = state?.restaurant.googleCalendarId;

  async function handleComplete() {
    await updateTask('complete', 'calendar');
    onComplete('phone');
  }

  async function handleSkip() {
    await updateTask('skip', 'calendar', { reason: 'Agenda manuel' });
    onComplete('phone');
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
      <StepHeader
        icon={Calendar}
        title="Connexion au planning"
        body="Google Calendar nous permet de vérifier la disponibilité en temps réel avant d'attribuer une table."
      />
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-background/60 p-4 transition-all duration-200">
          <p className="text-sm text-muted-foreground font-semibold">Statut de la connexion</p>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={cn(
                'h-2.5 w-2.5 rounded-full',
                connected ? 'bg-emerald-500 animate-pulse' : 'bg-muted',
              )}
            />
            <span className="text-sm font-medium">
              {connected ? `Connecté · ID : ${calendarId}` : 'Non connecté'}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          {!connected && (
            <Button variant="outline" className="transition-all duration-200" disabled>
              <Globe size={16} />
              Connexion Google Calendar (Aperçu)
            </Button>
          )}
          {connected ? (
            <Button onClick={handleComplete}>Continuer</Button>
          ) : (
            <Button onClick={handleSkip} variant="outline">
              Utiliser le planning manuel (Sokar OS)
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          En choisissant le planning manuel, vous gérez les arrivées depuis l&apos;onglet
          Réservations.
        </p>
      </div>
    </div>
  );
}

export function PhoneStep({ onComplete }: StepProps) {
  const { state, updateTask } = useOnboarding();
  const { post } = useApi();
  const [calling, setCalling] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const phoneNumber = state?.restaurant.phoneNumber ?? '';
  const hasAssignedPhone = Boolean(state?.restaurant.phoneAssigned);
  const managerPhone = state?.restaurant.managerPhone ?? '';

  async function handleTestCall() {
    if (!managerPhone) {
      setTestError("Numéro du restaurant manquant. Revenez à l'étape « Identité du restaurant ».");
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
      setTestResult(
        'Assistant vocal configuré. Votre IA répond maintenant au téléphone. Passons à la mise en ligne de votre fiche réservable…',
      );
      window.setTimeout(() => onComplete('connect-identity'), 2000);
    } catch (err: any) {
      // L'API renvoie un code structuré pour différencier les causes d'échec.
      // NO_PHONE_ASSIGNED : action Sokar (pas un retry utilisateur)
      // TELNYX_FAILED    : erreur réseau/opérateur (réessayer)
      // fallback         : message générique
      const code = err?.code ?? err?.response?.data?.code;
      const apiMessage = err?.response?.data?.error ?? err?.message;
      if (code === 'NO_PHONE_ASSIGNED') {
        setTestError(
          apiMessage ??
            "Aucun numéro Sokar attribué. L'équipe Sokar doit d'abord vous attribuer un numéro dédié.",
        );
      } else if (code === 'TELNYX_FAILED') {
        setTestError(
          apiMessage ??
            "L'appel test n'a pas pu être déclenché (opérateur injoignable). Réessayez dans quelques minutes.",
        );
      } else {
        setTestError(apiMessage ?? "L'appel test a échoué. Réessayez ou contactez le support.");
      }
    } finally {
      setCalling(false);
    }
  }

  async function handleSkip() {
    await updateTask('skip', 'phone', { reason: 'Pas de test immédiat' });
    onComplete('connect-identity');
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
      <StepHeader
        icon={PhoneForwarded}
        title="Mise en service des appels"
        body="Le dernier jalon vocal : votre numéro Sokar, le renvoi d'appel opérateur et votre premier test IA."
      />
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-background/60 p-4 transition-all duration-200">
          <p className="text-sm text-muted-foreground font-semibold">Numéro Sokar</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">
            {hasAssignedPhone ? phoneNumber : 'À attribuer'}
          </p>
          {!hasAssignedPhone && (
            <p className="mt-2 text-sm text-amber-300">
              Votre numéro dédié sera attribué par l&apos;équipe Sokar. Une fois attribué, vous
              pourrez lancer l&apos;appel test et activer le service vocal.
            </p>
          )}
        </div>
        <div className="rounded-lg border border-border bg-background/60 p-4 text-sm text-muted-foreground transition-all duration-200">
          Activez le renvoi d&apos;appel depuis l&apos;opérateur du restaurant vers le numéro Sokar,
          puis lancez le test.
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
          <Button onClick={handleSkip} variant="ghost" className="transition-all duration-200">
            Plus tard
          </Button>
        </div>
        {!hasAssignedPhone && (
          <p className="text-xs text-muted-foreground">
            L&apos;appel test sera disponible dès qu&apos;un numéro Sokar sera attribué à ce
            restaurant par notre équipe.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── CONNECT STEPS ────────────────────────────────────────────

export function ConnectIdentityStep({ onComplete }: StepProps) {
  const { patch, post, get, orgId } = useApi();
  const { state, updateTask } = useOnboarding();
  const restaurant = state!.restaurant;

  const [slug, setSlug] = useState(restaurant.slug || '');
  const [description, setDescription] = useState(restaurant.description || '');
  const [coverImageUrl, setCoverImageUrl] = useState(restaurant.coverImageUrl || '');
  const [saving, setSaving] = useState(false);

  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [checkingSlug, setCheckingSlug] = useState(false);

  useEffect(() => {
    if (!slug) {
      setSlugAvailable(null);
      return;
    }
    const regex = /^[a-z0-9-]+$/;
    if (!regex.test(slug)) {
      setSlugAvailable(false);
      return;
    }
    const timeout = setTimeout(async () => {
      setCheckingSlug(true);
      try {
        const res = await get<{ available: boolean }>(`restaurants/check-slug?slug=${slug}`);
        setSlugAvailable(res.available);
      } catch {
        setSlugAvailable(false);
      } finally {
        setCheckingSlug(false);
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [slug]);

  async function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      try {
        const resized = await resizeImage(file, 1000, 1000);
        setCoverImageUrl(resized);
      } catch (err) {
        console.error(err);
      }
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const resized = await resizeImage(file, 1000, 1000);
        setCoverImageUrl(resized);
      } catch (err) {
        console.error(err);
      }
    }
  }

  function setDemoPhoto() {
    setCoverImageUrl(
      'https://images.unsplash.com/photo-1550966871-3ed3cdb5ed0c?q=80&w=1000&auto=format&fit=crop',
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (slugAvailable === false) return;
    setSaving(true);
    try {
      if (coverImageUrl && coverImageUrl !== restaurant.coverImageUrl) {
        await post(`restaurants/${orgId}/images`, { url: coverImageUrl, isCover: true });
      }
      await patch(`restaurants/${orgId}/connect`, { slug, description, coverImageUrl });
      await updateTask('complete', 'connect-identity');
      onComplete('connect-location');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
      <StepHeader
        icon={Globe}
        title="Identité publique"
        body="C'est ce que vos clients verront sur les fiches d'assistants IA et votre URL personnalisée."
      />
      <div className="space-y-4">
        <Field label="Adresse web (Slug)">
          <div className="relative flex items-center">
            <span className="absolute left-3 text-sm text-muted-foreground">sokar.tech/r/</span>
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().trim())}
              className="pl-24"
              required
            />
            {checkingSlug && (
              <Loader2 className="absolute right-3 animate-spin text-muted-foreground" size={16} />
            )}
            {!checkingSlug && slugAvailable === true && (
              <Check className="absolute right-3 text-emerald-400" size={16} />
            )}
            {!checkingSlug && slugAvailable === false && (
              <span className="absolute right-3 text-xs text-destructive">Indisponible</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Lettres minuscules, chiffres et tirets uniquement.
          </p>
        </Field>

        <Field label="Description courte publique (200 caractères max)">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2"
            maxLength={200}
            placeholder="Ex: Un bistrot chaleureux au cœur du Vieux Lyon servant une cuisine traditionnelle revisitée."
            required
          />
        </Field>

        <Field label="Photo de couverture">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleFileDrop}
            className="border-2 border-dashed border-border rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 transition-all bg-background/40 relative min-h-[160px]"
          >
            {coverImageUrl ? (
              <div className="absolute inset-0 p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={coverImageUrl}
                  alt="Cover preview"
                  className="w-full h-full object-cover rounded-lg"
                />
                <button
                  type="button"
                  onClick={() => setCoverImageUrl('')}
                  className="absolute top-3 right-3 bg-black/60 hover:bg-black/80 text-white rounded-full p-1 text-xs"
                >
                  Supprimer
                </button>
              </div>
            ) : (
              <div className="text-center space-y-2">
                <Store className="mx-auto text-muted-foreground" size={32} />
                <p className="text-sm text-muted-foreground">Glisse ou dépose une photo ici</p>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                  id="cover-upload"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => document.getElementById('cover-upload')?.click()}
                >
                  Sélectionner un fichier
                </Button>
                <div className="pt-2">
                  <Button type="button" variant="ghost" size="sm" onClick={setDemoPhoto}>
                    Utiliser une photo de démo
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Field>

        <SubmitButton saving={saving}>Enregistrer et continuer</SubmitButton>
      </div>
    </form>
  );
}

export function ConnectLocationStep({ onComplete }: StepProps) {
  const { patch, orgId } = useApi();
  const { state, updateTask } = useOnboarding();
  const restaurant = state!.restaurant;

  const [formattedAddress, setFormattedAddress] = useState(restaurant.formattedAddress || '');
  const [postalCode, setPostalCode] = useState(restaurant.postalCode || '');
  const [city, setCity] = useState(restaurant.city || '');
  const [country, setCountry] = useState(restaurant.country || 'FR');
  const [lat, setLat] = useState<number | null>(restaurant.lat || null);
  const [lng, setLng] = useState<number | null>(restaurant.lng || null);

  const [cityQuery, setCityQuery] = useState(city);
  const [citySuggestions, setCitySuggestions] = useState<
    Array<{ nom: string; codesPostaux: string[] }>
  >([]);
  const [saving, setSaving] = useState(false);
  const [geocoding, setGeocoding] = useState(false);

  useEffect(() => {
    if (cityQuery.length < 2) {
      setCitySuggestions([]);
      return;
    }
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(cityQuery)}&fields=nom,codesPostaux&limit=5`,
        );
        if (res.ok) {
          const data = await res.json();
          setCitySuggestions(data);
        }
      } catch (err) {
        console.error(err);
      }
    }, 200);
    return () => clearTimeout(timeout);
  }, [cityQuery]);

  useEffect(() => {
    if (!formattedAddress || !postalCode || !city) return;
    const timeout = setTimeout(async () => {
      setGeocoding(true);
      try {
        const q = `${formattedAddress}, ${postalCode} ${city}, France`;
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`,
          { headers: { 'User-Agent': 'Sokar-Dashboard/1.0' } },
        );
        if (res.ok) {
          const data = await res.json();
          if (data && data[0]) {
            setLat(Number(data[0].lat));
            setLng(Number(data[0].lon));
          }
        }
      } catch (err) {
        console.error('Geocoding error', err);
      } finally {
        setGeocoding(false);
      }
    }, 1000);
    return () => clearTimeout(timeout);
  }, [formattedAddress, postalCode, city]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await patch(`restaurants/${orgId}/connect`, {
        formattedAddress,
        postalCode,
        city,
        country,
        lat,
        lng,
      });
      await updateTask('complete', 'connect-location');
      onComplete('connect-cuisine');
    } finally {
      setSaving(false);
    }
  }

  function handleSelectCity(item: { nom: string; codesPostaux: string[] }) {
    setCity(item.nom);
    setCityQuery(item.nom);
    if (item.codesPostaux && item.codesPostaux[0]) {
      setPostalCode(item.codesPostaux[0]);
    }
    setCitySuggestions([]);
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
      <StepHeader
        icon={MapPin}
        title="Localisation"
        body="Renseignez l'adresse physique de votre établissement pour apparaître dans les recherches de proximité."
      />
      <div className="space-y-4">
        <Field label="Adresse (Ligne 1)">
          <Input
            value={formattedAddress}
            onChange={(e) => setFormattedAddress(e.target.value)}
            placeholder="12 rue de la république"
            required
          />
        </Field>

        <div className="grid gap-3 grid-cols-2">
          <div className="relative">
            <Field label="Ville">
              <Input
                value={cityQuery}
                onChange={(e) => {
                  setCityQuery(e.target.value);
                  setCity(e.target.value);
                }}
                placeholder="Paris, Lyon..."
                required
              />
            </Field>
            {citySuggestions.length > 0 && (
              <div className="absolute z-20 w-full mt-1 bg-card border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                {citySuggestions.map((item) => (
                  <button
                    key={item.nom}
                    type="button"
                    onClick={() => handleSelectCity(item)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors border-b border-border last:border-b-0"
                  >
                    {item.nom} ({item.codesPostaux?.[0] || ''})
                  </button>
                ))}
              </div>
            )}
          </div>

          <Field label="Code postal">
            <Input
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              placeholder="75001"
              required
            />
          </Field>
        </div>

        <div className="grid gap-3 grid-cols-3">
          <Field label="Pays">
            <Input value={country} onChange={(e) => setCountry(e.target.value)} required />
          </Field>

          <Field label="Latitude">
            <Input
              type="number"
              step="0.000001"
              value={lat || ''}
              onChange={(e) => setLat(Number(e.target.value))}
              required
            />
          </Field>

          <Field label="Longitude">
            <Input
              type="number"
              step="0.000001"
              value={lng || ''}
              onChange={(e) => setLng(Number(e.target.value))}
              required
            />
          </Field>
        </div>

        {geocoding && (
          <div className="flex items-center gap-2 text-xs text-amber-300">
            <Loader2 className="animate-spin" size={14} />
            Calcul des coordonnées GPS en cours...
          </div>
        )}

        {lat && lng && (
          <div className="rounded-lg overflow-hidden border border-border h-48 w-full bg-background relative">
            <iframe
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.003}%2C${lat - 0.002}%2C${lng + 0.003}%2C${lat + 0.002}&layer=mapnik&marker=${lat}%2C${lng}`}
              className="w-full h-full border-0"
              title="Establishment location map preview"
            />
          </div>
        )}

        <SubmitButton saving={saving}>Enregistrer et continuer</SubmitButton>
      </div>
    </form>
  );
}

export function ConnectCuisineStep({ onComplete }: StepProps) {
  const { patch, orgId } = useApi();
  const { state, updateTask } = useOnboarding();
  const restaurant = state!.restaurant;

  const [cuisineType, setCuisineType] = useState<string[]>(restaurant.cuisineType || []);
  const [priceRange, setPriceRange] = useState<number>(restaurant.priceRange || 2);
  const [dietary, setDietary] = useState<string[]>(restaurant.dietary || []);
  const [ambiance, setAmbiance] = useState<string[]>(restaurant.ambiance || []);

  const [customCuisine, setCustomCuisine] = useState('');
  const [saving, setSaving] = useState(false);

  function toggleItem(list: string[], setList: (v: string[]) => void, item: string) {
    if (list.includes(item)) {
      setList(list.filter((x) => x !== item));
    } else {
      setList([...list, item]);
    }
  }

  function addCustomCuisine(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && customCuisine.trim()) {
      e.preventDefault();
      const val = customCuisine.trim();
      if (!cuisineType.includes(val)) {
        setCuisineType([...cuisineType, val]);
      }
      setCustomCuisine('');
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await patch(`restaurants/${orgId}/connect`, {
        cuisineType,
        priceRange,
        dietary,
        ambiance,
      });
      await updateTask('complete', 'connect-cuisine');
      onComplete('connect-capacity');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
      <StepHeader
        icon={Utensils}
        title="Cuisine & ambiance"
        body="Dites-nous ce que vous servez et dans quel cadre pour correspondre aux attentes des utilisateurs d'assistants IA."
      />
      <div className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Types de cuisine</label>
          <div className="flex flex-wrap gap-2 mb-2">
            {CUISINES_PRESETS.map((c) => {
              const active = cuisineType.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleItem(cuisineType, setCuisineType, c)}
                  className={cn(
                    'px-3 py-1 text-xs rounded-full border border-border bg-background hover:border-primary/50 transition-all',
                    active && 'border-primary/50 bg-primary/10 text-primary',
                  )}
                >
                  {c}
                </button>
              );
            })}
          </div>
          <Input
            value={customCuisine}
            onChange={(e) => setCustomCuisine(e.target.value)}
            onKeyDown={addCustomCuisine}
            placeholder="Saisis une autre cuisine et appuie sur Entrée..."
          />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {cuisineType
              .filter((c) => !CUISINES_PRESETS.includes(c))
              .map((c) => (
                <span
                  key={c}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground"
                >
                  {c}
                  <button
                    type="button"
                    onClick={() => setCuisineType(cuisineType.filter((x) => x !== c))}
                    className="hover:text-foreground"
                  >
                    ×
                  </button>
                </span>
              ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-2">Gamme de prix</label>
          <div className="grid grid-cols-4 gap-2">
            {[1, 2, 3, 4].map((p) => {
              const active = priceRange === p;
              const labels = ['Budget (€)', 'Modéré (€€)', 'Chic (€€€)', 'Prestige (€€€€)'];
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriceRange(p)}
                  className={cn(
                    'px-3 py-2 text-xs rounded-lg border border-border bg-background hover:bg-accent transition-all font-medium',
                    active && 'border-primary/50 bg-primary/10 text-primary',
                  )}
                >
                  {labels[p - 1]}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Régimes alimentaires proposés
          </label>
          <div className="flex flex-wrap gap-2">
            {DIETARY_PRESETS.map((d) => {
              const active = dietary.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleItem(dietary, setDietary, d)}
                  className={cn(
                    'px-3 py-1 text-xs rounded-full border border-border bg-background hover:border-primary/50 transition-all capitalize',
                    active && 'border-primary/50 bg-primary/10 text-primary',
                  )}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Atouts de l&apos;établissement
          </label>
          <div className="flex flex-wrap gap-2">
            {FEATURES_PRESETS.map((f) => {
              const active = ambiance.includes(f);
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => toggleItem(ambiance, setAmbiance, f)}
                  className={cn(
                    'px-3 py-1 text-xs rounded-full border border-border bg-background hover:border-primary/50 transition-all capitalize',
                    active && 'border-primary/50 bg-primary/10 text-primary',
                  )}
                >
                  {f}
                </button>
              );
            })}
          </div>
        </div>

        <div className="pt-2">
          <SubmitButton saving={saving}>Enregistrer et continuer</SubmitButton>
        </div>
      </div>
    </form>
  );
}

export function ConnectCapacityStep({ onComplete }: StepProps) {
  const { patch, orgId } = useApi();
  const { state, updateTask } = useOnboarding();
  const restaurant = state!.restaurant;
  const exposure = restaurant.exposureSettings;
  const specials = (exposure?.capacitySpecials as Record<string, any>) || {};

  const [totalCapacity, setTotalCapacity] = useState<number>(specials.totalCapacity || 40);
  const [maxPartySize, setMaxPartySize] = useState<number>(exposure?.maxPartySize || 12);
  const [serviceDuration, setServiceDuration] = useState<number>(specials.serviceDuration || 90);
  const [cancellationPolicy, setCancellationPolicy] = useState<string>(
    specials.cancellationPolicy || "Annulation gratuite jusqu'à 2 heures avant le service.",
  );

  const [depositRequired, setDepositRequired] = useState<boolean>(
    specials.depositRequired || false,
  );
  const [depositAmount, setDepositAmount] = useState<number>(specials.depositAmount || 15);
  const [depositThreshold, setDepositThreshold] = useState<number>(specials.depositThreshold || 0);

  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await patch(`restaurants/${orgId}/connect`, {
        maxPartySize,
        capacitySpecials: {
          totalCapacity,
          serviceDuration,
          cancellationPolicy,
          depositRequired,
          depositAmount,
          depositThreshold,
        },
      });
      await updateTask('complete', 'connect-capacity');
      onComplete('connect-activation');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <StepHeader
        icon={Gauge}
        title="Capacité & règles"
        body="Contrôlez le flux des réservations internet et protégez votre activité contre les no-shows."
      />
      <div className="space-y-4">
        <div className="grid gap-3 grid-cols-3">
          <Field label="Capacité d'accueil totale">
            <Input
              type="number"
              value={totalCapacity}
              onChange={(e) => setTotalCapacity(Number(e.target.value))}
              required
            />
          </Field>

          <Field label="Taille max de groupe">
            <Input
              type="number"
              value={maxPartySize}
              onChange={(e) => setMaxPartySize(Number(e.target.value))}
              required
            />
          </Field>

          <Field label="Durée de repas (minutes)">
            <Input
              type="number"
              value={serviceDuration}
              onChange={(e) => setServiceDuration(Number(e.target.value))}
              required
            />
          </Field>
        </div>

        <Field label="Politique d'annulation (280 caractères max)">
          <textarea
            value={cancellationPolicy}
            onChange={(e) => setCancellationPolicy(e.target.value)}
            className="flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2"
            maxLength={280}
            required
          />
        </Field>

        <div className="rounded-lg border border-border bg-background/40 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Garantie par acompte bancaire</p>
              <p className="text-xs text-muted-foreground">
                Demandez une empreinte de carte à vos clients.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={depositRequired}
                onChange={(e) => setDepositRequired(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>

          {depositRequired && (
            <div className="grid gap-3 grid-cols-2 pt-2 border-t border-border/40">
              <Field label="Montant par couvert (€)">
                <Input
                  type="number"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(Number(e.target.value))}
                  required
                />
              </Field>

              <Field label="Acompte requis au-dessus de (N personnes)">
                <Input
                  type="number"
                  value={depositThreshold}
                  onChange={(e) => setDepositThreshold(Number(e.target.value))}
                  placeholder="0 = toujours requis"
                  required
                />
              </Field>
            </div>
          )}
        </div>

        <SubmitButton saving={saving}>Enregistrer et continuer</SubmitButton>
      </div>
    </form>
  );
}

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
              className="bg-amber-600 hover:bg-amber-700 text-white"
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
                  {copied ? <Check className="text-emerald-400" size={16} /> : <Copy size={16} />}
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

// ─── STEP REGISTRY ─────────────────────────────────────────────

export const STEP_COMPONENTS: Record<OnboardingTaskKey, (props: StepProps) => React.JSX.Element> = {
  restaurant: RestaurantStep,
  hours: HoursStep,
  knowledge: KnowledgeStep,
  calendar: CalendarStep,
  phone: PhoneStep,
  'connect-identity': ConnectIdentityStep,
  'connect-location': ConnectLocationStep,
  'connect-cuisine': ConnectCuisineStep,
  'connect-capacity': ConnectCapacityStep,
  'connect-activation': ConnectActivationStep,
};

export const STEP_KEYS: OnboardingTaskKey[] = [
  'restaurant',
  'hours',
  'knowledge',
  'calendar',
  'phone',
  'connect-identity',
  'connect-location',
  'connect-cuisine',
  'connect-capacity',
  'connect-activation',
];

export const STEP_META: Record<
  OnboardingTaskKey,
  { title: string; group: 'voice' | 'connect'; index: number }
> = {
  restaurant: { title: 'Identité du restaurant', group: 'voice', index: 1 },
  hours: { title: 'Quand répondre et réserver', group: 'voice', index: 2 },
  knowledge: { title: "Ce que l'assistant doit savoir", group: 'voice', index: 3 },
  calendar: { title: 'Connexion au planning', group: 'voice', index: 4 },
  phone: { title: 'Mise en service des appels', group: 'voice', index: 5 },
  'connect-identity': { title: 'Identité publique', group: 'connect', index: 1 },
  'connect-location': { title: 'Localisation', group: 'connect', index: 2 },
  'connect-cuisine': { title: 'Cuisine & ambiance', group: 'connect', index: 3 },
  'connect-capacity': { title: 'Capacité & règles', group: 'connect', index: 4 },
  'connect-activation': { title: 'Activation & preview', group: 'connect', index: 5 },
};
