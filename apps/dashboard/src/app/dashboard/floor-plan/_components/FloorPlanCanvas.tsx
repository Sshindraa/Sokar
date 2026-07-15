'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '@/lib/api';
import {
  getErrorMessage,
  type FloorPlan,
  type FloorPlanTable,
  type PlanningReservation,
  type TableShape,
} from '@/types/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  format,
  parseISO,
  isWithinInterval,
  isAfter,
  isSameDay,
  differenceInMinutes,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  AlertCircle,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Grid3x3,
  Magnet,
  Activity,
  Plus,
  Trash2,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
  useDraggable,
} from '@dnd-kit/core';

const CANVAS_WIDTH = 1400;
const CANVAS_HEIGHT = 900;
const GRID_SIZE = 16;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.1;

type TableStatus = 'free' | 'occupied' | 'upcoming' | 'inactive';

type CanvasTable = FloorPlanTable & {
  sectionName?: string | null;
};

type TableForm = {
  name: string;
  capacity: string;
  minCapacity: string;
  shape: TableShape;
  sectionId: string;
  isActive: boolean;
};

type DragStartInfo = {
  tableId: string;
  originalX: number;
  originalY: number;
  width: number;
  height: number;
  table: CanvasTable;
};

function getTableSize(table: { capacity: number; shape: TableShape | null }): {
  width: number;
  height: number;
} {
  const base = 80;
  const extra = Math.min(table.capacity, 12) * 12;
  const size = Math.min(base + extra, 220);
  const width = size;
  const height = table.shape === 'round' ? size : 80;
  return { width, height };
}

const statusClasses: Record<TableStatus, string> = {
  free: 'bg-primary/20 border-primary text-foreground',
  occupied: 'bg-destructive/20 border-destructive text-foreground',
  upcoming: 'bg-accent/20 border-accent text-foreground',
  inactive: 'bg-muted border-border text-muted-foreground opacity-60',
};

function getTableStatus(
  table: FloorPlanTable,
  reservations: PlanningReservation[],
  now: Date,
): { status: TableStatus; reservation: PlanningReservation | null } {
  if (!table.isActive) {
    return { status: 'inactive', reservation: null };
  }

  const tableRes = reservations.filter(
    (r) => r.tableId === table.id && !['CANCELLED', 'NO_SHOW'].includes(r.state),
  );

  const current = tableRes.find((r) => {
    const start = parseISO(r.startsAt);
    const end = parseISO(r.endsAt);
    return isWithinInterval(now, { start, end }) && ['SEATED', 'CONFIRMED'].includes(r.state);
  });

  if (current) {
    return { status: 'occupied', reservation: current };
  }

  const upcoming = tableRes.find((r) => {
    const start = parseISO(r.startsAt);
    const diff = differenceInMinutes(start, now);
    return (
      isAfter(start, now) &&
      (isSameDay(start, now) || diff <= 60) &&
      (diff <= 60 || ['PENDING', 'CONFIRMED'].includes(r.state))
    );
  });

  if (upcoming) {
    return { status: 'upcoming', reservation: upcoming };
  }

  return { status: 'free', reservation: null };
}

function formatReservationBadge(reservation: PlanningReservation): string {
  const start = parseISO(reservation.startsAt);
  return `${reservation.customerName || 'Sans nom'} · ${reservation.partySize} · ${format(start, 'HH:mm', { locale: fr })}`;
}

function findNextPosition(
  width: number,
  height: number,
  existing: CanvasTable[],
): { x: number; y: number } {
  const startX = 400;
  const startY = 300;
  const step = GRID_SIZE;

  for (let y = startY; y <= CANVAS_HEIGHT - height; y += step) {
    for (let x = startX; x <= CANVAS_WIDTH - width; x += step) {
      const hasOverlap = existing.some((t) => {
        const { width: tw, height: th } = getTableSize(t);
        const tx = t.positionX ?? 0;
        const ty = t.positionY ?? 0;
        return x < tx + tw && x + width > tx && y < ty + th && y + height > ty;
      });
      if (!hasOverlap) {
        return { x: Math.round(x), y: Math.round(y) };
      }
    }
  }

  return { x: startX, y: startY };
}

