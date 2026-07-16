'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  Save,
  Check,
  Maximize2,
  Move,
  Copy,
  Lock,
  Unlock,
  Clock3,
  CalendarDays,
  AlertTriangle,
  CircleCheck,
  UserRound,
  Users,
  ListFilter,
  BarChart3,
  Plus,
  Trash2,
  Circle,
  Square,
  Minus,
  DoorOpen,
  Wine,
  type LucideIcon,
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

type TableStatus = 'free' | 'reserved' | 'upcoming' | 'late' | 'occupied' | 'inactive';

type WallLengthGuide = {
  activeWallId: string;
  referenceWallId: string;
  activeWall: FloorPlanWall;
  referenceWall: FloorPlanWall;
  length: number;
  labelX: number;
  labelY: number;
};

type WallResizeAlignGuide = {
  axis: 'x' | 'y';
  value: number;
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
  displayName?: string;
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
  const base = 88;
  const capacity = table.capacity ?? 1;
  const extra = Math.min(capacity, 12) * 12;
  const size = Math.min(base + extra, 220);
  const width = size;
  const shape = table.shape ?? 'rect';
  const height = shape === 'round' ? size : 112;
  return { width, height };
}

const statusClasses: Record<TableStatus, string> = {
  free: 'bg-card border-border text-foreground',
  reserved: 'bg-ring/10 border-ring/60 text-foreground shadow-sm',
  upcoming: 'bg-warning/10 border-warning/70 text-foreground shadow-sm',
  late: 'bg-destructive/10 border-destructive text-foreground shadow-sm',
  occupied: 'bg-primary/15 border-primary text-foreground shadow-sm',
  inactive: 'bg-muted border-border text-muted-foreground opacity-60',
};

const statusMeta: Record<TableStatus, { label: string; icon: LucideIcon }> = {
  free: { label: 'Disponible', icon: CircleCheck },
  reserved: { label: 'Réservée', icon: CalendarDays },
  upcoming: { label: 'Arrivée imminente', icon: Clock3 },
  late: { label: 'En retard', icon: AlertTriangle },
  occupied: { label: 'Occupée', icon: Users },
  inactive: { label: 'Inactive', icon: Lock },
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
    return isWithinInterval(now, { start, end }) && r.state === 'SEATED';
  });

  if (current) {
    return { status: 'occupied', reservation: current };
  }

  const late = tableRes.find((r) => {
    const start = parseISO(r.startsAt);
    const end = parseISO(r.endsAt);
    return !isAfter(start, now) && isAfter(end, now) && ['PENDING', 'CONFIRMED'].includes(r.state);
  });

  if (late) {
    return { status: 'late', reservation: late };
  }

  const upcoming = tableRes.find((r) => {
    const start = parseISO(r.startsAt);
    const diff = differenceInMinutes(start, now);
    return (
      isAfter(start, now) &&
      diff <= 30 &&
      (isSameDay(start, now) || diff <= 30) &&
      ['PENDING', 'CONFIRMED'].includes(r.state)
    );
  });

  if (upcoming) {
    return { status: 'upcoming', reservation: upcoming };
  }

  const reserved = tableRes.find((r) => {
    const start = parseISO(r.startsAt);
    return (
      isAfter(start, now) && isSameDay(start, now) && ['PENDING', 'CONFIRMED'].includes(r.state)
    );
  });

  if (reserved) {
    return { status: 'reserved', reservation: reserved };
  }

  return { status: 'free', reservation: null };
}

function formatReservationBadge(reservation: PlanningReservation): string {
  if (!reservation.startsAt) return 'Réservation';
  const start = parseISO(reservation.startsAt);
  return `${reservation.customerName || 'Sans nom'} · ${reservation.partySize} · ${format(start, 'HH:mm', { locale: fr })}`;
}

function formatCustomerName(name: string | null): string {
  return name?.trim().split(/\s+/)[0] || 'Client';
}

