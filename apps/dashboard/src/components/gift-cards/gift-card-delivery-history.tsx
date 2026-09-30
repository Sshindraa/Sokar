'use client';
import { useRef, useState } from 'react';
import { useApi } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { getErrorMessage } from '@/types/api';

export type GiftCardDeliveryRow = {
  id: string;
  kind: string;
  channel: string;
  status: string;
  attempts: number;
  providerMessageId?: string | null;
  sentAt: string | null;
  createdAt: string;
};
const states: Record<string, string> = {
  PENDING: 'En attente',
  IN_PROGRESS: 'En cours',
  SENT: 'Accepté par le fournisseur',
  FAILED: 'Échec confirmé',
  UNKNOWN: 'Résultat incertain — à vérifier',
  SKIPPED: 'Non envoyé : coordonnées manquantes ou carte indisponible',
};
const kinds: Record<string, string> = {
  sender_email: 'Reçu de l’acheteur',
  recipient_email: 'Carte du destinataire',
  restaurant_email: 'Notification du restaurant',
  recipient_whatsapp: 'Carte par WhatsApp',
  restaurant_sms: 'Notification SMS du restaurant',
  contribution_email: 'Reçu de contribution',
  organizer_email: 'Notification de l’organisateur',
  closure_email: 'Carte de la cagnotte',
  refund_sender_email: 'Remboursement de l’acheteur',
  refund_restaurant_email: 'Remboursement du restaurant',
};
export function GiftCardDeliveryHistory({
  giftCardId,
  deliveries,
  canManage,
  onChanged,
}: {
  giftCardId: string;
  deliveries: GiftCardDeliveryRow[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const { post, orgId } = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [channel, setChannel] = useState<'email' | 'whatsapp' | null>(null);
  const [manualId, setManualId] = useState<string | null>(null);
  const [caseReference, setCaseReference] = useState('');
  const [verified, setVerified] = useState(false);
  const definitiveFailure = useRef(false);
  const pending = useRef<{ channel: 'email' | 'whatsapp'; idempotencyKey: string } | null>(null);
  async function act(path: string, body?: unknown) {
    if (!orgId || busy) return;
    definitiveFailure.current = false;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await post<{ status: string; canVerifyWithProvider?: boolean }>(
        `restaurants/${orgId}/gift-cards/${giftCardId}/operations/${path}`,
        body,
      );
      setNotice(
        result.status === 'UNKNOWN'
          ? 'Le résultat reste incertain. Vérifiez l’envoi dans la console du fournisseur ; aucun renvoi automatique ne sera effectué.'
          : 'Historique actualisé.',
      );
      onChanged();
      return true;
    } catch (e) {
      definitiveFailure.current =
        e instanceof Error &&
        'status' in e &&
        typeof e.status === 'number' &&
        e.status >= 400 &&
        e.status < 500;
      if (definitiveFailure.current) onChanged();
      setError(getErrorMessage(e, 'Impossible de traiter cette demande.'));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    if (!channel || busy) return;
    pending.current ??= { channel, idempotencyKey: crypto.randomUUID() };
    if (await act('resend', pending.current)) {
      pending.current = null;
      setChannel(null);
    } else if (definitiveFailure.current) {
      pending.current = null;
    }
  }
  return (
    <section className="space-y-3 border-t border-border pt-4">
      <h3 className="font-semibold">Envoi de la carte et des reçus</h3>
      <p className="text-xs text-muted-foreground">
        « Accepté » confirme la prise en charge par le fournisseur, sans garantir la réception. Les
        envois incertains sont bloqués pour éviter les doublons.
      </p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!deliveries.length ? (
        <p className="text-muted-foreground">
          Aucun envoi suivi. Les anciens envois ne sont pas reconstitués.
        </p>
      ) : (
        <ul className="space-y-2">
          {deliveries.map((row) => (
            <li key={row.id} className="space-y-1 rounded-md border border-border p-3">
              <p>
                {kinds[row.kind] ?? 'Notification'} ·{' '}
                {row.channel === 'email' ? 'Email' : row.channel === 'sms' ? 'SMS' : 'WhatsApp'}
              </p>
              <p className="text-xs text-muted-foreground">
                {states[row.status] ?? 'État à vérifier'} · {row.attempts} tentative(s)
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date(row.createdAt).toLocaleString('fr-FR')}
              </p>
              {canManage && row.providerMessageId && (
                <p className="break-all text-xs text-muted-foreground">
                  Référence fournisseur : {row.providerMessageId}
                </p>
              )}
              {canManage && ['FAILED', 'SKIPPED', 'UNKNOWN'].includes(row.status) && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      `deliveries/${row.id}/${row.status === 'UNKNOWN' ? 'verify' : 'retry'}`,
                    )
                  }
                  className="transition-all duration-200"
                >
                  {row.status === 'UNKNOWN'
                    ? 'Vérifier auprès du fournisseur'
                    : 'Réessayer cet envoi'}
                </Button>
              )}
              {canManage && row.status === 'UNKNOWN' && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setManualId(row.id);
                    setVerified(false);
                    setCaseReference('');
                  }}
                >
                  Résoudre après vérification manuelle
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {manualId && deliveries.some((row) => row.id === manualId && row.status === 'UNKNOWN') && (
        <div className="space-y-3 rounded-md bg-muted p-4">
          <p className="text-sm">
            Vérifiez d’abord le message dans la console du fournisseur. Le fournisseur doit
            confirmer une non-acceptation définitive pour autoriser une nouvelle tentative.
          </p>
          <Label htmlFor="delivery-provider-case">
            Référence du dossier fournisseur (sans coordonnées personnelles)
          </Label>
          <Input
            id="delivery-provider-case"
            maxLength={128}
            value={caseReference}
            disabled={busy}
            onChange={(e) => setCaseReference(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Input
              type="checkbox"
              className="h-4 w-4"
              id="delivery-verified"
              checked={verified}
              disabled={busy}
              onChange={(event) => setVerified(event.target.checked)}
            />
            <Label htmlFor="delivery-verified">
              J’ai vérifié le résultat auprès du fournisseur.
            </Label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || !verified || !/^[A-Za-z0-9_-]{3,128}$/.test(caseReference)}
              onClick={() =>
                void act(`deliveries/${manualId}/resolve`, {
                  resolution: 'accepted',
                  providerCaseReference: caseReference,
                })
              }
            >
              Confirmer l’acceptation
            </Button>
            <Button
              variant="outline"
              disabled={busy || !verified || !/^[A-Za-z0-9_-]{3,128}$/.test(caseReference)}
              onClick={() =>
                void act(`deliveries/${manualId}/resolve`, {
                  resolution: 'not_accepted',
                  providerCaseReference: caseReference,
                })
              }
            >
              Confirmer la non-acceptation
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setManualId(null)}>
              Fermer
            </Button>
          </div>
        </div>
      )}
      {canManage && !channel && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setChannel('email')}
            className="transition-all duration-200"
          >
            Renvoyer au destinataire par email
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setChannel('whatsapp')}
            className="transition-all duration-200"
          >
            Renvoyer par WhatsApp
          </Button>
        </div>
      )}
      {channel && (
        <div className="space-y-2 rounded-md bg-muted p-3">
          <p>
            Confirmez un nouvel envoi au destinataire par{' '}
            {channel === 'email' ? 'email' : 'WhatsApp'}. Il pourra recevoir à nouveau sa carte.
          </p>
          <Button
            disabled={busy}
            onClick={() => void resend()}
            className="transition-all duration-200"
          >
            {busy
              ? 'Traitement…'
              : pending.current
                ? 'Réessayer la même demande de renvoi'
                : 'Confirmer le renvoi'}
          </Button>
          {!pending.current && (
            <Button variant="ghost" disabled={busy} onClick={() => setChannel(null)}>
              Annuler
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