function replaceTable(floorPlan: FloorPlan, updated: FloorPlanTable): FloorPlan {
  const id = updated.id;
  const targetSectionId = updated.sectionId ?? null;
  let placed = false;

  const sections = floorPlan.sections.map((section) => {
    const tables = section.tables.filter((t) => t.id !== id);
    if (section.id === targetSectionId) {
      placed = true;
      return {
        ...section,
        tables: [
          ...tables,
          { ...updated, sectionId: section.id, sectionName: section.name } as FloorPlanTable,
        ],
      };
    }
    return { ...section, tables };
  });

  const topTables = (floorPlan.tables ?? []).filter((t) => t.id !== id);
  if (targetSectionId === null || targetSectionId === undefined) {
    return { ...floorPlan, sections, tables: [...topTables, updated] };
  }

  return { ...floorPlan, sections, tables: topTables };
}

function removeTable(floorPlan: FloorPlan, tableId: string): FloorPlan {
  return {
    ...floorPlan,
    sections: floorPlan.sections.map((section) => ({
      ...section,
      tables: section.tables.filter((t) => t.id !== tableId),
    })),
    tables: (floorPlan.tables ?? []).filter((t) => t.id !== tableId),
  };
}

function replaceTablePosition(
  floorPlan: FloorPlan,
  tableId: string,
  positionX: number,
  positionY: number,
): FloorPlan {
  return {
    ...floorPlan,
    sections: floorPlan.sections.map((section) => ({
      ...section,
      tables: section.tables.map((t) => (t.id === tableId ? { ...t, positionX, positionY } : t)),
    })),
    tables: (floorPlan.tables ?? []).map((t) =>
      t.id === tableId ? { ...t, positionX, positionY } : t,
    ),
  };
}

type TableCardProps = {
  table: CanvasTable;
  status?: { status: TableStatus; reservation: PlanningReservation | null };
  onClick?: () => void;
  dragRef?: React.Ref<HTMLDivElement>;
  dragProps?: React.HTMLAttributes<HTMLDivElement>;
  isOverlay?: boolean;
  style?: React.CSSProperties;
  className?: string;
};

function TableCard({
  table,
  status,
  onClick,
  dragRef,
  dragProps,
  isOverlay,
  style,
  className,
}: TableCardProps) {
  const { width, height } = getTableSize(table);
  const title = status?.reservation
    ? formatReservationBadge(status.reservation)
    : `${table.name} · ${table.capacity} couverts`;

  return (
    <div
      ref={dragRef}
      className={cn(
        'box-border flex flex-col items-center justify-center border p-2 text-center transition-all duration-200 select-none',
        table.shape === 'round' ? 'rounded-full aspect-square' : 'rounded-md',
        'hover:ring-2 hover:ring-ring hover:ring-offset-1',
        status ? statusClasses[status.status] : 'bg-card border-border text-foreground',
        !isOverlay && 'absolute',
        className,
      )}
      style={{ width, height, ...style }}
      onClick={onClick}
      title={title}
      {...dragProps}
    >
      <p className="w-full truncate text-xs font-medium">{table.name}</p>
      <p className="text-[10px] text-muted-foreground">{table.capacity} couverts</p>
      {table.sectionName ? (
        <p className="w-full truncate text-[10px] text-muted-foreground">{table.sectionName}</p>
      ) : null}
      {status?.reservation && !isOverlay ? (
        <Badge variant="outline" className="mt-1 px-1 py-0 text-[10px]">
          {formatReservationBadge(status.reservation)}
        </Badge>
      ) : null}
    </div>
  );
}

