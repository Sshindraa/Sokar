'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
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
  formatDistanceToNow,
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
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignHorizontalJustifyCenter,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyEnd,
  RotateCw,
  Grip,
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
  useDroppable,
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

const TABLE_BORDER_WIDTH = 2;
const TABLE_CONTENT_PADDING = 8;
const CHAIR_SIZE = 12;
const CHAIR_GAP = 4;
const ROUND_TABLE_VISUAL_GAP = 12;
const MAXIMUM_CHAIR_COUNT = 16;
const MINIMUM_TABLE_DIMENSION = TABLE_CONTENT_PADDING * 2 + CHAIR_SIZE * 4;

export const TABLE_LAYOUT = {
  borderWidth: TABLE_BORDER_WIDTH,
  contentPadding: TABLE_CONTENT_PADDING,
  chairSize: CHAIR_SIZE,
  chairGap: CHAIR_GAP,
  roundTableVisualGap: ROUND_TABLE_VISUAL_GAP,
  maximumChairCount: MAXIMUM_CHAIR_COUNT,
  minimumDimension: MINIMUM_TABLE_DIMENSION,
} as const;

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

type ActiveDragData =
  | PaletteItemData
  | { kind: 'existingTable'; table: CanvasTable }
  | { kind: 'reservation'; reservation: PlanningReservation; fromTableId: string };

export function getSafeTableDimensions(
  width: number,
  height: number,
): {
  width: number;
  height: number;
} {
  return {
    width: Math.max(TABLE_LAYOUT.minimumDimension, width),
    height: Math.max(TABLE_LAYOUT.minimumDimension, height),
  };
}

