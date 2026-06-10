'use client';

import { useEffect, useState } from 'react';
import { useApi } from '../../../lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Save, Bot, Store, AlertCircle, CheckCircle2, ArrowUpRight, Calendar } from 'lucide-react';

const PLAN_FEATURES: Record<string, { label: string; calls: string }> = {
  STARTER:  { label: 'Essential',  calls: '1 500 appels / mois' },
  PRO:      { label: 'Pro',        calls: 'Appels illimités' },
  PREMIUM:  { label: 'Multi-site', calls: 'Appels illimités — 99€/site suppl.' },
};

const PROFILE_OPTIONS = [
  { value: 'BISTROT_BRASSERIE', label: 'Bistrot / Brasserie' },
  { value: 'GASTRONOMIQUE',     label: 'Gastronomique' },
  { value: 'SEMI_GASTRO',       label: 'Semi-gastronomique' },
];

const FILLER_OPTIONS = [
  { value: 'CASUAL', label: 'Décontracté', desc: 'Je regarde ça…' },
  { value: 'WARM',   label: 'Chaleureux',  desc: 'Pas de souci, je regarde ça !' },
  { value: 'FORMAL', label: 'Formel',      desc: 'Veuillez patienter un instant…' },
];

export default function SettingsPage() {
  const { get, post, patch, orgId } = useApi();

  const [restaurant, setRestaurant] = useState<any>(null);
  const [name, setName] = useState('');
  const [managerPhone, setManagerPhone] = useState('');
  const [managerEmail, setManagerEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Personality
  const [personality, setPersonality] = useState<any>(null);
  const [profileType, setProfileType] = useState('BISTROT_BRASSERIE');
  const [fillerStyle, setFillerStyle] = useState('CASUAL');
  const [speakingRate, setSpeakingRate] = useState(1.0);
  const [voiceIdCa, setVoiceIdCa] = useState('');
  const [systemPromptExtra, setSystemPromptExtra] = useState('');
  const [savingPersonality, setSavingPersonality] = useState(false);
  const [savedPersonality, setSavedPersonality] = useState(false);

  // Google Calendar Integration
  const [googleCalendarId, setGoogleCalendarId] = useState('primary');
  const [googleRefreshToken, setGoogleRefreshToken] = useState<string | null>(null);
  const [savingCalendar, setSavingCalendar] = useState(false);
  const [savedCalendar, setSavedCalendar] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('google_sync') === 'success') {
        window.history.replaceState({}, '', window.location.pathname);
      } else if (params.get('google_sync') === 'error') {
        const msg = params.get('message') || "Erreur d'association de l'agenda";
        setError(msg);
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
  }, []);

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      try {
        const [data, pers] = await Promise.all([
          get(`restaurants/${orgId}`),
          get(`restaurants/${orgId}/personality`),
        ]);
        setRestaurant(data);
        setName(data.name || '');
        setManagerPhone(data.managerPhone || '');
        setManagerEmail(data.managerEmail || '');
        setGoogleCalendarId(data.googleCalendarId || 'primary');
        setGoogleRefreshToken(data.googleRefreshToken || null);
        if (pers && pers.id) {
          setPersonality(pers);
          setProfileType(pers.profileType || 'BISTROT_BRASSERIE');
          setFillerStyle(pers.fillerStyle || 'CASUAL');
          setSpeakingRate(Number(pers.speakingRate) || 1.0);
          setVoiceIdCa(pers.voiceIdCa || '');
          setSystemPromptExtra(pers.systemPromptExtra || '');
        }
      } catch {
        setError('Impossible de charger les paramètres');
      } finally {
        setLoading(false);
      }
    })();
  }, [orgId, get]);

  if (loading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-8 w-40" />
        <Card className="sokar-card">
          <CardHeader><Skeleton className="h-5 w-32" /></CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError('');

    try {
      await patch(`restaurants/${orgId}`, { name, managerPhone, managerEmail });
      setSaved(true);
    } catch (err: any) {
      setError(err.message || 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  }

  async function handlePersonalitySave(e: React.FormEvent) {
    e.preventDefault();
    setSavingPersonality(true);
    setSavedPersonality(false);

    try {
      await patch(`restaurants/${orgId}/personality`, {
        profileType,
        fillerStyle,
        speakingRate,
        voiceIdCa: voiceIdCa || undefined,
        systemPromptExtra: systemPromptExtra || undefined,
      });
      setSavedPersonality(true);
    } catch (err: any) {
      setError(err.message || 'Erreur lors de la sauvegarde de la personnalité');
    } finally {
      setSavingPersonality(false);
    }
  }

  async function handleConnectCalendar() {
    setError('');
    try {
      const data = await get('integrations/google-calendar/auth');
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error("URL d'authentification invalide");
      }
    } catch (err: any) {
      setError(err.message || "Impossible d'initier la connexion Google Calendar");
    }
  }

  async function handleDisconnectCalendar() {
    if (!confirm('Êtes-vous sûr de vouloir déconnecter votre agenda Google ? Vos réservations ne seront plus synchronisées.')) {
      return;
    }
    setDisconnecting(true);
    setError('');
    try {
      await post('integrations/google-calendar/disconnect');
      setGoogleRefreshToken(null);
      setGoogleCalendarId('primary');
      if (restaurant) {
        setRestaurant({
          ...restaurant,
          googleRefreshToken: null,
          googleCalendarId: null,
        });
      }
    } catch (err: any) {
      setError(err.message || 'Erreur lors de la déconnexion');
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleSaveCalendarSettings(e: React.FormEvent) {
    e.preventDefault();
    setSavingCalendar(true);
    setSavedCalendar(false);
    setError('');

    try {
      await patch(`restaurants/${orgId}`, { googleCalendarId });
      setSavedCalendar(true);
      if (restaurant) {
        setRestaurant({
          ...restaurant,
          googleCalendarId,
        });
      }
    } catch (err: any) {
      setError(err.message || "Erreur lors de la sauvegarde des paramètres de l'agenda");
    } finally {
      setSavingCalendar(false);
    }
  }

  const plan = restaurant?.plan ?? 'STARTER';
  const planInfo = PLAN_FEATURES[plan] ?? PLAN_FEATURES.STARTER;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Paramètres</h1>

      {error && (
        <div className="sokar-error">
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      {/* Infos restaurant */}
      <Card className="sokar-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Store size={18} />
            Informations
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="max-w-full sm:max-w-lg space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nom du restaurant</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Téléphone du gérant</label>
              <Input type="tel" value={managerPhone} onChange={(e) => setManagerPhone(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Email du gérant</label>
              <Input type="email" value={managerEmail} onChange={(e) => setManagerEmail(e.target.value)} />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={saving}>
                <Save size={16} className="mr-1" />
                {saving ? 'Enregistrement...' : 'Enregistrer'}
              </Button>
              {saved && (
                <span className="flex items-center gap-1 text-sm text-primary">
                  <CheckCircle2 size={16} />
                  Enregistré
                </span>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Plan actuel */}
      <Card className="sokar-card">
        <CardHeader>
          <CardTitle className="text-lg">Plan actuel</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 rounded-2xl border border-border bg-secondary/60 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xl font-bold capitalize">{planInfo.label}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {planInfo.calls} · Pas de commission · Support email
              </p>
            </div>
            <Button variant="outline" asChild>
              <a href="/pricing">
                Changer de plan
                <ArrowUpRight size={14} className="ml-1" />
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Intégrations */}
      <Card className="sokar-card animate-fade-in transition-all duration-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Calendar size={18} className="text-primary" />
            Intégrations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col gap-4 rounded-2xl border border-border bg-secondary/30 p-5 sm:flex-row sm:items-center sm:justify-between transition-all duration-200 hover:bg-secondary/40">
            <div className="flex items-start gap-4">
              <div className="rounded-xl bg-primary/10 p-3 text-primary">
                <Calendar size={24} />
              </div>
              <div>
                <p className="font-semibold text-base">Google Calendar</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-md">
                  Synchronisez automatiquement vos réservations avec votre agenda Google et vérifiez la disponibilité en temps réel avant de confirmer.
                </p>
                {googleRefreshToken ? (
                  <div className="mt-3 flex items-center gap-2 transition-all duration-200">
                    <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      Connecté à Google Calendar
                    </span>
                  </div>
                ) : (
                  <div className="mt-3 flex items-center gap-2 transition-all duration-200">
                    <span className="inline-flex h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                    <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                      Non connecté
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div>
              {googleRefreshToken ? (
                <Button 
                  variant="outline" 
                  onClick={handleDisconnectCalendar} 
                  disabled={disconnecting}
                  className="text-destructive border-destructive/20 hover:bg-destructive/10 hover:text-destructive transition-all duration-200"
                >
                  {disconnecting ? 'Déconnexion...' : 'Déconnecter'}
                </Button>
              ) : (
                <Button 
                  onClick={handleConnectCalendar}
                  className="transition-all duration-200"
                >
                  Connecter
                  <ArrowUpRight size={16} className="ml-1" />
                </Button>
              )}
            </div>
          </div>

          {googleRefreshToken && (
            <form onSubmit={handleSaveCalendarSettings} className="max-w-full sm:max-w-lg space-y-4 pt-6 border-t border-border animate-fade-in">
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-1.5 text-foreground">
                  ID de l&apos;agenda Google
                </label>
                <Input 
                  value={googleCalendarId} 
                  onChange={(e) => setGoogleCalendarId(e.target.value)} 
                  placeholder="primary"
                  required 
                  className="transition-all duration-200 focus-visible:ring-primary"
                />
                <p className="text-xs text-muted-foreground">
                  Utilisez <code className="font-mono text-primary bg-primary/5 px-1 py-0.5 rounded">primary</code> pour votre agenda principal, ou spécifiez un ID d&apos;agenda spécifique (ex: adresse email ou ID d&apos;agenda Google partagé).
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={savingCalendar} className="transition-all duration-200">
                  <Save size={16} className="mr-1" />
                  {savingCalendar ? 'Enregistrement...' : 'Enregistrer les paramètres'}
                </Button>
                {savedCalendar && (
                  <span className="flex items-center gap-1 text-sm text-primary animate-fade-in">
                    <CheckCircle2 size={16} />
                    Paramètres enregistrés
                  </span>
                )}
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Personnalité de l'agent vocal */}
      <Card className="sokar-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Bot size={18} />
Personnalité de l&apos;agent vocal
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePersonalitySave} className="max-w-full sm:max-w-lg space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-medium">Type de restaurant</label>
              <select
                value={profileType}
                onChange={(e) => setProfileType(e.target.value)}
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {PROFILE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Style de l&apos;assistant</label>
              <select
                value={fillerStyle}
                onChange={(e) => setFillerStyle(e.target.value)}
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {FILLER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label} — {opt.desc}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                Vitesse de parole : {speakingRate.toFixed(2)}x
              </label>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.05"
                value={speakingRate}
                onChange={(e) => setSpeakingRate(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Lent (0.5x)</span>
                <span>Normal (1.0x)</span>
                <span>Rapide (2.0x)</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                ID voix Cartesia
                <span className="ml-1 text-xs text-muted-foreground">(laisser vide pour la voix par défaut)</span>
              </label>
              <Input
                value={voiceIdCa}
                onChange={(e) => setVoiceIdCa(e.target.value)}
                placeholder="f786b574-daa5-4673-aa0c-cbe3e8534c02"
                className="font-mono"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                Instructions personnalisées
                <span className="ml-1 text-xs text-muted-foreground">(max 2000 caractères)</span>
              </label>
              <textarea
                value={systemPromptExtra}
                onChange={(e) => setSystemPromptExtra(e.target.value)}
                maxLength={2000}
                rows={4}
                placeholder="Ex: Nous avons une offre spéciale le mercredi soir. Propose-la si le client demande."
                className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-all duration-200 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
              <p className="text-right text-xs text-muted-foreground">
                {systemPromptExtra.length}/2000
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={savingPersonality}>
                <Bot size={16} className="mr-1" />
                {savingPersonality ? 'Enregistrement...' : 'Enregistrer la personnalité'}
              </Button>
              {savedPersonality && (
                <span className="flex items-center gap-1 text-sm text-primary">
                  <CheckCircle2 size={16} />
                  Personnalité enregistrée
                </span>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
