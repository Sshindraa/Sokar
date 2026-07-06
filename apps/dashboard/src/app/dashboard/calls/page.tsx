'use client';

import { useEffect, useState } from 'react';
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
import { AlertCircle, PhoneCall, Clock, MessageSquare } from 'lucide-react';

interface CallItem {
  id: string;
  callSid: string;
  durationSec: number | null;
  transcript: string | null;
  intent: string | null;
  outcome: string | null;
  carrier: string | null;
  createdAt: string;
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function OutcomeBadge({ outcome }: { outcome: string | null }) {
  switch (outcome) {
    case 'RESERVED':
      return (
        <Badge className="border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15">
          Réservé
        </Badge>
      );
    case 'INFO':
      return (
        <Badge className="border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/15">
          Info
        </Badge>
      );
    case 'HANDOFF':
      return (
        <Badge className="border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15">
          Transféré
        </Badge>
      );
    case 'NO_ACTION':
      return <Badge variant="secondary">Aucune action</Badge>;
    case 'ERROR':
      return <Badge variant="destructive">Erreur</Badge>;
    default:
      return <Badge variant="outline">{outcome || 'Inconnu'}</Badge>;
  }
}

function IntentLabel({ intent }: { intent: string | null }) {
  switch (intent) {
    case 'RESERVATION':
      return 'Réservation';
    case 'HOURS':
      return 'Horaires';
    case 'MENU':
      return 'Menu';
    case 'CANCEL':
      return 'Annulation';
    case 'OTHER':
      return 'Autre';
    default:
      return intent || '—';
  }
}

export default function CallsPage() {
  const { get, orgId } = useApi();
  const isMobile = useIsMobile();

  const [calls, setCalls] = useState<CallItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!orgId) return;

    async function fetchCalls() {
      try {
        const data = await get(`calls?restaurantId=${orgId}&limit=100`);
        setCalls(Array.isArray(data?.data) ? data.data : []);
        setTotal(typeof data?.total === 'number' ? data.total : 0);
      } catch (err: any) {
        setError(err.message || 'Impossible de charger les appels');
      } finally {
        setLoading(false);
      }
    }

    fetchCalls();
  }, [orgId, get]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-32 rounded-full" />
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
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Appels</h1>
        <span className="text-sm text-muted-foreground">
          {total} appel{total > 1 ? 's' : ''}
        </span>
      </div>

      {error ? (
        <div className="sokar-error">
          <AlertCircle size={18} />
          {error}
        </div>
      ) : calls.length === 0 ? (
        <div className="sokar-empty">
          <PhoneCall size={40} className="opacity-30" />
          <p className="text-sm">Aucun appel enregistré</p>
          <p className="text-xs opacity-60">
            Les appels traités par votre assistant apparaîtront ici.
          </p>
        </div>
      ) : isMobile ? (
        /* ========== MOBILE: Card List ========== */
        <div className="space-y-2.5">
          {calls.map((call) => (
            <MobileDataCard
              key={call.id}
              title={IntentLabel({ intent: call.intent })}
              subtitle={formatDate(call.createdAt)}
              badge={<OutcomeBadge outcome={call.outcome} />}
              accentClass={
                call.outcome === 'RESERVED'
                  ? 'border-l-emerald-500'
                  : call.outcome === 'ERROR'
                    ? 'border-l-red-500'
                    : call.outcome === 'HANDOFF'
                      ? 'border-l-amber-500'
                      : 'border-l-border'
              }
              details={[
                {
                  label: 'Durée',
                  value: formatDuration(call.durationSec),
                },
                {
                  label: 'Opérateur',
                  value: call.carrier || '—',
                },
                ...(call.transcript
                  ? [
                      {
                        label: 'Transcript',
                        value:
                          call.transcript.length > 60
                            ? call.transcript.slice(0, 60) + '…'
                            : call.transcript,
                      },
                    ]
                  : []),
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
                  <TableHead>Date</TableHead>
                  <TableHead>Durée</TableHead>
                  <TableHead>Intention</TableHead>
                  <TableHead>Issue</TableHead>
                  <TableHead>Opérateur</TableHead>
                  <TableHead>Transcript</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calls.map((call) => (
                  <TableRow key={call.id} className="transition-all duration-200 hover:bg-accent">
                    <TableCell className="font-medium whitespace-nowrap">
                      {formatDate(call.createdAt)}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Clock size={14} />
                        {formatDuration(call.durationSec)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <IntentLabel intent={call.intent} />
                    </TableCell>
                    <TableCell>
                      <OutcomeBadge outcome={call.outcome} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{call.carrier || '—'}</TableCell>
                    <TableCell className="max-w-xs">
                      {call.transcript ? (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <MessageSquare size={14} />
                          <span className="truncate block max-w-[200px]">
                            {call.transcript.length > 60
                              ? call.transcript.slice(0, 60) + '…'
                              : call.transcript}
                          </span>
                        </span>
                      ) : (
                        <span className="opacity-50">—</span>
                      )}
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