function getTableSize(table: {
  capacity?: number | null;
  shape?: TableShape | null;
  width?: number | null;
  height?: number | null;
  rotation?: number | null;
}): {
  width: number;
  height: number;
  rotation: number;
} {
  const base = 88;
  const capacity = table.capacity ?? 1;
  const extra = Math.min(capacity, 12) * 12;
  const size = Math.min(base + extra, 220);
  const shape = table.shape ?? 'rect';
  const legacyWidth = size;
  const legacyHeight = shape === 'round' ? size : 112;
  const dimensions = getSafeTableDimensions(
    table.width ?? legacyWidth,
    table.height ?? legacyHeight,
  );
  return {
    ...dimensions,
    rotation: table.rotation ?? 0,
  };
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

type ChairPosition = {
  left: number;
  top: number;
};

type ChairLayoutInput = {
  width: number;
  height: number;
  capacity?: number | null;
  shape?: TableShape | null;
};

export function getChairPositions({
  width: unsafeWidth,
  height: unsafeHeight,
  capacity,
  shape = 'rect',
}: ChairLayoutInput): ChairPosition[] {
  const { width, height } = getSafeTableDimensions(unsafeWidth, unsafeHeight);
  const chairCount = Math.min(capacity ?? 1, TABLE_LAYOUT.maximumChairCount);
  const halfChairSize = TABLE_LAYOUT.chairSize / 2;
  // TableCard uses `border-2` with `box-border`, so absolute children are
  // positioned relative to the padding box. We must offset by the 2px border.
  const { borderWidth, chairGap, chairSize, roundTableVisualGap } = TABLE_LAYOUT;
  const chairs: ChairPosition[] = [];

  if (shape === 'round') {
    const centerX = width / 2 - borderWidth;
    const centerY = height / 2 - borderWidth;
    const chairClearance = roundTableVisualGap + (chairSize / 2) * Math.SQRT2;
    const radiusX = width / 2 + chairClearance;
    const radiusY = height / 2 + chairClearance;
    for (let i = 0; i < chairCount; i++) {
      const angle = (i / chairCount) * 2 * Math.PI - Math.PI / 2;
      chairs.push({
        left: centerX + radiusX * Math.cos(angle) - halfChairSize,
        top: centerY + radiusY * Math.sin(angle) - halfChairSize,
      });
    }
    return chairs;
  }

  const perimeter = 2 * (width + height);
  let topCount = Math.max(0, Math.round((chairCount * width) / perimeter));
  let bottomCount = topCount;
  let leftCount = Math.max(0, Math.round((chairCount * height) / perimeter));
  let rightCount = leftCount;
  const total = topCount + bottomCount + leftCount + rightCount;

  const adjust = (remaining: number) => {
    while (remaining !== 0) {
      if (remaining > 0) {
        if (width >= height) {
          topCount++;
          if (--remaining === 0) break;
          bottomCount++;
          remaining--;
        } else {
          leftCount++;
          if (--remaining === 0) break;
          rightCount++;
          remaining--;
        }
      } else if (width >= height) {
        if (leftCount > 0) {
          leftCount--;
        } else if (rightCount > 0) {
          rightCount--;
        } else if (topCount > 1) {
          topCount--;
        } else if (bottomCount > 1) {
          bottomCount--;
        } else {
          break;
        }
        remaining++;
      } else {
        if (topCount > 0) {
          topCount--;
        } else if (bottomCount > 0) {
          bottomCount--;
        } else if (leftCount > 1) {
          leftCount--;
        } else if (rightCount > 1) {
          rightCount--;
        } else {
          break;
        }
        remaining++;
      }
    }
  };

  adjust(chairCount - total);

  const place = (count: number, length: number, side: 'top' | 'bottom' | 'left' | 'right') => {
    if (count <= 0) return;
    const spacing = length / (count + 1);
    for (let i = 1; i <= count; i++) {
      const position = i * spacing;
      if (side === 'top') {
        chairs.push({
          left: position - halfChairSize - borderWidth,
          top: -(chairSize + chairGap + borderWidth),
        });
      } else if (side === 'bottom') {
        chairs.push({
          left: position - halfChairSize - borderWidth,
          top: height - borderWidth + chairGap,
        });
      } else if (side === 'left') {
        chairs.push({
          left: -(chairSize + chairGap + borderWidth),
          top: position - halfChairSize - borderWidth,
        });
      } else {
        chairs.push({
          left: width - borderWidth + chairGap,
          top: position - halfChairSize - borderWidth,
        });
      }
    }
  };

  place(topCount, width, 'top');
  place(bottomCount, width, 'bottom');
  place(leftCount, height, 'left');
  place(rightCount, height, 'right');

  return chairs;
}

function renderChairs(table: CanvasTable): React.ReactNode[] {
  const { width, height } = getTableSize(table);
  const chairs = getChairPositions({
    width,
    height,
    capacity: table.capacity,
    shape: table.shape,
  });
  const chairClassName = 'absolute rounded-full border-2 border-background bg-muted-foreground/80';
  const baseStyle: React.CSSProperties = {
    width: TABLE_LAYOUT.chairSize,
    height: TABLE_LAYOUT.chairSize,
    boxSizing: 'border-box',
  };

  return chairs.map(({ left, top }, index) => (
    <div key={`chair-${index}`} className={chairClassName} style={{ ...baseStyle, left, top }} />
  ));
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
  onClick?: (e?: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  dragRef?: React.Ref<HTMLDivElement>;
  dragProps?: React.HTMLAttributes<HTMLDivElement>;
  isOverlay?: boolean;
  isSelected?: boolean;
  onResizeStart?: (e: React.PointerEvent) => void;
  onRotateStart?: (e: React.PointerEvent) => void;
  style?: React.CSSProperties;
  className?: string;
  zoom?: number;
  draggableReservation?: boolean;
};

function TableCard({
  table,
  status,
  onClick,
  onDoubleClick,
  dragRef,
  dragProps,
  isOverlay,
  isSelected,
  onResizeStart,
  onRotateStart,
  style,
  className,
  zoom = 1,
  draggableReservation,
}: TableCardProps) {
  const { width, height, rotation } = getTableSize(table);
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
        'box-border flex min-w-0 min-h-0 flex-col items-center justify-center border-2 p-2 text-center transition-[opacity,background-color,border-color,box-shadow] duration-200 select-none relative shadow-sm',
        table.shape === 'round' ? 'rounded-full aspect-square' : 'rounded-md',
        'overflow-visible hover:ring-2 hover:ring-ring/60 hover:ring-offset-1',
        status ? statusClasses[status.status] : 'bg-card border-border text-foreground',
        isSelected && 'ring-2 ring-primary ring-offset-1',
        !isOverlay && 'absolute',
        className,
      )}
      style={{
        width,
        height,
        ...style,
        transform: style?.transform
          ? `${style.transform} rotate(${rotation}deg)`
          : `rotate(${rotation}deg)`,
        transformOrigin: style?.transformOrigin ?? 'center',
      }}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick?.();
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && onClick) {
          e.preventDefault();
          onClick?.();
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
        <div className="flex min-w-0 w-full flex-wrap items-baseline justify-center gap-1 leading-none">
          <p className="min-w-0 text-xs font-bold tracking-tight">{displayName}</p>
          {showCapacity ? (
            <p className="min-w-0 text-[9px] font-medium text-muted-foreground">
              · {table.capacity} places
            </p>
          ) : null}
        </div>
        {showServiceDetails && status?.reservation && reservationStart && !isOverlay ? (
          <DraggableReservation
            reservation={status.reservation}
            fromTableId={table.id}
            status={status.status}
            disabled={!draggableReservation}
          />
        ) : null}
        {showAssignment && assignment ? (
          <p className="mt-1 w-full text-[9px] font-medium text-muted-foreground">{assignment}</p>
        ) : null}
      </div>
      {isSelected && !isOverlay && onResizeStart ? (
        <div
          className="absolute -bottom-1.5 -right-1.5 z-30 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border border-background bg-primary shadow-sm"
          onPointerDown={(e) => {
            e.stopPropagation();
            onResizeStart(e as unknown as React.PointerEvent);
          }}
          title="Redimensionner"
        />
      ) : null}
      {isSelected && !isOverlay && onRotateStart ? (
        <div
          className="absolute -top-3 left-1/2 z-30 flex h-5 w-5 -translate-x-1/2 cursor-grab items-center justify-center rounded-full border border-background bg-primary text-background shadow-sm"
          onPointerDown={(e) => {
            e.stopPropagation();
            onRotateStart(e as unknown as React.PointerEvent);
          }}
          title="Tourner"
        >
          <RotateCw size={10} />
        </div>
      ) : null}
    </div>
  );
}

function DraggableReservation({
  reservation,
  fromTableId,
  status,
  disabled = false,
}: {
  reservation: PlanningReservation;
  fromTableId: string;
  status: TableStatus;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `reservation-${reservation.id}`,
    data: { kind: 'reservation', reservation, fromTableId } as ActiveDragData,
    disabled,
  });

  const reservationStart = reservation.startsAt ? parseISO(reservation.startsAt) : null;
  const { onPointerDown, ...otherListeners } = listeners ?? {};

  return (
    <div
      ref={setNodeRef}
      {...otherListeners}
      {...attributes}
      onPointerDown={(e) => {
        onPointerDown?.(e);
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'mt-1.5 w-full space-y-1 text-[9px] leading-tight rounded-sm',
        !disabled && 'cursor-grab active:cursor-grabbing hover:bg-background/40',
        isDragging && 'opacity-0',
      )}
    >
      <p className="w-full font-semibold">
        {formatCustomerName(reservation.customerName)} ·{' '}
        {reservationStart ? format(reservationStart, 'HH:mm') : '—'}
      </p>
      <p
        className={cn(
          'flex w-full items-center justify-center gap-1 font-medium text-muted-foreground',
          status === 'late' && 'text-destructive',
          status === 'upcoming' && 'text-warning',
        )}
      >
        <Clock3 size={10} />
        {formatServiceTiming(reservation, status, new Date())}
      </p>
    </div>
  );
}

