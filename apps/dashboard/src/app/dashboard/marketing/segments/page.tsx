'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, Check, ListFilter, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi } from '@/lib/api';
import { getErrorMessage } from '@/types/api';

type SegmentField =
  | 'honored30d'
  | 'honored90d'
  | 'honored365d'
  | 'cancelled365d'
  | 'noShow365d'
  | 'covers365d'
  | 'estimatedSpend365d'
  | 'actualSpend365d'
  | 'actualLifetimeSpend'
  | 'lastHonoredAt'
  | 'nextReservationAt'
  | 'birthMonth'
  | 'birthDay'
  | 'isVip'
  | 'tag'
  | 'preference';

type SegmentOperator =
  | 'EQ'
  | 'GTE'
  | 'LTE'
  | 'IS_NULL'
  | 'BEFORE_DAYS_AGO'
  | 'AFTER_DAYS_AGO'
  | 'EXISTS';

type ConditionDraft = {
  id: string;
  field: SegmentField;
  op: SegmentOperator;
  value: string;
};

type SegmentDefinition = {
  version: 1;
  operator: 'AND' | 'OR';
  conditions: Array<
    | {
        field: SegmentField;
        op: SegmentOperator;
        value?: string | number | boolean;
      }
    | {
        operator: 'AND' | 'OR';
        conditions: Array<{
          field: SegmentField;
          op: SegmentOperator;
          value?: string | number | boolean;
        }>;
      }
  >;
};

type Segment = {
  id: string;
  name: string;
  definition: SegmentDefinition;
  isSystem: boolean;
  systemDescription?: string | null;
  lastCount: number | null;
  lastEvaluatedAt: string | null;
  updatedAt: string;
};

type Preview = {
  count: number;
  sample: Array<{ id: string; name: string | null; isVip: boolean }>;
};

const FIELD_LABELS: Record<SegmentField, string> = {
  honored30d: 'Visites honorées (30 j)',
  honored90d: 'Visites honorées (90 j)',
  honored365d: 'Visites honorées (365 j)',
  cancelled365d: 'Annulations (365 j)',
  noShow365d: 'No-show (365 j)',
  covers365d: 'Couverts (365 j)',
  estimatedSpend365d: 'Dépense estimée (365 j)',
  actualSpend365d: 'Dépense caisse (365 j)',
  actualLifetimeSpend: 'Dépense caisse cumulée',
  lastHonoredAt: 'Dernière visite',
  nextReservationAt: 'Prochaine réservation',
  birthMonth: 'Mois anniversaire',
  birthDay: 'Jour anniversaire',
  isVip: 'Statut VIP',
  tag: 'Tag',
  preference: 'Préférence',
};

const NUMERIC_FIELDS = new Set<SegmentField>([
  'honored30d',
  'honored90d',
  'honored365d',
  'cancelled365d',
  'noShow365d',
  'covers365d',
  'estimatedSpend365d',
  'actualSpend365d',
  'actualLifetimeSpend',
  'birthMonth',
  'birthDay',
]);
const DATE_FIELDS = new Set<SegmentField>(['lastHonoredAt', 'nextReservationAt']);

type SegmentTemplate = {
  key: string;
  name: string;
  description: string;
  operator: 'AND' | 'OR';
  conditions: Array<{ field: SegmentField; op: SegmentOperator; value: string }>;
};

const SEGMENT_TEMPLATES: SegmentTemplate[] = [
  {
    key: 'first-visit',
    name: 'Première visite récente',
    description: 'Une visite honorée sur les 30 derniers jours.',
    operator: 'AND',
    conditions: [{ field: 'honored30d', op: 'EQ', value: '1' }],
  },
  {
    key: 'regulars',
    name: 'Habitués',
    description: 'Au moins trois visites honorées sur un an.',
    operator: 'AND',
    conditions: [{ field: 'honored365d', op: 'GTE', value: '3' }],
  },
  {
    key: 'vip',
    name: 'VIP manuels',
    description: 'Profils marqués VIP dans Sokar.',
    operator: 'AND',
    conditions: [{ field: 'isVip', op: 'EQ', value: 'true' }],
  },
  {
    key: 'dormant',
    name: 'Dormants sans réservation',
    description: 'Dernière visite avant 90 jours et aucune réservation à venir.',
    operator: 'AND',
    conditions: [
      { field: 'lastHonoredAt', op: 'BEFORE_DAYS_AGO', value: '90' },
      { field: 'nextReservationAt', op: 'IS_NULL', value: '' },
    ],
  },
  {
    key: 'cancelled',
    name: 'Annulés à relancer',
    description: 'Une annulation sur un an sans réservation future.',
    operator: 'AND',
    conditions: [
      { field: 'cancelled365d', op: 'GTE', value: '1' },
      { field: 'nextReservationAt', op: 'IS_NULL', value: '' },
    ],
  },
  {
    key: 'no-show',
    name: 'No-show à traiter',
    description: 'Au moins un no-show sur les 365 derniers jours.',
    operator: 'AND',
    conditions: [{ field: 'noShow365d', op: 'GTE', value: '1' }],
  },
  {
    key: 'cash-value',
    name: 'Dépense caisse connue',
    description: 'Dépense encaissée réellement remontée par une caisse connectée.',
    operator: 'AND',
    conditions: [{ field: 'actualLifetimeSpend', op: 'GTE', value: '1' }],
  },
  {
    key: 'language',
    name: 'Langue renseignée',
    description: 'Une préférence de langue structurée est présente.',
    operator: 'AND',
    conditions: [{ field: 'preference', op: 'EXISTS', value: 'preferred_language' }],
  },
];

