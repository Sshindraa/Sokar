'use client';

import { useCallback, useEffect, useState } from 'react';
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
import { Button } from '@/components/ui/button';
import { AlertCircle, HeartHandshake, Send, X, Clock, Check, Phone } from 'lucide-react';

interface ReactivationCustomer {
  id: string;
  name: string;
  phone: string | null;
  visitCount: number;
  lastSeenAt: string | null;
}

interface ReactivationCampaign {
  id: string;
  status: string;
  sentCount: number;
  sentAt: string | null;
  createdAt: string;
  customerCount: number;
  customers: ReactivationCustomer[];
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'PENDING') return <Badge className="bg-warning">En attente</Badge>;
  if (status === 'SENT') return <Badge className="bg-success">Envoyée</Badge>;
  if (status === 'DISMISSED') return <Badge className="bg-zinc-600">Ignorée</Badge>;
  return <Badge>{status}</Badge>;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function daysSince(dateStr: string | null): string {
  if (!dateStr) return '—';
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
  if (days < 30) return `${days}j`;
  const months = Math.floor(days / 30);
  return `${months} mois`;
}

export default function ReactivationPage() {
  const { get, post, orgId } = useApi();
  const isMobile = useIsMobile();

  const [campaigns, setCampaigns] = useState<ReactivationCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await get('dashboard/reactivation');
      setCampaigns(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || 'Impossible de charger les campagnes');
    }
    setLoading(false);
  }, [get]);

  useEffect(() => {
    if (!orgId) return;
    fetchCampaigns();
  }, [orgId, fetchCampaigns]);

  async function sendCampaign(id: string) {
    setActionLoading(id);
    try {
      await post(`dashboard/reactivation/${id}/send`);
      setCampaigns((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, status: 'SENT', sentAt: new Date().toISOString() } : c,
        ),
      );
    } catch (err: any) {
      setError(err.message || "Impossible d'envoyer la campagne");
    }
    setActionLoading(null);
  }

  async function dismissCampaign(id: string) {
    setActionLoading(id);
    try {
      await post(`dashboard/reactivation/${id}/dismiss`);
      setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, status: 'DISMISSED' } : c)));
    } catch (err: any) {
      setError(err.message || "Impossible d'ignorer la campagne");
    }
    setActionLoading(null);
  }

  const pendingCampaigns = campaigns.filter((c) => c.status === 'PENDING');
  const pastCampaigns = campaigns.filter((c) => c.status !== 'PENDING');

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32 rounded-full" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <HeartHandshake size={24} className="text-warning" />
        <div>
          <h1 className="text-xl font-semibold">Réactivation VIP</h1>
          <p className="text-sm text-muted-foreground">
            Vos meilleurs clients qui ne sont plus venus depuis un moment.
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {pendingCampaigns.length === 0 && pastCampaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <HeartHandshake size={40} className="opacity-30" />
          <p className="text-sm">Aucune campagne de réactivation pour le moment</p>
          <p className="text-xs text-muted-foreground">
            Le système scanne vos VIPs dormants chaque lundi. Revenez plus tard.
          </p>
        </div>
      ) : (
        <>
          {/* Campaigns en attente */}
          {pendingCampaigns.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground">À valider</h2>
              {pendingCampaigns.map((campaign) => (
                <div key={campaign.id} className="sokar-card border-l-warning p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock size={16} className="text-warning" />
                      <span className="text-sm font-medium">
                        {campaign.customerCount} VIP{campaign.customerCount > 1 ? 's' : ''} dormant
                        {campaign.customerCount > 1 ? 's' : ''}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        · {formatDate(campaign.createdAt)}
                      </span>
                    </div>
                    <StatusBadge status={campaign.status} />
                  </div>

                  {/* Liste des VIPs */}
                  {isMobile ? (
                    <div className="space-y-2">
                      {campaign.customers.map((c) => (
                        <MobileDataCard
                          key={c.id}
                          title={c.name}
                          subtitle={c.phone || undefined}
                          badge={
                            <Badge className="bg-warning/20 text-warning">
                              {c.visitCount} visites
                            </Badge>
                          }
                          details={[{ label: 'Dernière visite', value: daysSince(c.lastSeenAt) }]}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="mb-4 overflow-hidden rounded-lg border border-border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Client</TableHead>
                            <TableHead>Téléphone</TableHead>
                            <TableHead>Visites</TableHead>
                            <TableHead>Dernière visite</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {campaign.customers.map((c) => (
                            <TableRow key={c.id}>
                              <TableCell className="font-medium">{c.name}</TableCell>
                              <TableCell className="text-muted-foreground">
                                {c.phone ? (
                                  <span className="flex items-center gap-1">
                                    <Phone size={12} /> {c.phone}
                                  </span>
                                ) : (
                                  '—'
                                )}
                              </TableCell>
                              <TableCell>{c.visitCount}</TableCell>
                              <TableCell className="text-muted-foreground">
                                {daysSince(c.lastSeenAt)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="bg-success text-success-foreground hover:opacity-90"
                      onClick={() => sendCampaign(campaign.id)}
                      disabled={actionLoading === campaign.id}
                    >
                      <Send size={14} className="mr-1" />
                      Envoyer {campaign.customerCount} SMS
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => dismissCampaign(campaign.id)}
                      disabled={actionLoading === campaign.id}
                    >
                      <X size={14} className="mr-1" />
                      Ignorer
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Historique */}
          {pastCampaigns.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground">Historique</h2>
              {isMobile ? (
                <div className="space-y-2">
                  {pastCampaigns.map((c) => (
                    <MobileDataCard
                      key={c.id}
                      title={`${c.customerCount} VIPs`}
                      subtitle={formatDate(c.createdAt)}
                      badge={<StatusBadge status={c.status} />}
                      details={
                        c.status === 'SENT'
                          ? [{ label: 'SMS envoyés', value: `${c.sentCount}/${c.customerCount}` }]
                          : undefined
                      }
                    />
                  ))}
                </div>
              ) : (
                <div className="sokar-card overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>VIPs</TableHead>
                        <TableHead>SMS envoyés</TableHead>
                        <TableHead>Statut</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pastCampaigns.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell>{formatDate(c.createdAt)}</TableCell>
                          <TableCell>{c.customerCount}</TableCell>
                          <TableCell>
                            {c.status === 'SENT' ? (
                              <span className="flex items-center gap-1 text-success">
                                <Check size={12} /> {c.sentCount}/{c.customerCount}
                              </span>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={c.status} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
