'use client';

// @ts-ignore - date-fns types resolution issue under bundler
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Ban, Eye, Gift } from 'lucide-react';
import { useIsMobile } from '@/lib/useMediaQuery';
import MobileDataCard from '@/components/MobileDataCard';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { GiftCardListItem } from '@/lib/api/gift-cards';

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  REDEEMED: 'Utilisée',
  EXPIRED: 'Expirée',
  CANCELLED: 'Annulée',
};

const STATUS_VARIANT: Record<string, string> = {
  ACTIVE: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500',
  REDEEMED: 'border-blue-500/30 bg-blue-500/10 text-blue-500',
  EXPIRED: 'border-amber-500/30 bg-amber-500/10 text-amber-500',
  CANCELLED: 'border-red-500/30 bg-red-500/10 text-red-500',
};

function formatEuro(amount: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(amount);
}

function StatusBadge({ status }: { status: string }) {
  const variant = STATUS_VARIANT[status] ?? 'border-border bg-secondary text-muted-foreground';
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors ${variant}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export type GiftCardListProps = {
  items: GiftCardListItem[];
  onView?: (card: GiftCardListItem) => void;
  onCancel?: (card: GiftCardListItem) => void;
};

export default function GiftCardList({ items, onView, onCancel }: GiftCardListProps) {
  const isMobile = useIsMobile();

  if (items.length === 0) {
    return (
      <div className="sokar-empty">
        <Gift size={40} className="opacity-30" />
        <p className="text-sm">Aucune carte cadeau pour le moment</p>
        <p className="text-xs opacity-60">
          Les cartes cadeaux vendues ou créées manuellement apparaîtront ici.
        </p>
      </div>
    );
  }

  if (isMobile) {
    return (
      <div className="space-y-2.5">
        {items.map((card) => (
          <MobileDataCard
            key={card.id}
            title={card.code}
            subtitle={card.packName ?? 'Montant libre'}
            badge={<StatusBadge status={card.status} />}
            accentClass={
              card.status === 'ACTIVE'
                ? 'border-l-emerald-500'
                : card.status === 'REDEEMED'
                  ? 'border-l-blue-400'
                  : card.status === 'CANCELLED'
                    ? 'border-l-red-500'
                    : 'border-l-amber-500'
            }
            actions={[
              ...(onView
                ? [
                    {
                      label: 'Voir',
                      icon: <Eye size={14} />,
                      colorClass: 'bg-cyan-600',
                      onClick: (e: React.MouseEvent) => {
                        e.stopPropagation();
                        onView(card);
                      },
                    },
                  ]
                : []),
              ...(onCancel && card.status === 'ACTIVE'
                ? [
                    {
                      label: 'Annuler',
                      icon: <Ban size={14} />,
                      colorClass: 'bg-red-600',
                      onClick: (e: React.MouseEvent) => {
                        e.stopPropagation();
                        onCancel(card);
                      },
                    },
                  ]
                : []),
            ]}
            details={[
              { label: 'Montant', value: formatEuro(card.amount) },
              { label: 'Solde', value: formatEuro(card.remainingAmount) },
              {
                label: 'Destinataire',
                value: card.recipientName ?? '—',
              },
              {
                label: 'Achetée le',
                value: format(new Date(card.purchasedAt), 'dd MMM yyyy', { locale: fr }),
              },
            ]}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="sokar-card overflow-hidden">
      <div className="mobile-table-wrapper">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Montant</TableHead>
              <TableHead>Solde</TableHead>
              <TableHead>Destinataire</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Achetée le</TableHead>
              <TableHead>Expire le</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((card) => (
              <TableRow key={card.id} className="transition-all duration-200 hover:bg-accent">
                <TableCell className="font-mono text-xs">{card.code}</TableCell>
                <TableCell>
                  {card.packName ? (
                    <span className="text-sm">Pack : {card.packName}</span>
                  ) : (
                    <span className="text-sm text-muted-foreground">Montant libre</span>
                  )}
                </TableCell>
                <TableCell className="font-medium">{formatEuro(card.amount)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {formatEuro(card.remainingAmount)}
                </TableCell>
                <TableCell>{card.recipientName ?? <span className="opacity-50">—</span>}</TableCell>
                <TableCell>
                  <StatusBadge status={card.status} />
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {format(new Date(card.purchasedAt), 'dd MMM yyyy', { locale: fr })}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {card.expiresAt
                    ? format(new Date(card.expiresAt), 'dd MMM yyyy', { locale: fr })
                    : '—'}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {onView && (
                      <button
                        onClick={() => onView(card)}
                        className="p-2 text-white/50 hover:text-cyan-400 rounded-lg hover:bg-white/5 transition-all duration-200"
                        title="Voir le détail"
                      >
                        <Eye size={16} />
                      </button>
                    )}
                    {onCancel && card.status === 'ACTIVE' && (
                      <button
                        onClick={() => onCancel(card)}
                        className="p-2 text-white/50 hover:text-red-500 rounded-lg hover:bg-white/5 transition-all duration-200"
                        title="Annuler la carte"
                      >
                        <Ban size={16} />
                      </button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
