'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, RefreshCw, ShieldAlert, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DataFetchError } from '@/components/DataFetchError';
import { FeatureLockCard } from '@/components/FeatureLockCard';
import { useApi } from '@/lib/api';
import { ApiError, featureLockFromError, type FeatureLock } from '@/lib/api-error';
import { getErrorMessage } from '@/types/api';

type Feedback = {
  id: string;
  requestId: string;
  reservationId: string;
  score: number;
  comment: string | null;
  submittedAt: string;
};

type RecoveryStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'DISMISSED';
type RecoveryPriority = 'HIGH' | 'NORMAL';

type RecoveryTask = {
  id: string;
  feedbackId: string;
  reservationId: string;
  status: RecoveryStatus;
  priority: RecoveryPriority;
  assigned: boolean;
  resolutionCode: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  score: number;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
};

type ListResponse<T> = { data?: T[] };

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

function statusLabel(status: RecoveryStatus): string {
  return {
    OPEN: 'À traiter',
    IN_PROGRESS: 'En cours',
    RESOLVED: 'Résolue',
    DISMISSED: 'Classée',
  }[status];
}

function statusVariant(status: RecoveryStatus): 'default' | 'secondary' | 'destructive' {
  if (status === 'RESOLVED') return 'default';
  if (status === 'OPEN') return 'destructive';
  return 'secondary';
}

function scoreLabel(score: number): string {
  return `${score}/5`;
}

function LoadingTable() {
  return (
    <div className="space-y-2">
      {[1, 2, 3, 4].map((row) => (
        <Skeleton key={row} className="h-14 w-full rounded-xl" />
      ))}
    </div>
  );
}

