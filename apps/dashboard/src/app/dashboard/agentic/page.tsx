'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, Copy, Info, MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { useApi } from '../../../lib/api';
import { getErrorMessage } from '@/types/api';
import { ApiError, featureLockFromError, type FeatureLock } from '@/lib/api-error';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataFetchError } from '@/components/DataFetchError';
import { FeatureLockCard } from '@/components/FeatureLockCard';
import { StatusBadge } from '@/components/StatusBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { OnboardingLockBanner } from '@/features/onboarding/onboarding-guard';

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

function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className="inline-flex text-muted-foreground transition-all duration-200 hover:text-foreground"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{children}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default function AgenticSettingsPage() {
  const { get, post, put, del, orgId } = useApi();
  const router = useRouter();

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
  const [loadError, setLoadError] = useState('');
  const [lock, setLock] = useState<FeatureLock | null>(null);
  const [clientToRevoke, setClientToRevoke] = useState<McpClient | null>(null);
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
    try {
      const result = (await post('api/agentic/opt-in', next)) as OptInStatus;
      setOptIn(result);
      toast.success('Préférences enregistrées');
    } catch (err: unknown) {
      const needsProfile = err instanceof ApiError && err.kind === 'conflict';
      toast.error(getErrorMessage(err, 'Erreur lors de la sauvegarde'), {
        action: needsProfile
          ? { label: 'Compléter le profil', onClick: () => router.push('/dashboard/settings') }
          : undefined,
      });
    } finally {
      setSavingOptIn(false);
    }
  }

  async function handleSettingsSave() {
    setSavingSettings(true);
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
      toast.success('Paramètres de réservation enregistrés');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Erreur lors de la sauvegarde'));
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
      toast.success('Clé créée');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Impossible de créer la clé'));
    } finally {
      setCreatingClient(false);
    }
  }

  async function handleClientRevoke(clientId: string) {
    setRevokingClientId(clientId);
    try {
      await del(`api/agentic/mcp-clients/${clientId}`);
      setMcpClients(mcpClients.filter((client) => client.id !== clientId));
      toast.success('Clé révoquée');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Impossible de révoquer la clé'));
    } finally {
      setRevokingClientId(null);
      setClientToRevoke(null);
    }
  }

  async function copyCreatedKey() {
    if (!createdApiKey) return;
    try {
      await navigator.clipboard.writeText(createdApiKey);
      toast.success('Clé copiée');
    } catch {
      toast.error('Copie impossible. Sélectionnez la clé et copiez-la à la main.');
    }
  }

  const maxPartyInvalid = !Number.isInteger(maxPartySize) || maxPartySize < 1 || maxPartySize > 50;
  const leadTimeInvalid =
    !Number.isInteger(minLeadTimeMinutes) || minLeadTimeMinutes < 0 || minLeadTimeMinutes > 1440;

  if (loading) {
    return (
      <div className="space-y-6">
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
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Agents IA</h1>
        {lock ? (
          <FeatureLockCard lock={lock} feature="Agents IA" />
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
    <div className="space-y-6">
      <OnboardingLockBanner task="phone" />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Agents IA</h1>
        <InfoTip label="Précision sur les agents IA">
          Les assistants IA peuvent chercher votre restaurant, consulter les disponibilités et
          réserver. Vous pouvez les désactiver à tout moment : les réservations en cours ne sont pas
          affectées.
        </InfoTip>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Canaux</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">Assistants IA (Claude, Cursor…)</p>
                <StatusBadge level={mcpActive ? 'progress' : 'neutral'}>
                  {mcpActive ? 'Activé' : 'Désactivé'}
                </StatusBadge>
              </div>
              <p className="text-sm text-muted-foreground">
                Chercher, consulter les disponibilités et réserver.
              </p>
            </div>
            {mcpActive ? (
              <Button
                variant="outline"
                onClick={() => handleOptInSave({ mcp: false, openaiReserve: false })}
                disabled={savingOptIn}
                className="shrink-0 transition-all duration-200"
              >
                {savingOptIn ? '...' : 'Désactiver'}
              </Button>
            ) : (
              <Button
                onClick={() => handleOptInSave({ mcp: true, openaiReserve: false })}
                disabled={savingOptIn}
                className="shrink-0 transition-all duration-200"
              >
                {savingOptIn ? '...' : 'Activer'}
              </Button>
            )}
          </div>

          <div
            className={`flex flex-col gap-3 rounded-xl border border-border p-4 transition-all duration-200 sm:flex-row sm:items-center sm:justify-between ${!mcpActive ? 'opacity-60' : ''}`}
          >
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">OpenAI Reserve (bêta)</p>
                <StatusBadge level={openaiActive ? 'progress' : 'neutral'}>
                  {openaiActive ? 'Activé' : 'Désactivé'}
                </StatusBadge>
                <InfoTip label="Précision sur OpenAI Reserve">
                  Affiché dans ChatGPT avec widget natif. Nécessite l’adresse, le téléphone, le site
                  web et les coordonnées GPS de votre restaurant.
                </InfoTip>
              </div>
              {!mcpActive && !openaiActive && (
                <p className="text-sm text-muted-foreground">Activez d’abord les assistants IA.</p>
              )}
            </div>
            {openaiActive ? (
              <Button
                variant="outline"
                onClick={() => handleOptInSave({ mcp: true, openaiReserve: false })}
                disabled={savingOptIn}
                className="shrink-0 transition-all duration-200"
              >
                {savingOptIn ? '...' : 'Désactiver'}
              </Button>
            ) : (
              <Button
                onClick={() => handleOptInSave({ mcp: true, openaiReserve: true })}
                disabled={savingOptIn || !mcpActive}
                className="shrink-0 transition-all duration-200"
              >
                {savingOptIn ? '...' : 'Activer'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Clés d’accès</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {createdApiKey && (
            <div className="space-y-2 rounded-xl border border-primary/30 p-4">
              <p className="text-sm font-medium">
                Nouvelle clé : copiez-la maintenant, elle ne sera plus affichée.
              </p>
              <div className="flex items-start gap-2">
                <code className="block min-w-0 flex-1 select-all break-all rounded-md border border-border bg-background px-3 py-2 text-xs">
                  {createdApiKey}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={copyCreatedKey}
                  className="shrink-0 transition-all duration-200"
                >
                  <Copy size={16} />
                  Copier
                </Button>
              </div>
            </div>
          )}

          {mcpClients.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune clé active.</p>
          ) : (
            <div className="space-y-2">
              {mcpClients.map((client) => (
                <div
                  key={client.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-border p-4 transition-all duration-200 hover:bg-accent"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium">{client.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{client.keyPrefix}…</p>
                    <p className="text-xs text-muted-foreground">
                      {client.scopes
                        .map(
                          (scope) =>
                            MCP_SCOPE_OPTIONS.find((option) => option.value === scope)?.label ??
                            scope.replace('mcp:', ''),
                        )
                        .join(' · ')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Dernière utilisation :{' '}
                      {client.lastUsedAt
                        ? new Date(client.lastUsedAt).toLocaleString('fr-FR')
                        : 'jamais'}
                    </p>
                    <p className="break-all text-xs text-muted-foreground">
                      Sites autorisés :{' '}
                      {client.allowedOrigins.length > 0
                        ? client.allowedOrigins.join(', ')
                        : 'aucune restriction'}
                    </p>
                  </div>
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Actions pour ${client.name}`}
                        disabled={revokingClientId === client.id}
                        className="h-8 w-8 shrink-0 transition-all duration-200"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="text-destructive"
                        onSelect={() => setClientToRevoke(client)}
                      >
                        Révoquer
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          )}

          <details className="group rounded-xl border border-border">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-4 text-sm font-medium transition-all duration-200 [&::-webkit-details-marker]:hidden">
              Créer une clé
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-all duration-200 group-open:rotate-180" />
            </summary>
            <div className="space-y-4 border-t border-border p-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Nom</label>
                <Input
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder="Claude Desktop"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Droits</label>
                <div className="grid grid-cols-3 gap-2">
                  {MCP_SCOPE_OPTIONS.map((scope) => (
                    <button
                      key={scope.value}
                      type="button"
                      aria-pressed={newClientScopes.includes(scope.value)}
                      onClick={() => toggleClientScope(scope.value)}
                      className={`rounded-lg border px-2 py-2 text-xs transition-all duration-200 ${
                        newClientScopes.includes(scope.value)
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
                      }`}
                    >
                      {scope.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <label className="text-sm font-medium">Sites autorisés</label>
                  <InfoTip label="Précision sur les sites autorisés">
                    Une adresse par ligne. Facultatif pour les applications installées sur
                    ordinateur.
                  </InfoTip>
                </div>
                <textarea
                  value={newClientOrigins}
                  onChange={(e) => setNewClientOrigins(e.target.value)}
                  placeholder="https://claude.ai"
                  className="min-h-[92px] w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              <Button
                type="button"
                onClick={handleClientCreate}
                disabled={creatingClient || !newClientName.trim()}
                className="w-full transition-all duration-200 sm:w-auto"
              >
                {creatingClient ? 'Création...' : 'Créer une clé'}
              </Button>
            </div>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Paramètres de réservation</CardTitle>
        </CardHeader>
        <CardContent>
          <details className="group rounded-xl border border-border">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-4 text-sm font-medium transition-all duration-200 [&::-webkit-details-marker]:hidden">
              Modifier les limites et règles
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-all duration-200 group-open:rotate-180" />
            </summary>
            <div className="space-y-6 border-t border-border p-4">
              <div className="grid max-w-2xl grid-cols-1 gap-6 sm:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <label className="text-sm font-medium">Taille maximale (couverts)</label>
                    <InfoTip label="Précision sur la taille maximale">
                      Réservable automatiquement par téléphone et assistants IA. Au-delà, Sokar
                      confirme le nombre de couverts puis vous passe l’appel, ou prend un message.
                    </InfoTip>
                  </div>
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
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <label className="text-sm font-medium">Préavis minimum (minutes)</label>
                    <InfoTip label="Précision sur le préavis">
                      Empêche les réservations trop tardives (par exemple 30 min avant).
                    </InfoTip>
                  </div>
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
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <label className="text-sm font-medium">
                      Validité d’une estimation : {Math.round(quoteTtlSeconds / 60)} min
                    </label>
                    <InfoTip label="Précision sur la validité d’une estimation">
                      Durée pendant laquelle une estimation est valable. Elle ne bloque pas votre
                      capacité.
                    </InfoTip>
                  </div>
                  <input
                    type="range"
                    min={30}
                    max={3600}
                    step={30}
                    value={quoteTtlSeconds}
                    onChange={(e) => setQuoteTtlSeconds(Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <label className="text-sm font-medium">
                      Créneau gardé pendant : {Math.round(holdTtlSeconds / 60)} min
                    </label>
                    <InfoTip label="Précision sur le créneau gardé">
                      Durée pendant laquelle la table est bloquée. Au-delà, le créneau se libère
                      automatiquement.
                    </InfoTip>
                  </div>
                  <input
                    type="range"
                    min={60}
                    max={3600}
                    step={30}
                    value={holdTtlSeconds}
                    onChange={(e) => setHoldTtlSeconds(Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <label className="text-sm font-medium">Politique no-show</label>
                  <select
                    value={noShowPolicy}
                    onChange={(e) => setNoShowPolicy(e.target.value as 'warning' | 'fee' | 'block')}
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {NO_SHOW_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <div className="flex items-center gap-1.5">
                    <label className="text-sm font-medium">Canaux de notification</label>
                    <InfoTip label="Précision sur les canaux de notification">
                      Gardez au moins un canal de notification.
                    </InfoTip>
                  </div>
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
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <div className="flex items-center gap-1.5">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={requireManualValidation}
                        onChange={(e) => setRequireManualValidation(e.target.checked)}
                        className="accent-primary"
                      />
                      Valider chaque réservation à la main
                    </label>
                    <InfoTip label="Précision sur la validation manuelle">
                      Les réservations faites par les assistants IA restent en attente jusqu’à votre
                      validation (utile au démarrage).
                    </InfoTip>
                  </div>
                </div>
              </div>

              <Button
                onClick={handleSettingsSave}
                disabled={savingSettings || maxPartyInvalid || leadTimeInvalid}
                className="transition-all duration-200"
              >
                {savingSettings ? 'Enregistrement...' : 'Enregistrer'}
              </Button>
            </div>
          </details>
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
