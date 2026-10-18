'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useApi } from '../../../lib/api';
import { getErrorMessage, type Call, type CallListResponse } from '@/types/api';
import { useMediaQuery } from '@/lib/useMediaQuery';
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
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PhoneCall, Clock, MessageSquare } from 'lucide-react';
import { formatDate } from '@sokar/shared';
import { DataFetchError } from '@/components/DataFetchError';

interface CallItem extends Call {}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const CALL_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

const PAGE_SIZE = 100;
const TRANSCRIPT_PREVIEW_LENGTH = 60;

function transcriptPreview(transcript: string): string {
  return transcript.length > TRANSCRIPT_PREVIEW_LENGTH
    ? `${transcript.slice(0, TRANSCRIPT_PREVIEW_LENGTH)}…`
    : transcript;
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
    case 'MESSAGE':
      return (
        <Badge className="border-brand/20 bg-brand/10 text-brand hover:bg-brand/15">Message</Badge>
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

function RecordingPlayer({ call, siteId }: { call: CallItem; siteId?: string }) {
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
      src={`/api/proxy/calls/${call.id}/recording${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`}
    >
      Votre navigateur ne permet pas la lecture audio.
    </audio>
  );
}

export default function CallsPage() {
  const { get, orgId, siteId } = useApi();
  // Sous 1024 px (iPad compris), un tableau de colonnes larges déborde : la liste en cartes prend le relais.
  const isCompact = useMediaQuery('(max-width: 1023px)');

  const [calls, setCalls] = useState<CallItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState('');
  const [transcriptCall, setTranscriptCall] = useState<CallItem | null>(null);

  const fetchCalls = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError('');
    try {
      const data = await get<CallListResponse>(`calls?restaurantId=${orgId}&limit=${PAGE_SIZE}`);
      setCalls(Array.isArray(data?.data) ? data.data : []);
      setTotal(typeof data?.total === 'number' ? data.total : 0);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de charger les appels'));
    } finally {
      setLoading(false);
    }
  }, [get, orgId]);

  useEffect(() => {
    void fetchCalls();
  }, [fetchCalls]);

  // L'en-tête annonce le total réel : sans suite, les appels plus anciens seraient inaccessibles.
  const loadMore = useCallback(async () => {
    if (!orgId) return;
    setLoadingMore(true);
    setMoreError('');
    try {
      const data = await get<CallListResponse>(
        `calls?restaurantId=${orgId}&limit=${PAGE_SIZE}&offset=${calls.length}`,
      );
      const next = Array.isArray(data?.data) ? data.data : [];
      setCalls((current) => {
        const known = new Set(current.map((call) => call.id));
        return [...current, ...next.filter((call) => !known.has(call.id))];
      });
      if (typeof data?.total === 'number') setTotal(data.total);
    } catch (err: unknown) {
      setMoreError(getErrorMessage(err, 'Impossible de charger les appels suivants'));
    } finally {
      setLoadingMore(false);
    }
  }, [get, orgId, calls.length]);

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
        {!error && (
          <span className="text-sm text-muted-foreground">
            {total} appel{total > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {error && <DataFetchError message={error} onRetry={fetchCalls} retrying={loading} />}
      {calls.length === 0 ? (
        error ? null : (
          <div className="sokar-empty">
            <PhoneCall size={40} className="opacity-30" />
            <p className="text-sm">Aucun appel enregistré</p>
            <p className="max-w-sm text-xs opacity-60">
              Les appels de votre assistant apparaîtront ici.
            </p>
            <Button asChild size="sm" variant="outline" className="mt-1">
              <Link href="/dashboard/settings#settings-agent">Vérifier l&apos;assistant</Link>
            </Button>
          </div>
        )
      ) : isCompact ? (
        /* ========== MOBILE: Card List ========== */
        <div className="space-y-2.5">
          {calls.map((call) => (
            <div key={call.id} className="space-y-2">
              <MobileDataCard
                title={IntentLabel({ intent: call.intent })}
                subtitle={formatDate(call.createdAt, 'fr-FR', CALL_DATE_FORMAT)}
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
                  ...(call.transcript
                    ? [{ label: 'Transcription', value: transcriptPreview(call.transcript) }]
                    : []),
                ]}
              />
              {call.transcript ? (
                <div className="px-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setTranscriptCall(call)}
                    className="transition-all duration-200"
                  >
                    <MessageSquare size={14} />
                    Lire la transcription
                  </Button>
                </div>
              ) : null}
              {call.recordingStatus !== 'NOT_REQUESTED' ? (
                <div className="px-1">
                  <RecordingPlayer call={call} siteId={siteId} />
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
                  <TableHead>Enregistrement</TableHead>
                  <TableHead>Transcription</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calls.map((call) => (
                  <TableRow key={call.id} className="transition-all duration-200 hover:bg-accent">
                    <TableCell className="font-medium whitespace-nowrap">
                      {formatDate(call.createdAt, 'fr-FR', CALL_DATE_FORMAT)}
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
                    <TableCell>
                      <RecordingPlayer call={call} siteId={siteId} />
                    </TableCell>
                    <TableCell className="max-w-xs">
                      {call.transcript ? (
                        <button
                          type="button"
                          onClick={() => setTranscriptCall(call)}
                          aria-label={`Lire la transcription de l'appel du ${formatDate(call.createdAt, 'fr-FR')}`}
                          className="inline-flex max-w-full items-center gap-1 rounded-md text-left text-muted-foreground transition-all duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <MessageSquare size={14} className="shrink-0" />
                          <span className="block max-w-[200px] truncate">
                            {transcriptPreview(call.transcript)}
                          </span>
                        </button>
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

      {calls.length > 0 && calls.length < total && (
        <div className="flex flex-col items-center gap-2">
          {moreError && <p className="text-sm text-destructive">{moreError}</p>}
          <Button
            type="button"
            variant="outline"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="transition-all duration-200"
          >
            {loadingMore ? 'Chargement…' : `Afficher plus d'appels (${calls.length} sur ${total})`}
          </Button>
        </div>
      )}

      <Dialog open={!!transcriptCall} onOpenChange={(open) => !open && setTranscriptCall(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Transcription de l&apos;appel</DialogTitle>
            <DialogDescription>
              {transcriptCall && formatDate(transcriptCall.createdAt, 'fr-FR', CALL_DATE_FORMAT)}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-border bg-background p-4 text-sm leading-relaxed">
            {transcriptCall?.transcript}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