function operatorsFor(field: SegmentField): SegmentOperator[] {
  if (NUMERIC_FIELDS.has(field)) return ['EQ', 'GTE', 'LTE'];
  if (DATE_FIELDS.has(field)) return ['BEFORE_DAYS_AGO', 'AFTER_DAYS_AGO', 'IS_NULL'];
  if (field === 'isVip') return ['EQ'];
  if (field === 'tag' || field === 'preference') return ['EXISTS'];
  return ['EQ'];
}

function defaultValue(field: SegmentField): string {
  if (field === 'isVip') return 'true';
  if (field === 'tag') return 'vip';
  if (field === 'preference') return 'preferred_language';
  if (DATE_FIELDS.has(field)) return '60';
  return '1';
}

function newCondition(): ConditionDraft {
  return { id: `${Date.now()}-${Math.random()}`, field: 'honored365d', op: 'GTE', value: '1' };
}

function operatorLabel(operator: SegmentOperator): string {
  return {
    EQ: 'est égal à',
    GTE: 'est supérieur ou égal à',
    LTE: 'est inférieur ou égal à',
    IS_NULL: 'est vide',
    BEFORE_DAYS_AGO: 'avant il y a (jours)',
    AFTER_DAYS_AGO: 'après il y a (jours)',
    EXISTS: 'existe',
  }[operator];
}

function buildDefinition(operator: 'AND' | 'OR', drafts: ConditionDraft[]): SegmentDefinition {
  return {
    version: 1,
    operator,
    conditions: drafts.map((condition) => {
      const base = { field: condition.field, op: condition.op } as {
        field: SegmentField;
        op: SegmentOperator;
        value?: string | number | boolean;
      };
      if (condition.op === 'IS_NULL') return base;
      if (condition.field === 'isVip') base.value = condition.value === 'true';
      else if (NUMERIC_FIELDS.has(condition.field) || DATE_FIELDS.has(condition.field)) {
        base.value = Number(condition.value);
      } else base.value = condition.value.trim();
      return base;
    }),
  };
}

function formatDate(value: string | null): string {
  if (!value) return 'Jamais';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('fr-FR');
}

function formatConditionValue(condition: {
  field: SegmentField;
  op: SegmentOperator;
  value?: string | number | boolean;
}): string {
  if (condition.op === 'IS_NULL') return '';
  if (condition.field === 'isVip') return condition.value === true ? 'VIP' : 'hors VIP';
  if (DATE_FIELDS.has(condition.field)) return `${condition.value ?? 0} j`;
  return String(condition.value ?? '');
}

function describeDefinition(definition: SegmentDefinition): string {
  const describeNode = (
    node:
      | { field: SegmentField; op: SegmentOperator; value?: string | number | boolean }
      | {
          operator: 'AND' | 'OR';
          conditions: Array<{
            field: SegmentField;
            op: SegmentOperator;
            value?: string | number | boolean;
          }>;
        },
  ): string => {
    if ('conditions' in node) {
      const joiner = node.operator === 'AND' ? ' ET ' : ' OU ';
      return node.conditions.map(describeNode).join(joiner);
    }
    const value = formatConditionValue(node);
    return `${FIELD_LABELS[node.field]} ${operatorLabel(node.op)}${value ? ` ${value}` : ''}`;
  };
  const joiner = definition.operator === 'AND' ? ' ET ' : ' OU ';
  return definition.conditions.map(describeNode).join(joiner);
}

