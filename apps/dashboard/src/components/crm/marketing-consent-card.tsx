'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2, Mail, MessageSquare, RefreshCw } from 'lucide-react';
import {
  describeMarketingConsentSource,
  MARKETING_CONSENT_COLLECTION_LABELS,
  MARKETING_CONSENT_COLLECTION_METHODS,
  type MarketingConsentChannel,
  type MarketingConsentCollectionMethod,
} from '@sokar/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi } from '@/lib/api';
import { ApiError } from '@/lib/api-error';
import { getErrorMessage } from '@/types/api';

type PermissionRow = {
  channel: string;
  status: 'OPTED_IN' | 'OPTED_OUT' | 'UNKNOWN';
  source: string;
  consentedAt: string | null;
  withdrawnAt: string | null;
};

const CHANNELS: Array<{ channel: MarketingConsentChannel; label: string; noun: string }> = [
  { channel: 'EMAIL', label: 'E-mail', noun: 'par e-mail' },
  { channel: 'SMS', label: 'SMS', noun: 'par SMS' },
];

function formatDay(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('fr-FR', { dateStyle: 'long' });
}

function describePermission(row: PermissionRow | undefined): {
  badge: 'Accord donné' | 'Accord retiré' | 'Jamais demandé';
  detail: string;
} {
  if (!row || row.status === 'UNKNOWN') return { badge: 'Jamais demandé', detail: '' };
  const source = describeMarketingConsentSource(row.source);
  if (row.status === 'OPTED_IN') {
    return { badge: 'Accord donné', detail: `Donné le ${formatDay(row.consentedAt)} · ${source}` };
  }
  return { badge: 'Accord retiré', detail: `Retiré le ${formatDay(row.withdrawnAt)} · ${source}` };
}

/**
 * Marketing consent of one customer, per channel. The restaurant team can record an agreement
 * obtained outside a form (with how it was obtained) and withdraw one. The customer withdraws by
 * themselves with the unsubscribe link of each message.
 */
