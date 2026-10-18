'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useApi } from '../../../lib/api';
import { getErrorMessage } from '@/types/api';
import { ApiError, featureLockFromError, type FeatureLock } from '@/lib/api-error';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataFetchError } from '@/components/DataFetchError';
import { FeatureLockCard } from '@/components/FeatureLockCard';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { OnboardingLockBanner } from '@/features/onboarding/onboarding-guard';
import {
  Save,
  Bot,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Settings,
  KeyRound,
  Trash2,
  Copy,
} from 'lucide-react';

type OptInStatus = {
  mcp: boolean;
  openaiReserve: boolean;
  policyVersion: string;
};

type ExposureSettings = {
  maxPartySize: number;
  minLeadTimeMinutes: number;
  requireManualValidation: boolean;
  quoteTtlSeconds: number;
  holdTtlSeconds: number;
  noShowPolicy: 'warning' | 'fee' | 'block';
  notificationChannels: ('sms' | 'email')[];
  exposedCreneaux: Array<{ day: number; from: string; to: string }>;
  capacitySpecials: {
    terrasse?: number;
    pmr?: number;
    chien?: boolean;
    poussette?: boolean;
  };
};

type McpClient = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  allowedOrigins: string[];
  lastUsedAt: string | null;
  createdAt: string;
};

type McpClientListResponse = {
  clients: McpClient[];
};

type McpClientCreateResponse = {
  client: McpClient;
  apiKey: string;
};

const MCP_SCOPE_OPTIONS = [
  { value: 'mcp:read', label: 'Lire' },
  { value: 'mcp:reserve', label: 'Réserver' },
  { value: 'mcp:cancel', label: 'Annuler' },
] as const;

const NO_SHOW_OPTIONS = [
  { value: 'warning', label: 'Avertissement (par défaut)' },
  { value: 'fee', label: 'Frais appliqués' },
  { value: 'block', label: 'Bloquer les futures réservations' },
] as const;

const DAYS_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