export default function MarketingSegmentsPage() {
  const { get, post, del, orgId } = useApi();
  const [segments, setSegments] = useState<Segment[]>([]);
  const [name, setName] = useState('Clients fidèles');
  const [groupOperator, setGroupOperator] = useState<'AND' | 'OR'>('AND');
  const [conditions, setConditions] = useState<ConditionDraft[]>([newCondition()]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadSegments = useCallback(async () => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await get<{ data: Segment[] }>('marketing/segments');
      setSegments(Array.isArray(response.data) ? response.data : []);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de charger les segments Pro'));
      setSegments([]);
    } finally {
      setLoading(false);
    }
  }, [get, orgId]);

  useEffect(() => {
    void loadSegments();
  }, [loadSegments]);

  const definition = useMemo(
    () => buildDefinition(groupOperator, conditions),
    [conditions, groupOperator],
  );

  function updateCondition(id: string, patch: Partial<ConditionDraft>) {
    setConditions((current) =>
      current.map((condition) => {
        if (condition.id !== id) return condition;
        const next = { ...condition, ...patch };
        if (patch.field && patch.field !== condition.field) {
          const operators = operatorsFor(patch.field);
          next.op = operators[0]!;
          next.value = defaultValue(patch.field);
        }
        if (patch.op === 'IS_NULL') next.value = '';
        return next;
      }),
    );
  }

  function applyTemplate(template: SegmentTemplate) {
    setName(template.name);
    setGroupOperator(template.operator);
    setConditions(
      template.conditions.map((condition, index) => ({
        ...condition,
        id: `${Date.now()}-${index}-${Math.random()}`,
      })),
    );
    setPreview(null);
    setError('');
    setNotice(`Modèle « ${template.name} » chargé.`);
  }

  async function previewSegment() {
    setAction('preview');
    setError('');
    setNotice('');
    try {
      const response = await post<Preview>('marketing/segments/preview', {
        definition,
        sampleLimit: 5,
      });
      setPreview(response);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de prévisualiser ce segment'));
    } finally {
      setAction('');
    }
  }

  async function createSegment() {
    if (!name.trim()) {
      setError('Donnez un nom au segment.');
      return;
    }
    setAction('create');
    setError('');
    setNotice('');
    try {
      const response = await post<{ data: Segment }>('marketing/segments', {
        name: name.trim(),
        definition,
      });
      if (response.data) setSegments((current) => [response.data!, ...current]);
      setNotice('Segment enregistré.');
      setPreview(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible d’enregistrer ce segment'));
    } finally {
      setAction('');
    }
  }

  async function refreshSegment(segment: Segment) {
    setAction(`refresh:${segment.id}`);
    setError('');
    try {
      const response = await post<{ data: { segment: Segment } }>(
        `marketing/segments/${segment.id}/refresh`,
      );
      if (response.data?.segment) {
        setSegments((current) =>
          current.map((item) => (item.id === segment.id ? response.data!.segment : item)),
        );
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de recalculer ce segment'));
    } finally {
      setAction('');
    }
  }

  async function deleteSegment(segment: Segment) {
    setAction(`delete:${segment.id}`);
    setError('');
    try {
      await del(`marketing/segments/${segment.id}`);
      setSegments((current) => current.filter((item) => item.id !== segment.id));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de supprimer ce segment'));
    } finally {
      setAction('');
    }
  }

  const forbidden = error.toLowerCase().includes('formule') || error.includes('CAPABILITY');

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div className="space-y-3">
          <Button asChild variant="ghost" size="sm" className="-ml-3">
            <Link href="/dashboard/marketing">
              <ArrowLeft size={16} />
              Retour au marketing
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <ListFilter className="text-primary" size={20} />
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Segments Pro</h1>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Construisez une audience expliquée avec des champs et opérateurs bornés. Le snapshot est
            recalculé avant une campagne.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void loadSegments()}
          disabled={loading}
        >
          <RefreshCw size={15} />
          Actualiser
        </Button>
      </header>

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-3 pt-6 text-sm text-destructive">
            <AlertCircle className="mt-0.5 shrink-0" size={18} />
            <div>
              <p>{error}</p>
              {forbidden ? (
                <p className="mt-2 text-muted-foreground">
                  Les segments sont inclus dans la formule Pro.
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
      {notice ? (
        <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
          <Check size={16} />
          {notice}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nouveau segment</CardTitle>
            <CardDescription>
              Les conditions sont validées par l’API avant tout enregistrement.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-border bg-muted/20 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Modèles recommandés
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Les modèles utilisent uniquement les champs disponibles ; ajustez-les avant de
                sauvegarder votre segment.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {SEGMENT_TEMPLATES.map((template) => (
                  <button
                    key={template.key}
                    type="button"
                    className="rounded-lg border border-border bg-background p-2 text-left transition-all duration-200 hover:border-primary/50 hover:bg-accent"
                    onClick={() => applyTemplate(template)}
                  >
                    <span className="block text-sm font-medium">{template.name}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {template.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px]">
              <label className="space-y-1 text-sm font-medium">
                Nom
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={100}
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Combinaison
                <select
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm font-normal"
                  value={groupOperator}
                  onChange={(event) => setGroupOperator(event.target.value as 'AND' | 'OR')}
                >
                  <option value="AND">Toutes (ET)</option>
                  <option value="OR">Au moins une (OU)</option>
                </select>
              </label>
            </div>

            <div className="space-y-3">
              {conditions.map((condition, index) => {
                const operators = operatorsFor(condition.field);
                const noValue = condition.op === 'IS_NULL';
                return (
                  <div
                    key={condition.id}
                    className="rounded-xl border border-border bg-muted/20 p-3"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Condition {index + 1}
                      </span>
                      {conditions.length > 1 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Supprimer la condition ${index + 1}`}
                          onClick={() =>
                            setConditions((current) =>
                              current.filter((item) => item.id !== condition.id),
                            )
                          }
                        >
                          <Trash2 size={15} />
                        </Button>
                      ) : null}
                    </div>
                    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
                      <select
                        aria-label={`Champ condition ${index + 1}`}
                        className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
                        value={condition.field}
                        onChange={(event) =>
                          updateCondition(condition.id, {
                            field: event.target.value as SegmentField,
                          })
                        }
                      >
                        {Object.entries(FIELD_LABELS).map(([field, label]) => (
                          <option key={field} value={field}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label={`Opérateur condition ${index + 1}`}
                        className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
                        value={condition.op}
                        onChange={(event) =>
                          updateCondition(condition.id, {
                            op: event.target.value as SegmentOperator,
                          })
                        }
                      >
                        {operators.map((operator) => (
                          <option key={operator} value={operator}>
                            {operatorLabel(operator)}
                          </option>
                        ))}
                      </select>
                      {noValue ? (
                        <div className="flex h-10 items-center rounded-lg border border-dashed border-border px-3 text-sm text-muted-foreground">
                          Aucun seuil
                        </div>
                      ) : condition.field === 'isVip' ? (
                        <select
                          aria-label={`Valeur condition ${index + 1}`}
                          className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
                          value={condition.value}
                          onChange={(event) =>
                            updateCondition(condition.id, { value: event.target.value })
                          }
                        >
                          <option value="true">VIP</option>
                          <option value="false">Hors VIP</option>
                        </select>
                      ) : (
                        <Input
                          aria-label={`Valeur condition ${index + 1}`}
                          type={
                            NUMERIC_FIELDS.has(condition.field) || DATE_FIELDS.has(condition.field)
                              ? 'number'
                              : 'text'
                          }
                          min={DATE_FIELDS.has(condition.field) ? 0 : undefined}
                          value={condition.value}
                          onChange={(event) =>
                            updateCondition(condition.id, { value: event.target.value })
                          }
                          placeholder={
                            DATE_FIELDS.has(condition.field) ? 'Nombre de jours' : 'Valeur'
                          }
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={conditions.length >= 20}
                onClick={() => setConditions((current) => [...current, newCondition()])}
              >
                <Plus size={15} />
                Ajouter une condition
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={action === 'preview'}
                  onClick={() => void previewSegment()}
                >
                  {action === 'preview' ? 'Calcul…' : 'Prévisualiser'}
                </Button>
                <Button
                  type="button"
                  disabled={action === 'create'}
                  onClick={() => void createSegment()}
                >
                  {action === 'create' ? 'Enregistrement…' : 'Enregistrer'}
                </Button>
              </div>
            </div>

            {preview ? (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
                <p className="font-medium">{preview.count} profil(s) correspondent</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Règles : {describeDefinition(definition)}
                </p>
                {preview.sample.length > 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Exemple :{' '}
                    {preview.sample.map((item) => item.name || 'Client sans nom').join(' · ')}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">Aucun profil exemple.</p>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Segments enregistrés</CardTitle>
            <CardDescription>Le nombre affiché correspond au dernier refresh.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((row) => (
                  <Skeleton key={row} className="h-16 rounded-xl" />
                ))}
              </div>
            ) : segments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun segment personnalisé.</p>
            ) : (
              <div className="space-y-3">
                {segments.map((segment) => (
                  <div key={segment.id} className="rounded-xl border border-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{segment.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {segment.lastCount ?? '—'} profil(s) · évalué{' '}
                          {formatDate(segment.lastEvaluatedAt)}
                        </p>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground/80">
                          {segment.systemDescription || describeDefinition(segment.definition)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {segment.isSystem ? <Badge variant="outline">Système</Badge> : null}
                        {segment.definition?.operator ? (
                          <Badge variant="secondary">{segment.definition.operator}</Badge>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3 flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={Boolean(action)}
                        onClick={() => void refreshSegment(segment)}
                      >
                        <RefreshCw size={14} />
                        Recalculer
                      </Button>
                      {!segment.isSystem ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={Boolean(action)}
                          onClick={() => void deleteSegment(segment)}
                        >
                          <Trash2 size={14} />
                          Supprimer
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
