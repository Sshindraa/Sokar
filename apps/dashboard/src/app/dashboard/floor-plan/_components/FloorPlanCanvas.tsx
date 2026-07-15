'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '@/lib/api';
import {
  getErrorMessage,
  type FloorPlan,
  type FloorPlanTable,
  type FloorPlanWall,
  type PlanningReservation,
  type TableShape,
  type WallType,
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
  Settings,
  Circle,
  Square,
  Minus,
  DoorOpen,
  Wine,
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
  type DragMoveEvent,
  DragOverlay,
  useDraggable,
} from '@dnd-kit/core';

const DEFAULT_CANVAS_WIDTH = 1400;
const DEFAULT_CANVAS_HEIGHT = 900;
const GRID_SIZE = 16;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.1;
const WALL_SNAP_DISTANCE = 40; // pixels in canvas coordinates
const WALL_LENGTH_MATCH_DISTANCE = 24; // pixels in canvas coordinates
const WALL_ALIGN_GUIDE_DISTANCE = 24; // pixels in canvas coordinates
const WALL_PERPENDICULAR_DOT_TOLERANCE = 0.08;

type TableStatus = 'free' | 'occupied' | 'upcoming' | 'inactive';

type WallLengthGuide = {
  activeWallId: string;
  referenceWallId: string;
  activeWall: FloorPlanWall;
  referenceWall: FloorPlanWall;
  length: number;
  labelX: number;
  labelY: number;
};

function getWallLength(wall: Pick<FloorPlanWall, 'x1' | 'y1' | 'x2' | 'y2'>): number {
  return Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);
}

function getWallMidpoint(wall: Pick<FloorPlanWall, 'x1' | 'y1' | 'x2' | 'y2'>): {
  x: number;
  y: number;
} {
  return { x: (wall.x1 + wall.x2) / 2, y: (wall.y1 + wall.y2) / 2 };
}

function areWallsPerpendicular(
  a: Pick<FloorPlanWall, 'x1' | 'y1' | 'x2' | 'y2'>,
  b: Pick<FloorPlanWall, 'x1' | 'y1' | 'x2' | 'y2'>,
): boolean {
  const ax = a.x2 - a.x1;
  const ay = a.y2 - a.y1;
  const bx = b.x2 - b.x1;
  const by = b.y2 - b.y1;
  const aLength = Math.hypot(ax, ay);
  const bLength = Math.hypot(bx, by);
  if (aLength < 1 || bLength < 1) return false;
  const normalizedDot = Math.abs((ax * bx + ay * by) / (aLength * bLength));
  return normalizedDot <= WALL_PERPENDICULAR_DOT_TOLERANCE;
}

function formatWallLength(length: number): string {
  return `${Math.round(length)} px`;
}

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
  moveId?: number;
};

type PaletteWallType = 'wall' | 'door' | 'bar';

type PaletteItemData =
  | { kind: 'table'; shape: TableShape; capacity: number }
  | { kind: 'wall'; type: PaletteWallType };

type ActiveDragData = PaletteItemData | { kind: 'existingTable'; table: CanvasTable };

function getTableSize(table: { capacity?: number | null; shape?: TableShape | null }): {
  width: number;
  height: number;
} {
  const base = 80;
  const capacity = table.capacity ?? 1;
  const extra = Math.min(capacity, 12) * 12;
  const size = Math.min(base + extra, 220);
  const width = size;
  const shape = table.shape ?? 'rect';
  const height = shape === 'round' ? size : 80;
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
  if (!reservation.startsAt) return 'Réservation';
  const start = parseISO(reservation.startsAt);
  return `${reservation.customerName || 'Sans nom'} · ${reservation.partySize} · ${format(start, 'HH:mm', { locale: fr })}`;
}

