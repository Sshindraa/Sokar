'use client';

import { useEffect, useState } from 'react';
import { useApi } from '../../../lib/api';
import { getErrorMessage, type Call, type CallListResponse } from '@/types/api';
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
import { formatDate } from '@sokar/shared';

interface CallItem extends Call {}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function OutcomeBadge({ outcome }: { outcome: string | null }) {
  switch (outcome) {
    case 'RESERVED':
      return (
        <Badge className="border-success/20 bg-success/10 text-success hover:bg-success/15">
          Réservé
        </Badge>
      );
    case 'INFO':
      return (
        <Badge className="border-brand/20 bg-brand/10 text-brand hover:bg-brand/15">Info</Badge>
      );
    case 'HANDOFF':
      return (
        <Badge className="border-warning/20 bg-warning/10 text-warning hover:bg-warning/15">
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

function RecordingPlayer({ call }: { call: CallItem }) {
  if (call.recordingStatus === 'PENDING') {
    return <span className="text-xs text-muted-foreground">Traitement…</span>;
  }
  if (call.recordingStatus === 'FAILED') {
    return <span className="text-xs text-destructive">Enregistrement indisponible</span>;
  }
  if (call.recordingStatus === 'DELETED') {
    return <span className="text-xs text-muted-foreground">Expiré</span>;
  }
  if (call.recordingStatus !== 'AVAILABLE') {
    return <span className="text-muted-foreground opacity-50">—</span>;
  }

  return (
    <audio
      controls
      preload="none"
      aria-label={`Réécouter l'appel du ${formatDate(call.createdAt, 'fr-FR')}`}
      className="h-9 w-full min-w-[220px] max-w-[300px]"
      src={`/api/proxy/calls/${call.id}/recording`}
    >
      Votre navigateur ne permet pas la lecture audio.
    </audio>
  );
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
        const data = await get<CallListResponse>(`calls?restaurantId=${orgId}&limit=100`);
        setCalls(Array.isArray(data?.data) ? data.data : []);
        setTotal(typeof data?.total === 'number' ? data.total : 0);
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Impossible de charger les appels'));
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
            <div key={call.id} className="space-y-2">
              <MobileDataCard
                title={IntentLabel({ intent: call.intent })}
                subtitle={formatDate(call.createdAt, 'fr-FR', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                badge={<OutcomeBadge outcome={call.outcome} />}
                accentClass={
                  call.outcome === 'RESERVED'
                    ? 'border-l-success'
                    : call.outcome === 'ERROR'
                      ? 'border-l-destructive'
                      : call.outcome === 'HANDOFF'
                        ? 'border-l-warning'
                        : 'border-l-border'
                }
                details={[
                  { label: 'Durée', value: formatDuration(call.durationSec) },
                  { label: 'Opérateur', value: call.carrier || '—' },
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
              {call.recordingStatus !== 'NOT_REQUESTED' ? (
                <div className="px-1">
                  <RecordingPlayer call={call} />
                </div>
              ) : null}
            </div>
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
                  <TableHead>Enregistrement</TableHead>
                  <TableHead>Transcript</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calls.map((call) => (
                  <TableRow key={call.id} className="transition-all duration-200 hover:bg-accent">
                    <TableCell className="font-medium whitespace-nowrap">
                      {formatDate(call.createdAt, 'fr-FR', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
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
                    <TableCell>
                      <RecordingPlayer call={call} />
                    </TableCell>
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
