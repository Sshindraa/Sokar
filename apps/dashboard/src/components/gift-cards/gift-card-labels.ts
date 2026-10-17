/** Libellés français des statuts de cartes cadeaux, partagés par la liste et la fenêtre de détail. */

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  REDEEMED: 'Utilisée',
  EXPIRED: 'Expirée',
  CANCELLED: 'Annulée',
  REFUND_PENDING: 'Remboursement en cours',
  REFUND_FAILED: 'Remboursement à vérifier',
  PAYMENT_REVIEW: 'Paiement à vérifier',
  REFUND_REVIEW: 'Remboursement à vérifier',
  CLOSED: 'Clôturée',
};

export function giftCardStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? 'À vérifier';
}

/** Statut de paiement Stripe, en clair ; une valeur inconnue n'est jamais montrée telle quelle. */
export function giftCardPaymentLabel(status: string): string {
  const labels: Record<string, string> = {
    succeeded: 'Payé',
    pending: 'En attente',
    processing: 'En cours',
    failed: 'Échoué',
    canceled: 'Annulé',
    refunded: 'Remboursé',
    partially_refunded: 'Remboursé en partie',
  };
  return labels[status] ?? 'À vérifier';
}
