'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@/lib/api';
import { getErrorMessage } from '@/types/api';
import { useIsMobile } from '@/lib/useMediaQuery';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, Check, LayoutGrid, Pencil, Plus, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ConfirmDialog';

type Section = {
  id: string;
  name: string;
  position: number;
  tables: Table[];
};

type Table = {
  id: string;
  name: string;
  capacity: number;
  minCapacity: number;
  isActive: boolean;
  positionX: number | null;
  positionY: number | null;
  shape: string | null;
};

type FloorPlan = {
  id: string;
  name: string | null;
  sections: Section[];
};

export function FloorPlanCrud() {
  const { get, patch, put, post, del, orgId } = useApi();
  const isMobile = useIsMobile();

  const [floorPlan, setFloorPlan] = useState<FloorPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newSectionName, setNewSectionName] = useState('');
  const [newTable, setNewTable] = useState<{
    sectionId: string;
    name: string;
    capacity: string;
  }>({ sectionId: '', name: '', capacity: '' });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDeleteTableId, setPendingDeleteTableId] = useState<string | null>(null);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [confirmSectionOpen, setConfirmSectionOpen] = useState(false);
  const [pendingDeleteSectionId, setPendingDeleteSectionId] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;

    async function fetchFloorPlan() {
      try {
        const data = await get<FloorPlan>(`restaurants/${orgId}/floor-plan`);
        setFloorPlan(data);
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Impossible de charger le plan de salle'));
      } finally {
        setLoading(false);
      }
    }

    fetchFloorPlan();
  }, [orgId, get]);

  async function toggleTable(tableId: string, isActive: boolean) {
    if (!orgId) return;
    const previousIsActive =
      floorPlan?.sections.flatMap((section) => section.tables).find((table) => table.id === tableId)
        ?.isActive ?? !isActive;
    try {
      setError('');
      setFloorPlan((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          sections: prev.sections.map((section) => ({
            ...section,
            tables: section.tables.map((table) =>
              table.id === tableId ? { ...table, isActive } : table,
            ),
          })),
        };
      });
      await patch(`restaurants/${orgId}/floor-plan/tables/${tableId}`, { isActive });
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de modifier la table'));
      setFloorPlan((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          sections: prev.sections.map((section) => ({
            ...section,
            tables: section.tables.map((table) =>
              table.id === tableId ? { ...table, isActive: previousIsActive } : table,
            ),
          })),
        };
      });
    }
  }

  async function createSection(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId || !newSectionName.trim()) return;
    try {
      setError('');
      const section = await post<Section>(`restaurants/${orgId}/floor-plan/sections`, {
        name: newSectionName.trim(),
      });
      setFloorPlan((prev) => {
        if (!prev) return prev;
        return { ...prev, sections: [...prev.sections, { ...section, tables: [] }] };
      });
      setNewSectionName('');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de créer la section'));
    }
  }

  async function createTable(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId || !newTable.sectionId || !newTable.name.trim() || !newTable.capacity) return;
    try {
      setError('');
      const table = await post<Table>(`restaurants/${orgId}/floor-plan/tables`, {
        sectionId: newTable.sectionId,
        name: newTable.name.trim(),
        capacity: Number(newTable.capacity),
      });
      setFloorPlan((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          sections: prev.sections.map((section) =>
            section.id === newTable.sectionId
              ? { ...section, tables: [...section.tables, table] }
              : section,
          ),
        };
      });
      setNewTable({ sectionId: '', name: '', capacity: '' });
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de créer la table'));
    }
  }

  async function deleteTable(tableId: string) {
    if (!orgId) return;
    setPendingDeleteTableId(tableId);
    setConfirmOpen(true);
  }

  async function confirmDeleteTable() {
    const tableId = pendingDeleteTableId;
    if (!orgId || !tableId) return;
    setConfirmOpen(false);
    setPendingDeleteTableId(null);
    try {
      setError('');
      await del(`restaurants/${orgId}/floor-plan/tables/${tableId}`);
      setFloorPlan((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          sections: prev.sections.map((section) => ({
            ...section,
            tables: section.tables.filter((table) => table.id !== tableId),
          })),
        };
      });
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de supprimer la table'));
    }
  }

  function startSectionEdit(section: Section) {
    setEditingSectionId(section.id);
    setEditingName(section.name);
  }

  function cancelSectionEdit() {
    setEditingSectionId(null);
    setEditingName('');
  }

  async function saveSectionName(sectionId: string) {
    if (!orgId || !editingName.trim()) return;
    try {
      setError('');
      const updated = await put<Section>(`restaurants/${orgId}/floor-plan/sections/${sectionId}`, {
        name: editingName.trim(),
      });
      setFloorPlan((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          sections: prev.sections.map((section) =>
            section.id === sectionId
              ? { ...section, ...updated, tables: updated.tables ?? section.tables }
              : section,
          ),
        };
      });
      cancelSectionEdit();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de renommer la section'));
      const originalName = floorPlan?.sections.find((section) => section.id === sectionId)?.name;
      if (originalName) setEditingName(originalName);
    }
  }

  async function deleteSection(sectionId: string) {
    setPendingDeleteSectionId(sectionId);
    setConfirmSectionOpen(true);
  }

  async function confirmDeleteSection() {
    const sectionId = pendingDeleteSectionId;
    if (!orgId || !sectionId) return;
    setConfirmSectionOpen(false);
    setPendingDeleteSectionId(null);
    try {
      setError('');
      await del(`restaurants/${orgId}/floor-plan/sections/${sectionId}`);
      setFloorPlan((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          sections: prev.sections.filter((section) => section.id !== sectionId),
        };
      });
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de supprimer la section'));
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-40 rounded-full" />
          <Skeleton className="h-10 w-32 rounded-lg" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <LayoutGrid className="h-6 w-6 text-primary" />
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Plan de salle</h1>
        </div>
        <form onSubmit={createSection} className="flex items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="sectionName" className="text-xs text-muted-foreground">
              Nouvelle section
            </Label>
            <Input
              id="sectionName"
              value={newSectionName}
              onChange={(e) => setNewSectionName(e.target.value)}
              placeholder="Ex. : Salle principale"
              className="h-10 bg-card border-border"
            />
          </div>
          <Button type="submit" disabled={!newSectionName.trim()} size="sm">
            <Plus size={16} className="mr-1" />
            Ajouter
          </Button>
        </form>
      </div>

      {error ? (
        <div className="sokar-error">
          <AlertCircle size={18} />
          {error}
        </div>
      ) : null}

      {floorPlan?.sections.length === 0 ? (
        <div className="sokar-empty">
          <LayoutGrid size={40} className="opacity-30" />
          <p className="text-sm">Aucune section dans votre plan de salle</p>
          <p className="text-xs opacity-60">
            Créez une section, puis ajoutez vos tables pour commencer.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {floorPlan?.sections.map((section) => (
            <Card key={section.id} className="sokar-card" data-testid="section-card">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
                {editingSectionId === section.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void saveSectionName(section.id);
                    }}
                    className="flex flex-1 items-center gap-2"
                  >
                    <Label htmlFor={`section-name-${section.id}`} className="sr-only">
                      Nom de la section
                    </Label>
                    <Input
                      id={`section-name-${section.id}`}
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="h-9 flex-1 bg-card border-border"
                      autoFocus
                    />
                    <Button
                      type="submit"
                      size="icon"
                      disabled={!editingName.trim()}
                      className="transition-all duration-200"
                    >
                      <Check size={16} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={cancelSectionEdit}
                      className="transition-all duration-200"
                    >
                      <X size={16} />
                    </Button>
                  </form>
                ) : (
                  <>
                    <CardTitle className="text-base font-medium">{section.name}</CardTitle>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => startSectionEdit(section)}
                        className="h-8 w-8 text-muted-foreground hover:text-primary transition-all duration-200"
                        title="Renommer la section"
                        aria-label="Renommer la section"
                      >
                        <Pencil size={16} />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteSection(section.id)}
                        className="h-8 w-8 text-muted-foreground hover:text-destructive transition-all duration-200"
                        title="Supprimer la section"
                        aria-label="Supprimer la section"
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  {section.tables.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Aucune table</p>
                  ) : (
                    section.tables.map((table) => (
                      <div
                        key={table.id}
                        className={cn(
                          'flex items-center justify-between rounded-lg border p-3 transition-all duration-200',
                          table.isActive
                            ? 'border-border bg-card'
                            : 'border-border bg-muted opacity-60',
                        )}
                      >
                        <div>
                          <p className="font-medium">{table.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {table.capacity} couvert{table.capacity > 1 ? 's' : ''}
                            {table.minCapacity > 1 && ` (min. ${table.minCapacity})`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={table.isActive}
                            onCheckedChange={(checked) => toggleTable(table.id, checked)}
                            aria-label={`Activer ${table.name}`}
                          />
                          <button
                            onClick={() => deleteTable(table.id)}
                            className="p-2 text-muted-foreground hover:text-destructive rounded-lg hover:bg-accent transition-all duration-200"
                            title="Supprimer la table"
                            aria-label="Supprimer la table"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <form
                  onSubmit={createTable}
                  className="flex items-end gap-2 pt-2 border-t border-border"
                >
                  <input type="hidden" value={section.id} />
                  <div className={cn('space-y-1.5', isMobile ? 'flex-1' : 'w-32')}>
                    <Label
                      htmlFor={`table-name-${section.id}`}
                      className="text-xs text-muted-foreground"
                    >
                      Table
                    </Label>
                    <Input
                      id={`table-name-${section.id}`}
                      value={newTable.sectionId === section.id ? newTable.name : ''}
                      onChange={(e) =>
                        setNewTable({
                          sectionId: section.id,
                          name: e.target.value,
                          capacity: newTable.capacity,
                        })
                      }
                      placeholder="Ex. : T1"
                      className="h-9 bg-card border-border"
                    />
                  </div>
                  <div className="w-20 space-y-1.5">
                    <Label
                      htmlFor={`table-capacity-${section.id}`}
                      className="text-xs text-muted-foreground"
                    >
                      Couv.
                    </Label>
                    <Input
                      id={`table-capacity-${section.id}`}
                      type="number"
                      min={1}
                      value={newTable.sectionId === section.id ? newTable.capacity : ''}
                      onChange={(e) =>
                        setNewTable({
                          sectionId: section.id,
                          name: newTable.name,
                          capacity: e.target.value,
                        })
                      }
                      placeholder="2"
                      className="h-9 bg-card border-border"
                    />
                  </div>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={
                      newTable.sectionId !== section.id ||
                      !newTable.name.trim() ||
                      !newTable.capacity
                    }
                    className="h-9"
                  >
                    <Plus size={16} />
                  </Button>
                </form>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onConfirm={confirmDeleteTable}
        onCancel={() => {
          setConfirmOpen(false);
          setPendingDeleteTableId(null);
        }}
        title="Supprimer la table"
        description="Êtes-vous sûr de vouloir supprimer cette table ? Cette action est irréversible."
        confirmLabel="Supprimer"
        variant="destructive"
      />

      <ConfirmDialog
        open={confirmSectionOpen}
        onConfirm={confirmDeleteSection}
        onCancel={() => {
          setConfirmSectionOpen(false);
          setPendingDeleteSectionId(null);
        }}
        title="Supprimer la section"
        description="Êtes-vous sûr de vouloir supprimer cette section ? Les tables associées ne seront pas supprimées, mais ne seront plus rattachées à une section."
        confirmLabel="Supprimer"
        variant="destructive"
      />
    </div>
  );
}
