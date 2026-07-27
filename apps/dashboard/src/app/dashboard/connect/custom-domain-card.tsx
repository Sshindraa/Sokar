'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Globe, CheckCircle2, AlertCircle, Loader2, Copy, X } from 'lucide-react';

type CustomDomainStatus =
  | 'pending'
  | 'dns_validated'
  | 'ssl_provisioning'
  | 'active'
  | 'failed'
  | null;

export type Props = {
  restaurantId: string;
  customDomain: string | null;
  customDomainStatus: CustomDomainStatus;
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: 'En attente — configurez le CNAME', color: 'text-muted-foreground' },
  dns_validated: { label: 'DNS validé — SSL en cours', color: 'text-warning' },
  ssl_provisioning: { label: 'SSL en cours de provisionnement', color: 'text-warning' },
  active: { label: 'Domaine actif', color: 'text-success' },
  failed: { label: 'Échec — vérifiez la configuration', color: 'text-destructive' },
};

export function CustomDomainCard({
  restaurantId,
  customDomain,
  customDomainStatus,
}: Props) {
  const [domain, setDomain] = useState(customDomain ?? '');
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<{
    cnameValid: boolean;
    message: string;
    overallStatus: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  async function saveDomain() {
    setSaving(true);
    setError(null);
    setVerifyResult(null);
    try {
      const res = await fetch(`/api/proxy/restaurants/${restaurantId}/connect`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customDomain: domain || null }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Erreur lors de la sauvegarde');
      }
      // Recharger pour refléter le nouveau statut
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSaving(false);
    }
  }

  async function verifyDns() {
    setVerifying(true);
    setError(null);
    setVerifyResult(null);
    try {
      const res = await fetch(
        `/api/proxy/restaurants/${restaurantId}/connect/verify-dns`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Erreur lors de la vérification');
      }
      const data = await res.json();
      setVerifyResult({
        cnameValid: data.cnameValid,
        message: data.message,
        overallStatus: data.overallStatus,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setVerifying(false);
    }
  }

  async function removeDomain() {
    setRemoving(true);
    setError(null);
    setVerifyResult(null);
    try {
      const res = await fetch(`/api/proxy/restaurants/${restaurantId}/connect`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customDomain: null }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Erreur lors de la suppression');
      }
      setDomain('');
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setRemoving(false);
    }
  }

  function copyCname() {
    navigator.clipboard.writeText('sokar.tech');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const status = customDomainStatus ? STATUS_LABELS[customDomainStatus] : null;
  const isActive = customDomainStatus === 'active';

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe className="h-4 w-4 text-primary" />
          Domaine personnalisé
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Utilisez votre propre domaine (ex: reserve.votrerestaurant.fr) pour votre page
          de réservation. Vos clients ne verront jamais &quot;sokar.tech&quot;.
        </p>

        {customDomain && status && (
          <div className="flex items-center gap-2 text-sm">
            {isActive ? (
              <CheckCircle2 className="h-4 w-4 text-success" />
            ) : (
              <AlertCircle className="h-4 w-4 text-warning" />
            )}
            <span className={status.color}>{status.label}</span>
          </div>
        )}

        <div className="space-y-2">
          <label htmlFor="custom-domain" className="text-sm font-medium">
            Votre domaine
          </label>
          <div className="flex gap-2">
            <Input
              id="custom-domain"
              type="text"
              placeholder="reserve.monrestaurant.fr"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              disabled={saving || removing}
              className="flex-1"
            />
            {customDomain ? (
              <Button
                variant="outline"
                size="sm"
                onClick={removeDomain}
                disabled={removing || saving}
                className="transition-all duration-200"
              >
                {removing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <X className="h-4 w-4" />
                )}
              </Button>
            ) : null}
          </div>
        </div>

        {customDomain && (
          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
            <div>
              <p className="text-sm font-medium">Étape 1 — Configurez le DNS</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Chez votre registrar (OVH, Gandi, GoDaddy…), ajoutez un enregistrement CNAME :
              </p>
              <div className="mt-2 flex items-center gap-2 rounded-md bg-background p-2 font-mono text-xs">
                <span className="text-muted-foreground">{customDomain}</span>
                <span className="text-muted-foreground">→</span>
                <span>sokar.tech</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={copyCname}
                  className="ml-auto h-6 px-2"
                  aria-label="Copier la destination CNAME"
                >
                  {copied ? (
                    <CheckCircle2 className="h-3 w-3 text-success" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
            </div>
            <div>
              <p className="text-sm font-medium">Étape 2 — Vérifiez</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Une fois le CNAME configuré, cliquez pour vérifier. Le SSL est provisionné
                automatiquement (quelques minutes).
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={verifyDns}
                disabled={verifying}
                className="mt-2 transition-all duration-200"
              >
                {verifying ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Vérification…
                  </>
                ) : (
                  'Vérifier le DNS'
                )}
              </Button>
            </div>
          </div>
        )}

        {verifyResult && (
          <div
            className={`flex items-start gap-2 rounded-lg p-3 text-sm ${
              verifyResult.cnameValid
                ? 'bg-success/10 text-success'
                : 'bg-warning/10 text-warning'
            }`}
          >
            {verifyResult.cnameValid ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span>{verifyResult.message}</span>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!customDomain && domain && (
          <Button
            onClick={saveDomain}
            disabled={saving || !domain}
            className="w-full transition-all duration-200"
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Configuration…
              </>
            ) : (
              'Configurer le domaine'
            )}
          </Button>
        )}

        {customDomain && domain !== customDomain && (
          <Button
            onClick={saveDomain}
            disabled={saving || !domain}
            className="w-full transition-all duration-200"
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Mise à jour…
              </>
            ) : (
              'Mettre à jour le domaine'
            )}
          </Button>
        )}

        {isActive && customDomain && (
          <div className="flex items-center gap-2 text-xs text-success">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>
              Page live sur{' '}
              <a
                href={`https://${customDomain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                {customDomain}
              </a>
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
