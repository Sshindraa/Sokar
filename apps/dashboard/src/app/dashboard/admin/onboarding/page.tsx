'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw, Route, Timer, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';

interface StepFunnel {
  step: string;
  started: number;
  completed: number;
  skipped: number;
  blocked: number;
  abandoned: number;
  completionRate: number;
}

interface CohortFunnel {
  restaurants: number;
  totalEvents: number;
  steps: StepFunnel[];
  milestones: { activated: number; firstCall: number; demoCallPlayed: number };
  timeToFirstReservation: {
    measured: number;
    pending: number;
    medianHours: number | null;
    p90Hours: number | null;
  };
  overallCompletionRate: number;
}

interface RestaurantProgress {
  restaurantId: string;
  startedAt: string;
  lastEventAt: string;
  completedSteps: number;
  blockedSteps: number;
  firstReservationAt: string | null;
  hoursToFirstReservation: number | null;
}

interface CohortResponse {
  funnel: CohortFunnel;
  restaurants: RestaurantProgress[];
}

function formatHours(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} j`;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function Metric({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold text-foreground">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

export default function AdminOnboardingPage() {
  const { get } = useApi();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CohortResponse | null>(null);

  const fetchCohort = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await get<CohortResponse>('admin/onboarding-funnel/cohort');
      setData(res);
    } catch (err: unknown) {
      setData(null);
      setError(
        err instanceof Error ? err.message : "Erreur lors du chargement du funnel d'onboarding",
      );
    } finally {
      setLoading(false);
    }
  }, [get]);

  useEffect(() => {
    fetchCohort();
  }, [fetchCohort]);

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Onboarding — cohorte</h1>
        <p className="text-sm text-muted-foreground">
          Abandon par étape et délai jusqu&apos;à la première réservation, tous établissements
          confondus.
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={fetchCohort}
        disabled={loading}
        className="transition-all duration-200"
      >
        <RefreshCw size={14} className={cn('mr-2', loading && 'animate-spin')} />
        Rafraîchir
      </Button>
    </div>
  );

  if (loading && !data) {
    return (
      <div className="flex flex-col gap-6 p-6 md:p-8">
        {header}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" />
          Chargement du funnel…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-6 p-6 md:p-8">
        {header}
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-3 pt-6">
            <AlertCircle size={18} className="mt-0.5 text-destructive" />
            <div>
              <p className="text-sm font-medium text-foreground">Funnel indisponible</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data || data.funnel.restaurants === 0) {
    return (
      <div className="flex flex-col gap-6 p-6 md:p-8">
        {header}
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Aucun établissement n&apos;est entré dans l&apos;onboarding pour l&apos;instant. Les
              étapes apparaîtront dès le premier parcours.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { funnel, restaurants } = data;
  const waiting = restaurants.filter((row) => !row.firstReservationAt);

  return (
    <div className="flex flex-col gap-6 p-6 md:p-8">
      {header}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Établissements"
          value={String(funnel.restaurants)}
          hint={`${funnel.totalEvents} événements enregistrés`}
          icon={<Users size={16} />}
        />
        <Metric
          label="Parcours complet"
          value={`${funnel.overallCompletionRate} %`}
          hint="Étapes complétées au moins une fois"
          icon={<Route size={16} />}
        />
        <Metric
          label="Délai médian"
          value={formatHours(funnel.timeToFirstReservation.medianHours)}
          hint={`p90 ${formatHours(funnel.timeToFirstReservation.p90Hours)} · ${funnel.timeToFirstReservation.measured} mesuré(s)`}
          icon={<Timer size={16} />}
        />
        <Metric
          label="Sans réservation"
          value={String(funnel.timeToFirstReservation.pending)}
          hint={
            waiting.length > 0 && waiting[0]
              ? `Dernier signal : ${formatDate(waiting[0].lastEventAt)}`
              : 'Tous les parcours ont réservé'
          }
          icon={<AlertCircle size={16} />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Abandon par étape</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Étape</TableHead>
                <TableHead className="text-right">Entrées</TableHead>
                <TableHead className="text-right">Terminées</TableHead>
                <TableHead className="text-right">Ignorées</TableHead>
                <TableHead className="text-right">Bloquées</TableHead>
                <TableHead className="text-right">Abandonnées</TableHead>
                <TableHead className="text-right">Taux</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {funnel.steps.map((step) => (
                <TableRow key={step.step}>
                  <TableCell className="font-medium text-foreground">{step.step}</TableCell>
                  <TableCell className="text-right">{step.started}</TableCell>
                  <TableCell className="text-right">{step.completed}</TableCell>
                  <TableCell className="text-right">{step.skipped}</TableCell>
                  <TableCell className="text-right">
                    {step.blocked > 0 ? (
                      <Badge variant="destructive">{step.blocked}</Badge>
                    ) : (
                      step.blocked
                    )}
                  </TableCell>
                  <TableCell className="text-right">{step.abandoned}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {step.completionRate} %
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Établissements</CardTitle>
          <p className="text-xs text-muted-foreground">
            Triés par avancement : ceux qui n&apos;ont pas encore réservé passent en tête.
          </p>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Établissement</TableHead>
                <TableHead>Début</TableHead>
                <TableHead className="text-right">Étapes</TableHead>
                <TableHead className="text-right">Bloquées</TableHead>
                <TableHead>Première réservation</TableHead>
                <TableHead className="text-right">Délai</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {restaurants.map((row) => (
                <TableRow key={row.restaurantId}>
                  <TableCell className="font-mono text-xs text-foreground">
                    {row.restaurantId.slice(0, 8)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(row.startedAt)}
                  </TableCell>
                  <TableCell className="text-right">{row.completedSteps}</TableCell>
                  <TableCell className="text-right">
                    {row.blockedSteps > 0 ? (
                      <Badge variant="destructive">{row.blockedSteps}</Badge>
                    ) : (
                      row.blockedSteps
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.firstReservationAt ? formatDate(row.firstReservationAt) : 'En attente'}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatHours(row.hoursToFirstReservation)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