type DraggableTableProps = {
  table: CanvasTable;
  status?: { status: TableStatus; reservation: PlanningReservation | null };
  onClick: () => void;
  style?: React.CSSProperties;
};

function DraggableTable({ table, status, onClick, style }: DraggableTableProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: table.id,
    data: { table },
  });

  return (
    <TableCard
      table={table}
      status={status}
      onClick={onClick}
      dragRef={setNodeRef as React.Ref<HTMLDivElement>}
      dragProps={{ ...attributes, ...listeners }}
      className={cn(isDragging && 'opacity-0')}
      style={style}
    />
  );
}

export function FloorPlanCanvas({ orgId }: { orgId: string }) {
  const { get, post, patch, del } = useApi();

  const [floorPlan, setFloorPlan] = useState<FloorPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [zoom, setZoom] = useState(1);
  const [gridVisible, setGridVisible] = useState(true);
  const [snap, setSnap] = useState(true);
  const [live, setLive] = useState(false);
  const [liveDate, setLiveDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [reservations, setReservations] = useState<PlanningReservation[]>([]);

  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState<DragStartInfo | null>(null);
  const justDraggedRef = useRef(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTable, setEditingTable] = useState<CanvasTable | null>(null);
  const [form, setForm] = useState<TableForm>({
    name: '',
    capacity: '4',
    minCapacity: '1',
    shape: 'rect',
    sectionId: '',
    isActive: true,
  });

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDeleteTableId, setPendingDeleteTableId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const loadFloorPlan = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await get<FloorPlan>(`restaurants/${orgId}/floor-plan`);
      setFloorPlan(data);
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de charger le plan de salle'));
    } finally {
      setLoading(false);
    }
  }, [orgId, get]);

  const loadReservations = useCallback(async () => {
    if (!live) return;
    setError('');
    try {
      const data = await get<PlanningReservation[]>(
        `restaurants/${orgId}/floor-plan/reservations?date=${liveDate}`,
      );
      setReservations(data);
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de charger les réservations'));
    }
  }, [orgId, live, liveDate, get]);

  useEffect(() => {
    if (!orgId) return;
    loadFloorPlan();
  }, [orgId, loadFloorPlan]);

  useEffect(() => {
    if (!orgId || !live) return;
    loadReservations();
  }, [orgId, live, liveDate, loadReservations]);

  const allTables = useMemo<CanvasTable[]>(() => {
    if (!floorPlan) return [];
    const sectionTables = floorPlan.sections.flatMap((section) =>
      section.tables.map((table) => ({
        ...table,
        sectionId: section.id,
        sectionName: section.name,
      })),
    );
    const topTables = (floorPlan.tables ?? []).map((table) => ({
      ...table,
      sectionName: table.sectionName ?? null,
    }));
    return [...sectionTables, ...topTables];
  }, [floorPlan]);

  const tableStatuses = useMemo(() => {
    const map = new Map<string, { status: TableStatus; reservation: PlanningReservation | null }>();
    if (!live) return map;
    const now = new Date();
    for (const table of allTables) {
      map.set(table.id, getTableStatus(table, reservations, now));
    }
    return map;
  }, [live, allTables, reservations]);

  function openCreateDialog() {
    setEditingTable(null);
    setForm({
      name: 'Nouvelle table',
      capacity: '4',
      minCapacity: '1',
      shape: 'rect',
      sectionId: floorPlan?.sections[0]?.id ?? '',
      isActive: true,
    });
    setDialogOpen(true);
  }

  function openEditDialog(table: CanvasTable) {
    setEditingTable(table);
    setForm({
      name: table.name,
      capacity: String(table.capacity),
      minCapacity: String(table.minCapacity),
      shape: table.shape ?? 'rect',
      sectionId: table.sectionId ?? '',
      isActive: table.isActive,
    });
    setDialogOpen(true);
  }

  function handleTableClick(table: CanvasTable) {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    openEditDialog(table);
  }

  async function handleSubmitTable(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId || !form.name.trim()) return;

    const capacity = Number(form.capacity);
    const minCapacity = Number(form.minCapacity);
    if (Number.isNaN(capacity) || capacity < 1) {
      setError('La capacité doit être un nombre positif');
      return;
    }
    if (Number.isNaN(minCapacity) || minCapacity < 1) {
      setError('La capacité minimale doit être un nombre positif');
      return;
    }

    setError('');

    try {
      if (editingTable) {
        const updated = await patch<FloorPlanTable>(
          `restaurants/${orgId}/floor-plan/tables/${editingTable.id}`,
          {
            sectionId: form.sectionId || null,
            name: form.name.trim(),
            capacity,
            minCapacity,
            shape: form.shape,
            isActive: form.isActive,
          },
        );
        setFloorPlan((prev) => (prev ? replaceTable(prev, updated) : prev));
      } else {
        const { width, height } = getTableSize({
          capacity,
          shape: form.shape,
        } as FloorPlanTable);
        const { x, y } = findNextPosition(width, height, allTables);
        const created = await post<FloorPlanTable>(`restaurants/${orgId}/floor-plan/tables`, {
          sectionId: form.sectionId || null,
          name: form.name.trim(),
          capacity,
          minCapacity,
          shape: form.shape,
          positionX: x,
          positionY: y,
        });
        setFloorPlan((prev) => (prev ? replaceTable(prev, created) : prev));
      }
      setDialogOpen(false);
      setEditingTable(null);
    } catch (err) {
      setError(getErrorMessage(err, "Impossible d'enregistrer la table"));
    }
  }

  async function confirmDeleteTable() {
    const tableId = pendingDeleteTableId;
    if (!orgId || !tableId) return;
    setConfirmOpen(false);
    setPendingDeleteTableId(null);
    try {
      setError('');
      await del(`restaurants/${orgId}/floor-plan/tables/${tableId}`);
      setFloorPlan((prev) => (prev ? removeTable(prev, tableId) : prev));
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de supprimer la table'));
    }
  }

  function handleDragStart(event: DragStartEvent) {
    justDraggedRef.current = true;
    setActiveDragId(event.active.id as string);
    const table = allTables.find((t) => t.id === event.active.id);
    if (table) {
      const { width, height } = getTableSize(table);
      setDragStart({
        tableId: table.id,
        originalX: table.positionX ?? 0,
        originalY: table.positionY ?? 0,
        width,
        height,
        table,
      });
    }
  }

  function handleDragCancel() {
    setActiveDragId(null);
    setDragStart(null);
    setTimeout(() => {
      justDraggedRef.current = false;
    }, 0);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const start = dragStart;
    setActiveDragId(null);
    setDragStart(null);
    setTimeout(() => {
      justDraggedRef.current = false;
    }, 0);

    if (!start || !orgId) return;

    const { delta } = event;
    const newX = start.originalX + delta.x / zoom;
    const newY = start.originalY + delta.y / zoom;

    const grid = snap ? GRID_SIZE : 1;
    const snappedX = Math.round(newX / grid) * grid;
    const snappedY = Math.round(newY / grid) * grid;

    const clampedX = Math.max(0, Math.min(CANVAS_WIDTH - start.width, snappedX));
    const clampedY = Math.max(0, Math.min(CANVAS_HEIGHT - start.height, snappedY));

    setFloorPlan((prev) =>
      prev ? replaceTablePosition(prev, start.tableId, clampedX, clampedY) : prev,
    );

    try {
      setError('');
      const updated = await patch<FloorPlanTable>(
        `restaurants/${orgId}/floor-plan/tables/${start.tableId}`,
        {
          positionX: clampedX,
          positionY: clampedY,
        },
      );
      setFloorPlan((prev) => (prev ? replaceTable(prev, updated) : prev));
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de déplacer la table'));
      setFloorPlan((prev) =>
        prev ? replaceTablePosition(prev, start.tableId, start.originalX, start.originalY) : prev,
      );
    }
  }

  if (loading) {
    return (
      <Card className="sokar-card">
        <CardHeader className="p-4">
          <Skeleton className="h-6 w-32 rounded-md" />
        </CardHeader>
        <CardContent className="p-0 overflow-hidden h-[600px]">
          <Skeleton className="h-full w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error && !floorPlan) {
    return (
      <Card className="sokar-card">
        <CardContent className="p-6">
          <div className="sokar-error">
            <AlertCircle size={18} />
            {error}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (allTables.length === 0) {
    return (
      <Card className="sokar-card">
        <CardHeader className="p-4 border-b border-border flex flex-row items-center justify-between">
          <CardTitle className="text-base font-medium">Plan 2D</CardTitle>
          <Button size="sm" onClick={openCreateDialog}>
            <Plus size={16} className="mr-1" />
            Ajouter une table
          </Button>
        </CardHeader>
        <CardContent className="p-0 h-[600px]">
          <div className="sokar-empty h-full">
            <p className="text-sm">Aucune table dans votre plan 2D</p>
            <p className="text-xs opacity-60">Ajoutez une table pour commencer.</p>
            <Button size="sm" className="mt-4" onClick={openCreateDialog}>
              <Plus size={16} className="mr-1" />
              Ajouter une table
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const activeDragTable = activeDragId ? allTables.find((t) => t.id === activeDragId) : null;

  return (
    <Card className="sokar-card">
      <CardHeader className="p-4 border-b border-border flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base font-medium">Plan 2D</CardTitle>
          {live ? <Badge variant="outline">Live</Badge> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            title="Zoom avant"
            onClick={() =>
              setZoom((z) => Math.min(MAX_ZOOM, Math.round((z + ZOOM_STEP) * 10) / 10))
            }
          >
            <ZoomIn size={16} />
          </Button>
          <span className="text-xs text-muted-foreground min-w-[3ch] text-center">
            {zoom.toFixed(1)}x
          </span>
          <Button
            variant="outline"
            size="sm"
            title="Zoom arrière"
            onClick={() =>
              setZoom((z) => Math.max(MIN_ZOOM, Math.round((z - ZOOM_STEP) * 10) / 10))
            }
          >
            <ZoomOut size={16} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            title="Réinitialiser le zoom"
            onClick={() => setZoom(1)}
          >
            <RotateCcw size={16} />
          </Button>
          <Button
            variant={gridVisible ? 'default' : 'outline'}
            size="sm"
            title="Afficher/masquer la grille"
            onClick={() => setGridVisible((v) => !v)}
          >
            <Grid3x3 size={16} />
          </Button>
          <Button
            variant={snap ? 'default' : 'outline'}
            size="sm"
            title="Activer/désactiver l'aimantation"
            onClick={() => setSnap((s) => !s)}
          >
            <Magnet size={16} />
          </Button>
          <Button
            variant={live ? 'default' : 'outline'}
            size="sm"
            title="Mode live"
            onClick={() => setLive((l) => !l)}
          >
            <Activity size={16} />
          </Button>
          {live ? (
            <Input
              type="date"
              value={liveDate}
              onChange={(e) => setLiveDate(e.target.value)}
              className="w-40 bg-card border-border"
            />
          ) : null}
          <Button size="sm" onClick={openCreateDialog}>
            <Plus size={16} className="mr-1" />
            Ajouter une table
          </Button>
        </div>
      </CardHeader>

      {error ? (
        <div className="sokar-error m-4 text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      ) : null}

      <CardContent className="p-0 overflow-hidden h-[600px]">
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div className="relative overflow-auto bg-muted h-full">
            <div
              className="absolute origin-top-left bg-muted"
              style={{
                width: CANVAS_WIDTH,
                height: CANVAS_HEIGHT,
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
                backgroundImage: gridVisible
                  ? `linear-gradient(to right, hsl(var(--border) / 0.5) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--border) / 0.5) 1px, transparent 1px)`
                  : undefined,
                backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
              }}
            >
              {allTables.map((table) => {
                const { width, height } = getTableSize(table);
                const status = live ? tableStatuses.get(table.id) : undefined;
                return (
                  <DraggableTable
                    key={table.id}
                    table={table}
                    status={status}
                    onClick={() => handleTableClick(table)}
                    style={{
                      left: table.positionX ?? 0,
                      top: table.positionY ?? 0,
                      width,
                      height,
                      position: 'absolute',
                    }}
                  />
                );
              })}
            </div>
          </div>
          <DragOverlay>
            {activeDragTable ? (
              <TableCard
                table={activeDragTable}
                status={live ? tableStatuses.get(activeDragTable.id) : undefined}
                isOverlay
                style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      </CardContent>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDialogOpen(false);
            setEditingTable(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingTable ? 'Modifier la table' : 'Ajouter une table'}</DialogTitle>
            <DialogDescription>
              {editingTable
                ? 'Modifiez les informations de la table.'
                : 'Créez une nouvelle table sur le plan 2D.'}
            </DialogDescription>
          </DialogHeader>

          <form id="table-form" onSubmit={handleSubmitTable} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="table-name">Nom</Label>
              <Input
                id="table-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="bg-card border-border"
                placeholder="Ex. Table 1"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="table-capacity">Capacité</Label>
                <Input
                  id="table-capacity"
                  type="number"
                  min={1}
                  value={form.capacity}
                  onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))}
                  className="bg-card border-border"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="table-min-capacity">Min.</Label>
                <Input
                  id="table-min-capacity"
                  type="number"
                  min={1}
                  value={form.minCapacity}
                  onChange={(e) => setForm((f) => ({ ...f, minCapacity: e.target.value }))}
                  className="bg-card border-border"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="table-shape">Forme</Label>
                <Select
                  value={form.shape}
                  onValueChange={(value) => setForm((f) => ({ ...f, shape: value as TableShape }))}
                >
                  <SelectTrigger id="table-shape" className="bg-card border-border">
                    <SelectValue placeholder="Forme" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rect">Rectangle</SelectItem>
                    <SelectItem value="round">Rond</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="table-section">Section</Label>
                <Select
                  value={form.sectionId}
                  onValueChange={(value) => setForm((f) => ({ ...f, sectionId: value }))}
                >
                  <SelectTrigger id="table-section" className="bg-card border-border">
                    <SelectValue placeholder="Section" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Aucune section</SelectItem>
                    {floorPlan?.sections.map((section) => (
                      <SelectItem key={section.id} value={section.id}>
                        {section.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Switch
                id="table-active"
                checked={form.isActive}
                onCheckedChange={(checked) => setForm((f) => ({ ...f, isActive: checked }))}
              />
              <Label htmlFor="table-active" className="text-sm text-muted-foreground">
                Table active
              </Label>
            </div>
          </form>

          <DialogFooter className="gap-2 sm:gap-2">
            {editingTable ? (
              <Button
                variant="destructive"
                type="button"
                onClick={() => {
                  setPendingDeleteTableId(editingTable.id);
                  setDialogOpen(false);
                  setConfirmOpen(true);
                }}
              >
                <Trash2 size={16} className="mr-1" />
                Supprimer
              </Button>
            ) : null}
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                setDialogOpen(false);
                setEditingTable(null);
              }}
            >
              Annuler
            </Button>
            <Button type="submit" form="table-form">
              {editingTable ? 'Enregistrer' : 'Ajouter'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onConfirm={confirmDeleteTable}
        onCancel={() => {
          setConfirmOpen(false);
          setPendingDeleteTableId(null);
        }}
        title="Supprimer la table"
        description="Cette action est irréversible. Voulez-vous vraiment supprimer cette table ?"
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        variant="destructive"
      />
    </Card>
  );
}
