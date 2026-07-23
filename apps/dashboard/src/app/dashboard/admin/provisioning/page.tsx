'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  PhoneForwarded,
  CheckCircle2,
  AlertCircle,
  Loader2,
  PhoneCall,
  Search,
  Sparkles,
  ShieldCheck,
  Building2,
  RefreshCw,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';

interface TelnyxNumberItem {
  id: string;
  phoneNumber: string;
  status: string;
  assignedToRestaurantId?: string | null;
  assignedToRestaurantName?: string | null;
}

interface ProvisioningStatusView {
  restaurantId: string;
  restaurantName: string;
  phoneNumber: string;
  hasAssignedPhone: boolean;
  provisioningStatus: string;
  telnyxPhoneNumberId: string | null;
  forwardingConfiguredAt: string | null;
  testCallValidatedAt: string | null;
  firstCallAt: string | null;
  forwardingCode: string | null;
  steps: {
    assignment: {
      completed: boolean;
      phoneNumber: string;
    };
    webhook: {
      completed: boolean;
      webhookUrl: string;
    };
    forwarding: {
      completed: boolean;
      configuredAt: string | null;
      ussdCode: string | null;
    };
    testCall: {
      completed: boolean;
      validatedAt: string | null;
    };
  };
}

export default function AdminProvisioningPage() {
  const { get, post } = useApi();

  const [loadingList, setLoadingList] = useState(true);
  const [restaurants, setRestaurants] = useState<ProvisioningStatusView[]>([]);
  const [availableNumbers, setAvailableNumbers] = useState<TelnyxNumberItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Form states per step
  const [customPhoneInput, setCustomPhoneInput] = useState('');
  const [selectedTelnyxId, setSelectedTelnyxId] = useState('');
  const [testCallPhone, setTestCallPhone] = useState('');

  // Step action loading states & feedback
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchRestaurants = useCallback(async () => {
    setLoadingList(true);
    setActionError(null);
    try {
      const [resList, resNumbers] = await Promise.all([
        get<{ ok: boolean; restaurants: ProvisioningStatusView[] }>(
          'admin/provisioning/restaurants',
        ),
        get<{ ok: boolean; numbers: TelnyxNumberItem[] }>('admin/provisioning/available-numbers'),
      ]);
      setRestaurants(resList.restaurants ?? []);
      setAvailableNumbers(resNumbers.numbers ?? []);

      if (resList.restaurants && resList.restaurants.length > 0 && !selectedId) {
        setSelectedId(resList.restaurants[0].restaurantId);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur lors de la récupération des données';
      setActionError(msg);
    } finally {
      setLoadingList(false);
    }
  }, [get, selectedId]);

  useEffect(() => {
    fetchRestaurants();
  }, [fetchRestaurants]);

  const selectedStatus = restaurants.find((r) => r.restaurantId === selectedId);

  const handleSelectRestaurant = (id: string) => {
    setSelectedId(id);
    setActionSuccess(null);
    setActionError(null);
    setCustomPhoneInput('');
    setSelectedTelnyxId('');
    setTestCallPhone('');
  };

  // Action 1 : Assign Phone
  const handleAssignPhone = async () => {
    if (!selectedId) return;
    const phoneToAssign =
      customPhoneInput.trim() ||
      availableNumbers.find((n) => n.id === selectedTelnyxId)?.phoneNumber;
    if (!phoneToAssign) {
      setActionError(
        'Sélectionnez un numéro Telnyx ou saisissez un numéro E.164 (ex: +33451221528).',
      );
      return;
    }

    setActionLoading('assign');
    setActionSuccess(null);
    setActionError(null);

    try {
      const res = await post<{ ok: boolean; message: string; status: ProvisioningStatusView }>(
        `admin/provisioning/${selectedId}/assign-phone`,
        {
          phoneNumber: phoneToAssign,
          telnyxPhoneNumberId: selectedTelnyxId || undefined,
        },
      );
      setActionSuccess(res.message);
      // Refresh status locally
      setRestaurants((prev) =>
        prev.map((item) => (item.restaurantId === selectedId ? res.status : item)),
      );
      setCustomPhoneInput('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erreur lors de l'attribution";
      setActionError(msg);
    } finally {
      setActionLoading(null);
    }
  };

  // Action 2 : Verify Webhook
  const handleVerifyWebhook = async () => {
    if (!selectedId) return;
    setActionLoading('webhook');
    setActionSuccess(null);
    setActionError(null);

    try {
      const res = await post<{ ok: boolean; message: string; status: ProvisioningStatusView }>(
        `admin/provisioning/${selectedId}/verify-webhook`,
      );
      setActionSuccess(res.message);
      setRestaurants((prev) =>
        prev.map((item) => (item.restaurantId === selectedId ? res.status : item)),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur lors de la vérification webhook';
      setActionError(msg);
    } finally {
      setActionLoading(null);
    }
  };

  // Action 3 : Mark Forwarding
  const handleMarkForwarding = async () => {
    if (!selectedId) return;
    setActionLoading('forwarding');
    setActionSuccess(null);
    setActionError(null);

    try {
      const res = await post<{ ok: boolean; message: string; status: ProvisioningStatusView }>(
        `admin/provisioning/${selectedId}/verify-webhook`,
      );
      setActionSuccess('Renvoi d’appel marqué comme configuré.');
      setRestaurants((prev) =>
        prev.map((item) => (item.restaurantId === selectedId ? res.status : item)),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur lors de la mise à jour';
      setActionError(msg);
    } finally {
      setActionLoading(null);
    }
  };

  // Action 4 : Test Call
  const handleTestCall = async () => {
    if (!selectedId) return;
    setActionLoading('testcall');
    setActionSuccess(null);
    setActionError(null);

    try {
      const res = await post<{
        ok: boolean;
        callControlId: string;
        message: string;
        status: ProvisioningStatusView;
      }>(`admin/provisioning/${selectedId}/test-call`, {
        targetPhoneNumber: testCallPhone.trim() || undefined,
      });

      setActionSuccess(`${res.message} (Call ID: ${res.callControlId})`);
      setRestaurants((prev) =>
        prev.map((item) => (item.restaurantId === selectedId ? res.status : item)),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Échec du déclenchement de l'appel test";
      setActionError(msg);
    } finally {
      setActionLoading(null);
    }
  };

  // Final Action : Complete
  const handleCompletePilot = async () => {
    if (!selectedId) return;
    setActionLoading('complete');
    setActionSuccess(null);
    setActionError(null);

    try {
      const res = await post<{ ok: boolean; message: string; status: ProvisioningStatusView }>(
        `admin/provisioning/${selectedId}/complete`,
      );
      setActionSuccess(res.message);
      setRestaurants((prev) =>
        prev.map((item) => (item.restaurantId === selectedId ? res.status : item)),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur lors de la finalisation du pilote';
      setActionError(msg);
    } finally {
      setActionLoading(null);
    }
  };

  const filteredRestaurants = restaurants.filter(
    (r) =>
      r.restaurantName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.phoneNumber.includes(searchTerm),
  );

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 text-primary font-semibold text-sm tracking-wide uppercase">
            <Zap className="h-4 w-4" /> Administration Sokar
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground mt-1">
            Préparer un pilote restaurant
          </h1>
          <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
            Attribution Telnyx, vérification du webhook, consignes de renvoi d&apos;appel et
            validation d&apos;appel test. Aucune modification manuelle de base de données requise.
          </p>
        </div>

        <Button
          variant="outline"
          onClick={fetchRestaurants}
          disabled={loadingList}
          className="gap-2 transition-all duration-200"
        >
          <RefreshCw className={cn('h-4 w-4', loadingList && 'animate-spin')} />
          Actualiser
        </Button>
      </div>

      {actionError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive flex items-start gap-3 transition-all duration-200">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Erreur de provisioning</p>
            <p className="mt-0.5 leading-relaxed">{actionError}</p>
          </div>
        </div>
      )}

      {actionSuccess && (
        <div className="rounded-xl border border-success/30 bg-success/10 p-4 text-sm text-success flex items-start gap-3 transition-all duration-200">
          <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Opération réussie</p>
            <p className="mt-0.5 leading-relaxed">{actionSuccess}</p>
          </div>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[320px_1fr]">
        {/* Colonne gauche : liste des restaurants */}
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher un restaurant..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 bg-background"
            />
          </div>

          <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border shadow-sm">
            {loadingList ? (
              <div className="p-8 text-center text-muted-foreground space-y-2">
                <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
                <p className="text-xs">Chargement des comptes...</p>
              </div>
            ) : filteredRestaurants.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">
                Aucun restaurant trouvé.
              </div>
            ) : (
              filteredRestaurants.map((resto) => {
                const isSelected = resto.restaurantId === selectedId;
                const isPlaceholder = resto.phoneNumber.startsWith('+000');
                const isReady = resto.provisioningStatus === 'ACTIVE';

                return (
                  <button
                    key={resto.restaurantId}
                    onClick={() => handleSelectRestaurant(resto.restaurantId)}
                    className={cn(
                      'w-full text-left p-4 transition-all duration-200 flex flex-col gap-1.5 hover:bg-accent/50 focus-visible:outline-none',
                      isSelected && 'bg-primary/10 border-l-4 border-l-primary font-medium',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-foreground truncate text-sm">
                        {resto.restaurantName}
                      </span>
                      <span
                        className={cn(
                          'text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full border',
                          isReady
                            ? 'bg-success/15 border-success/30 text-success'
                            : isPlaceholder
                              ? 'bg-warning/15 border-warning/30 text-warning'
                              : 'bg-primary/15 border-primary/30 text-primary',
                        )}
                      >
                        {isReady ? 'Pilote Actif' : isPlaceholder ? 'À attribuer' : 'En cours'}
                      </span>
                    </div>

                    <p className="text-xs font-mono text-muted-foreground">
                      {isPlaceholder ? 'Numéro fictif +000...' : resto.phoneNumber}
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Colonne droite : Cockpit de provisioning */}
        {selectedStatus ? (
          <div className="space-y-6">
            {/* Header du restaurant sélectionné */}
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-primary" />
                  <h2 className="text-xl font-bold text-foreground">
                    {selectedStatus.restaurantName}
                  </h2>
                </div>
                <p className="text-xs font-mono text-muted-foreground">
                  ID: {selectedStatus.restaurantId} &bull; Statut :{' '}
                  <span className="font-semibold text-foreground uppercase">
                    {selectedStatus.provisioningStatus}
                  </span>
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Numéro Sokar attribué</p>
                  <p className="text-base font-semibold font-mono text-foreground">
                    {selectedStatus.hasAssignedPhone
                      ? selectedStatus.phoneNumber
                      : 'À attribuer (+000...)'}
                  </p>
                </div>

                <Button
                  onClick={handleCompletePilot}
                  disabled={actionLoading === 'complete' || !selectedStatus.hasAssignedPhone}
                  className="bg-success text-success-foreground hover:bg-success/90 gap-2 transition-all duration-200"
                >
                  {actionLoading === 'complete' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  Finaliser le pilote
                </Button>
              </div>
            </div>

            {/* Grille des 4 étapes */}
            <div className="grid gap-6 md:grid-cols-2">
              {/* ÉTAPE 1 : Attribution Telnyx */}
              <div className="rounded-xl border border-border bg-card p-6 space-y-4 shadow-sm flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-semibold text-foreground">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                        1
                      </span>
                      Attribution numéro Telnyx
                    </div>
                    {selectedStatus.steps.assignment.completed ? (
                      <span className="text-xs font-semibold text-success flex items-center gap-1 bg-success/10 px-2 py-0.5 rounded-md">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Attribué
                      </span>
                    ) : (
                      <span className="text-xs font-semibold text-warning bg-warning/10 px-2 py-0.5 rounded-md">
                        En attente
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Associe un numéro E.164 réel du compte Telnyx au restaurant.
                  </p>

                  <div className="space-y-3 pt-2">
                    {availableNumbers.length > 0 && (
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-foreground">
                          Inventaire Telnyx disponible
                        </label>
                        <select
                          value={selectedTelnyxId}
                          onChange={(e) => {
                            setSelectedTelnyxId(e.target.value);
                            const found = availableNumbers.find((n) => n.id === e.target.value);
                            if (found) setCustomPhoneInput(found.phoneNumber);
                          }}
                          className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          <option value="">-- Choisir dans l&apos;inventaire Telnyx --</option>
                          {availableNumbers.map((num) => (
                            <option
                              key={num.id}
                              value={num.id}
                              disabled={Boolean(num.assignedToRestaurantId)}
                            >
                              {num.phoneNumber}{' '}
                              {num.assignedToRestaurantName
                                ? `(Déjà: ${num.assignedToRestaurantName})`
                                : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="space-y-1">
                      <label className="text-xs font-medium text-foreground">
                        Ou saisie directe (E.164)
                      </label>
                      <Input
                        placeholder="+33451221528"
                        value={customPhoneInput}
                        onChange={(e) => setCustomPhoneInput(e.target.value)}
                        className="h-9 text-xs font-mono"
                      />
                    </div>
                  </div>
                </div>

                <Button
                  onClick={handleAssignPhone}
                  disabled={actionLoading === 'assign'}
                  className="w-full gap-2 mt-4 transition-all duration-200"
                >
                  {actionLoading === 'assign' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <PhoneForwarded className="h-4 w-4" />
                  )}
                  Attribuer le numéro
                </Button>
              </div>

              {/* ÉTAPE 2 : Verification Webhook */}
              <div className="rounded-xl border border-border bg-card p-6 space-y-4 shadow-sm flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-semibold text-foreground">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                        2
                      </span>
                      Vérification du Webhook
                    </div>
                    {selectedStatus.steps.webhook.completed ? (
                      <span className="text-xs font-semibold text-success flex items-center gap-1 bg-success/10 px-2 py-0.5 rounded-md">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Webhook prêt
                      </span>
                    ) : (
                      <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-md">
                        À valider
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    S&apos;assure que la route d&apos;accueil d&apos;appels Sokar réagit
                    correctement.
                  </p>

                  <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1">
                    <p className="text-[11px] text-muted-foreground font-medium">
                      URL Webhook configurée :
                    </p>
                    <p className="text-xs font-mono text-foreground break-all">
                      {selectedStatus.steps.webhook.webhookUrl}
                    </p>
                  </div>
                </div>

                <Button
                  variant="outline"
                  onClick={handleVerifyWebhook}
                  disabled={actionLoading === 'webhook' || !selectedStatus.hasAssignedPhone}
                  className="w-full gap-2 mt-4 transition-all duration-200"
                >
                  {actionLoading === 'webhook' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" />
                  )}
                  Tester & valider le webhook
                </Button>
              </div>

              {/* ÉTAPE 3 : Consignes Renvoi d'appel */}
              <div className="rounded-xl border border-border bg-card p-6 space-y-4 shadow-sm flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-semibold text-foreground">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                        3
                      </span>
                      Renvoi d&apos;appel (Opérateur)
                    </div>
                    {selectedStatus.steps.forwarding.completed ? (
                      <span className="text-xs font-semibold text-success flex items-center gap-1 bg-success/10 px-2 py-0.5 rounded-md">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Activé
                      </span>
                    ) : (
                      <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-md">
                        À communiquer
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Code USSD à composer sur le téléphone du restaurant pour router les appels vers
                    Sokar :
                  </p>

                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-center">
                    <p className="text-xs text-muted-foreground">Code de renvoi inconditionnel :</p>
                    <p className="text-lg font-mono font-bold text-primary mt-1">
                      {selectedStatus.forwardingCode ?? '*21*+33XXXXXXXXX#'}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-2">
                      (Désactivation à tout moment en composant{' '}
                      <span className="font-mono text-foreground">##21#</span>)
                    </p>
                  </div>
                </div>

                <Button
                  variant="outline"
                  onClick={handleMarkForwarding}
                  disabled={actionLoading === 'forwarding' || !selectedStatus.hasAssignedPhone}
                  className="w-full gap-2 mt-4 transition-all duration-200"
                >
                  {actionLoading === 'forwarding' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <PhoneCall className="h-4 w-4" />
                  )}
                  Marquer renvoi comme configuré
                </Button>
              </div>

              {/* ÉTAPE 4 : Validation Appel Test */}
              <div className="rounded-xl border border-border bg-card p-6 space-y-4 shadow-sm flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-semibold text-foreground">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                        4
                      </span>
                      Appel test & validation IA
                    </div>
                    {selectedStatus.steps.testCall.completed ? (
                      <span className="text-xs font-semibold text-success flex items-center gap-1 bg-success/10 px-2 py-0.5 rounded-md">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Appel validé
                      </span>
                    ) : (
                      <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-md">
                        À tester
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Déclenche un appel sortant pour faire entendre l&apos;assistant vocal au gérant.
                  </p>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">
                      Numéro de téléphone cible (gérant)
                    </label>
                    <Input
                      placeholder="+33612345678"
                      value={testCallPhone}
                      onChange={(e) => setTestCallPhone(e.target.value)}
                      className="h-9 text-xs font-mono"
                    />
                  </div>
                </div>

                <Button
                  onClick={handleTestCall}
                  disabled={actionLoading === 'testcall' || !selectedStatus.hasAssignedPhone}
                  className="w-full gap-2 mt-4 bg-primary text-primary-foreground hover:bg-primary/90 transition-all duration-200"
                >
                  {actionLoading === 'testcall' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Lancer l&apos;appel test IA
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-12 text-center text-muted-foreground space-y-2">
            <Building2 className="h-8 w-8 mx-auto text-muted-foreground/50" />
            <p className="text-sm font-medium">
              Sélectionnez un restaurant dans la liste de gauche pour préparer son pilote.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