export function MarketingConsentCard({
  customerId,
  email,
  onChanged,
}: {
  customerId: string;
  email: string | null;
  onChanged?: () => void;
}) {
  const { get, post, del, orgId } = useApi();
  const [rows, setRows] = useState<PermissionRow[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [openChannel, setOpenChannel] = useState<MarketingConsentChannel | null>(null);
  const [method, setMethod] = useState<MarketingConsentCollectionMethod>('IN_PERSON');
  const [confirmed, setConfirmed] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState<MarketingConsentChannel | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoadError('');
    try {
      const response = await get<{ data: PermissionRow[] }>(
        `crm/customers/${customerId}/marketing-permissions`,
      );
      setRows(Array.isArray(response?.data) ? response.data : []);
    } catch (err: unknown) {
      setRows(null);
      setLoadError(getErrorMessage(err, 'Impossible de charger les consentements marketing.'));
    }
  }, [customerId, get, orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  function closeForms(): void {
    setOpenChannel(null);
    setConfirmWithdraw(null);
    setConfirmed(false);
    setMethod('IN_PERSON');
    setActionError('');
  }

  async function record(channel: MarketingConsentChannel): Promise<void> {
    if (busy || !confirmed) return;
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      await post(`crm/customers/${customerId}/marketing-permissions/${channel}/consent`, {
        method,
      });
      closeForms();
      setNotice('Accord enregistré.');
      await load();
      onChanged?.();
    } catch (err: unknown) {
      setActionError(
        err instanceof ApiError && err.code === 'CUSTOMER_EMAIL_REQUIRED'
          ? 'Ajoutez d’abord une adresse e-mail à cette fiche.'
          : getErrorMessage(err, 'Impossible d’enregistrer l’accord.'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(channel: MarketingConsentChannel): Promise<void> {
    if (busy) return;
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      await del(`crm/customers/${customerId}/marketing-permissions/${channel}`);
      closeForms();
      setNotice('Accord retiré. Ce client ne recevra plus de messages sur ce canal.');
      await load();
      onChanged?.();
    } catch (err: unknown) {
      setActionError(getErrorMessage(err, 'Impossible de retirer l’accord.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Consentement marketing</CardTitle>
        <CardDescription>
          Accord de ce client pour recevoir les offres et actualités, canal par canal. Une
          réservation ne vaut jamais accord. Le client se désinscrit lui-même avec le lien de chaque
          message.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows === null && !loadError ? (
          <div className="space-y-3" role="status" aria-label="Chargement des consentements">
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
          </div>
        ) : null}

        {loadError ? (
          <div className="flex items-start gap-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 shrink-0" size={18} />
            <div className="space-y-3">
              <p role="alert">{loadError}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="transition-all duration-200"
                onClick={() => void load()}
              >
                <RefreshCw size={14} />
                Réessayer
              </Button>
            </div>
          </div>
        ) : null}

        {rows !== null ? (
          <ul className="space-y-3">
            {CHANNELS.map(({ channel, label, noun }) => {
              const row = rows.find((item) => item.channel === channel);
              const { badge, detail } = describePermission(row);
              const granted = row?.status === 'OPTED_IN';
              const missingEmail = channel === 'EMAIL' && !email;
              const Icon = channel === 'EMAIL' ? Mail : MessageSquare;
              return (
                <li key={channel} className="rounded-xl border border-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <Icon className="mt-0.5 text-muted-foreground" size={18} />
                      <div>
                        <p className="font-medium">{label}</p>
                        {detail ? <p className="text-sm text-muted-foreground">{detail}</p> : null}
                        {!granted && missingEmail ? (
                          <p className="text-sm text-muted-foreground">
                            Aucune adresse e-mail sur cette fiche : l’accord ne peut pas être
                            enregistré.
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={granted ? 'default' : 'secondary'}>{badge}</Badge>
                      {granted ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="transition-all duration-200"
                          disabled={busy}
                          onClick={() => {
                            closeForms();
                            setConfirmWithdraw(channel);
                          }}
                        >
                          Retirer l’accord
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="transition-all duration-200"
                          disabled={busy || missingEmail}
                          onClick={() => {
                            closeForms();
                            setOpenChannel(channel);
                          }}
                        >
                          Enregistrer un accord
                        </Button>
                      )}
                    </div>
                  </div>

                  {openChannel === channel ? (
                    <div className="mt-4 space-y-3 border-t border-border pt-4">
                      <div className="space-y-1.5">
                        <Label htmlFor={`consent-method-${channel}`}>
                          Comment l’accord a-t-il été recueilli ?
                        </Label>
                        <select
                          id={`consent-method-${channel}`}
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground transition-all duration-200"
                          value={method}
                          disabled={busy}
                          onChange={(event) =>
                            setMethod(event.target.value as MarketingConsentCollectionMethod)
                          }
                        >
                          {MARKETING_CONSENT_COLLECTION_METHODS.map((value) => (
                            <option key={value} value={value}>
                              {MARKETING_CONSENT_COLLECTION_LABELS[value]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <label className="flex items-start gap-3 text-sm">
                        <input
                          type="checkbox"
                          checked={confirmed}
                          disabled={busy}
                          onChange={(event) => setConfirmed(event.target.checked)}
                          className="mt-1 h-4 w-4 shrink-0 transition-all duration-200"
                        />
                        <span>
                          Je confirme que ce client a clairement accepté de recevoir les offres et
                          actualités du restaurant {noun}, et qu’il peut se désinscrire à tout
                          moment.
                        </span>
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          className="transition-all duration-200"
                          disabled={busy || !confirmed}
                          onClick={() => void record(channel)}
                        >
                          {busy ? <Loader2 className="animate-spin" size={14} /> : null}
                          Enregistrer l’accord
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="transition-all duration-200"
                          disabled={busy}
                          onClick={closeForms}
                        >
                          Annuler
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  {confirmWithdraw === channel ? (
                    <div className="mt-4 space-y-3 border-t border-border pt-4">
                      <p className="text-sm">
                        Ce client ne recevra plus de messages marketing {noun}. Ses réservations ne
                        sont pas modifiées.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          className="transition-all duration-200"
                          disabled={busy}
                          onClick={() => void withdraw(channel)}
                        >
                          {busy ? <Loader2 className="animate-spin" size={14} /> : null}
                          Confirmer le retrait
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="transition-all duration-200"
                          disabled={busy}
                          onClick={closeForms}
                        >
                          Annuler
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        {notice ? (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        ) : null}
        {actionError ? (
          <p role="alert" className="text-sm text-destructive">
            {actionError}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
