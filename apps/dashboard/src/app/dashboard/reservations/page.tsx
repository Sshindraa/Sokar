'use client';

import { useEffect, useState } from 'react';
// @ts-ignore - date-fns types resolution issue under bundler
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useApi } from '../../../lib/api';
import { useIsMobile } from '@/lib/useMediaQuery';
import MobileDataCard from '@/components/MobileDataCard';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, CalendarCheck, Check, Trash2 } from 'lucide-react';

export default function ReservationsPage() {
  const { get, orgId } = useApi();
  const isMobile = useIsMobile();

  const [reservations, setReservations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!orgId) return;

    async function fetchReservations() {
      try {
        const data = await get(`reservations?restaurantId=${orgId}&limit=100`);
        setReservations(Array.isArray(data) ? data : []);
      } catch (err: any) {
        setError(err.message || 'Impossible de charger les réservations');
      }
      setLoading(false);
    }
    fetchReservations();
  }, [orgId, get]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-36 rounded-full" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Réservations</h1>
        <span className="text-sm text-muted-foreground">
          {reservations.length} réservation{reservations.length > 1 ? 's' : ''}
        </span>
      </div>

      {error ? (
        <div className="sokar-error">
          <AlertCircle size={18} />
          {error}
        </div>
      ) : reservations.length === 0 ? (
        <div className="sokar-empty">
          <CalendarCheck size={40} className="opacity-30" />
          <p className="text-sm">Aucune réservation pour le moment</p>
          <p className="text-xs opacity-60">
            Les réservations prises par votre assistant apparaîtront ici.
          </p>
        </div>
      ) : isMobile ? (
        /* ========== MOBILE: Card List ========== */
        <div className="space-y-2.5">
          {reservations.map((res: any) => (
            <MobileDataCard
              key={res.id}
              title={res.customerName}
              subtitle={res.customerPhone || undefined}
              badge={<StatusBadge status={res.status} />}
              accentClass={
                res.status === 'CONFIRMED'
                  ? 'border-l-emerald-500'
                  : res.status === 'CANCELLED'
                    ? 'border-l-red-500'
                    : res.status === 'SEATED'
                      ? 'border-l-blue-400'
                      : 'border-l-white/10'
              }
              actions={[
                {
                  label: 'Confirmer',
                  icon: <Check size={14} />,
                  colorClass: 'bg-emerald-600',
                  onClick: () => {
                    setReservations((prev) =>
                      prev.map((r) => (r.id === res.id ? { ...r, status: 'CONFIRMED' } : r)),
                    );
                  },
                },
                {
                  label: 'Annuler',
                  icon: <Trash2 size={14} />,
                  colorClass: 'bg-red-600',
                  onClick: () => {
                    setReservations((prev) =>
                      prev.map((r) => (r.id === res.id ? { ...r, status: 'CANCELLED' } : r)),
                    );
                  },
                },
              ]}
              details={[
                {
                  label: 'Date',
                  value: format(new Date(res.reservedAt), 'dd MMM HH:mm', { locale: fr }),
                },
                {
                  label: 'Couverts',
                  value: `${res.partySize} pers.`,
                },
                {
                  label: 'Revenu',
                  value: res.estimatedRevenue ? `${res.estimatedRevenue}€` : '—',
                },
              ]}
            />
          ))}
        </div>
      ) : (
        /* ========== DESKTOP: Table ========== */
        <div className="sokar-card overflow-hidden">
          <div className="mobile-table-wrapper">
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Téléphone</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Couverts</TableHead>
                <TableHead>Revenu estimé</TableHead>
                <TableHead>Statut</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reservations.map((res: any) => (
                <TableRow key={res.id} className="transition-all duration-200 hover:bg-accent">
                  <TableCell className="font-medium">{res.customerName}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {res.customerPhone || <span className="opacity-50">—</span>}
                  </TableCell>
                  <TableCell>
                    {format(new Date(res.reservedAt), 'dd MMM yyyy HH:mm', { locale: fr })}
                  </TableCell>
                  <TableCell>{res.partySize}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {res.estimatedRevenue ? `${res.estimatedRevenue}€` : <span className="opacity-50">—</span>}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={res.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'CONFIRMED':
      return <Badge className="border-primary/20 bg-primary/10 text-foreground hover:bg-primary/15">Confirmée</Badge>;
    case 'CANCELLED':
      return <Badge variant="destructive">Annulée</Badge>;
    case 'SEATED':
      return <Badge className="border-border bg-secondary text-secondary-foreground hover:bg-accent">Installée</Badge>;
    case 'NO_SHOW':
      return <Badge variant="secondary">No-show</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