export default function AgenticSettingsPage() {
  const { get, post, put, del, orgId } = useApi();

  const [optIn, setOptIn] = useState<OptInStatus | null>(null);
  const [settings, setSettings] = useState<ExposureSettings | null>(null);
  const [mcpClients, setMcpClients] = useState<McpClient[]>([]);

  // Form local
  const [maxPartySize, setMaxPartySize] = useState(7);
  const [minLeadTimeMinutes, setMinLeadTimeMinutes] = useState(30);
  const [quoteTtlSeconds, setQuoteTtlSeconds] = useState(300);
  const [holdTtlSeconds, setHoldTtlSeconds] = useState(420);
  const [noShowPolicy, setNoShowPolicy] = useState<'warning' | 'fee' | 'block'>('warning');
  const [notificationChannels, setNotificationChannels] = useState<('sms' | 'email')[]>([
    'sms',
    'email',
  ]);
  const [requireManualValidation, setRequireManualValidation] = useState(false);

  const [loading, setLoading] = useState(true);
  const [savingOptIn, setSavingOptIn] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [creatingClient, setCreatingClient] = useState(false);
  const [revokingClientId, setRevokingClientId] = useState<string | null>(null);
  const [error, setError] = useState('');
  // Refus d'activation parce que le profil du restaurant est incomplet : on propose d'aller le compléter.
  const [errorNeedsProfile, setErrorNeedsProfile] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [lock, setLock] = useState<FeatureLock | null>(null);
  const [clientToRevoke, setClientToRevoke] = useState<McpClient | null>(null);
  const [success, setSuccess] = useState('');
  const [newClientName, setNewClientName] = useState('');
  const [newClientScopes, setNewClientScopes] = useState<string[]>(['mcp:read', 'mcp:reserve']);
  const [newClientOrigins, setNewClientOrigins] = useState('');
  const [createdApiKey, setCreatedApiKey] = useState('');

  const loadData = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setLoadError('');
    setLock(null);
    try {
      const [optInData, settingsData, clientsData] = await Promise.all([
        get('api/agentic/opt-in') as Promise<OptInStatus>,
        get('api/agentic/exposure-settings') as Promise<ExposureSettings>,
        get('api/agentic/mcp-clients') as Promise<McpClientListResponse>,
      ]);
      setOptIn(optInData);
      setSettings(settingsData);
      setMcpClients(clientsData.clients ?? []);
      setMaxPartySize(settingsData.maxPartySize);
      setMinLeadTimeMinutes(settingsData.minLeadTimeMinutes);
      setQuoteTtlSeconds(settingsData.quoteTtlSeconds);
      setHoldTtlSeconds(settingsData.holdTtlSeconds);
      setNoShowPolicy(settingsData.noShowPolicy);
      setNotificationChannels(settingsData.notificationChannels);
      setRequireManualValidation(settingsData.requireManualValidation);
    } catch (err: unknown) {
      const locked = featureLockFromError(err);
      if (locked) setLock(locked);
      else setLoadError(getErrorMessage(err, 'Impossible de charger vos réglages de réservation'));
    } finally {
      setLoading(false);
    }
  }, [orgId, get]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleOptInSave(next: { mcp: boolean; openaiReserve: boolean }) {
    setSavingOptIn(true);
    setError('');
    setErrorNeedsProfile(false);
    setSuccess('');
    try {
      const result = (await post('api/agentic/opt-in', next)) as OptInStatus;
      setOptIn(result);
      setSuccess('Préférences enregistrées');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Erreur lors de la sauvegarde'));
      setErrorNeedsProfile(err instanceof ApiError && err.kind === 'conflict');
    } finally {
      setSavingOptIn(false);
    }
  }

  async function handleSettingsSave() {
    setSavingSettings(true);
    setError('');
    setSuccess('');
    try {
      const result = (await put('api/agentic/exposure-settings', {
        maxPartySize,
        minLeadTimeMinutes,
        quoteTtlSeconds,
        holdTtlSeconds,
        noShowPolicy,
        notificationChannels,
        requireManualValidation,
      })) as ExposureSettings;
      setSettings(result);
      setSuccess('Paramètres de réservation enregistrés');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Erreur lors de la sauvegarde'));
    } finally {
      setSavingSettings(false);
    }
  }

  function toggleClientScope(scope: string) {
    setNewClientScopes((current) => {
      if (current.includes(scope)) {
        const next = current.filter((s) => s !== scope);
        return next.length > 0 ? next : current;
      }
      return [...current, scope];
    });
  }

  function parseOrigins(input: string) {
    return input
      .split(/[\n,]/)
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  async function handleClientCreate() {
    setCreatingClient(true);
    setError('');
    setSuccess('');
    setCreatedApiKey('');
    try {
      const result = (await post('api/agentic/mcp-clients', {
        name: newClientName,
        scopes: newClientScopes,
        allowedOrigins: parseOrigins(newClientOrigins),
      })) as McpClientCreateResponse;
      setMcpClients([result.client, ...mcpClients]);
      setCreatedApiKey(result.apiKey);
      setNewClientName('');
      setNewClientScopes(['mcp:read', 'mcp:reserve']);
      setNewClientOrigins('');
      setSuccess('Clé MCP créée');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de créer la clé MCP'));
    } finally {
      setCreatingClient(false);
    }
  }

  async function handleClientRevoke(clientId: string) {
    setRevokingClientId(clientId);
    setError('');
    setSuccess('');
    try {
      await del(`api/agentic/mcp-clients/${clientId}`);
      setMcpClients(mcpClients.filter((client) => client.id !== clientId));
      setSuccess('Clé MCP révoquée');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de révoquer la clé MCP'));
    } finally {
      setRevokingClientId(null);
      setClientToRevoke(null);
    }
  }

  async function copyCreatedKey() {
    if (!createdApiKey) return;
    try {
      await navigator.clipboard.writeText(createdApiKey);
      setError('');
      setSuccess('Clé copiée');
    } catch {
      setSuccess('');
      setError('Copie impossible. Sélectionnez la clé et copiez-la à la main.');
    }
  }

  const maxPartyInvalid = !Number.isInteger(maxPartySize) || maxPartySize < 1 || maxPartySize > 50;
  const leadTimeInvalid =
    !Number.isInteger(minLeadTimeMinutes) || minLeadTimeMinutes < 0 || minLeadTimeMinutes > 1440;

  if (loading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  // Sans réglages chargés, aucun formulaire : il afficherait des valeurs fictives (MCP « Désactivé », 7 couverts…)
  // et « Enregistrer » les écraserait par-dessus la vraie configuration.
  if (lock || !settings || !optIn) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
          Réservations par les assistants IA
        </h1>
        {lock ? (
          <FeatureLockCard lock={lock} feature="Réservations par les assistants IA" />
        ) : (
          <DataFetchError
            message={`${loadError || 'Impossible de charger vos réglages de réservation.'} Vos réglages n’ont pas été modifiés.`}
            onRetry={() => void loadData()}
            retrying={loading}
          />
        )}
      </div>
    );
  }

  const mcpActive = optIn.mcp;
  const openaiActive = optIn.openaiReserve;

  return (
    <div className="space-y-8">
      <OnboardingLockBanner task="phone" />
      <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
        Réservations par les assistants IA
      </h1>

      {error && (
        <div role="alert" className="sokar-error">
          <AlertCircle size={18} />
          <span>
            {error}
            {errorNeedsProfile ? (
              <>
                {' '}
                <Link
                  href="/dashboard/settings"
                  className="font-medium underline underline-offset-4 transition-all duration-200"
                >
                  Compléter le profil
                </Link>
              </>
            ) : null}
          </span>
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-primary/20 bg-secondary p-4 text-sm text-primary flex items-center gap-2">
          <CheckCircle2 size={18} />
          {success}
        </div>
      )}

      {/* Opt-in MCP / OpenAI Reserve */}
      <Card className="sokar-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sparkles size={18} className="text-primary" />
            Canaux d&apos;exposition
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground max-w-2xl">
            Activez les canaux par lesquels les assistants IA (ChatGPT, Claude, Cursor) peuvent
            consulter et réserver chez vous. Vous pouvez les désactiver à tout moment : les
            réservations en cours ne sont pas affectées.
          </p>

          <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-2xl border border-border bg-secondary p-5 sm:flex-row sm:items-center sm:justify-between transition-all duration-200 hover:bg-accent">
              <div className="flex items-start gap-4">
                <div className="rounded-xl bg-secondary p-3 text-primary">
                  <Bot size={24} />
                </div>
                <div>
                  <p className="font-semibold text-base">Assistants IA (connecteur MCP)</p>
                  <p className="text-sm text-muted-foreground mt-1 max-w-md">
                    Visible dans Claude, Cursor et les autres assistants compatibles : ils peuvent
                    chercher votre restaurant, consulter les disponibilités et réserver.
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <span
                      className={`inline-flex h-2 w-2 rounded-full ${mcpActive ? 'bg-success' : 'bg-faint'} animate-pulse`}
                    />
                    <span
                      className={`text-xs font-medium ${mcpActive ? 'text-success' : 'text-muted-foreground'}`}
                    >
                      {mcpActive ? 'Activé' : 'Désactivé'}
                    </span>
                  </div>
                </div>
              </div>
              <div>
                {mcpActive ? (
                  <Button
                    variant="outline"
                    onClick={() => handleOptInSave({ mcp: false, openaiReserve: false })}
                    disabled={savingOptIn}
                    className="transition-all duration-200"
                  >
                    {savingOptIn ? '...' : 'Désactiver'}
                  </Button>
                ) : (
                  <Button
                    onClick={() => handleOptInSave({ mcp: true, openaiReserve: false })}
                    disabled={savingOptIn}
                    className="transition-all duration-200"
                  >
                    {savingOptIn ? '...' : 'Activer'}
                  </Button>
                )}
              </div>
            </div>

            <div
              className={`flex flex-col gap-3 rounded-2xl border border-border bg-secondary p-5 sm:flex-row sm:items-center sm:justify-between transition-all duration-200 hover:bg-accent ${!mcpActive ? 'opacity-60' : ''}`}
            >
              <div className="flex items-start gap-4">
                <div className="rounded-xl bg-secondary p-3 text-primary">
                  <Sparkles size={24} />
                </div>
                <div>
                  <p className="font-semibold text-base">OpenAI Reserve (beta)</p>
                  <p className="text-sm text-muted-foreground mt-1 max-w-md">
                    Visible dans ChatGPT avec widget natif. Nécessite que vous ayez renseigné
                    l&apos;adresse, le téléphone, le site web, et les coordonnées GPS de votre
                    restaurant.
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <span
                      className={`inline-flex h-2 w-2 rounded-full ${openaiActive ? 'bg-success' : 'bg-faint'} animate-pulse`}
                    />
                    <span
                      className={`text-xs font-medium ${openaiActive ? 'text-success' : 'text-muted-foreground'}`}
                    >
                      {openaiActive
                        ? 'Activé'
                        : mcpActive
                          ? 'Désactivé'
                          : "Désactivé (activer MCP d'abord)"}
                    </span>
                  </div>
                </div>
              </div>
              <div>
                {openaiActive ? (
                  <Button
                    variant="outline"
                    onClick={() => handleOptInSave({ mcp: true, openaiReserve: false })}
                    disabled={savingOptIn}
                    className="transition-all duration-200"
                  >
                    {savingOptIn ? '...' : 'Désactiver'}
                  </Button>
                ) : (
                  <Button
                    onClick={() => handleOptInSave({ mcp: true, openaiReserve: true })}
                    disabled={savingOptIn || !mcpActive}
                    className="transition-all duration-200"
                  >
                    {savingOptIn ? '...' : 'Activer'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="sokar-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <KeyRound size={18} className="text-primary" />
            Clés MCP
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {createdApiKey && (
            <div className="rounded-lg border border-primary/20 bg-secondary p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium text-primary">Clé créée</p>
                  <p className="text-xs text-muted-foreground">
                    Copiez cette clé maintenant : elle ne sera plus affichée.
                  </p>
                  <code className="block select-all overflow-x-auto rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground">
                    {createdApiKey}
                  </code>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={copyCreatedKey}
                  className="transition-all duration-200"
                >
                  <Copy size={16} />
                  Copier
                </Button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-3">
              {mcpClients.length === 0 ? (
                <div className="rounded-lg border border-border bg-secondary p-5 text-sm text-muted-foreground">
                  Aucune clé MCP active.
                </div>
              ) : (
                mcpClients.map((client) => (
                  <div
                    key={client.id}
                    className="rounded-lg border border-border bg-secondary p-4 transition-all duration-200 hover:bg-accent"
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-3">
                        <div>
                          <p className="font-medium">{client.name}</p>
                          <p className="mt-1 font-mono text-xs text-muted-foreground">
                            {client.keyPrefix}...
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {client.scopes.map((scope) => (
                            <span
                              key={scope}
                              className="rounded-full border border-border bg-background px-2 py-1 text-xs text-muted-foreground"
                            >
                              {MCP_SCOPE_OPTIONS.find((option) => option.value === scope)?.label ??
                                scope.replace('mcp:', '')}
                            </span>
                          ))}
                        </div>

                        <div className="space-y-1 text-xs text-muted-foreground">
                          <p>
                            Dernière utilisation :{' '}
                            {client.lastUsedAt
                              ? new Date(client.lastUsedAt).toLocaleString('fr-FR')
                              : 'Jamais'}
                          </p>
                          <p>
                            Sites autorisés :{' '}
                            {client.allowedOrigins.length > 0
                              ? client.allowedOrigins.join(', ')
                              : 'Aucune restriction client'}
                          </p>
                        </div>
                      </div>

                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => setClientToRevoke(client)}
                        disabled={revokingClientId === client.id}
                        className="transition-all duration-200"
                      >
                        <Trash2 size={16} />
                        {revokingClientId === client.id ? '...' : 'Révoquer'}
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="rounded-lg border border-border bg-background p-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Nom</label>
                  <Input
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    placeholder="Claude Desktop"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Scopes</label>
                  <div className="grid grid-cols-3 gap-2">
                    {MCP_SCOPE_OPTIONS.map((scope) => (
                      <button
                        key={scope.value}
                        type="button"
                        onClick={() => toggleClientScope(scope.value)}
                        className={`rounded-lg border px-2 py-2 text-xs transition-all duration-200 ${
                          newClientScopes.includes(scope.value)
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-background text-muted-foreground hover:bg-secondary'
                        }`}
                      >
                        {scope.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Sites autorisés</label>
                  <textarea
                    value={newClientOrigins}
                    onChange={(e) => setNewClientOrigins(e.target.value)}
                    placeholder="https://claude.ai"
                    className="min-h-[92px] w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <p className="text-xs text-muted-foreground">
                    Une adresse par ligne. Facultatif pour les applications installées sur
                    ordinateur.
                  </p>
                </div>

                <Button
                  type="button"
                  onClick={handleClientCreate}
                  disabled={creatingClient || !newClientName.trim()}
                  className="w-full transition-all duration-200"
                >
                  <KeyRound size={16} />
                  {creatingClient ? 'Création...' : 'Créer une clé'}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Exposure settings */}
      <Card className="sokar-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Settings size={18} className="text-primary" />
            Paramètres de réservation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground max-w-2xl">
            Contrôlez les limites de réservation, la durée pendant laquelle un créneau est gardé et
            les règles appliquées aux réservations faites par les assistants IA.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Taille de groupe maximale réservable automatiquement — téléphone et assistants IA
              </label>
              <Input
                type="number"
                min={1}
                max={50}
                value={Number.isNaN(maxPartySize) ? '' : maxPartySize}
                onChange={(e) =>
                  setMaxPartySize(e.target.value === '' ? NaN : Number(e.target.value))
                }
                aria-invalid={maxPartyInvalid}
                className={maxPartyInvalid ? 'border-destructive' : undefined}
              />
              {maxPartyInvalid ? (
                <p role="alert" className="text-xs text-destructive">
                  Indiquez un nombre entre 1 et 50.
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                1 à 50 personnes. Au-delà, Sokar, votre chef de rang numérique, confirme le nombre
                de couverts puis vous passe l’appel, ou prend un message.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Préavis minimum (minutes)</label>
              <Input
                type="number"
                min={0}
                max={1440}
                value={Number.isNaN(minLeadTimeMinutes) ? '' : minLeadTimeMinutes}
                onChange={(e) =>
                  setMinLeadTimeMinutes(e.target.value === '' ? NaN : Number(e.target.value))
                }
                aria-invalid={leadTimeInvalid}
                className={leadTimeInvalid ? 'border-destructive' : undefined}
              />
              {leadTimeInvalid ? (
                <p role="alert" className="text-xs text-destructive">
                  Indiquez un nombre entre 0 et 1440 minutes.
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Empêche les réservations trop tardives (par exemple 30 min avant)
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                Validité d’une estimation : {Math.round(quoteTtlSeconds / 60)} min
              </label>
              <input
                type="range"
                min={30}
                max={3600}
                step={30}
                value={quoteTtlSeconds}
                onChange={(e) => setQuoteTtlSeconds(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <p className="text-xs text-muted-foreground">
                Durée pendant laquelle une estimation est valable
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                Créneau gardé pendant : {Math.round(holdTtlSeconds / 60)} min
              </label>
              <input
                type="range"
                min={60}
                max={3600}
                step={30}
                value={holdTtlSeconds}
                onChange={(e) => setHoldTtlSeconds(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <p className="text-xs text-muted-foreground">
                Durée pendant laquelle la table est bloquée
              </p>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-medium">Politique no-show</label>
              <select
                value={noShowPolicy}
                onChange={(e) => setNoShowPolicy(e.target.value as 'warning' | 'fee' | 'block')}
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {NO_SHOW_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-medium">Canaux de notification</label>
              <div className="flex gap-4">
                {(['sms', 'email'] as const).map((ch) => (
                  <label key={ch} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={notificationChannels.includes(ch)}
                      disabled={
                        notificationChannels.length === 1 && notificationChannels.includes(ch)
                      }
                      onChange={(e) => {
                        if (e.target.checked) {
                          setNotificationChannels([...notificationChannels, ch]);
                        } else {
                          setNotificationChannels(notificationChannels.filter((c) => c !== ch));
                        }
                      }}
                      className="accent-primary"
                    />
                    {ch === 'sms' ? 'SMS' : 'E-mail'}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Gardez au moins un canal de notification.
              </p>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={requireManualValidation}
                  onChange={(e) => setRequireManualValidation(e.target.checked)}
                  className="accent-primary"
                />
                Valider chaque réservation à la main
              </label>
              <p className="text-xs text-muted-foreground">
                Si activé, les réservations faites par les assistants IA restent en attente jusqu’à
                votre validation (utile au démarrage).
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={handleSettingsSave}
              disabled={savingSettings || maxPartyInvalid || leadTimeInvalid}
            >
              <Save size={16} className="mr-1" />
              {savingSettings ? 'Enregistrement...' : 'Enregistrer'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Footer info */}
      <Card className="sokar-card bg-secondary">
        <CardContent className="p-5 text-sm text-muted-foreground">
          <p className="font-medium text-foreground mb-2">Comment ça marche</p>
          <ul className="space-y-1 list-disc list-inside">
            <li>
              Les <strong>estimations</strong> sont valables 5 minutes par défaut. Elles ne bloquent
              pas votre capacité.
            </li>
            <li>
              Un <strong>créneau gardé</strong> bloque une table 7 minutes par défaut. Au-delà, il
              se libère automatiquement.
            </li>
            <li>
              Chaque changement de paramètre est conservé dans un historique : pour en annuler un,
              contactez le support.
            </li>
            {DAYS_FR.length > 0 /* keep import used */ && null}
          </ul>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={clientToRevoke !== null}
        title="Révoquer cette clé ?"
        description={`« ${clientToRevoke?.name ?? ''} » ne pourra plus se connecter. Si cette clé sert à une intégration en service (ChatGPT, Claude…), celle-ci cessera de fonctionner immédiatement. Cette action est définitive.`}
        confirmLabel="Révoquer la clé"
        variant="destructive"
        pending={revokingClientId !== null}
        onConfirm={() => clientToRevoke && void handleClientRevoke(clientToRevoke.id)}
        onCancel={() => setClientToRevoke(null)}
      />
    </div>
  );
}
