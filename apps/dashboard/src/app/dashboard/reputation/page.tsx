'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock3, RefreshCw, ShieldAlert, Star } from 'lucide-react';
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
import { useApi } from '@/lib/api';
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

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [feedbackResponse, taskResponse] = await Promise.all([
        get<ListResponse<Feedback>>('reputation/feedback?limit=100'),
        get<ListResponse<RecoveryTask>>('reputation/recovery-tasks?limit=100'),
      ]);
      setFeedback(Array.isArray(feedbackResponse.data) ? feedbackResponse.data : []);
      setTasks(Array.isArray(taskResponse.data) ? taskResponse.data : []);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de charger la réputation'));
      setFeedback([]);
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [get]);

  useEffect(() => {
    void load();
  }, [load]);

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
      setError(getErrorMessage(err, 'Impossible de mettre à jour la tâche de récupération'));
    } finally {
      setAction(null);
    }
  }

  const locked = error.includes('REPUTATION_DISABLED') || error.includes('CAPABILITY_NOT_INCLUDED');

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

      {error ? (
        <Card className="border-destructive/30 bg-destructive/5" role="alert">
          <CardContent className="flex items-start gap-3 pt-6 text-sm text-destructive">
            {locked ? (
              <ShieldAlert className="mt-0.5 shrink-0" size={18} />
            ) : (
              <AlertCircle className="mt-0.5 shrink-0" size={18} />
            )}
            <div className="space-y-2">
              <p>{error}</p>
              {locked ? (
                <p className="text-muted-foreground">
                  Module Pro indisponible tant que les sources d’avis et le pilote d’envoi ne sont
                  pas validés.
                </p>
              ) : null}
              <Button variant="outline" size="sm" onClick={() => void load()}>
                Réessayer
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

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
                Les notes faibles créent une tâche dans la même transaction que le retour client.
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
                Les retours positifs restent disponibles ci-dessous.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Note</TableHead>
                  <TableHead>Réservation</TableHead>
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
                          <span className="max-w-[18rem] truncate text-sm">{task.comment}</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {task.reservationId}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(task.status)}>{statusLabel(task.status)}</Badge>
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
            <p className="text-sm text-muted-foreground">Aucun retour reçu pour le moment.</p>
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
                  <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                    Réservation {item.reservationId}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
