'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { GiftCardDeliveryHistory, type GiftCardDeliveryRow } from './gift-card-delivery-history';
import { useApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { formatEuro } from '@sokar/shared';
import { getErrorMessage } from '@/types/api';

type Receipt = {
  id: string;
  billAmount: number;
  appliedAmount: number;
  remainingAmount: number;
  complementAmount: number;
  ticketReference: string;
  redeemedAt: string;
};
type Detail = {
  deliveries?: GiftCardDeliveryRow[];
  canManageDeliveries?: boolean;
  card: {
    remainingAmount: number;
    status: string;
    shortCode: string | null;
    expiresAt: string | null;
    type: string;
    closedAt: string | null;
    stripePaymentStatus: string | null;
    currency: string;
  };
  associatedReservations?: {
    id: string;
    reservedAt: string;
    customerName: string;
    partySize: number;
  }[];
  payments?: {
    paymentIntentId: string;
    amount: number;
    refundedAmount: number;
    pendingRefund: boolean;
  }[];
  refunds?: { id: string; amount: number; status: string; createdAt: string }[];
  redemptions: {
    id: string;
    amount: number;
    billAmount: number | null;
    ticketReference: string | null;
    redeemedAt: string;
  }[];
};

export function GiftCardCashier({
  giftCardId,
  onChanged,
}: {
  giftCardId: string;
  onChanged: () => void;
}) {
  const { get, post, orgId } = useApi();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [bill, setBill] = useState('');
  const [ticket, setTicket] = useState('');
  const [reservation, setReservation] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const pending = useRef<{
    body: {
      billAmount: number;
      ticketReference: string;
      reservationId?: string;
      idempotencyKey: string;
    };
  } | null>(null);
  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      setDetail(await get<Detail>(`restaurants/${orgId}/gift-cards/${giftCardId}/operations`));
      setError('');
    } catch (e) {
      setError(getErrorMessage(e, 'Impossible de charger les opérations.'));
    } finally {
      setLoading(false);
    }
  }, [get, orgId, giftCardId]);
  useEffect(() => {
    void load();
  }, [load]);
  const amount = Number(bill.replace(',', '.'));
  const usable =
    detail?.card.status === 'ACTIVE' &&
    detail.card.currency.toUpperCase() === 'EUR' &&
    detail.card.remainingAmount > 0 &&
    (!detail.card.expiresAt || new Date(detail.card.expiresAt) > new Date()) &&
    (detail.card.type !== 'CROWDFUNDED' || Boolean(detail.card.closedAt));
  const valid =
    usable &&
    amount > 0 &&
    amount <= 999999.99 &&
    Math.abs(amount * 100 - Math.round(amount * 100)) < 0.000001 &&
    ticket.trim().length > 0;
  async function debit() {
    if (!orgId || busy || (!pending.current && !valid)) return;
    pending.current ??= {
      body: {
        billAmount: amount,
        ticketReference: ticket.trim(),
        reservationId: reservation.trim() || undefined,
        idempotencyKey: crypto.randomUUID(),
      },
    };
    setBusy(true);
    setError('');
    try {
      const result = await post<Receipt>(
        `restaurants/${orgId}/gift-cards/${giftCardId}/redeem`,
        pending.current.body,
      );
      setReceipt(result);
      pending.current = null;
      setConfirm(false);
      await load();
      onChanged();
    } catch (e) {
      // A definitive API rejection can be corrected. A lost response must retain its retry key.
      if (
        e instanceof Error &&
        'status' in e &&
        typeof e.status === 'number' &&
        e.status >= 400 &&
        e.status < 500
      ) {
        pending.current = null;
        setConfirm(false);
      }
      setError(
        getErrorMessage(
          e,
          'Débit non confirmé. Réessayez la même demande : elle ne sera appliquée qu’une fois.',
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  if (loading && !detail)
    return (
      <p className="text-muted-foreground" role="status">
        Chargement des opérations…
      </p>
    );
  if (!detail)
    return (
      <div>
        <p role="alert">{error}</p>
        <Button variant="outline" onClick={() => void load()}>
          Réessayer
        </Button>
      </div>
    );
  return (
    <section className="space-y-4 border-t border-border pt-4">
      <h3 className="font-semibold">Débiter en salle</h3>
      {detail.card.shortCode && <p className="font-mono">{detail.card.shortCode}</p>}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {receipt ? (
        <div role="status" className="space-y-1 rounded-lg bg-muted p-4">
          <p>Ticket {receipt.ticketReference} : débit enregistré.</p>
          <p>
            Carte : {formatEuro(receipt.appliedAmount)} · Complément à encaisser :{' '}
            {formatEuro(receipt.complementAmount)}
          </p>
          <p>Solde restant : {formatEuro(receipt.remainingAmount)}</p>
          <Button
            variant="outline"
            onClick={() => {
              setReceipt(null);
              setBill('');
              setTicket('');
              setReservation('');
            }}
          >
            Nouvelle addition
          </Button>
        </div>
      ) : usable || pending.current ? (
        <div className="space-y-3">
          <div>
            <Label htmlFor="gift-bill">Montant réel de l’addition (€)</Label>
            <Input
              id="gift-bill"
              inputMode="decimal"
              value={bill}
              disabled={busy || confirm || Boolean(pending.current)}
              onChange={(e) => setBill(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="gift-ticket">Référence du ticket</Label>
            <Input
              id="gift-ticket"
              maxLength={64}
              value={ticket}
              disabled={busy || confirm || Boolean(pending.current)}
              onChange={(e) => setTicket(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Utilisez la référence unique de votre caisse, avec sa date si nécessaire.
            </p>
          </div>
          {Boolean(detail.associatedReservations?.length) && (
            <div>
              <Label htmlFor="gift-reservation">Réservation associée (facultatif)</Label>
              <Select
                value={reservation || 'none'}
                onValueChange={(value) => setReservation(value === 'none' ? '' : value)}
                disabled={busy || confirm || Boolean(pending.current)}
              >
                <SelectTrigger id="gift-reservation">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sans réservation</SelectItem>
                  {detail.associatedReservations?.map((booking) => (
                    <SelectItem key={booking.id} value={booking.id}>
                      {booking.customerName} ·{' '}
                      {new Date(booking.reservedAt).toLocaleString('fr-FR')} · {booking.partySize}{' '}
                      couverts
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {valid && (
            <p>
              Carte : {formatEuro(Math.min(amount, detail.card.remainingAmount))} · Complément :{' '}
              {formatEuro(Math.max(0, amount - detail.card.remainingAmount))}
            </p>
          )}
          {confirm ? (
            <div className="space-y-2">
              <p>Confirmez le règlement de cette addition. Le solde de la carte sera débité.</p>
              <Button
                disabled={busy}
                onClick={() => void debit()}
                className="transition-all duration-200"
              >
                {busy
                  ? 'Enregistrement…'
                  : pending.current
                    ? 'Réessayer la même demande'
                    : 'Confirmer le débit'}
              </Button>
              {!pending.current && (
                <Button variant="ghost" disabled={busy} onClick={() => setConfirm(false)}>
                  Modifier
                </Button>
              )}
            </div>
          ) : (
            <Button
              disabled={!valid}
              onClick={() => setConfirm(true)}
              className="transition-all duration-200"
            >
              Vérifier le débit
            </Button>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground">
          Cette carte ne peut pas être débitée dans son état actuel.
        </p>
      )}
      <h3 className="font-semibold">Historique des débits</h3>
      {detail.redemptions.length === 0 ? (
        <p className="text-muted-foreground">Aucun débit enregistré.</p>
      ) : (
        <ul className="space-y-2">
          {detail.redemptions.map((row) => (
            <li key={row.id} className="rounded-md border border-border p-3">
              <p>
                {row.ticketReference ?? 'Débit historique'} · {formatEuro(row.amount)}
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date(row.redeemedAt).toLocaleString('fr-FR')}
              </p>
            </li>
          ))}
        </ul>
      )}
      <h3 className="font-semibold">Paiements et remboursements</h3>
      {!detail.payments?.length && !detail.refunds?.length && (
        <p className="text-muted-foreground">
          Aucun paiement Stripe enregistré. Les anciens paiements peuvent nécessiter un
          rapprochement.
        </p>
      )}
      {detail.payments?.map((payment) => (
        <div key={payment.paymentIntentId} className="rounded-md border border-border p-3">
          <p>
            Encaissé : {formatEuro(payment.amount)} · Remboursé :{' '}
            {formatEuro(payment.refundedAmount)}
          </p>
          {payment.pendingRefund && (
            <p className="text-sm text-muted-foreground">
              Remboursement en attente de confirmation Stripe.
            </p>
          )}
        </div>
      ))}
      {detail.refunds?.map((refund) => (
        <p key={refund.id} className="text-sm">
          Remboursement de {formatEuro(refund.amount)} :{' '}
          {refund.status === 'succeeded'
            ? 'confirmé par Stripe'
            : ['REQUESTED', 'pending', 'requires_action'].includes(refund.status)
              ? 'en cours'
              : 'à vérifier'}{' '}
          · {new Date(refund.createdAt).toLocaleString('fr-FR')}
        </p>
      ))}
      <GiftCardDeliveryHistory
        giftCardId={giftCardId}
        deliveries={detail.deliveries ?? []}
        canManage={Boolean(detail.canManageDeliveries)}
        onChanged={() => {
          void load();
          onChanged();
        }}
      />
    </section>
  );
}
