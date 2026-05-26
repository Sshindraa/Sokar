'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useApi } from '../../../lib/api';
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
import { PhoneCall, Frown } from 'lucide-react';

export default function CallsPage() {
  const { get, orgId } = useApi();

  const [calls, setCalls] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) return;

    async function fetchCalls() {
      try {
        const data = await get(`calls?restaurantId=${orgId}&limit=100&offset=0`);
        setCalls(data.data ?? []);
        setTotal(data.total ?? 0);
      } catch {
        // silent
      }
      setLoading(false);
    }
    fetchCalls();
  }, [orgId, get]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Appels</h1>
        <span className="text-sm text-muted-foreground">{total} appels</span>
      </div>

      {calls.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
          <PhoneCall size={40} className="opacity-30" />
          <p className="text-sm">Aucun appel pour le moment</p>
          <p className="text-xs opacity-60">
            Les appels apparaîtront ici quand votre assistant commencera à répondre.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Call SID</TableHead>
                <TableHead>Intention</TableHead>
                <TableHead>Résultat</TableHead>
                <TableHead>Durée</TableHead>
                <TableHead>Carrier</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {calls.map((call: any) => (
                <TableRow key={call.id} className="transition-all duration-200 hover:bg-accent">
                  <TableCell className="font-medium">{call.callSid}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {call.intent || <span className="opacity-50">—</span>}
                  </TableCell>
                  <TableCell>
                    <OutcomeBadge outcome={call.outcome} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {call.durationSec != null ? `${call.durationSec}s` : <span className="opacity-50">—</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {call.carrier || <span className="opacity-50">—</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {format(new Date(call.createdAt), 'dd MMM HH:mm', { locale: fr })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: string | null }) {
  switch (outcome) {
    case 'RESERVED':
      return <Badge className="bg-green-100 text-green-700 hover:bg-green-200">Réservé</Badge>;
    case 'INFO':
      return <Badge variant="secondary">Info</Badge>;
    case 'NO_ACTION':
      return <Badge variant="outline">Aucune action</Badge>;
    default:
      return <Badge variant="secondary">En cours</Badge>;
  }
}