function formatServiceTiming(
  reservation: PlanningReservation,
  status: TableStatus,
  now: Date,
): string {
  const startsAt = parseISO(reservation.startsAt);
  const minutes = Math.abs(differenceInMinutes(startsAt, now));
  if (status === 'occupied') {
    return `Occupée depuis ${minutes} min`;
  }
  const diff = differenceInMinutes(startsAt, now);
  if (diff < 0) return `En retard de ${Math.abs(diff)} min`;
  if (diff === 0) return 'Arrivée maintenant';
  return `Arrivée dans ${diff} min`;
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
  editable?: boolean;
  locked?: boolean;
  onPointerDownMove?: (e: React.PointerEvent) => void;
  onPointerDownStart?: (e: React.PointerEvent) => void;
  onPointerDownEnd?: (e: React.PointerEvent) => void;
};

function WallSegment({
  wall,
  onClick,
  isSelected,
  editable = true,
  locked = false,
  onPointerDownMove,
  onPointerDownStart,
  onPointerDownEnd,
}: WallSegmentProps) {
  const { stroke, strokeWidth, strokeDasharray } = wallStrokeConfig[wall.type];

  return (
    <g
      className={cn(
        'transition-all duration-200',
        onClick && editable && !locked && 'cursor-pointer',
      )}
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
      {isSelected && editable && !locked ? (
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
  zoom?: number;
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
  zoom = 1,
}: TableCardProps) {
  const { width, height } = getTableSize(table);
  const displayName = table.displayName ?? table.name;
  const title = status?.reservation
    ? formatReservationBadge(status.reservation)
    : `${displayName} · ${table.capacity} places`;

  const showCapacity = zoom >= 0.6;
  const showServiceDetails = zoom >= 0.82;
  const showAssignment = zoom >= 0.95;
  const reservationStart = status?.reservation ? parseISO(status.reservation.startsAt) : null;
  const StatusIcon = status ? statusMeta[status.status].icon : null;
  const assignment = table.sectionName || status?.reservation?.sectionName;

  return (
    <div
      ref={dragRef}
      className={cn(
        'box-border flex flex-col items-center justify-center border-2 p-2 text-center transition-[opacity,background-color,border-color,box-shadow] duration-200 select-none relative shadow-sm',
        table.shape === 'round' ? 'rounded-full aspect-square' : 'rounded-md',
        'overflow-visible hover:ring-2 hover:ring-ring/60 hover:ring-offset-1',
        status ? statusClasses[status.status] : 'bg-card border-border text-foreground',
        !isOverlay && 'absolute',
        className,
      )}
      style={{ width, height, ...style }}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && onClick) {
          e.preventDefault();
          onClick();
        }
      }}
      title={title}
      {...dragProps}
    >
      {renderChairs(table)}
      {StatusIcon && status ? (
        <span
          className={cn(
            'absolute right-1.5 top-1.5 z-20 inline-flex h-5 w-5 items-center justify-center rounded-full border bg-background/90 shadow-sm',
            status.status === 'late' && 'border-destructive text-destructive',
            status.status === 'upcoming' && 'border-warning/70 text-warning',
            status.status === 'occupied' && 'border-primary text-primary',
            status.status === 'reserved' && 'border-ring/60 text-ring',
            status.status === 'free' && 'border-border text-muted-foreground',
            status.status === 'inactive' && 'border-border text-muted-foreground',
          )}
          title={statusMeta[status.status].label}
          aria-label={statusMeta[status.status].label}
        >
          <StatusIcon size={12} strokeWidth={2.4} />
        </span>
      ) : null}
      <div className="relative z-10 flex w-full max-w-full flex-col items-center px-1">
        <div className="flex w-full items-baseline justify-center gap-1 leading-none">
          <p className="text-xs font-bold tracking-tight">{displayName}</p>
          {showCapacity ? (
            <p className="text-[9px] font-medium text-muted-foreground">
              · {table.capacity} places
            </p>
          ) : null}
        </div>
        {showServiceDetails && status?.reservation && reservationStart && !isOverlay ? (
          <div className="mt-1.5 w-full space-y-1 text-[9px] leading-tight">
            <p className="w-full font-semibold">
              {formatCustomerName(status.reservation.customerName)} ·{' '}
              {format(reservationStart, 'HH:mm')}
            </p>
            <p
              className={cn(
                'flex w-full items-center justify-center gap-1 font-medium text-muted-foreground',
                status.status === 'late' && 'text-destructive',
                status.status === 'upcoming' && 'text-warning',
              )}
            >
              <Clock3 size={10} />
              {formatServiceTiming(status.reservation, status.status, new Date())}
            </p>
          </div>
        ) : null}
        {showAssignment && assignment ? (
          <p className="mt-1 w-full text-[9px] font-medium text-muted-foreground">{assignment}</p>
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
  draggable?: boolean;
  zoom?: number;
};

function DraggableTable({
  table,
  status,
  onClick,
  style,
  draggable = true,
  zoom = 1,
}: DraggableTableProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: table.id,
    data: { table },
    disabled: !draggable,
  });

  return (
    <TableCard
      table={table}
      status={status}
      onClick={onClick}
      dragRef={setNodeRef as React.Ref<HTMLDivElement>}
      dragProps={draggable ? { ...attributes, ...listeners } : undefined}
      className={cn(
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        isDragging && 'opacity-40 transition-none',
      )}
      style={style}
      zoom={zoom}
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
        transform: `scale(${zoom})`,
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
        transform: `scale(${zoom})`,
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

export function FloorPlanCanvas({
  orgId,
  mode = 'design',
}: {
  orgId: string;
  mode?: 'service' | 'design';
}) {
  const { get, post, patch, del } = useApi();
  const getRef = useRef(get);
  getRef.current = get;

  const [floorPlan, setFloorPlan] = useState<FloorPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [zoom, setZoom] = useState(1);
  const [gridVisible, setGridVisible] = useState(true);
  const [snap, setSnap] = useState(true);
  const live = mode === 'service';
  const [liveDate, setLiveDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [reservations, setReservations] = useState<PlanningReservation[]>([]);
  const [selectedServiceTableId, setSelectedServiceTableId] = useState<string | null>(null);
  const [lockedWallIds, setLockedWallIds] = useState<Set<string>>(() => new Set());

  const [activeDragData, setActiveDragData] = useState<ActiveDragData | null>(null);
  const [dragStart, setDragStart] = useState<DragStartInfo | null>(null);
  const justDraggedRef = useRef(false);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const tableMoveIdRef = useRef(0);
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasViewportRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

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
  const [wallResizeAlignGuide, setWallResizeAlignGuide] = useState<WallResizeAlignGuide | null>(
    null,
  );
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [floorSettings, setFloorSettings] = useState({ name: '', width: 1400, height: 900 });
  const [savingPlan, setSavingPlan] = useState(false);
  const [planSaved, setPlanSaved] = useState(false);

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
      const data = await getRef.current<FloorPlan>(`restaurants/${orgId}/floor-plan`);
      setFloorPlan(data);
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de charger le plan de salle'));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  const loadReservations = useCallback(async () => {
    if (!live) return;
    setError('');
    try {
      const data = await getRef.current<PlanningReservation[]>(
        `restaurants/${orgId}/floor-plan/reservations?date=${liveDate}`,
      );
      setReservations(data);
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de charger les réservations'));
    }
  }, [orgId, live, liveDate]);

  async function savePlan() {
    setSavingPlan(true);
    setError('');
    try {
      const savedPlan = await getRef.current<FloorPlan>(`restaurants/${orgId}/floor-plan`);
      setFloorPlan(savedPlan);
      setPlanSaved(true);
    } catch (err) {
      setError(getErrorMessage(err, "Impossible d'enregistrer le plan"));
    } finally {
      setSavingPlan(false);
    }
  }

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
    const combined = [...sectionTables, ...topTables];
    const usedNumbers = new Set(
      combined
        .map((table) => Number(table.name.match(/^T0*(\d+)$/i)?.[1] ?? 0))
        .filter((number) => number > 0),
    );
    let nextNumber = 1;

    return combined.map((table) => {
      const existingNumber = Number(table.name.match(/^T0*(\d+)$/i)?.[1] ?? 0);
      if (existingNumber > 0) return { ...table, displayName: `T${existingNumber}` };
      while (usedNumbers.has(nextNumber)) nextNumber += 1;
      const displayName = `T${nextNumber}`;
      usedNumbers.add(nextNumber);
      nextNumber += 1;
      return { ...table, displayName };
    });
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

  const selectedWall = useMemo(
    () => (floorPlan?.walls ?? []).find((wall) => wall.id === selectedWallId) ?? null,
    [floorPlan?.walls, selectedWallId],
  );

  const selectedServiceTable = useMemo(
    () => allTables.find((table) => table.id === selectedServiceTableId) ?? null,
    [allTables, selectedServiceTableId],
  );

  function centerCanvas() {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({
      left: Math.max(0, (canvasWidth * zoom - viewport.clientWidth) / 2),
      top: Math.max(0, (canvasHeight * zoom - viewport.clientHeight) / 2),
      behavior: 'smooth',
    });
  }

  function openCreateDialog() {
    setPlanSaved(false);
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
    if (live) {
      setSelectedServiceTableId(table.id);
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
    setPlanSaved(false);

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
    setPlanSaved(false);
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
    setPlanSaved(false);
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

  async function duplicateWall(wall: FloorPlanWall) {
    if (!orgId || live) return;
    setPlanSaved(false);
    try {
      setError('');
      const offset = GRID_SIZE;
      const duplicated = await post<FloorPlanWall>(`restaurants/${orgId}/floor-plan/walls`, {
        x1: Math.min(canvasWidth, wall.x1 + offset),
        y1: Math.min(canvasHeight, wall.y1 + offset),
        x2: Math.min(canvasWidth, wall.x2 + offset),
        y2: Math.min(canvasHeight, wall.y2 + offset),
        type: wall.type,
        name: wall.name ? `${wall.name} copie` : null,
      });
      setFloorPlan((prev) =>
        prev ? { ...prev, walls: [...(prev.walls ?? []), duplicated] } : prev,
      );
      setSelectedWallId(duplicated.id);
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de dupliquer le mur'));
    }
  }

  function toggleWallLock(wallId: string) {
    setLockedWallIds((current) => {
      const next = new Set(current);
      if (next.has(wallId)) next.delete(wallId);
      else next.add(wallId);
      return next;
    });
  }

  function updateWallLength(wall: FloorPlanWall, length: number) {
    if (!Number.isFinite(length) || length < 1) return;
    const angle = Math.atan2(wall.y2 - wall.y1, wall.x2 - wall.x1);
    const nextWall = {
      ...wall,
      x2: Math.round(wall.x1 + Math.cos(angle) * length),
      y2: Math.round(wall.y1 + Math.sin(angle) * length),
    };
    void updateWall(nextWall, nextWall.type, nextWall.name ?? null);
  }

  function updateWallAngle(wall: FloorPlanWall, degrees: number) {
    if (!Number.isFinite(degrees)) return;
    const length = getWallLength(wall);
    const radians = (degrees * Math.PI) / 180;
    const nextWall = {
      ...wall,
      x2: Math.round(wall.x1 + Math.cos(radians) * length),
      y2: Math.round(wall.y1 + Math.sin(radians) * length),
    };
    void updateWall(nextWall, nextWall.type, nextWall.name ?? null);
  }

  async function handleSaveFloorSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setError('');
    setPlanSaved(false);
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
    if (live || lockedWallIds.has(wall.id)) return;
    e.stopPropagation();
    setSelectedWallId(wall.id);
    setWallDragMode(mode);
    setWallDragStart({ pointerX: e.clientX, pointerY: e.clientY, wall });
    wallDragCurrentRef.current = wall;
    setWallLengthGuide(null);
    setWallResizeAlignGuide(null);
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

  function findWallResizeAlignGuide(
    wall: FloorPlanWall,
    mode: 'resize-start' | 'resize-end',
  ): { guide: WallResizeAlignGuide; coords: Partial<FloorPlanWall> } | null {
    const horizontal = Math.abs(wall.y1 - wall.y2) <= 0.5;
    const vertical = Math.abs(wall.x1 - wall.x2) <= 0.5;
    if (!horizontal && !vertical) return null;

    const dragged =
      mode === 'resize-start' ? { x: wall.x1, y: wall.y1 } : { x: wall.x2, y: wall.y2 };
    const candidates: { axis: 'x' | 'y'; value: number; dist: number }[] = [];

    const addCandidate = (axis: 'x' | 'y', value: number) => {
      const dist = Math.abs((axis === 'x' ? dragged.x : dragged.y) - value);
      if (dist <= WALL_ALIGN_GUIDE_DISTANCE) {
        candidates.push({ axis, value, dist });
      }
    };

    for (const referenceWall of floorPlan?.walls ?? []) {
      if (referenceWall.id === wall.id) continue;
      if (horizontal) {
        addCandidate('x', referenceWall.x1);
        addCandidate('x', referenceWall.x2);
      } else if (vertical) {
        addCandidate('y', referenceWall.y1);
        addCandidate('y', referenceWall.y2);
      }
    }

    if (candidates.length === 0) return null;

    const match = candidates.reduce((a, b) => (a.dist < b.dist ? a : b));
    const coords =
      mode === 'resize-start'
        ? match.axis === 'x'
          ? { x1: match.value }
          : { y1: match.value }
        : match.axis === 'x'
          ? { x2: match.value }
          : { y2: match.value };

    return {
      coords,
      guide: {
        axis: match.axis,
        value: match.value,
      },
    };
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
      const lengthGuide = findWallLengthGuide(nextWall);
      if (lengthGuide) {
        const lengthMatched = matchWallLengthToGuide(nextWall, wallDragMode, lengthGuide);
        finalCoords = { ...finalCoords, ...lengthMatched };
        nextWall = { ...wallDragStart.wall, ...finalCoords };
        setWallLengthGuide({ ...lengthGuide, activeWall: nextWall });
      } else {
        setWallLengthGuide(null);
      }

      const alignGuide = findWallResizeAlignGuide(nextWall, wallDragMode);
      if (alignGuide) {
        finalCoords = { ...finalCoords, ...alignGuide.coords };
        nextWall = { ...wallDragStart.wall, ...finalCoords };
        setWallResizeAlignGuide(alignGuide.guide);
      } else {
        setWallResizeAlignGuide(null);
      }
    } else {
      setWallLengthGuide(null);
      setWallResizeAlignGuide(null);
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
    setWallResizeAlignGuide(null);
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

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;

      if (event.key.toLowerCase() === 'g') {
        event.preventDefault();
        setGridVisible((visible) => !visible);
      } else if (event.key.toLowerCase() === 's' && !live) {
        event.preventDefault();
        setSnap((enabled) => !enabled);
      } else if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        centerCanvas();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
        if (selectedWall && !live) {
          event.preventDefault();
          void duplicateWall(selectedWall);
        }
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  });

  function handleDragStart(event: DragStartEvent) {
    if (live) return;
    setPlanSaved(false);
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
    if (live) {
      handleDragCancel();
      return;
    }
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
        const numericTableNames = allTables
          .map((table) => Number(table.name.match(/^T(\d+)$/i)?.[1] ?? 0))
          .filter((value) => value > 0);
        const name = `T${Math.max(0, ...numericTableNames) + 1}`;

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
          <DialogTitle>Ajouter une salle</DialogTitle>
          <DialogDescription>
            Définissez le nom et les dimensions de la salle affichée sur le plan.
          </DialogDescription>
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
            Enregistrer la salle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const selectedServiceStatus = selectedServiceTable
    ? tableStatuses.get(selectedServiceTable.id)
    : undefined;
  const selectedServiceReservation = selectedServiceStatus?.reservation ?? null;

  const inspector = live ? (
    <aside className="flex h-full w-72 min-w-72 flex-col border-l border-border bg-card">
      <div className="border-b border-border p-4">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-50" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
          </span>
          <p className="text-sm font-semibold">Service en direct</p>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Le plan est entièrement verrouillé.</p>
      </div>
      {selectedServiceTable ? (
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          <div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold">
                  {selectedServiceTable.displayName ?? selectedServiceTable.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {selectedServiceTable.capacity} places
                  {selectedServiceTable.sectionName ? ` · ${selectedServiceTable.sectionName}` : ''}
                </p>
              </div>
              <Badge variant="outline">
                {selectedServiceStatus
                  ? statusMeta[selectedServiceStatus.status].label
                  : 'Disponible'}
              </Badge>
            </div>
          </div>
          {selectedServiceReservation ? (
            <div className="space-y-3 rounded-lg border border-border bg-background p-3">
              <div className="flex items-center gap-2 text-sm">
                <UserRound size={16} className="text-muted-foreground" />
                <span className="font-medium">
                  {selectedServiceReservation.customerName || 'Sans nom'}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Users size={16} className="text-muted-foreground" />
                <span>{selectedServiceReservation.partySize} personnes</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Clock3 size={16} className="text-muted-foreground" />
                <span>
                  {format(parseISO(selectedServiceReservation.startsAt), 'HH:mm')} ·{' '}
                  {formatServiceTiming(
                    selectedServiceReservation,
                    selectedServiceStatus?.status ?? 'upcoming',
                    new Date(),
                  )}
                </span>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-4 text-center">
              <p className="text-sm font-medium">Table disponible</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Aucune réservation en cours ou imminente.
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 space-y-4 p-4">
          <p className="text-sm font-medium">Vue d’ensemble</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border bg-background p-3">
              <p className="text-xl font-semibold">
                {[...tableStatuses.values()].filter((item) => item.status === 'occupied').length}
              </p>
              <p className="text-xs text-muted-foreground">Occupées</p>
            </div>
            <div className="rounded-lg border border-border bg-background p-3">
              <p className="text-xl font-semibold">
                {
                  [...tableStatuses.values()].filter((item) =>
                    ['reserved', 'upcoming', 'late'].includes(item.status),
                  ).length
                }
              </p>
              <p className="text-xs text-muted-foreground">Attendues</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Sélectionnez une table pour afficher la réservation et le temps d’occupation.
          </p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-4">
            {(['free', 'reserved', 'upcoming', 'late', 'occupied'] as TableStatus[]).map(
              (status) => {
                const StatusIcon = statusMeta[status].icon;
                return (
                  <div
                    key={status}
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                  >
                    <span
                      className={cn(
                        'flex size-6 shrink-0 items-center justify-center rounded-md border',
                        statusClasses[status],
                      )}
                    >
                      <StatusIcon className="size-3.5" aria-hidden="true" />
                    </span>
                    <span>{statusMeta[status].label}</span>
                  </div>
                );
              },
            )}
          </div>
        </div>
      )}
    </aside>
  ) : (
    <aside className="flex h-full w-72 min-w-72 flex-col border-l border-border bg-card">
      <div className="border-b border-border p-4">
        <p className="text-sm font-semibold">Inspecteur</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {selectedWall ? 'Propriétés du mur sélectionné' : 'Sélectionnez un objet du plan'}
        </p>
      </div>
      {selectedWall ? (
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="space-y-2">
            <Label htmlFor="wall-inspector-type">Type</Label>
            <Select
              value={selectedWall.type}
              onValueChange={(value) =>
                void updateWall(selectedWall, value as WallType, selectedWall.name ?? null)
              }
            >
              <SelectTrigger id="wall-inspector-type" className="bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="wall">Mur</SelectItem>
                <SelectItem value="door">Porte</SelectItem>
                <SelectItem value="window">Fenêtre</SelectItem>
                <SelectItem value="bar">Bar</SelectItem>
                <SelectItem value="plant">Décor</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="wall-inspector-name">Nom</Label>
            <Input
              key={`name-${selectedWall.id}-${selectedWall.name ?? ''}`}
              id="wall-inspector-name"
              defaultValue={selectedWall.name ?? ''}
              placeholder="Ex. Mur terrasse"
              className="bg-background"
              onBlur={(event) =>
                void updateWall(
                  selectedWall,
                  selectedWall.type,
                  event.currentTarget.value.trim() || null,
                )
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="wall-inspector-length">Longueur</Label>
              <Input
                key={`length-${selectedWall.id}-${getWallLength(selectedWall)}`}
                id="wall-inspector-length"
                type="number"
                min={1}
                defaultValue={Math.round(getWallLength(selectedWall))}
                className="bg-background"
                onBlur={(event) =>
                  updateWallLength(selectedWall, Number(event.currentTarget.value))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wall-inspector-angle">Angle</Label>
              <Input
                key={`angle-${selectedWall.id}-${selectedWall.x2}-${selectedWall.y2}`}
                id="wall-inspector-angle"
                type="number"
                defaultValue={Math.round(
                  (Math.atan2(
                    selectedWall.y2 - selectedWall.y1,
                    selectedWall.x2 - selectedWall.x1,
                  ) *
                    180) /
                    Math.PI,
                )}
                className="bg-background"
                onBlur={(event) => updateWallAngle(selectedWall, Number(event.currentTarget.value))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(['x1', 'y1'] as const).map((coordinate) => (
              <div key={coordinate} className="space-y-2">
                <Label htmlFor={`wall-inspector-${coordinate}`}>
                  Position {coordinate === 'x1' ? 'X' : 'Y'}
                </Label>
                <Input
                  key={`${coordinate}-${selectedWall.id}-${selectedWall[coordinate]}`}
                  id={`wall-inspector-${coordinate}`}
                  type="number"
                  defaultValue={Math.round(selectedWall[coordinate])}
                  className="bg-background"
                  onBlur={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (!Number.isFinite(value)) return;
                    const delta = value - selectedWall[coordinate];
                    const nextWall =
                      coordinate === 'x1'
                        ? { ...selectedWall, x1: value, x2: selectedWall.x2 + delta }
                        : { ...selectedWall, y1: value, y2: selectedWall.y2 + delta };
                    void updateWall(nextWall, nextWall.type, nextWall.name ?? null);
                  }}
                />
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-border bg-background p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Verrouillage</p>
                <p className="text-xs text-muted-foreground">Empêche tout déplacement.</p>
              </div>
              <Button
                type="button"
                variant={lockedWallIds.has(selectedWall.id) ? 'default' : 'outline'}
                size="sm"
                title={
                  lockedWallIds.has(selectedWall.id) ? 'Déverrouiller le mur' : 'Verrouiller le mur'
                }
                onClick={() => toggleWallLock(selectedWall.id)}
              >
                {lockedWallIds.has(selectedWall.id) ? <Lock size={16} /> : <Unlock size={16} />}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => void duplicateWall(selectedWall)}
            >
              <Copy size={16} className="mr-2" />
              Dupliquer
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                void deleteWall(selectedWall.id);
                setSelectedWallId(null);
              }}
            >
              <Trash2 size={16} className="mr-2" />
              Supprimer
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <Move size={24} className="mb-3 text-muted-foreground" />
          <p className="text-sm font-medium">Aucun objet sélectionné</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Cliquez sur un mur pour modifier ses dimensions et sa position.
          </p>
        </div>
      )}
    </aside>
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
      <Card ref={cardRef} className="sokar-card overflow-hidden">
        <CardHeader className="flex flex-col gap-3 border-b border-border p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <CardTitle className="text-base font-medium">
              {floorPlan?.name || 'Plan de salle'}
            </CardTitle>
            {!live ? (
              <Button
                type="button"
                variant={planSaved ? 'outline' : 'default'}
                size="sm"
                className="gap-2 transition-all duration-200"
                disabled={savingPlan}
                onClick={() => void savePlan()}
              >
                {planSaved ? <Check size={16} /> : <Save size={16} />}
                {savingPlan
                  ? 'Enregistrement…'
                  : planSaved
                    ? 'Plan enregistré'
                    : 'Enregistrer le plan'}
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
            <div className="flex items-center gap-1 rounded-md border border-border bg-background p-1">
              <Button
                variant="ghost"
                size="sm"
                title="Zoom arrière — −"
                aria-label="Zoom arrière"
                onClick={() =>
                  setZoom((z) => Math.max(MIN_ZOOM, Math.round((z - ZOOM_STEP) * 10) / 10))
                }
              >
                <ZoomOut size={16} />
              </Button>
              <span className="min-w-11 text-center text-xs text-muted-foreground">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                variant="ghost"
                size="sm"
                title="Zoom avant — +"
                aria-label="Zoom avant"
                onClick={() =>
                  setZoom((z) => Math.min(MAX_ZOOM, Math.round((z + ZOOM_STEP) * 10) / 10))
                }
              >
                <ZoomIn size={16} />
              </Button>
              <Button variant="ghost" size="sm" title="Centrer le plan — F" onClick={centerCanvas}>
                <RotateCcw size={16} className="mr-1.5" />
                Centrer
              </Button>
              <Button
                variant="ghost"
                size="sm"
                title="Plein écran"
                onClick={() => {
                  if (document.fullscreenElement) void document.exitFullscreen();
                  else void cardRef.current?.requestFullscreen();
                }}
              >
                <Maximize2 size={16} />
              </Button>
              <Button
                variant={gridVisible ? 'secondary' : 'ghost'}
                size="sm"
                title="Afficher ou masquer la grille — G"
                aria-pressed={gridVisible}
                onClick={() => setGridVisible((v) => !v)}
              >
                <Grid3x3 size={16} className="mr-1.5" />
                Grille
              </Button>
            </div>
            {!live ? (
              <>
                <div className="flex items-center gap-1 rounded-md border border-border bg-background p-1">
                  <span className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Alignement
                  </span>
                  <Button
                    variant={snap ? 'secondary' : 'ghost'}
                    size="sm"
                    title="Activer ou désactiver le magnétisme — S"
                    aria-pressed={snap}
                    onClick={() => setSnap((s) => !s)}
                  >
                    <Magnet size={16} className="mr-1.5" />
                    Magnétisme
                  </Button>
                </div>
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    variant="default"
                    size="sm"
                    title="Ajouter ou configurer une salle"
                    onClick={() => {
                      setFloorSettings({
                        name: floorPlan?.name ?? '',
                        width: floorPlan?.width ?? 1400,
                        height: floorPlan?.height ?? 900,
                      });
                      setSettingsDialogOpen(true);
                    }}
                  >
                    <Plus size={16} className="mr-1.5" />
                    Ajouter une salle
                  </Button>
                  <Button size="sm" onClick={openCreateDialog}>
                    <Plus size={16} className="mr-1.5" />
                    Ajouter une table
                  </Button>
                </div>
              </>
            ) : (
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Input
                  type="date"
                  value={liveDate}
                  aria-label="Date du service"
                  onChange={(e) => setLiveDate(e.target.value)}
                  className="w-40 bg-background border-border"
                />
                <Badge variant="outline" className="gap-1.5 py-1.5">
                  <ListFilter size={14} /> {reservations.length} réservations
                </Badge>
                <Badge variant="outline" className="gap-1.5 py-1.5">
                  <BarChart3 size={14} />
                  {[...tableStatuses.values()].filter((item) => item.status === 'occupied').length}/
                  {allTables.filter((table) => table.isActive).length} occupées
                </Badge>
              </div>
            )}
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
              {!live ? <FloorPlanPalette /> : null}
              <div
                ref={canvasViewportRef}
                className="relative min-w-0 flex-1 overflow-auto bg-muted"
              >
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
                          isSelected={!live && selectedWallId === w.id}
                          editable={!live}
                          locked={lockedWallIds.has(w.id)}
                          onClick={() => {
                            if (live) return;
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
                      {wallResizeAlignGuide ? (
                        <g className="pointer-events-none">
                          {wallResizeAlignGuide.axis === 'y' ? (
                            <line
                              x1={0}
                              y1={wallResizeAlignGuide.value}
                              x2={canvasWidth}
                              y2={wallResizeAlignGuide.value}
                              stroke="hsl(var(--primary))"
                              strokeWidth={2}
                              strokeDasharray="6 4"
                              opacity={0.95}
                            />
                          ) : (
                            <line
                              x1={wallResizeAlignGuide.value}
                              y1={0}
                              x2={wallResizeAlignGuide.value}
                              y2={canvasHeight}
                              stroke="hsl(var(--primary))"
                              strokeWidth={2}
                              strokeDasharray="6 4"
                              opacity={0.95}
                            />
                          )}
                        </g>
                      ) : null}
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
                        draggable={!live}
                        zoom={zoom}
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
              {inspector}
            </div>
            {typeof document !== 'undefined'
              ? createPortal(
                  <DragOverlay dropAnimation={null}>
                    {activeDragTable
                      ? (() => {
                          const { width: tw, height: th } = getTableSize(activeDragTable);
                          return (
                            <TableCard
                              table={activeDragTable}
                              status={live ? tableStatuses.get(activeDragTable.id) : undefined}
                              isOverlay
                              zoom={zoom}
                              style={{
                                transform: `scale(${zoom})`,
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
                  </DragOverlay>,
                  document.body,
                )
              : null}
          </DndContext>
        </CardContent>
      </Card>
      {dialog}
      {confirm}
      {settingsDialog}
    </>
  );
}