type DraggableTableProps = {
  table: CanvasTable;
  status?: { status: TableStatus; reservation: PlanningReservation | null };
  isSelected?: boolean;
  onClick: (e?: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  onResizeStart?: (e: React.PointerEvent) => void;
  onRotateStart?: (e: React.PointerEvent) => void;
  style?: React.CSSProperties;
  draggable?: boolean;
  droppable?: boolean;
  draggableReservation?: boolean;
  zoom?: number;
};

function DraggableTable({
  table,
  status,
  isSelected,
  onClick,
  onDoubleClick,
  onResizeStart,
  onRotateStart,
  style,
  draggable = true,
  droppable = false,
  draggableReservation,
  zoom = 1,
}: DraggableTableProps) {
  const {
    attributes,
    listeners,
    setNodeRef: setDragNodeRef,
    isDragging,
  } = useDraggable({
    id: table.id,
    data: { table },
    disabled: !draggable,
  });

  const { setNodeRef: setDropNodeRef, isOver } = useDroppable({
    id: table.id,
    data: { table },
    disabled: !droppable,
  });

  const setNodeRef = useCallback(
    (node: HTMLDivElement | null) => {
      setDragNodeRef(node);
      setDropNodeRef(node);
    },
    [setDragNodeRef, setDropNodeRef],
  );

  return (
    <TableCard
      table={table}
      status={status}
      isSelected={isSelected}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onResizeStart={onResizeStart}
      onRotateStart={onRotateStart}
      dragRef={setNodeRef}
      dragProps={draggable ? { ...attributes, ...listeners } : undefined}
      draggableReservation={draggableReservation}
      className={cn(
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        isDragging && 'opacity-40 transition-none',
        droppable && isOver && 'ring-2 ring-primary ring-offset-1',
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
      width: null,
      height: null,
      rotation: 0,
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

function ElapsedSince({ date, prefix }: { date: number; prefix: string }) {
  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const id = setInterval(() => forceRender(), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      {prefix}
      {formatDistanceToNow(date, { locale: fr, addSuffix: true })}
    </>
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
  const patchRef = useRef(patch);
  patchRef.current = patch;
  const postRef = useRef(post);
  postRef.current = post;

  const [floorPlan, setFloorPlan] = useState<FloorPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [zoom, setZoom] = useState(1);
  const [gridVisible, setGridVisible] = useState(true);
  const [snap, setSnap] = useState(true);
  const live = mode === 'service';
  const [liveDate, setLiveDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const liveDateRef = useRef(liveDate);
  liveDateRef.current = liveDate;
  const [reservations, setReservations] = useState<PlanningReservation[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [selectedServiceTableId, setSelectedServiceTableId] = useState<string | null>(null);
  const [suggestedTable, setSuggestedTable] = useState<{ tableId: string; reason: string } | null>(
    null,
  );
  const [lockedWallIds, setLockedWallIds] = useState<Set<string>>(() => new Set());

  const [selectedTableIds, setSelectedTableIds] = useState<Set<string>>(() => new Set());
  const [lastSelectedTableId, setLastSelectedTableId] = useState<string | null>(null);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [duplicateForm, setDuplicateForm] = useState({
    count: 6,
    mode: 'row' as 'row' | 'grid',
    spacing: 32,
    cols: 3,
    rows: 2,
    spacingY: 32,
  });
  const [resizeTableId, setResizeTableId] = useState<string | null>(null);
  const resizeStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    width: number;
    height: number;
    currentWidth?: number;
    currentHeight?: number;
  } | null>(null);
  const [rotateTableId, setRotateTableId] = useState<string | null>(null);
  const rotateStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    startRotation: number;
    centerX: number;
    centerY: number;
    currentRotation?: number;
  } | null>(null);

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
  const [multiDeleteConfirmOpen, setMultiDeleteConfirmOpen] = useState(false);

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

  const pollAbortRef = useRef<AbortController | null>(null);
  const pollInFlightRef = useRef(false);

  const loadReservations = useCallback(
    async ({ force }: { force?: boolean } = {}) => {
      if (!live) return;
      if (pollInFlightRef.current && !force) return;
      if (force) {
        pollAbortRef.current?.abort();
      }
      const controller = new AbortController();
      pollAbortRef.current = controller;
      pollInFlightRef.current = true;
      setError('');
      try {
        const data = await getRef.current<PlanningReservation[]>(
          `restaurants/${orgId}/floor-plan/reservations?date=${liveDate}`,
          { signal: controller.signal },
        );
        if (pollAbortRef.current !== controller) return;
        if (liveDateRef.current !== liveDate) return;
        setReservations(data);
        setLastUpdatedAt(Date.now());
      } catch (err) {
        if (pollAbortRef.current !== controller) return;
        if (controller.signal.aborted) return;
        setError(getErrorMessage(err, 'Impossible de charger les réservations'));
      } finally {
        if (pollAbortRef.current === controller) {
          pollInFlightRef.current = false;
        }
      }
    },
    [orgId, live, liveDate],
  );

  const updateReservationState = useCallback(
    async (reservationId: string, state: 'SEATED' | 'HONORED') => {
      if (!orgId) return;
      try {
        await patchRef.current<void>(
          `restaurants/${orgId}/floor-plan/reservations/${reservationId}/state`,
          { state },
        );
        setReservations((prev) => prev.map((r) => (r.id === reservationId ? { ...r, state } : r)));
        await loadReservations({ force: true });
      } catch (err) {
        setError(getErrorMessage(err, 'Impossible de mettre à jour le statut'));
      }
    },
    [orgId, loadReservations],
  );

  const createWalkIn = useCallback(
    async (tableId: string) => {
      if (!orgId) return;
      try {
        const idempotencyKey = crypto.randomUUID();
        const res = await postRef.current<{ id: string }>(
          `restaurants/${orgId}/floor-plan/walk-ins`,
          {
            tableId,
            partySize: 2,
            customerName: 'Walk-in',
            idempotencyKey,
          },
        );
        const now = new Date().toISOString();
        setReservations((prev) => [
          ...prev,
          {
            id: res.id,
            tableId,
            tableName: null,
            sectionName: null,
            startsAt: now,
            endsAt: now,
            partySize: 2,
            customerName: 'Walk-in',
            state: 'SEATED',
            seatedAt: now,
          },
        ]);
        await loadReservations({ force: true });
      } catch (err) {
        setError(getErrorMessage(err, 'Impossible de créer le walk-in'));
      }
    },
    [orgId, loadReservations],
  );

  const suggestTable = useCallback(
    async (reservationId: string) => {
      if (!orgId) return;
      setSuggestedTable(null);
      try {
        const res = await getRef.current<{ tableId: string | null; reason: string }>(
          `restaurants/${orgId}/floor-plan/reservations/${reservationId}/suggest-table`,
        );
        if (res.tableId) setSuggestedTable({ tableId: res.tableId, reason: res.reason });
        else setError(res.reason || 'Aucune table disponible');
      } catch (err) {
        setError(getErrorMessage(err, 'Impossible de suggérer une table'));
      }
    },
    [orgId],
  );

  const assignTable = useCallback(
    async (reservationId: string, tableId: string) => {
      if (!orgId) return;
      try {
        await patchRef.current<void>(
          `restaurants/${orgId}/floor-plan/reservations/${reservationId}/assign-table`,
          { tableId },
        );
        setReservations((prev) =>
          prev.map((r) => (r.id === reservationId ? { ...r, tableId } : r)),
        );
        setSuggestedTable(null);
        await loadReservations({ force: true });
      } catch (err) {
        setError(getErrorMessage(err, 'Impossible d’assigner la table'));
      }
    },
    [orgId, loadReservations],
  );

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
    loadReservations({ force: true });

    let timer: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => {
      if (timer) return;
      timer = setInterval(() => {
        loadReservations();
      }, 10000);
    };
    const stopPolling = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        loadReservations({ force: true });
        startPolling();
      }
    };

    startPolling();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      pollAbortRef.current?.abort();
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibility);
    };
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

  const selectedTables = useMemo(
    () => allTables.filter((table) => selectedTableIds.has(table.id)),
    [allTables, selectedTableIds],
  );

  const selectedTable = useMemo(
    () => (selectedTableIds.size === 1 ? (selectedTables[0] ?? null) : null),
    [selectedTables, selectedTableIds.size],
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

  function selectTable(table: CanvasTable, event?: React.MouseEvent) {
    if (!event) {
      setSelectedTableIds(new Set([table.id]));
      setLastSelectedTableId(table.id);
      setSelectedWallId(null);
      return;
    }
    const isMeta = event.ctrlKey || event.metaKey;
    const isShift = event.shiftKey;
    if (isMeta) {
      setSelectedTableIds((prev) => {
        const next = new Set(prev);
        if (next.has(table.id)) next.delete(table.id);
        else next.add(table.id);
        return next;
      });
      setLastSelectedTableId(table.id);
      setSelectedWallId(null);
      return;
    }
    if (isShift && lastSelectedTableId) {
      const ids = allTables.map((t) => t.id);
      const start = ids.indexOf(lastSelectedTableId);
      const end = ids.indexOf(table.id);
      if (start !== -1 && end !== -1) {
        const [rangeStart, rangeEnd] = start < end ? [start, end] : [end, start];
        const range = ids.slice(rangeStart, rangeEnd + 1);
        setSelectedTableIds((prev) => {
          const next = new Set(prev);
          for (const id of range) next.add(id);
          return next;
        });
      }
      setLastSelectedTableId(table.id);
      setSelectedWallId(null);
      return;
    }
    setSelectedTableIds(new Set([table.id]));
    setLastSelectedTableId(table.id);
    setSelectedWallId(null);
  }

  function handleTableClick(table: CanvasTable, event?: React.MouseEvent) {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    if (live) {
      setSelectedServiceTableId(table.id);
      return;
    }
    selectTable(table, event);
  }

  function handleTableDoubleClick(table: CanvasTable) {
    if (live) return;
    openEditDialog(table);
  }

  async function patchTable(tableId: string, updates: Partial<FloorPlanTable>) {
    if (!orgId) return;
    setPlanSaved(false);
    try {
      setError('');
      const updated = await patch<FloorPlanTable>(
        `restaurants/${orgId}/floor-plan/tables/${tableId}`,
        updates,
      );
      setFloorPlan((prev) => (prev ? replaceTable(prev, updated) : prev));
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de modifier la table'));
    }
  }

  async function adjustCapacity(delta: number) {
    if (selectedTables.length === 0) return;
    setPlanSaved(false);
    try {
      setError('');
      const results = await Promise.all(
        selectedTables.map((table) =>
          patch<FloorPlanTable>(`restaurants/${orgId}/floor-plan/tables/${table.id}`, {
            capacity: Math.max(1, table.capacity + delta),
          }),
        ),
      );
      setFloorPlan((prev) => {
        if (!prev) return prev;
        let next = prev;
        for (const updated of results) next = replaceTable(next, updated);
        return next;
      });
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de modifier la capacité'));
    }
  }

  async function duplicateTable(table: FloorPlanTable, x: number, y: number, name?: string) {
    if (!orgId || !floorPlan) return;
    const generatedName =
      name ??
      (() => {
        const numericTableNames = allTables
          .map((t) => Number(t.name.match(/^T(\d+)$/i)?.[1] ?? 0))
          .filter((value) => value > 0);
        return `T${Math.max(0, ...numericTableNames) + 1}`;
      })();
    const created = await post<FloorPlanTable>(`restaurants/${orgId}/floor-plan/tables`, {
      sectionId: table.sectionId ?? null,
      name: generatedName,
      minCapacity: table.minCapacity,
      capacity: table.capacity,
      shape: table.shape,
      positionX: x,
      positionY: y,
      width: table.width ?? null,
      height: table.height ?? null,
      rotation: table.rotation ?? 0,
    });
    return created;
  }

  function nextTableName(offset = 1): string {
    const numericTableNames = allTables
      .map((t) => Number(t.name.match(/^T(\d+)$/i)?.[1] ?? 0))
      .filter((value) => value > 0);
    const max = Math.max(0, ...numericTableNames);
    return `T${max + offset}`;
  }

  async function duplicateSelectedAsRow() {
    if (selectedTables.length === 0) return;
    setPlanSaved(false);
    setDuplicateDialogOpen(false);
    const source = selectedTables[0];
    const { width } = getTableSize(source);
    const spacing = Math.max(0, duplicateForm.spacing);
    const count = Math.max(2, duplicateForm.count);
    try {
      setError('');
      const startX = source.positionX ?? 0;
      const startY = source.positionY ?? 0;
      const created: FloorPlanTable[] = [];
      for (let i = 1; i < count; i++) {
        const x = startX + i * (width + spacing);
        const y = startY;
        const name = nextTableName(i);
        const table = await duplicateTable(source, x, y, name);
        if (table) created.push(table);
      }
      setFloorPlan((prev) => {
        if (!prev) return prev;
        let next = prev;
        for (const table of created) next = replaceTable(next, table);
        return next;
      });
      setSelectedTableIds(new Set(created.map((t) => t.id)));
      setLastSelectedTableId(created[created.length - 1]?.id ?? source.id);
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de dupliquer la table'));
    }
  }

  async function duplicateSelectedAsGrid() {
    if (selectedTables.length === 0) return;
    setPlanSaved(false);
    setDuplicateDialogOpen(false);
    const source = selectedTables[0];
    const { width, height } = getTableSize(source);
    const spacingX = Math.max(0, duplicateForm.spacing);
    const spacingY = Math.max(0, duplicateForm.spacingY);
    const cols = Math.max(1, duplicateForm.cols);
    const rows = Math.max(1, duplicateForm.rows);
    try {
      setError('');
      const startX = source.positionX ?? 0;
      const startY = source.positionY ?? 0;
      const created: FloorPlanTable[] = [];
      let index = 1;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          if (row === 0 && col === 0) continue;
          const x = startX + col * (width + spacingX);
          const y = startY + row * (height + spacingY);
          const name = nextTableName(index);
          const table = await duplicateTable(source, x, y, name);
          if (table) created.push(table);
          index += 1;
        }
      }
      setFloorPlan((prev) => {
        if (!prev) return prev;
        let next = prev;
        for (const table of created) next = replaceTable(next, table);
        return next;
      });
      setSelectedTableIds(new Set(created.map((t) => t.id)));
      setLastSelectedTableId(created[created.length - 1]?.id ?? source.id);
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de créer la grille'));
    }
  }

  async function deleteSelectedTables() {
    if (selectedTables.length === 0) return;
    setPlanSaved(false);
    try {
      setError('');
      await Promise.all(
        selectedTables.map((table) => del(`restaurants/${orgId}/floor-plan/tables/${table.id}`)),
      );
      setFloorPlan((prev) => {
        if (!prev) return prev;
        let next = prev;
        for (const table of selectedTables) next = removeTable(next, table.id);
        return next;
      });
      setSelectedTableIds(new Set());
      setLastSelectedTableId(null);
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de supprimer les tables'));
    }
  }

  function alignSelectedTables(axis: 'x' | 'y', anchor: 'min' | 'center' | 'max') {
    if (selectedTables.length < 2) return;
    const dimensions = selectedTables.map((table) => {
      const { width, height } = getTableSize(table);
      const x = table.positionX ?? 0;
      const y = table.positionY ?? 0;
      return { table, width, height, x, y };
    });
    const values =
      axis === 'x'
        ? dimensions.map((d) => ({ min: d.x, center: d.x + d.width / 2, max: d.x + d.width }))
        : dimensions.map((d) => ({ min: d.y, center: d.y + d.height / 2, max: d.y + d.height }));
    const target =
      anchor === 'min'
        ? Math.min(...values.map((v) => v.min))
        : anchor === 'max'
          ? Math.max(...values.map((v) => v.max))
          : values[0].center;
    for (const { table, width, height, x, y } of dimensions) {
      let nextX = x;
      let nextY = y;
      if (axis === 'x') {
        nextX = anchor === 'min' ? target : anchor === 'max' ? target - width : target - width / 2;
      } else {
        nextY =
          anchor === 'min' ? target : anchor === 'max' ? target - height : target - height / 2;
      }
      void patchTable(table.id, {
        positionX: Math.round(nextX),
        positionY: Math.round(nextY),
      });
    }
  }

  function distributeSelectedTables(axis: 'x' | 'y') {
    if (selectedTables.length < 3) return;
    const sorted = [...selectedTables]
      .map((table) => ({
        table,
        x: table.positionX ?? 0,
        y: table.positionY ?? 0,
        size: getTableSize(table),
      }))
      .sort((a, b) => (axis === 'x' ? a.x - b.x : a.y - b.y));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const start = axis === 'x' ? first.x : first.y;
    const end = axis === 'x' ? last.x + last.size.width : last.y + last.size.height;
    const totalSpace = end - start;
    const totalSize = sorted.reduce(
      (sum, item) => sum + (axis === 'x' ? item.size.width : item.size.height),
      0,
    );
    const gap = Math.max(0, (totalSpace - totalSize) / (sorted.length - 1));
    let cursor = start;
    for (const { table, size } of sorted) {
      const dimension = axis === 'x' ? size.width : size.height;
      void patchTable(table.id, {
        positionX: axis === 'x' ? Math.round(cursor) : table.positionX,
        positionY: axis === 'y' ? Math.round(cursor) : table.positionY,
      });
      cursor += dimension + gap;
    }
  }

  function startTableResize(e: React.PointerEvent, table: CanvasTable) {
    e.stopPropagation();
    e.preventDefault();
    const { width, height } = getTableSize(table);
    resizeStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      width,
      height,
    };
    setResizeTableId(table.id);
    setSelectedTableIds(new Set([table.id]));
    setSelectedWallId(null);
  }

  function startTableRotate(e: React.PointerEvent, table: CanvasTable) {
    e.stopPropagation();
    e.preventDefault();
    const { width, height } = getTableSize(table);
    const centerX = (table.positionX ?? 0) + width / 2;
    const centerY = (table.positionY ?? 0) + height / 2;
    rotateStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      startRotation: table.rotation ?? 0,
      centerX,
      centerY,
    };
    setRotateTableId(table.id);
    setSelectedTableIds(new Set([table.id]));
    setSelectedWallId(null);
  }

  function handleTablePointerMove(e: PointerEvent) {
    const resizeStart = resizeStartRef.current;
    if (resizeTableId && resizeStart) {
      const dx = (e.clientX - resizeStart.pointerX) / zoom;
      const dy = (e.clientY - resizeStart.pointerY) / zoom;
      const width = Math.max(TABLE_LAYOUT.minimumDimension, resizeStart.width + dx);
      const height = Math.max(TABLE_LAYOUT.minimumDimension, resizeStart.height + dy);
      setFloorPlan((prev) => {
        if (!prev) return prev;
        const table = prev.sections
          .flatMap((s) => s.tables)
          .concat(prev.tables ?? [])
          .find((t) => t.id === resizeTableId);
        if (!table) return prev;
        const clampedWidth = Math.max(
          TABLE_LAYOUT.minimumDimension,
          Math.min(width, canvasWidth - (table.positionX ?? 0)),
        );
        const clampedHeight = Math.max(
          TABLE_LAYOUT.minimumDimension,
          Math.min(height, canvasHeight - (table.positionY ?? 0)),
        );
        resizeStart.currentWidth = clampedWidth;
        resizeStart.currentHeight = clampedHeight;
        return replaceTable(prev, {
          ...table,
          width: Math.round(clampedWidth),
          height: Math.round(clampedHeight),
        });
      });
    }
    if (rotateTableId && rotateStartRef.current && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const cx = rect.left + rotateStartRef.current.centerX * zoom;
      const cy = rect.top + rotateStartRef.current.centerY * zoom;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      const startAngle =
        (Math.atan2(rotateStartRef.current.pointerY - cy, rotateStartRef.current.pointerX - cx) *
          180) /
        Math.PI;
      const rotation = Math.round(
        (rotateStartRef.current.startRotation + angle - startAngle) % 360,
      );
      rotateStartRef.current.currentRotation = rotation;
      setFloorPlan((prev) => {
        if (!prev) return prev;
        const table = prev.sections
          .flatMap((s) => s.tables)
          .concat(prev.tables ?? [])
          .find((t) => t.id === rotateTableId);
        if (!table) return prev;
        return replaceTable(prev, { ...table, rotation });
      });
    }
  }

  function handleTablePointerUp() {
    if (resizeTableId && resizeStartRef.current) {
      void patchTable(resizeTableId, {
        width: Math.round(resizeStartRef.current.currentWidth ?? resizeStartRef.current.width),
        height: Math.round(resizeStartRef.current.currentHeight ?? resizeStartRef.current.height),
      });
      setResizeTableId(null);
      resizeStartRef.current = null;
    }
    if (rotateTableId && rotateStartRef.current) {
      void patchTable(rotateTableId, {
        rotation: rotateStartRef.current.currentRotation ?? rotateStartRef.current.startRotation,
      });
      setRotateTableId(null);
      rotateStartRef.current = null;
    }
  }

  useEffect(() => {
    if (!resizeTableId && !rotateTableId) return;
    const handleMove = (e: PointerEvent) => handleTablePointerMove(e);
    const handleUp = () => handleTablePointerUp();
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resizeTableId, rotateTableId, allTables, zoom, canvasWidth, canvasHeight]);

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

  async function confirmMultiDelete() {
    setMultiDeleteConfirmOpen(false);
    await deleteSelectedTables();
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
    setPlanSaved(false);
    justDraggedRef.current = true;
    const pointer = event.activatorEvent as PointerEvent | undefined;
    if (pointer) {
      pointerStartRef.current = { x: pointer.clientX, y: pointer.clientY };
    }

    const dragData = event.active.data.current as ActiveDragData | undefined;
    if (dragData?.kind === 'reservation') {
      setActiveDragData(dragData);
      return;
    }

    if (live) return;

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

    if (data?.kind === 'reservation') {
      const targetTableId = event.over?.id as string | undefined;
      if (targetTableId && targetTableId !== data.fromTableId) {
        void assignTable(data.reservation.id, targetTableId);
      }
      return;
    }

    if (live) {
      handleDragCancel();
      return;
    }

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

  const multiDeleteConfirm = (
    <ConfirmDialog
      open={multiDeleteConfirmOpen}
      onConfirm={confirmMultiDelete}
      onCancel={() => setMultiDeleteConfirmOpen(false)}
      title={`Supprimer ${selectedTables.length} tables`}
      description="Cette action est irréversible. Voulez-vous vraiment supprimer les tables sélectionnées ?"
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

  const duplicateDialog = (
    <Dialog open={duplicateDialogOpen} onOpenChange={setDuplicateDialogOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {duplicateForm.mode === 'row' ? 'Dupliquer en rangée' : 'Dupliquer en grille'}
          </DialogTitle>
          <DialogDescription>
            {duplicateForm.mode === 'row'
              ? 'Créez plusieurs copies alignées avec le même espacement.'
              : 'Créez une grille à partir de la table sélectionnée.'}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4">
          {duplicateForm.mode === 'row' ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="duplicate-count">Nombre total de tables</Label>
                <Input
                  id="duplicate-count"
                  type="number"
                  min={2}
                  max={50}
                  value={duplicateForm.count}
                  onChange={(e) =>
                    setDuplicateForm((f) => ({ ...f, count: Number(e.target.value) || 1 }))
                  }
                  className="bg-card border-border"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="duplicate-spacing">Espacement (px)</Label>
                <Input
                  id="duplicate-spacing"
                  type="number"
                  min={0}
                  value={duplicateForm.spacing}
                  onChange={(e) =>
                    setDuplicateForm((f) => ({ ...f, spacing: Number(e.target.value) || 0 }))
                  }
                  className="bg-card border-border"
                />
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="duplicate-cols">Colonnes</Label>
                  <Input
                    id="duplicate-cols"
                    type="number"
                    min={1}
                    max={20}
                    value={duplicateForm.cols}
                    onChange={(e) =>
                      setDuplicateForm((f) => ({ ...f, cols: Number(e.target.value) || 1 }))
                    }
                    className="bg-card border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="duplicate-rows">Rangées</Label>
                  <Input
                    id="duplicate-rows"
                    type="number"
                    min={1}
                    max={20}
                    value={duplicateForm.rows}
                    onChange={(e) =>
                      setDuplicateForm((f) => ({ ...f, rows: Number(e.target.value) || 1 }))
                    }
                    className="bg-card border-border"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="duplicate-spacing-x">Espacement X (px)</Label>
                  <Input
                    id="duplicate-spacing-x"
                    type="number"
                    min={0}
                    value={duplicateForm.spacing}
                    onChange={(e) =>
                      setDuplicateForm((f) => ({ ...f, spacing: Number(e.target.value) || 0 }))
                    }
                    className="bg-card border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="duplicate-spacing-y">Espacement Y (px)</Label>
                  <Input
                    id="duplicate-spacing-y"
                    type="number"
                    min={0}
                    value={duplicateForm.spacingY}
                    onChange={(e) =>
                      setDuplicateForm((f) => ({ ...f, spacingY: Number(e.target.value) || 0 }))
                    }
                    className="bg-card border-border"
                  />
                </div>
              </div>
            </>
          )}
        </form>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" type="button" onClick={() => setDuplicateDialogOpen(false)}>
            Annuler
          </Button>
          <Button
            type="button"
            onClick={() =>
              void (duplicateForm.mode === 'row'
                ? duplicateSelectedAsRow()
                : duplicateSelectedAsGrid())
            }
          >
            Dupliquer
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
          <p className="text-sm font-semibold">
            {lastUpdatedAt ? (
              <ElapsedSince date={lastUpdatedAt} prefix="Service en direct · mis à jour " />
            ) : (
              'Service en direct · connexion…'
            )}
          </p>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {lastUpdatedAt
            ? 'Le plan se met à jour automatiquement.'
            : 'Synchronisation du service en cours…'}
        </p>
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
              <div className="mt-3 flex gap-2">
                {['PENDING', 'CONFIRMED'].includes(selectedServiceReservation.state) && (
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() =>
                      void updateReservationState(selectedServiceReservation.id, 'SEATED')
                    }
                  >
                    Installer
                  </Button>
                )}
                {selectedServiceReservation.state === 'SEATED' && (
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() =>
                      void updateReservationState(selectedServiceReservation.id, 'HONORED')
                    }
                  >
                    Terminer
                  </Button>
                )}
              </div>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => void suggestTable(selectedServiceReservation.id)}
                >
                  Suggérer une table
                </Button>
                {suggestedTable && (
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() =>
                      void assignTable(selectedServiceReservation.id, suggestedTable.tableId)
                    }
                  >
                    Assigner
                  </Button>
                )}
              </div>
              {suggestedTable && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Proposition : table {suggestedTable.tableId} — {suggestedTable.reason}
                </p>
              )}
              {selectedServiceReservation.state === 'SEATED' &&
                selectedServiceReservation.seatedAt && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    À table depuis{' '}
                    {formatDistanceToNow(parseISO(selectedServiceReservation.seatedAt), {
                      locale: fr,
                      addSuffix: true,
                    })}
                  </p>
                )}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-4 text-center">
              <p className="text-sm font-medium">Table disponible</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Aucune réservation en cours ou imminente.
              </p>
              <Button
                size="sm"
                className="mt-3 w-full"
                onClick={() => void createWalkIn(selectedServiceTable?.id ?? '')}
                disabled={!selectedServiceTable?.id}
              >
                Walk-in
              </Button>
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
          {selectedWall
            ? 'Propriétés du mur sélectionné'
            : selectedTables.length > 0
              ? selectedTables.length === 1
                ? 'Propriétés de la table sélectionnée'
                : `${selectedTables.length} tables sélectionnées`
              : 'Sélectionnez un objet du plan'}
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
      ) : selectedTables.length > 0 ? (
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {selectedTable ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold">
                    {selectedTable.displayName ?? selectedTable.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {selectedTable.capacity} places
                    {selectedTable.sectionName ? ` · ${selectedTable.sectionName}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 p-0"
                    title="Diminuer la capacité"
                    onClick={() => void adjustCapacity(-1)}
                  >
                    <Minus size={14} />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 p-0"
                    title="Augmenter la capacité"
                    onClick={() => void adjustCapacity(1)}
                  >
                    <Plus size={14} />
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 border-t border-border pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  className="px-1"
                  onClick={() => void patchTable(selectedTable.id, { shape: 'rect' })}
                >
                  <Square size={14} className="mr-1" />
                  Rect.
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="px-1"
                  onClick={() => void patchTable(selectedTable.id, { shape: 'round' })}
                >
                  <Circle size={14} className="mr-1" />
                  Ronde
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="px-1"
                  onClick={() => openEditDialog(selectedTable)}
                >
                  <Maximize2 size={14} className="mr-1" />
                  Éditer
                </Button>
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Aligner
            </p>
            <div className="grid grid-cols-3 gap-2">
              <Button variant="outline" size="sm" onClick={() => alignSelectedTables('x', 'min')}>
                <AlignLeft size={14} className="mr-1" />
                Gauche
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => alignSelectedTables('x', 'center')}
              >
                <AlignCenter size={14} className="mr-1" />
                Centre
              </Button>
              <Button variant="outline" size="sm" onClick={() => alignSelectedTables('x', 'max')}>
                <AlignRight size={14} className="mr-1" />
                Droite
              </Button>
              <Button variant="outline" size="sm" onClick={() => alignSelectedTables('y', 'min')}>
                <AlignVerticalJustifyStart size={14} className="mr-1" />
                Haut
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => alignSelectedTables('y', 'center')}
              >
                <AlignVerticalJustifyCenter size={14} className="mr-1" />
                Milieu
              </Button>
              <Button variant="outline" size="sm" onClick={() => alignSelectedTables('y', 'max')}>
                <AlignVerticalJustifyEnd size={14} className="mr-1" />
                Bas
              </Button>
            </div>
          </div>

          {selectedTables.length >= 3 ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Répartir
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" onClick={() => distributeSelectedTables('x')}>
                  <AlignHorizontalJustifyCenter size={14} className="mr-1" />
                  Horizontal
                </Button>
                <Button variant="outline" size="sm" onClick={() => distributeSelectedTables('y')}>
                  <AlignVerticalJustifyCenter size={14} className="mr-1" />
                  Vertical
                </Button>
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Multiplier
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDuplicateForm((f) => ({ ...f, mode: 'row' }));
                  setDuplicateDialogOpen(true);
                }}
              >
                <Copy size={14} className="mr-1" />
                Rangée
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDuplicateForm((f) => ({ ...f, mode: 'grid' }));
                  setDuplicateDialogOpen(true);
                }}
              >
                <Grid3x3 size={14} className="mr-1" />
                Grille
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 border-t border-border pt-4">
            <Button variant="outline" size="sm" onClick={() => setSelectedTableIds(new Set())}>
              Désélectionner
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setMultiDeleteConfirmOpen(true)}>
              <Trash2 size={14} className="mr-1" />
              Supprimer
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <Move size={24} className="mb-3 text-muted-foreground" />
          <p className="text-sm font-medium">Aucun objet sélectionné</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Cliquez sur une table ou un mur pour modifier l’objet.
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
                  onClick={() => {
                    setSelectedTableIds(new Set());
                    setSelectedWallId(null);
                  }}
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
                            setSelectedTableIds(new Set());
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
                        isSelected={!live && selectedTableIds.has(table.id)}
                        draggable={!live}
                        droppable={live}
                        draggableReservation={live}
                        zoom={zoom}
                        onClick={(e) => handleTableClick(table, e)}
                        onDoubleClick={() => handleTableDoubleClick(table)}
                        onResizeStart={(e) => startTableResize(e, table)}
                        onRotateStart={(e) => startTableRotate(e, table)}
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
                    {activeDragData?.kind === 'reservation' ? (
                      <div
                        className={cn(
                          'flex flex-col items-center justify-center rounded-md border-2 border-dashed bg-background/95 px-3 py-2 text-center shadow-lg',
                          statusClasses[
                            tableStatuses.get(activeDragData.fromTableId)?.status ?? 'free'
                          ],
                        )}
                      >
                        <p className="text-xs font-semibold">
                          {formatCustomerName(activeDragData.reservation.customerName)}
                        </p>
                        <p className="text-[9px] text-muted-foreground">
                          {activeDragData.reservation.partySize} pers. ·{' '}
                          {activeDragData.reservation.startsAt
                            ? format(parseISO(activeDragData.reservation.startsAt), 'HH:mm')
                            : '—'}
                        </p>
                      </div>
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
      {multiDeleteConfirm}
      {settingsDialog}
      {duplicateDialog}
    </>
  );
}
