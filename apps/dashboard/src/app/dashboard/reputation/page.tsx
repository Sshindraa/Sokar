'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Info, MoreHorizontal } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { StatusBadge, type StatusLevel } from '@/components/StatusBadge';
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

// Niveau par sens : à traiter = action ; en cours = en cours ; résolue = terminée ; classée = neutre.
function statusLevel(status: RecoveryStatus): StatusLevel {
  if (status === 'OPEN') return 'action';
  if (status === 'IN_PROGRESS') return 'progress';
  if (status === 'RESOLVED') return 'done';
  return 'neutral';
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
  const [selectedTask, setSelectedTask] = useState<RecoveryTask | null>(null);
  // Échec du chargement ou module fermé : on n'affiche ni « 0 retour » ni « aucune récupération à traiter ».
  const [loadError, setLoadError] = useState('');
  const [lock, setLock] = useState<FeatureLock | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
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
        toast.error('Cette demande a déjà été traitée par un collègue. La liste est actualisée.');
      } else {
        toast.error(getErrorMessage(err, 'Impossible de mettre à jour cette demande.'));
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
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Réputation</h1>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => void load()}
          disabled={loading}
          className="w-fit transition-all duration-200"
        >
          Actualiser
        </Button>
      </header>

      {lock ? (
        <FeatureLockCard lock={lock} feature="Réputation" />
      ) : loadError ? (
        <DataFetchError message={loadError} onRetry={() => void load()} retrying={loading} />
      ) : null}
      {showContent ? (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    Boîte de récupération
                  </CardTitle>
                </div>
                <Badge variant="secondary">
                  {activeTasks.length} active{activeTasks.length > 1 ? 's' : ''}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <LoadingTable />
              ) : tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune récupération à traiter</p>
              ) : (
                <Table className="block w-full md:table [&_th]:px-2 [&_td]:px-2">
                  <TableHeader className="hidden md:table-header-group">
                    <TableRow>
                      <TableHead>Note</TableHead>
                      <TableHead>État</TableHead>
                      <TableHead className="hidden md:table-cell">Créée</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="block md:table-row-group">
                    {tasks.map((task) => (
                      <TableRow
                        key={task.id}
                        className="block space-y-2 py-3 md:table-row md:space-y-0 md:py-0"
                      >
                        <TableCell className="block md:table-cell">
                          <div className="flex items-center gap-2">
                            <StatusBadge level={task.priority === 'HIGH' ? 'action' : 'neutral'}>
                              {scoreLabel(task.score)}
                            </StatusBadge>
                            {task.comment ? (
                              <span className="max-w-[18rem] whitespace-normal break-words text-sm">
                                {task.comment}
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="block md:table-cell">
                          <StatusBadge level={statusLevel(task.status)}>
                            {statusLabel(task.status)}
                          </StatusBadge>
                        </TableCell>
                        <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                          {formatDate(task.createdAt)}
                        </TableCell>
                        <TableCell className="block text-left md:table-cell md:text-right">
                          <div className="flex justify-start gap-2 md:justify-end">
                            {task.status === 'OPEN' ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void updateTask(task, 'IN_PROGRESS')}
                                disabled={action !== null}
                              >
                                Prendre en charge
                              </Button>
                            ) : null}
                            {task.status === 'IN_PROGRESS' ? (
                              <Button
                                size="sm"
                                onClick={() => void updateTask(task, 'RESOLVED')}
                                disabled={action !== null}
                              >
                                Marquer résolue
                              </Button>
                            ) : null}
                            <DropdownMenu modal={false}>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className="h-9 w-9 shrink-0 transition-all duration-200"
                                  aria-label={`Autres actions pour le retour du ${formatDate(task.createdAt)}`}
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => setSelectedTask(task)}>
                                  Voir le retour
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
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

          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <CardDescription>Note moyenne</CardDescription>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label="Comprendre la note moyenne"
                          className="rounded text-muted-foreground transition-all duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Info className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Sur les retours chargés (100 maximum).</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <CardTitle className="text-3xl tabular-nums">
                  {averageScore === null
                    ? '—'
                    : `${averageScore.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}/5`}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Retours reçus</CardDescription>
                <CardTitle className="text-3xl tabular-nums">
                  {loading ? '—' : feedback.length}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Récupérations ouvertes</CardDescription>
                <CardTitle className="text-3xl tabular-nums">{loading ? '—' : openTasks}</CardTitle>
              </CardHeader>
            </Card>
          </div>

          <details open className="group rounded-xl border border-border bg-card">
            <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-base font-semibold transition-all duration-200 [&::-webkit-details-marker]:hidden">
              <ChevronDown className="h-4 w-4 transition-all duration-200 group-open:rotate-180" />
              Retours récents
            </summary>
            <Card className="border-0 shadow-none">
              <CardContent>
                {loading ? (
                  <LoadingTable />
                ) : feedback.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucun retour pour le moment.</p>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {feedback.slice(0, 8).map((item) => (
                      <div
                        key={item.id}
                        className="rounded-xl border border-border p-4 transition-all duration-200"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <StatusBadge level={item.score <= 2 ? 'action' : 'neutral'}>
                            {scoreLabel(item.score)}
                          </StatusBadge>
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
          </details>
        </>
      ) : null}
      <Dialog
        open={selectedTask !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedTask(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Retour client</DialogTitle>
            <DialogDescription>
              {selectedTask && formatDate(selectedTask.createdAt)}
            </DialogDescription>
          </DialogHeader>
          {selectedTask && (
            <div className="space-y-3">
              <StatusBadge level={selectedTask.score <= 2 ? 'action' : 'neutral'}>
                {scoreLabel(selectedTask.score)}
              </StatusBadge>
              <p className="whitespace-pre-wrap break-words text-sm">
                {selectedTask.comment || 'Aucun commentaire.'}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