function findNextPosition(
  width: number,
  height: number,
  existing: CanvasTable[],
  maxWidth: number,
  maxHeight: number,
): { x: number; y: number } {
  const startX = 400;
  const startY = 300;
  const step = GRID_SIZE;

  for (let y = startY; y <= maxHeight - height; y += step) {
    for (let x = startX; x <= maxWidth - width; x += step) {
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

function renderChairs(table: CanvasTable): React.ReactNode[] {
  const { width, height } = getTableSize(table);
  const capacity = table.capacity ?? 1;
  const chairCount = Math.min(capacity, 10);
  const chairSize = 10;
  const chairOffset = 6;
  const chairs: React.ReactNode[] = [];
  const shape = table.shape ?? 'rect';

  if (shape === 'round') {
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2 + chairOffset + chairSize / 2;
    for (let i = 0; i < chairCount; i++) {
      const angle = (i / chairCount) * 2 * Math.PI;
      const left = centerX + radius * Math.cos(angle) - chairSize / 2;
      const top = centerY + radius * Math.sin(angle) - chairSize / 2;
      chairs.push(
        <div
          key={`chair-${i}`}
          className="absolute rounded-full border-2 border-background bg-muted-foreground/80"
          style={{ width: chairSize, height: chairSize, left, top }}
        />,
      );
    }
  } else {
    const longSideIsWidth = width >= height;
    if (longSideIsWidth) {
      const topCount = Math.ceil(chairCount / 2);
      const bottomCount = chairCount - topCount;
      const topSpacing = width / (topCount + 1);
      for (let i = 1; i <= topCount; i++) {
        const left = i * topSpacing - chairSize / 2;
        const top = -chairOffset - chairSize / 2;
        chairs.push(
          <div
            key={`chair-top-${i}`}
            className="absolute rounded-full border-2 border-background bg-muted-foreground/80"
            style={{ width: chairSize, height: chairSize, left, top }}
          />,
        );
      }
      const bottomSpacing = width / (bottomCount + 1);
      for (let i = 1; i <= bottomCount; i++) {
        const left = i * bottomSpacing - chairSize / 2;
        const top = height + chairOffset - chairSize / 2;
        chairs.push(
          <div
            key={`chair-bottom-${i}`}
            className="absolute rounded-full border-2 border-background bg-muted-foreground/80"
            style={{ width: chairSize, height: chairSize, left, top }}
          />,
        );
      }
    } else {
      const leftCount = Math.ceil(chairCount / 2);
      const rightCount = chairCount - leftCount;
      const leftSpacing = height / (leftCount + 1);
      for (let i = 1; i <= leftCount; i++) {
        const top = i * leftSpacing - chairSize / 2;
        const left = -chairOffset - chairSize / 2;
        chairs.push(
          <div
            key={`chair-left-${i}`}
            className="absolute rounded-full border-2 border-background bg-muted-foreground/80"
            style={{ width: chairSize, height: chairSize, left, top }}
          />,
        );
      }
      const rightSpacing = height / (rightCount + 1);
      for (let i = 1; i <= rightCount; i++) {
        const top = i * rightSpacing - chairSize / 2;
        const left = width + chairOffset - chairSize / 2;
        chairs.push(
          <div
            key={`chair-right-${i}`}
            className="absolute rounded-full border-2 border-background bg-muted-foreground/80"
            style={{ width: chairSize, height: chairSize, left, top }}
          />,
        );
      }
    }
  }

  return chairs;
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

const wallStrokeConfig: Record<
  WallType,
  { stroke: string; strokeWidth: number; strokeDasharray?: string }
> = {
  wall: { stroke: 'hsl(var(--foreground))', strokeWidth: 4 },
  door: { stroke: 'hsl(var(--primary))', strokeWidth: 3 },
  window: { stroke: 'hsl(var(--accent))', strokeWidth: 3, strokeDasharray: '8 4' },
  bar: { stroke: 'hsl(var(--destructive))', strokeWidth: 6 },
  plant: { stroke: 'hsl(var(--muted-foreground))', strokeWidth: 2, strokeDasharray: '2 2' },
};

type WallSegmentProps = {
  wall: FloorPlanWall;
  onClick?: () => void;
  isSelected?: boolean;
  onPointerDownMove?: (e: React.PointerEvent) => void;
  onPointerDownStart?: (e: React.PointerEvent) => void;
  onPointerDownEnd?: (e: React.PointerEvent) => void;
};

function WallSegment({
  wall,
  onClick,
  isSelected,
  onPointerDownMove,
  onPointerDownStart,
  onPointerDownEnd,
}: WallSegmentProps) {
  const { stroke, strokeWidth, strokeDasharray } = wallStrokeConfig[wall.type];

  return (
    <g
      className={cn('transition-all duration-200', onClick && 'cursor-pointer')}
      onClick={(e) => {
        if (!onClick) return;
        e.stopPropagation();
        onClick();
      }}
    >
      <line
        x1={wall.x1}
        y1={wall.y1}
        x2={wall.x2}
        y2={wall.y2}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        strokeLinecap="square"
        className={cn(
          'transition-all duration-200',
          isSelected && 'stroke-ring stroke-[6]',
          isSelected && 'pointer-events-none',
        )}
      />
      {isSelected ? (
        <>
          {/* Thicker invisible line for easier drag of the whole wall */}
          <line
            x1={wall.x1}
            y1={wall.y1}
            x2={wall.x2}
            y2={wall.y2}
            stroke="transparent"
            strokeWidth={20}
            style={{ cursor: 'move' }}
            onPointerDown={onPointerDownMove}
          />
          {/* Endpoint handles */}
          <circle
            cx={wall.x1}
            cy={wall.y1}
            r={8}
            fill="hsl(var(--ring))"
            stroke="white"
            strokeWidth={2}
            style={{ cursor: 'grab' }}
            onPointerDown={onPointerDownStart}
          />
          <circle
            cx={wall.x2}
            cy={wall.y2}
            r={8}
            fill="hsl(var(--ring))"
            stroke="white"
            strokeWidth={2}
            style={{ cursor: 'grab' }}
            onPointerDown={onPointerDownEnd}
          />
        </>
      ) : null}
    </g>
  );
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
        'box-border flex flex-col items-center justify-center border p-2 text-center transition-all duration-200 select-none relative',
        table.shape === 'round' ? 'rounded-full aspect-square' : 'rounded-md',
        'hover:ring-2 hover:ring-ring hover:ring-offset-1',
        status ? statusClasses[status.status] : 'bg-card border-border text-foreground',
        !isOverlay && 'absolute',
        className,
      )}
      style={{ width, height, ...style }}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      title={title}
      {...dragProps}
    >
      {renderChairs(table)}
      <div className="relative z-10 flex flex-col items-center w-full">
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
      className={cn(isDragging && 'opacity-40 transition-none')}
      style={style}
    />
  );
}

type PaletteItemCardProps = {
  id: string;
  icon: React.ReactNode;
  label: string;
  data: PaletteItemData;
};

function PaletteItemCard({ id, icon, label, data }: PaletteItemCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: data as Record<string, unknown>,
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        'flex items-center gap-3 rounded-md border border-border bg-background p-2 cursor-grab active:cursor-grabbing select-none hover:bg-accent/50 transition-colors',
        isDragging && 'opacity-0',
      )}
    >
      {icon}
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}

function FloorPlanPalette() {
  return (
    <div className="w-56 min-w-56 h-full border-r border-border bg-card flex flex-col gap-5 p-3 overflow-y-auto">
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Tables
        </h4>
        <div className="flex flex-col gap-2">
          <PaletteItemCard
            id="palette-table-round"
            icon={<Circle size={18} className="text-primary" />}
            label="Table ronde"
            data={{ kind: 'table', shape: 'round', capacity: 4 }}
          />
          <PaletteItemCard
            id="palette-table-rect"
            icon={<Square size={18} className="text-primary" />}
            label="Table rectangle"
            data={{ kind: 'table', shape: 'rect', capacity: 4 }}
          />
        </div>
      </div>
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Murs / Décor
        </h4>
        <div className="flex flex-col gap-2">
          <PaletteItemCard
            id="palette-wall"
            icon={<Minus size={18} className="text-muted-foreground" />}
            label="Mur"
            data={{ kind: 'wall', type: 'wall' }}
          />
          <PaletteItemCard
            id="palette-door"
            icon={<DoorOpen size={18} className="text-muted-foreground" />}
            label="Porte"
            data={{ kind: 'wall', type: 'door' }}
          />
          <PaletteItemCard
            id="palette-bar"
            icon={<Wine size={18} className="text-muted-foreground" />}
            label="Bar"
            data={{ kind: 'wall', type: 'bar' }}
          />
        </div>
      </div>
    </div>
  );
}