export default function ReputationPage() {
  const { get, patch } = useApi();
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [tasks, setTasks] = useState<RecoveryTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState('');
  // Échec du chargement ou module fermé : on n'affiche ni « 0 retour » ni « aucune récupération à traiter ».
  const [loadError, setLoadError] = useState('');
  const [lock, setLock] = useState<FeatureLock | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setLoadError('');
    setLock(null);
    try {
      // Les demandes à traiter sont chargées par état : une note faible récente ne doit jamais disparaître
      // derrière 100 demandes déjà classées.
      const [feedbackResponse, openResponse, inProgressResponse] = await Promise.all([
        get<ListResponse<Feedback>>('reputation/feedback?limit=100'),
        get<ListResponse<RecoveryTask>>('reputation/recovery-tasks?status=OPEN&limit=100'),
        get<ListResponse<RecoveryTask>>('reputation/recovery-tasks?status=IN_PROGRESS&limit=100'),
      ]);
      setFeedback(Array.isArray(feedbackResponse.data) ? feedbackResponse.data : []);
      setTasks([
        ...(Array.isArray(openResponse.data) ? openResponse.data : []),
        ...(Array.isArray(inProgressResponse.data) ? inProgressResponse.data : []),
      ]);
    } catch (err: unknown) {
      setLock(featureLockFromError(err));
      setLoadError(getErrorMessage(err, 'Impossible de charger la réputation.'));
      setFeedback([]);
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [get]);

  useEffect(() => {
    void load();
  }, [load]);

  const showContent = !lock && !loadError;
  const averageScore = useMemo(() => {
    if (feedback.length === 0) return null;
    return feedback.reduce((sum, item) => sum + item.score, 0) / feedback.length;
  }, [feedback]);
  const openTasks = tasks.filter((task) => task.status === 'OPEN').length;
  const activeTasks = tasks.filter(
    (task) => task.status === 'OPEN' || task.status === 'IN_PROGRESS',
  );

  async function updateTask(task: RecoveryTask, status: RecoveryStatus) {
    setAction(`${task.id}:${status}`);
    setError('');
    try {
      const response = await patch<{ data?: RecoveryTask }>(
        `reputation/recovery-tasks/${task.id}`,
        {
          status,
          ...(status === 'RESOLVED'
            ? {
                resolutionCode: 'CONTACTED',
                resolutionNote: 'Traitée depuis la boîte de récupération.',
              }
            : {}),
        },
      );
      if (response.data) {
        setTasks((previous) =>
          previous.map((item) => (item.id === task.id ? response.data! : item)),
        );
      }
    } catch (err: unknown) {
      if (err instanceof ApiError && (err.kind === 'conflict' || err.kind === 'not-found')) {
        // Un collègue a déjà traité cette demande, ou la page n'est plus à jour : on la rafraîchit.
        await load();
        setError('Cette demande a déjà été traitée par un collègue. La liste est actualisée.');
      } else {
        setError(getErrorMessage(err, 'Impossible de mettre à jour cette demande.'));
      }
    } finally {
      setAction(null);
    }
  }

  return (
    <div className="w-full space-y-6">
      <header className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="flex items-center gap-2">
            <Star className="text-primary" size={20} aria-hidden="true" />
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Réputation</h1>
            <Badge variant="secondary">Pro</Badge>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Centralisez les retours post-visite et traitez rapidement les expériences qui
            nécessitent une attention.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : undefined} aria-hidden="true" />
          Actualiser
        </Button>
      </header>

      {lock ? (
        <FeatureLockCard lock={lock} feature="Réputation" />
      ) : loadError ? (
        <DataFetchError message={loadError} onRetry={() => void load()} retrying={loading} />
      ) : null}
      {showContent && error ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      {showContent ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Score moyen</CardDescription>
                <CardTitle className="text-3xl">
                  {averageScore === null ? '—' : `${averageScore.toFixed(1)}/5`}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Sur les retours chargés (100 maximum).
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Retours reçus</CardDescription>
                <CardTitle className="text-3xl">{loading ? '—' : feedback.length}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Une réponse par invitation.
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Récupérations ouvertes</CardDescription>
                <CardTitle className="text-3xl">{loading ? '—' : openTasks}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {activeTasks.length} active(s) à suivre.
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldAlert size={17} aria-hidden="true" />
                    Boîte de récupération
                  </CardTitle>
                  <CardDescription>
                    Quand un client donne une note faible, une demande de rappel apparaît ici pour
                    que vous puissiez lui répondre.
                  </CardDescription>
                </div>
                <Badge variant="secondary">{activeTasks.length} active(s)</Badge>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <LoadingTable />
              ) : tasks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-8 text-center">
                  <CheckCircle2 className="mx-auto text-success" size={24} aria-hidden="true" />
                  <p className="mt-3 text-sm font-medium">Aucune récupération à traiter</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Les retours positifs sont visibles ci-dessous.
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Note</TableHead>
                      <TableHead>État</TableHead>
                      <TableHead>Créée</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tasks.map((task) => (
                      <TableRow key={task.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Badge variant={task.priority === 'HIGH' ? 'destructive' : 'secondary'}>
                              {scoreLabel(task.score)}
                            </Badge>
                            {task.comment ? (
                              <span className="max-w-[18rem] whitespace-normal break-words text-sm">
                                {task.comment}
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(task.status)}>
                            {statusLabel(task.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(task.createdAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {task.status === 'OPEN' ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void updateTask(task, 'IN_PROGRESS')}
                                disabled={action !== null}
                              >
                                <Clock3 size={14} aria-hidden="true" />
                                Prendre en charge
                              </Button>
                            ) : null}
                            {task.status === 'IN_PROGRESS' ? (
                              <Button
                                size="sm"
                                onClick={() => void updateTask(task, 'RESOLVED')}
                                disabled={action !== null}
                              >
                                <CheckCircle2 size={14} aria-hidden="true" />
                                Marquer résolue
                              </Button>
                            ) : null}
                            {action?.startsWith(`${task.id}:`) ? (
                              <span className="sr-only">Mise à jour…</span>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Retours récents</CardTitle>
              <CardDescription>
                Les commentaires sont visibles uniquement aux rôles autorisés du site.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <LoadingTable />
              ) : feedback.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aucun retour pour le moment. Après chaque visite, vos clients reçoivent une
                  invitation à noter leur repas : leurs réponses apparaîtront ici.
                </p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {feedback.slice(0, 8).map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-border p-4 transition-all duration-200"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <Badge variant={item.score <= 2 ? 'destructive' : 'secondary'}>
                          {scoreLabel(item.score)}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(item.submittedAt)}
                        </span>
                      </div>
                      <p className="mt-3 text-sm text-foreground">
                        {item.comment || 'Aucun commentaire.'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
