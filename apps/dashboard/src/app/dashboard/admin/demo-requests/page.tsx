'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';

type DemoRequestStatus = 'NEW' | 'CONTACTED' | 'DEMO_DONE' | 'CLOSED';
type StatusFilter = DemoRequestStatus | 'ALL';

interface DemoRequestRow {
  id: string;
  establishmentName: string;
  contactEmail: string;
  contactPhone: string | null;
  currentTool: string | null;
  mainProblem: string | null;
  status: DemoRequestStatus;
  notifiedAt: string | null;
  createdAt: string;
}

const STATUS_LABELS: Record<DemoRequestStatus, string> = {
  NEW: 'Nouvelle',
  CONTACTED: 'Contactée',
  DEMO_DONE: 'Démo faite',
  CLOSED: 'Clôturée',
};

const FILTER_LABELS: Record<StatusFilter, string> = {
  ALL: 'Toutes',
  ...STATUS_LABELS,
};

const FILTERS = Object.keys(FILTER_LABELS) as StatusFilter[];

function formatDate(value: string) {
  return new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Suivi opérateur des demandes de démonstration. Les coordonnées ne sont visibles qu'aux
 * opérateurs Sokar : l'API les refuse aux autres comptes.
 */
export default function DemoRequestsPage() {
  const { get, patch } = useApi();
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [rows, setRows] = useState<DemoRequestRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const query = filter === 'ALL' ? '' : `?status=${filter}`;
      const response = await get<{ data: DemoRequestRow[] }>(`/admin/demo-requests${query}`);
      setRows(response.data);
    } catch {
      setLoadFailed(true);
    }
  }, [filter, get]);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateStatus(id: string, status: DemoRequestStatus) {
    setSavingId(id);
    setSaveFailed(false);
    try {
      const response = await patch<{ data: DemoRequestRow }>(`/admin/demo-requests/${id}`, {
        status,
      });
      setRows(
        (current) =>
          current?.map((row) => (row.id === id ? { ...row, ...response.data } : row)) ?? current,
      );
    } catch {
      setSaveFailed(true);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6 md:p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Demandes de démonstration
        </h1>
        <p className="text-sm text-muted-foreground">
          Prospects issus de la vitrine. Les coordonnées sont réservées à l’équipe Sokar.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((option) => (
          <Button
            key={option}
            type="button"
            variant={filter === option ? 'default' : 'outline'}
            size="sm"
            aria-pressed={filter === option}
            onClick={() => setFilter(option)}
            className="transition-all duration-200"
          >
            {FILTER_LABELS[option]}
          </Button>
        ))}
      </div>

      {saveFailed && (
        <p role="alert" className="text-sm text-destructive">
          Le statut n’a pas pu être enregistré. Réessayez dans un instant.
        </p>
      )}

      {loadFailed ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-2xl border border-border p-6"
        >
          <p className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle size={16} aria-hidden="true" />
            Impossible de charger les demandes.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            Réessayer
          </Button>
        </div>
      ) : rows === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          Chargement des demandes…
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune demande pour ce filtre.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 md:flex-row md:items-start md:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <p className="font-semibold text-foreground">{row.establishmentName}</p>
                <p className="break-all text-sm text-muted-foreground">
                  {row.contactEmail}
                  {row.contactPhone ? ` · ${row.contactPhone}` : ''}
                </p>
                {row.currentTool && (
                  <p className="text-sm text-muted-foreground">Outil actuel : {row.currentTool}</p>
                )}
                {row.mainProblem && (
                  <p className="text-sm text-muted-foreground">Problème : {row.mainProblem}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Reçue le {formatDate(row.createdAt)} ·{' '}
                  <span className={cn(row.notifiedAt ? 'text-foreground' : 'text-destructive')}>
                    {row.notifiedAt ? 'Notifiée' : 'Notification non envoyée'}
                  </span>
                </p>
              </div>
              <select
                aria-label={`Statut de ${row.establishmentName}`}
                value={row.status}
                disabled={savingId === row.id}
                onChange={(event) =>
                  void updateStatus(row.id, event.target.value as DemoRequestStatus)
                }
                className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground transition-all duration-200 disabled:opacity-60"
              >
                {(Object.keys(STATUS_LABELS) as DemoRequestStatus[]).map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