function NewTableOverlay({
  shape,
  capacity,
  zoom,
}: {
  shape: TableShape;
  capacity: number;
  zoom: number;
}) {
  const table = useMemo<CanvasTable>(
    () => ({
      id: 'palette-new-table',
      name: 'Table',
      capacity,
      minCapacity: 1,
      isActive: true,
      positionX: 0,
      positionY: 0,
      shape,
      sectionName: null,
    }),
    [capacity, shape],
  );
  const { width, height } = getTableSize(table);

  return (
    <TableCard
      table={table}
      isOverlay
      style={{
        transform: `scale(${zoom}) translate(-${width / 2}px, -${height / 2}px)`,
        transformOrigin: 'top left',
      }}
    />
  );
}

function NewWallOverlay({ type, zoom }: { type: PaletteWallType; zoom: number }) {
  const wallLengths: Record<PaletteWallType, number> = { wall: 120, door: 80, bar: 120 };
  const length = wallLengths[type];
  const previewHeight = 12;
  const { stroke, strokeWidth, strokeDasharray } = wallStrokeConfig[type];

  return (
    <svg
      width={length}
      height={previewHeight}
      style={{
        transform: `scale(${zoom}) translate(-${length / 2}px, -${previewHeight / 2}px)`,
        transformOrigin: 'top left',
        overflow: 'visible',
      }}
    >
      <line
        x1={0}
        y1={previewHeight / 2}
        x2={length}
        y2={previewHeight / 2}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
      />
    </svg>
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

  const [activeDragData, setActiveDragData] = useState<ActiveDragData | null>(null);
  const [dragStart, setDragStart] = useState<DragStartInfo | null>(null);
  const justDraggedRef = useRef(false);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const tableMoveIdRef = useRef(0);
  const canvasRef = useRef<HTMLDivElement>(null);

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

  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [wallDragMode, setWallDragMode] = useState<'move' | 'resize-start' | 'resize-end' | null>(
    null,
  );
  const [wallDragStart, setWallDragStart] = useState<{
    pointerX: number;
    pointerY: number;
    wall: FloorPlanWall;
  } | null>(null);
  const wallJustDraggedRef = useRef(false);
  const wallDragCurrentRef = useRef<FloorPlanWall | null>(null);
  // Guide d'alignement mur : pendant un drag de mur depuis la palette, si un mur
  // existant de meme orientation a son axe aligne (<seuil), on stocke l'axe guide
  // pour afficher un trait pointille pleine hauteur/largeur (style Canva).
  const [wallAlignGuide, setWallAlignGuide] = useState<{ axis: 'x' | 'y'; value: number } | null>(
    null,
  );
  const [wallLengthGuide, setWallLengthGuide] = useState<WallLengthGuide | null>(null);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [floorSettings, setFloorSettings] = useState({ name: '', width: 1400, height: 900 });

  const canvasWidth = floorPlan?.width ?? DEFAULT_CANVAS_WIDTH;
  const canvasHeight = floorPlan?.height ?? DEFAULT_CANVAS_HEIGHT;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 3 },
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
        const { x, y } = findNextPosition(width, height, allTables, canvasWidth, canvasHeight);
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

  async function updateWall(wall: FloorPlanWall, type: WallType, name: string | null) {
    if (!orgId) return;
    setError('');
    try {
      const updated = await patch<FloorPlanWall>(
        `restaurants/${orgId}/floor-plan/walls/${wall.id}`,
        { ...wall, type, name },
      );
      setFloorPlan((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          walls: (prev.walls ?? []).map((w) => (w.id === updated.id ? updated : w)),
        };
      });
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de modifier le mur'));
      throw err;
    }
  }

  async function deleteWall(wallId: string) {
    if (!orgId) return;
    setError('');
    try {
      await del(`restaurants/${orgId}/floor-plan/walls/${wallId}`);
      setFloorPlan((prev) => {
        if (!prev) return prev;
        return { ...prev, walls: (prev.walls ?? []).filter((w) => w.id !== wallId) };
      });
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de supprimer le mur'));
    }
  }

  async function handleSaveFloorSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setError('');
    try {
      const updated = await patch<FloorPlan>(`restaurants/${orgId}/floor-plan`, {
        name: floorSettings.name,
        width: floorSettings.width,
        height: floorSettings.height,
      });
      setFloorPlan(updated);
      setSettingsDialogOpen(false);
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de modifier les paramètres du plan'));
    }
  }

  function handleWallPointerDown(
    e: React.PointerEvent,
    wall: FloorPlanWall,
    mode: 'move' | 'resize-start' | 'resize-end',
  ) {
    e.stopPropagation();
    setSelectedWallId(wall.id);
    setWallDragMode(mode);
    setWallDragStart({ pointerX: e.clientX, pointerY: e.clientY, wall });
    wallDragCurrentRef.current = wall;
    setWallLengthGuide(null);
  }

  function findWallLengthGuide(wall: FloorPlanWall): WallLengthGuide | null {
    const wallLength = getWallLength(wall);
    if (wallLength < 1) return null;

    let best: { referenceWall: FloorPlanWall; length: number; diff: number } | null = null;
    for (const referenceWall of floorPlan?.walls ?? []) {
      if (referenceWall.id === wall.id || !areWallsPerpendicular(wall, referenceWall)) continue;
      const length = getWallLength(referenceWall);
      const diff = Math.abs(wallLength - length);
      if (diff <= WALL_LENGTH_MATCH_DISTANCE && (!best || diff < best.diff)) {
        best = { referenceWall, length, diff };
      }
    }

    if (!best) return null;

    const activeMidpoint = getWallMidpoint(wall);
    const referenceMidpoint = getWallMidpoint(best.referenceWall);
    return {
      activeWallId: wall.id,
      referenceWallId: best.referenceWall.id,
      activeWall: wall,
      referenceWall: best.referenceWall,
      length: best.length,
      labelX: (activeMidpoint.x + referenceMidpoint.x) / 2,
      labelY: (activeMidpoint.y + referenceMidpoint.y) / 2,
    };
  }

  function matchWallLengthToGuide(
    wall: FloorPlanWall,
    mode: 'resize-start' | 'resize-end',
    guide: WallLengthGuide,
  ): Partial<FloorPlanWall> {
    const fixed = mode === 'resize-start' ? { x: wall.x2, y: wall.y2 } : { x: wall.x1, y: wall.y1 };
    const dragged =
      mode === 'resize-start' ? { x: wall.x1, y: wall.y1 } : { x: wall.x2, y: wall.y2 };
    const dx = dragged.x - fixed.x;
    const dy = dragged.y - fixed.y;
    const currentLength = Math.hypot(dx, dy);
    if (currentLength < 1) return {};

    const ratio = guide.length / currentLength;
    const nextPoint = {
      x: Math.max(0, Math.min(canvasWidth, fixed.x + dx * ratio)),
      y: Math.max(0, Math.min(canvasHeight, fixed.y + dy * ratio)),
    };

    return mode === 'resize-start'
      ? { x1: nextPoint.x, y1: nextPoint.y }
      : { x2: nextPoint.x, y2: nextPoint.y };
  }

  function getSnappedWallCoords(
    wall: FloorPlanWall,
    mode: 'move' | 'resize-start' | 'resize-end',
  ): Partial<FloorPlanWall> {
    const otherWalls = (floorPlan?.walls ?? []).filter((w) => w.id !== wall.id);
    const otherEndpoints: { x: number; y: number }[] = [];
    for (const w of otherWalls) {
      otherEndpoints.push({ x: w.x1, y: w.y1 });
      otherEndpoints.push({ x: w.x2, y: w.y2 });
    }

    if (mode === 'move') {
      const startRaw = { x: wall.x1, y: wall.y1 };
      const endRaw = { x: wall.x2, y: wall.y2 };
      let bestStart = startRaw;
      let bestEnd = endRaw;
      let bestStartDist = Infinity;
      let bestEndDist = Infinity;

      for (const ep of otherEndpoints) {
        const distStart = Math.hypot(startRaw.x - ep.x, startRaw.y - ep.y);
        if (distStart < WALL_SNAP_DISTANCE && distStart < bestStartDist) {
          bestStartDist = distStart;
          bestStart = ep;
        }
        const distEnd = Math.hypot(endRaw.x - ep.x, endRaw.y - ep.y);
        if (distEnd < WALL_SNAP_DISTANCE && distEnd < bestEndDist) {
          bestEndDist = distEnd;
          bestEnd = ep;
        }
      }

      if (bestStartDist < WALL_SNAP_DISTANCE || bestEndDist < WALL_SNAP_DISTANCE) {
        if (bestStartDist < bestEndDist) {
          const dx = bestStart.x - wall.x1;
          const dy = bestStart.y - wall.y1;
          return { x1: bestStart.x, y1: bestStart.y, x2: wall.x2 + dx, y2: wall.y2 + dy };
        } else {
          const dx = bestEnd.x - wall.x2;
          const dy = bestEnd.y - wall.y2;
          return { x1: wall.x1 + dx, y1: wall.y1 + dy, x2: bestEnd.x, y2: bestEnd.y };
        }
      }
      return {};
    }

    if (mode === 'resize-start') {
      const rawX = wall.x1;
      const rawY = wall.y1;
      const fixedX = wall.x2;
      const fixedY = wall.y2;

      // 1) Connexion prioritaire : accroche l'extremite a un point d'un autre mur
      //    (coin parfait). On ignore l'alignement d'axe tant qu'un point est proche.
      let bestEndpoint: { x: number; y: number; dist: number } | null = null;
      for (const ep of otherEndpoints) {
        const dist = Math.hypot(rawX - ep.x, rawY - ep.y);
        if (dist < WALL_SNAP_DISTANCE && (!bestEndpoint || dist < bestEndpoint.dist)) {
          bestEndpoint = { x: ep.x, y: ep.y, dist };
        }
      }
      if (bestEndpoint) {
        return { x1: bestEndpoint.x, y1: bestEndpoint.y };
      }

      // 2) Repli : alignement d'axe sur le propre mur (horizontal/vertical)
      const candidates: { x: number; y: number; dist: number }[] = [];
      if (Math.abs(rawY - fixedY) < WALL_SNAP_DISTANCE) {
        candidates.push({ x: rawX, y: fixedY, dist: Math.abs(rawY - fixedY) });
      }
      if (Math.abs(rawX - fixedX) < WALL_SNAP_DISTANCE) {
        candidates.push({ x: fixedX, y: rawY, dist: Math.abs(rawX - fixedX) });
      }

      if (candidates.length === 0) {
        return { x1: rawX, y1: rawY };
      }

      const best = candidates.reduce((a, b) => (a.dist < b.dist ? a : b));
      return { x1: best.x, y1: best.y };
    }

    // resize-end
    const rawX = wall.x2;
    const rawY = wall.y2;
    const fixedX = wall.x1;
    const fixedY = wall.y1;

    // 1) Connexion prioritaire : accroche l'extremite a un point d'un autre mur
    let bestEndpoint: { x: number; y: number; dist: number } | null = null;
    for (const ep of otherEndpoints) {
      const dist = Math.hypot(rawX - ep.x, rawY - ep.y);
      if (dist < WALL_SNAP_DISTANCE && (!bestEndpoint || dist < bestEndpoint.dist)) {
        bestEndpoint = { x: ep.x, y: ep.y, dist };
      }
    }
    if (bestEndpoint) {
      return { x2: bestEndpoint.x, y2: bestEndpoint.y };
    }

    // 2) Repli : alignement d'axe sur le propre mur (horizontal/vertical)
    const candidates: { x: number; y: number; dist: number }[] = [];
    if (Math.abs(rawY - fixedY) < WALL_SNAP_DISTANCE) {
      candidates.push({ x: rawX, y: fixedY, dist: Math.abs(rawY - fixedY) });
    }
    if (Math.abs(rawX - fixedX) < WALL_SNAP_DISTANCE) {
      candidates.push({ x: fixedX, y: rawY, dist: Math.abs(rawX - fixedX) });
    }

    if (candidates.length === 0) {
      return { x2: rawX, y2: rawY };
    }

    const best = candidates.reduce((a, b) => (a.dist < b.dist ? a : b));
    return { x2: best.x, y2: best.y };
  }

  function handleWallPointerMove(e: PointerEvent) {
    if (!wallDragStart || !wallDragMode) return;
    wallJustDraggedRef.current = true;

    let deltaX = (e.clientX - wallDragStart.pointerX) / zoom;
    let deltaY = (e.clientY - wallDragStart.pointerY) / zoom;
    if (snap) {
      deltaX = Math.round(deltaX / GRID_SIZE) * GRID_SIZE;
      deltaY = Math.round(deltaY / GRID_SIZE) * GRID_SIZE;
    }

    let rawCoords: Partial<FloorPlanWall>;
    if (wallDragMode === 'move') {
      rawCoords = {
        x1: wallDragStart.wall.x1 + deltaX,
        y1: wallDragStart.wall.y1 + deltaY,
        x2: wallDragStart.wall.x2 + deltaX,
        y2: wallDragStart.wall.y2 + deltaY,
      };
    } else if (wallDragMode === 'resize-start') {
      rawCoords = {
        x1: wallDragStart.wall.x1 + deltaX,
        y1: wallDragStart.wall.y1 + deltaY,
      };
    } else {
      rawCoords = {
        x2: wallDragStart.wall.x2 + deltaX,
        y2: wallDragStart.wall.y2 + deltaY,
      };
    }

    // Clamp raw coordinates to canvas bounds
    const clamped: Partial<FloorPlanWall> = {};
    if (rawCoords.x1 !== undefined) clamped.x1 = Math.max(0, Math.min(canvasWidth, rawCoords.x1));
    if (rawCoords.y1 !== undefined) clamped.y1 = Math.max(0, Math.min(canvasHeight, rawCoords.y1));
    if (rawCoords.x2 !== undefined) clamped.x2 = Math.max(0, Math.min(canvasWidth, rawCoords.x2));
    if (rawCoords.y2 !== undefined) clamped.y2 = Math.max(0, Math.min(canvasHeight, rawCoords.y2));

    // Build a temporary wall object from start + clamped
    const tempWall = { ...wallDragStart.wall, ...clamped };

    // Apply axis/endpoint snapping
    const snapped = getSnappedWallCoords(tempWall, wallDragMode);

    // Merge clamped + snapped
    let finalCoords = { ...clamped, ...snapped };
    let nextWall = { ...wallDragStart.wall, ...finalCoords };

    if (wallDragMode !== 'move') {
      const guide = findWallLengthGuide(nextWall);
      if (guide) {
        const lengthMatched = matchWallLengthToGuide(nextWall, wallDragMode, guide);
        finalCoords = { ...finalCoords, ...lengthMatched };
        nextWall = { ...wallDragStart.wall, ...finalCoords };
        setWallLengthGuide({ ...guide, activeWall: nextWall });
      } else {
        setWallLengthGuide(null);
      }
    } else {
      setWallLengthGuide(null);
    }

    // Clamp again after snapping to ensure we stay in bounds
    const finalClamped: Partial<FloorPlanWall> = {};
    if (finalCoords.x1 !== undefined)
      finalClamped.x1 = Math.max(0, Math.min(canvasWidth, finalCoords.x1));
    if (finalCoords.y1 !== undefined)
      finalClamped.y1 = Math.max(0, Math.min(canvasHeight, finalCoords.y1));
    if (finalCoords.x2 !== undefined)
      finalClamped.x2 = Math.max(0, Math.min(canvasWidth, finalCoords.x2));
    if (finalCoords.y2 !== undefined)
      finalClamped.y2 = Math.max(0, Math.min(canvasHeight, finalCoords.y2));

    const finalWall = { ...wallDragStart.wall, ...finalClamped };

    setFloorPlan((prev) =>
      prev
        ? {
            ...prev,
            walls: (prev.walls ?? []).map((w) => (w.id === wallDragStart.wall.id ? finalWall : w)),
          }
        : prev,
    );
    wallDragCurrentRef.current = finalWall;
  }

  function handleWallPointerUp() {
    if (!wallDragStart) return;
    const currentWall = wallDragCurrentRef.current;
    if (currentWall) {
      void updateWall(currentWall, currentWall.type, currentWall.name ?? null).catch(() => {
        // updateWall already sets the error message
      });
    }
    setWallDragMode(null);
    setWallDragStart(null);
    wallDragCurrentRef.current = null;
    setWallLengthGuide(null);
    setSelectedWallId(null);
    setTimeout(() => {
      wallJustDraggedRef.current = false;
    }, 0);
  }

  useEffect(() => {
    if (!wallDragMode) return;
    const handleMove = (e: PointerEvent) => handleWallPointerMove(e);
    const handleUp = () => handleWallPointerUp();
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallDragMode, wallDragStart, zoom, snap, canvasWidth, canvasHeight]);

  // Deselect wall on Escape
  useEffect(() => {
    if (!selectedWallId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedWallId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedWallId]);

  function handleDragStart(event: DragStartEvent) {
    justDraggedRef.current = true;
    const pointer = event.activatorEvent as PointerEvent | undefined;
    if (pointer) {
      pointerStartRef.current = { x: pointer.clientX, y: pointer.clientY };
    }
    const table = allTables.find((t) => t.id === event.active.id);
    if (table) {
      const { width, height } = getTableSize(table);
      const moveId = ++tableMoveIdRef.current;
      setActiveDragData({ kind: 'existingTable', table });
      setDragStart({
        tableId: table.id,
        originalX: table.positionX ?? 0,
        originalY: table.positionY ?? 0,
        width,
        height,
        table,
        moveId,
      });
    } else {
      setActiveDragData((event.active.data.current as PaletteItemData | undefined) ?? null);
    }
  }

  function handleDragCancel() {
    setActiveDragData(null);
    setDragStart(null);
    setWallAlignGuide(null);
    pointerStartRef.current = null;
    setTimeout(() => {
      justDraggedRef.current = false;
    }, 0);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const start = dragStart;
    const data = activeDragData;
    const pointerStart = pointerStartRef.current;
    setActiveDragData(null);
    setDragStart(null);
    setWallAlignGuide(null);
    pointerStartRef.current = null;
    setTimeout(() => {
      justDraggedRef.current = false;
    }, 0);

    if (!orgId) return;

    if (data?.kind === 'existingTable') {
      if (!start) return;

      const { delta } = event;
      const newX = start.originalX + delta.x / zoom;
      const newY = start.originalY + delta.y / zoom;

      const grid = snap ? GRID_SIZE : 1;
      const snappedX = Math.round(newX / grid) * grid;
      const snappedY = Math.round(newY / grid) * grid;

      const clampedX = Math.max(0, Math.min(canvasWidth - start.width, snappedX));
      const clampedY = Math.max(0, Math.min(canvasHeight - start.height, snappedY));

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
        if (start.moveId !== tableMoveIdRef.current) return;
        setFloorPlan((prev) =>
          prev
            ? replaceTablePosition(
                prev,
                start.tableId,
                updated.positionX ?? clampedX,
                updated.positionY ?? clampedY,
              )
            : prev,
        );
      } catch (err) {
        if (start.moveId !== tableMoveIdRef.current) return;
        setError(getErrorMessage(err, 'Impossible de déplacer la table'));
        setFloorPlan((prev) =>
          prev ? replaceTablePosition(prev, start.tableId, start.originalX, start.originalY) : prev,
        );
      }
      return;
    }

    if (
      data &&
      (data.kind === 'table' || data.kind === 'wall') &&
      pointerStart &&
      canvasRef.current
    ) {
      const rect = canvasRef.current.getBoundingClientRect();
      const finalClientX = pointerStart.x + event.delta.x;
      const finalClientY = pointerStart.y + event.delta.y;

      const grid = snap ? GRID_SIZE : 1;
      let dropX = Math.round((finalClientX - rect.left) / zoom / grid) * grid;
      let dropY = Math.round((finalClientY - rect.top) / zoom / grid) * grid;

      if (data.kind === 'table') {
        const { width, height } = getTableSize({
          capacity: data.capacity,
          shape: data.shape,
        } as FloorPlanTable);
        const positionX = Math.max(0, Math.min(canvasWidth - width, dropX - width / 2));
        const positionY = Math.max(0, Math.min(canvasHeight - height, dropY - height / 2));
        const sameShapeCount = allTables.filter((t) => t.shape === data.shape).length;
        const nameBase = data.shape === 'round' ? 'Table ronde' : 'Table rectangulaire';
        const name = `${nameBase} ${sameShapeCount + 1}`;

        try {
          setError('');
          const created = await post<FloorPlanTable>(`restaurants/${orgId}/floor-plan/tables`, {
            sectionId: null,
            minCapacity: 1,
            positionX,
            positionY,
            capacity: data.capacity,
            shape: data.shape,
            name,
          });
          setFloorPlan((prev) => (prev ? replaceTable(prev, created) : prev));
        } catch (err) {
          setError(getErrorMessage(err, 'Impossible de créer la table'));
        }
      } else if (data.kind === 'wall') {
        const wallLengths: Record<PaletteWallType, number> = { wall: 120, door: 80, bar: 120 };
        const length = wallLengths[data.type];
        let x1: number;
        let x2: number;
        let y1: number;
        let y2: number;
        if (wallAlignGuide?.axis === 'x') {
          // Mur vertical aligne sur l'axe X d'un mur existant
          const vx = wallAlignGuide.value;
          x1 = vx;
          x2 = vx;
          y1 = Math.max(0, Math.min(canvasHeight, dropY - length / 2));
          y2 = Math.max(0, Math.min(canvasHeight, dropY + length / 2));
        } else if (wallAlignGuide?.axis === 'y') {
          // Mur horizontal aligne sur l'axe Y d'un mur existant
          const hy = wallAlignGuide.value;
          y1 = hy;
          y2 = hy;
          x1 = Math.max(0, Math.min(canvasWidth, dropX - length / 2));
          x2 = Math.max(0, Math.min(canvasWidth, dropX + length / 2));
        } else {
          const centerX = dropX;
          const centerY = dropY;
          x1 = Math.max(0, Math.min(canvasWidth, centerX - length / 2));
          x2 = Math.max(0, Math.min(canvasWidth, centerX + length / 2));
          y1 = Math.max(0, Math.min(canvasHeight, centerY));
          y2 = Math.max(0, Math.min(canvasHeight, centerY));
        }

        // Accroche les pointes du nouveau mur aux points existants (coins parfaits)
        const snapDropPoint = (px: number, py: number): { x: number; y: number } | null => {
          let best: { x: number; y: number; dist: number } | null = null;
          for (const w of floorPlan?.walls ?? []) {
            for (const ep of [
              { x: w.x1, y: w.y1 },
              { x: w.x2, y: w.y2 },
            ]) {
              const d = Math.hypot(px - ep.x, py - ep.y);
              if (d < WALL_SNAP_DISTANCE && (!best || d < best.dist)) {
                best = { x: ep.x, y: ep.y, dist: d };
              }
            }
          }
          return best ? { x: best.x, y: best.y } : null;
        };
        const snappedStart = snapDropPoint(x1, y1);
        if (snappedStart) {
          x1 = snappedStart.x;
          y1 = snappedStart.y;
        }
        const snappedEnd = snapDropPoint(x2, y2);
        if (snappedEnd) {
          x2 = snappedEnd.x;
          y2 = snappedEnd.y;
        }

        try {
          setError('');
          const wall = await post<FloorPlanWall>(`restaurants/${orgId}/floor-plan/walls`, {
            x1,
            y1,
            x2,
            y2,
            type: data.type as WallType,
            name: null,
          });
          setFloorPlan((prev) => (prev ? { ...prev, walls: [...(prev.walls ?? []), wall] } : prev));
        } catch (err) {
          setError(getErrorMessage(err, 'Impossible de créer le mur'));
        }
      }
    }
  }

  // Pendant un drag de mur depuis la palette : detecte un mur existant de meme
  // orientation dont l'axe est aligne avec le mur preview, et stocke le guide.
  function handleDragMove(event: DragMoveEvent) {
    const data = activeDragData;
    const pointerStart = pointerStartRef.current;
    if (data?.kind !== 'wall' || !pointerStart || !canvasRef.current) {
      if (wallAlignGuide) setWallAlignGuide(null);
      return;
    }
    const rect = canvasRef.current.getBoundingClientRect();
    const cursorX = (pointerStart.x + event.delta.x - rect.left) / zoom;
    const cursorY = (pointerStart.y + event.delta.y - rect.top) / zoom;

    let best: { axis: 'x' | 'y'; value: number; dist: number } | null = null;

    for (const w of floorPlan?.walls ?? []) {
      const horiz = Math.abs(w.y1 - w.y2) <= 0.5;
      const vert = Math.abs(w.x1 - w.x2) <= 0.5;
      if (horiz) {
        const wy = (w.y1 + w.y2) / 2;
        const d = Math.abs(cursorY - wy);
        if (d <= WALL_ALIGN_GUIDE_DISTANCE && (!best || d < best.dist)) {
          best = { axis: 'y', value: wy, dist: d };
        }
      } else if (vert) {
        const wx = (w.x1 + w.x2) / 2;
        const d = Math.abs(cursorX - wx);
        if (d <= WALL_ALIGN_GUIDE_DISTANCE && (!best || d < best.dist)) {
          best = { axis: 'x', value: wx, dist: d };
        }
      }
    }
    if (best) {
      if (
        !wallAlignGuide ||
        wallAlignGuide.axis !== best.axis ||
        wallAlignGuide.value !== best.value
      ) {
        setWallAlignGuide({ axis: best.axis, value: best.value });
      }
    } else if (wallAlignGuide) {
      setWallAlignGuide(null);
    }
  }

  const dialog = (
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
                value={form.sectionId || '_none_'}
                onValueChange={(value) =>
                  setForm((f) => ({ ...f, sectionId: value === '_none_' ? '' : value }))
                }
              >
                <SelectTrigger id="table-section" className="bg-card border-border">
                  <SelectValue placeholder="Section" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none_">Aucune section</SelectItem>
                  {(floorPlan?.sections ?? []).map((section) => (
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
  );

  const confirm = (
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
  );

  const settingsDialog = (
    <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Paramètres du plan</DialogTitle>
          <DialogDescription>Modifiez les dimensions et le nom du plan.</DialogDescription>
        </DialogHeader>

        <form id="floor-settings-form" onSubmit={handleSaveFloorSettings} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="floor-name">Nom</Label>
            <Input
              id="floor-name"
              value={floorSettings.name}
              onChange={(e) => setFloorSettings((s) => ({ ...s, name: e.target.value }))}
              className="bg-card border-border"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="floor-width">Largeur (px)</Label>
              <Input
                id="floor-width"
                type="number"
                min={400}
                value={floorSettings.width}
                onChange={(e) =>
                  setFloorSettings((s) => ({ ...s, width: Number(e.target.value) || 0 }))
                }
                className="bg-card border-border"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="floor-height">Hauteur (px)</Label>
              <Input
                id="floor-height"
                type="number"
                min={400}
                value={floorSettings.height}
                onChange={(e) =>
                  setFloorSettings((s) => ({ ...s, height: Number(e.target.value) || 0 }))
                }
                className="bg-card border-border"
              />
            </div>
          </div>
        </form>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" type="button" onClick={() => setSettingsDialogOpen(false)}>
            Annuler
          </Button>
          <Button type="submit" form="floor-settings-form">
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (loading) {
    return (
      <>
        <Card className="sokar-card">
          <CardHeader className="p-4">
            <Skeleton className="h-6 w-32 rounded-md" />
          </CardHeader>
          <CardContent className="p-0 overflow-hidden h-[600px]">
            <Skeleton className="h-full w-full" />
          </CardContent>
        </Card>
        {dialog}
        {confirm}
        {settingsDialog}
      </>
    );
  }

  if (error && !floorPlan) {
    return (
      <>
        <Card className="sokar-card">
          <CardContent className="p-6">
            <div className="sokar-error">
              <AlertCircle size={18} />
              {error}
            </div>
          </CardContent>
        </Card>
        {dialog}
        {confirm}
        {settingsDialog}
      </>
    );
  }

  const activeDragTable = activeDragData?.kind === 'existingTable' ? activeDragData.table : null;

  return (
    <>
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
            <Button
              variant="outline"
              size="sm"
              title="Paramètres du plan"
              onClick={() => {
                setFloorSettings({
                  name: floorPlan?.name ?? '',
                  width: floorPlan?.width ?? 1400,
                  height: floorPlan?.height ?? 900,
                });
                setSettingsDialogOpen(true);
              }}
            >
              <Settings size={16} />
            </Button>
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
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <div className="flex h-full">
              <FloorPlanPalette />
              <div className="relative flex-1 overflow-auto bg-muted">
                <div
                  ref={canvasRef}
                  className="absolute origin-top-left bg-muted"
                  style={{
                    width: canvasWidth,
                    height: canvasHeight,
                    transform: `scale(${zoom})`,
                    transformOrigin: 'top left',
                    backgroundImage: gridVisible
                      ? `linear-gradient(to right, hsl(var(--border) / 0.5) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--border) / 0.5) 1px, transparent 1px)`
                      : undefined,
                    backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
                  }}
                >
                  <svg
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    style={{ zIndex: 10 }}
                    onClick={() => setSelectedWallId(null)}
                  >
                    <g className="pointer-events-auto">
                      {floorPlan?.walls?.map((w) => (
                        <WallSegment
                          key={w.id}
                          wall={w}
                          isSelected={selectedWallId === w.id}
                          onClick={() => {
                            if (wallJustDraggedRef.current) {
                              wallJustDraggedRef.current = false;
                              return;
                            }
                            setSelectedWallId(w.id);
                          }}
                          onPointerDownMove={(e) => handleWallPointerDown(e, w, 'move')}
                          onPointerDownStart={(e) => handleWallPointerDown(e, w, 'resize-start')}
                          onPointerDownEnd={(e) => handleWallPointerDown(e, w, 'resize-end')}
                        />
                      ))}
                      {wallLengthGuide ? (
                        <g className="pointer-events-none">
                          <line
                            x1={wallLengthGuide.activeWall.x1}
                            y1={wallLengthGuide.activeWall.y1}
                            x2={wallLengthGuide.activeWall.x2}
                            y2={wallLengthGuide.activeWall.y2}
                            stroke="hsl(var(--primary))"
                            strokeWidth={8}
                            strokeLinecap="square"
                            opacity={0.35}
                          />
                          <line
                            x1={wallLengthGuide.referenceWall.x1}
                            y1={wallLengthGuide.referenceWall.y1}
                            x2={wallLengthGuide.referenceWall.x2}
                            y2={wallLengthGuide.referenceWall.y2}
                            stroke="hsl(var(--primary))"
                            strokeWidth={8}
                            strokeLinecap="square"
                            opacity={0.35}
                          />
                          <line
                            x1={(wallLengthGuide.activeWall.x1 + wallLengthGuide.activeWall.x2) / 2}
                            y1={(wallLengthGuide.activeWall.y1 + wallLengthGuide.activeWall.y2) / 2}
                            x2={
                              (wallLengthGuide.referenceWall.x1 +
                                wallLengthGuide.referenceWall.x2) /
                              2
                            }
                            y2={
                              (wallLengthGuide.referenceWall.y1 +
                                wallLengthGuide.referenceWall.y2) /
                              2
                            }
                            stroke="hsl(var(--primary))"
                            strokeWidth={1.5}
                            strokeDasharray="5 5"
                            opacity={0.9}
                          />
                          <circle
                            cx={(wallLengthGuide.activeWall.x1 + wallLengthGuide.activeWall.x2) / 2}
                            cy={(wallLengthGuide.activeWall.y1 + wallLengthGuide.activeWall.y2) / 2}
                            r={4}
                            fill="hsl(var(--primary))"
                          />
                          <circle
                            cx={
                              (wallLengthGuide.referenceWall.x1 +
                                wallLengthGuide.referenceWall.x2) /
                              2
                            }
                            cy={
                              (wallLengthGuide.referenceWall.y1 +
                                wallLengthGuide.referenceWall.y2) /
                              2
                            }
                            r={4}
                            fill="hsl(var(--primary))"
                          />
                          <foreignObject
                            x={Math.max(
                              8,
                              Math.min(canvasWidth - 132, wallLengthGuide.labelX - 66),
                            )}
                            y={Math.max(
                              8,
                              Math.min(canvasHeight - 38, wallLengthGuide.labelY - 19),
                            )}
                            width={132}
                            height={38}
                          >
                            <div className="flex h-full items-center justify-center rounded-md border border-primary/40 bg-background/95 px-2 text-[11px] font-medium text-primary shadow-sm">
                              Même longueur · {formatWallLength(wallLengthGuide.length)}
                            </div>
                          </foreignObject>
                        </g>
                      ) : null}
                      {floorPlan?.walls?.map((w) =>
                        selectedWallId === w.id ? (
                          <foreignObject
                            key={`delete-${w.id}`}
                            x={(w.x1 + w.x2) / 2 - 14}
                            y={(w.y1 + w.y2) / 2 - 14}
                            width={28}
                            height={28}
                            style={{ pointerEvents: 'auto' }}
                          >
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              className="h-7 w-7 p-0"
                              title="Supprimer"
                              onClick={(e) => {
                                e.stopPropagation();
                                void deleteWall(w.id);
                                setSelectedWallId(null);
                              }}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </foreignObject>
                        ) : null,
                      )}
                    </g>
                  </svg>
                  {wallAlignGuide ? (
                    <svg
                      className="absolute inset-0 w-full h-full pointer-events-none"
                      style={{ zIndex: 11 }}
                    >
                      {wallAlignGuide.axis === 'y' ? (
                        <line
                          x1={0}
                          y1={wallAlignGuide.value}
                          x2={canvasWidth}
                          y2={wallAlignGuide.value}
                          stroke="hsl(var(--primary))"
                          strokeWidth={1}
                          strokeDasharray="4 4"
                        />
                      ) : (
                        <line
                          x1={wallAlignGuide.value}
                          y1={0}
                          x2={wallAlignGuide.value}
                          y2={canvasHeight}
                          stroke="hsl(var(--primary))"
                          strokeWidth={1}
                          strokeDasharray="4 4"
                        />
                      )}
                    </svg>
                  ) : null}
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
                {allTables.length === 0 ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <p className="text-sm text-muted-foreground">Aucune table dans votre plan 2D</p>
                    <p className="text-xs text-muted-foreground opacity-60">
                      Glissez-déposez un élément depuis la palette pour commencer.
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
            <DragOverlay dropAnimation={null}>
              {activeDragTable
                ? (() => {
                    const { width: tw, height: th } = getTableSize(activeDragTable);
                    return (
                      <TableCard
                        table={activeDragTable}
                        status={live ? tableStatuses.get(activeDragTable.id) : undefined}
                        isOverlay
                        style={{
                          transform: `scale(${zoom}) translate(-${tw / 2}px, -${th / 2}px)`,
                          transformOrigin: 'top left',
                        }}
                      />
                    );
                  })()
                : null}
              {activeDragData?.kind === 'table' ? (
                <NewTableOverlay
                  shape={activeDragData.shape}
                  capacity={activeDragData.capacity}
                  zoom={zoom}
                />
              ) : null}
              {activeDragData?.kind === 'wall' ? (
                <NewWallOverlay type={activeDragData.type} zoom={zoom} />
              ) : null}
            </DragOverlay>
          </DndContext>
        </CardContent>
      </Card>
      {dialog}
      {confirm}
      {settingsDialog}
    </>
  );
}
