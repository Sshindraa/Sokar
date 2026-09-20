'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApi } from '@/lib/api';
import {
  getErrorMessage,
  type FloorPlan,
  type FloorPlanTable,
  type FloorPlanWall,
  type FloorPlanZone,
  type FloorPlanTableCombination,
  type PlanningReservation,
  type ServiceCopilotDelayImpact,
  type ServiceCopilotDelayRecoveryHistoryItem,
  type ServiceCopilotDelayRecoveryHistoryResponse,
  type ServiceCopilotPulse,
  type ServiceCommunicationDraft,
  type ServiceCommunicationDraftsResponse,
  type TableShape,
  type WaitingListEntry,
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
  addDays,
  startOfDay,
  addMinutes,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  AlertCircle,
  ZoomIn,
  ZoomOut,
  LocateFixed,
  Grid3x3,
  Grid2x2,
  Magnet,
  Save,
  Settings2,
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
  UserX,
  Users,
  Armchair,
  ListOrdered,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
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
  Undo2,
  Redo2,
  Grip,
  Phone,
  X,
  ArrowRight,
  Link2,
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
import { useUndoHistory } from './useUndoHistory';
import { useIsMobile, useMediaQuery } from '@/lib/useMediaQuery';

const DEFAULT_CANVAS_WIDTH = 1400;
const DEFAULT_CANVAS_HEIGHT = 900;

// Onglets de la vue service. Déclarés hors composant pour garder le rendu
// lisible et permettre une navigation clavier conforme au motif ARIA `tablist`.
const SERVICE_TABS = [
  { id: 'plan', label: 'Plan' },
  { id: 'waiting-list', label: "Liste d'attente" },
  { id: 'stats', label: 'Statistiques' },
] as const;

type ServiceTabId = (typeof SERVICE_TABS)[number]['id'];
const GRID_SIZE = 16;
// L’échelle physique reste un détail d’implémentation : 100 px représentent
// 1 mètre dans le plan. Les dimensions affichées aux restaurateurs sont donc
// toujours en mètres, tandis que l’API conserve ses coordonnées en pixels.
const CANVAS_PIXELS_PER_METER = 100;
const MIN_ROOM_DIMENSION_METERS = 2;
const MAX_ROOM_DIMENSION_METERS = 100;
const MIN_ZOOM = 0.5;
// Sur téléphone et tablette, 50 % ne suffisent pas à cadrer une salle de 14 m :
// l'échelle minimale descend plus bas et le plan s'ouvre ajusté à sa fenêtre.
const MIN_ZOOM_TOUCH = 0.3;
// Plancher du cadrage automatique : en dessous, une table devient plus petite
// que la cible tactile de 44 px et le plan n'est plus manipulable au doigt.
const TOUCH_FIT_FLOOR = 0.45;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.1;

/** Borne une échelle de zoom entre la limite du support et le maximum produit. */
export function clampZoom(value: number, minZoom: number = MIN_ZOOM, maxZoom = MAX_ZOOM) {
  return Math.min(maxZoom, Math.max(minZoom, value));
}

/**
 * Échelle qui cadre le plan dans la fenêtre visible. `floor` empêche un
 * dézoom total sur téléphone : un plan entièrement visible mais illisible ne
 * sert personne.
 */
export function computeFitZoom({
  viewportWidth,
  viewportHeight,
  canvasWidth,
  canvasHeight,
  minZoom = MIN_ZOOM,
  maxZoom = MAX_ZOOM,
  floor = 1,
}: {
  viewportWidth: number;
  viewportHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  minZoom?: number;
  maxZoom?: number;
  floor?: number;
}) {
  if (viewportWidth <= 0 || viewportHeight <= 0 || canvasWidth <= 0 || canvasHeight <= 0) {
    return minZoom;
  }
  const fit = Math.min(viewportWidth / canvasWidth, viewportHeight / canvasHeight);
  return clampZoom(Math.max(fit, floor), minZoom, maxZoom);
}

/**
 * Défilement à appliquer pour garder immobile, pendant un changement
 * d'échelle, le point du plan situé sous le doigt (ou le curseur).
 */
export function computeZoomAnchorScroll({
  scrollLeft,
  scrollTop,
  offsetX,
  offsetY,
  zoom,
  nextZoom,
}: {
  scrollLeft: number;
  scrollTop: number;
  offsetX: number;
  offsetY: number;
  zoom: number;
  nextZoom: number;
}) {
  const safeZoom = zoom > 0 ? zoom : 1;
  const worldX = (scrollLeft + offsetX) / safeZoom;
  const worldY = (scrollTop + offsetY) / safeZoom;
  return {
    left: Math.max(0, worldX * nextZoom - offsetX),
    top: Math.max(0, worldY * nextZoom - offsetY),
  };
}

/** Défilement qui centre le plan dans la fenêtre visible. */
export function computeCenterScroll({
  viewportWidth,
  viewportHeight,
  canvasWidth,
  canvasHeight,
  zoom,
}: {
  viewportWidth: number;
  viewportHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  zoom: number;
}) {
  return {
    left: Math.max(0, (canvasWidth * zoom - viewportWidth) / 2),
    top: Math.max(0, (canvasHeight * zoom - viewportHeight) / 2),
  };
}

/** Marge (coordonnées plan) ajoutée autour des tables au cadrage d'ouverture. */
export const CONTENT_FIT_PADDING = 48;
// Live est une vue opérationnelle : une marge plus courte garde les tables
// lisibles sans conserver une bande vide sous le groupe quand la zone est haute.
export const LIVE_CONTENT_FIT_PADDING = 24;

export type ContentBounds = { x: number; y: number; width: number; height: number };

/**
 * Rectangle englobant les tables posées, en coordonnées plan. Renvoie `null`
 * quand aucune table n'est posée : le cadrage retombe alors sur le plan entier.
 * Cadrer le canvas entier ne montre en effet que du vide quand les tables
 * n'occupent qu'un coin de la salle.
 */
export function computeContentBounds(
  tables: Array<{
    positionX: number | null;
    positionY: number | null;
    width?: number | null;
    height?: number | null;
    shape?: TableShape | null;
    rotation?: number | null;
  }>,
  canvasWidth: number,
  canvasHeight: number,
): ContentBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const table of tables) {
    if (table.positionX === null || table.positionY === null) continue;
    const size = getTableSize(table);
    const angle = ((table.rotation ?? 0) * Math.PI) / 180;
    const cos = Math.abs(Math.cos(angle));
    const sin = Math.abs(Math.sin(angle));
    // La rotation pivote autour du centre de la carte : l'empreinte au sol est
    // la boîte englobante du rectangle tourné.
    const boundingWidth = size.width * cos + size.height * sin;
    const boundingHeight = size.width * sin + size.height * cos;
    const centerX = table.positionX + size.width / 2;
    const centerY = table.positionY + size.height / 2;
    minX = Math.min(minX, centerX - boundingWidth / 2);
    minY = Math.min(minY, centerY - boundingHeight / 2);
    maxX = Math.max(maxX, centerX + boundingWidth / 2);
    maxY = Math.max(maxY, centerY + boundingHeight / 2);
  }
  if (minX === Number.POSITIVE_INFINITY || canvasWidth <= 0 || canvasHeight <= 0) return null;
  const x = Math.max(0, minX - CONTENT_FIT_PADDING);
  const y = Math.max(0, minY - CONTENT_FIT_PADDING);
  return {
    x,
    y,
    width: Math.max(1, Math.min(canvasWidth - x, maxX + CONTENT_FIT_PADDING - x)),
    height: Math.max(1, Math.min(canvasHeight - y, maxY + CONTENT_FIT_PADDING - y)),
  };
}

/**
 * Tables réellement visibles en Live. Le mode opérationnel ne doit pas
 * conserver la hauteur complète d'une zone d'édition : la surface défilable
 * commence autour du groupe de tables et s'arrête peu après son contenu.
 *
 * Les zones restent dessinées comme repère visuel, mais elles sont volontairement
 * écrêtées par la scène Live. Ainsi, une grande zone vide sous les tables ne
 * force plus un long défilement ni une carte disproportionnée.
 */
export function computeLiveContentBounds(
  zones: Array<Pick<FloorPlanZone, 'x' | 'y' | 'width' | 'height' | 'rotation'>>,
  tables: Array<{
    positionX: number | null;
    positionY: number | null;
    width?: number | null;
    height?: number | null;
    shape?: TableShape | null;
    rotation?: number | null;
  }>,
  canvasWidth: number,
  canvasHeight: number,
): ContentBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const includeRotatedRectangle = (
    x: number,
    y: number,
    width: number,
    height: number,
    rotation: number,
  ) => {
    const angle = (rotation * Math.PI) / 180;
    const cos = Math.abs(Math.cos(angle));
    const sin = Math.abs(Math.sin(angle));
    const boundingWidth = width * cos + height * sin;
    const boundingHeight = width * sin + height * cos;
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    minX = Math.min(minX, centerX - boundingWidth / 2);
    minY = Math.min(minY, centerY - boundingHeight / 2);
    maxX = Math.max(maxX, centerX + boundingWidth / 2);
    maxY = Math.max(maxY, centerY + boundingHeight / 2);
  };

  const positionedTables = tables.filter(
    (table) => table.positionX !== null && table.positionY !== null,
  );
  if (positionedTables.length > 0) {
    for (const table of positionedTables) {
      if (table.positionX === null || table.positionY === null) continue;
      const size = getTableSize(table);
      includeRotatedRectangle(
        table.positionX,
        table.positionY,
        size.width,
        size.height,
        table.rotation ?? 0,
      );
    }
  } else {
    // Si un plan Live n'a pas encore de table mais possède une zone, garder
    // cette zone comme surface de secours plutôt que de produire un cadre nul.
    for (const zone of zones) {
      includeRotatedRectangle(zone.x, zone.y, zone.width, zone.height, zone.rotation ?? 0);
    }
  }

  if (minX === Number.POSITIVE_INFINITY || canvasWidth <= 0 || canvasHeight <= 0) return null;
  const x = Math.max(0, minX - LIVE_CONTENT_FIT_PADDING);
  const y = Math.max(0, minY - LIVE_CONTENT_FIT_PADDING);
  return {
    x,
    y,
    width: Math.max(1, Math.min(canvasWidth - x, maxX + LIVE_CONTENT_FIT_PADDING - x)),
    height: Math.max(1, Math.min(canvasHeight - y, maxY + LIVE_CONTENT_FIT_PADDING - y)),
  };
}

/** Centre d'une table dans une zone, en tenant compte de la rotation de la zone. */
function isTableInsideZone(
  table: {
    positionX: number | null;
    positionY: number | null;
    width?: number | null;
    height?: number | null;
    shape?: TableShape | null;
  },
  zone: Pick<FloorPlanZone, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
) {
  if (table.positionX === null || table.positionY === null) return false;
  const size = getTableSize(table);
  const tableCenterX = table.positionX + size.width / 2;
  const tableCenterY = table.positionY + size.height / 2;
  const zoneCenterX = zone.x + zone.width / 2;
  const zoneCenterY = zone.y + zone.height / 2;
  const angle = -((zone.rotation ?? 0) * Math.PI) / 180;
  const deltaX = tableCenterX - zoneCenterX;
  const deltaY = tableCenterY - zoneCenterY;
  const localX = deltaX * Math.cos(angle) - deltaY * Math.sin(angle);
  const localY = deltaX * Math.sin(angle) + deltaY * Math.cos(angle);
  return Math.abs(localX) <= zone.width / 2 && Math.abs(localY) <= zone.height / 2;
}

/** Défilement qui centre une zone du plan (ex. les tables) dans la fenêtre. */
export function computeFocusScroll({
  viewportWidth,
  viewportHeight,
  region,
  zoom,
}: {
  viewportWidth: number;
  viewportHeight: number;
  region: ContentBounds;
  zoom: number;
}) {
  return {
    left: Math.max(0, (region.x + region.width / 2) * zoom - viewportWidth / 2),
    top: Math.max(0, (region.y + region.height / 2) * zoom - viewportHeight / 2),
  };
}

/** Deux contacts rapprochés dans le temps et l'espace forment un double-tap. */
export function isDoubleTap(
  previous: { time: number; x: number; y: number } | null,
  next: { time: number; x: number; y: number },
  maxDelay = 320,
  maxDistance = 32,
) {
  if (!previous) return false;
  const elapsed = next.time - previous.time;
  const distance = Math.hypot(next.x - previous.x, next.y - previous.y);
  return elapsed >= 0 && elapsed <= maxDelay && distance <= maxDistance;
}
const WALL_SNAP_DISTANCE = 40; // pixels in canvas coordinates
const WALL_LENGTH_MATCH_DISTANCE = 24; // pixels in canvas coordinates
const WALL_ALIGN_GUIDE_DISTANCE = 24; // pixels in canvas coordinates
const WALL_PERPENDICULAR_DOT_TOLERANCE = 0.08;

function formatRoomMeters(pixels: number): string {
  return (pixels / CANVAS_PIXELS_PER_METER).toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatRoomCentimeters(pixels: number): string {
  return Math.round((pixels / CANVAS_PIXELS_PER_METER) * 100).toLocaleString('fr-FR');
}

function parseRoomMeters(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const meters = Number(normalized);
  if (
    !Number.isFinite(meters) ||
    meters < MIN_ROOM_DIMENSION_METERS ||
    meters > MAX_ROOM_DIMENSION_METERS
  ) {
    return null;
  }
  return meters;
}

type WaitingListApiEntry = WaitingListEntry & {
  preferredSection?: { name: string } | null;
};

type DelayRecoveryApiResult = {
  delayedReservationId: string;
  promotedReservationId: string;
  operationId: string;
  idempotent?: boolean;
};

function mapWaitingListEntries(data: unknown[]): WaitingListEntry[] {
  return data.map((item) => {
    const entry = item as WaitingListApiEntry;
    return {
      ...entry,
      preferredSectionName: entry.preferredSectionName ?? entry.preferredSection?.name ?? null,
    };
  });
}

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

const ZONE_MIN_WIDTH = 128;
const ZONE_MIN_HEIGHT = 80;
const TABLE_CARD_MIN_WIDTH = 132;
const TABLE_CARD_MIN_HEIGHT = 66;
const TABLE_CARD_SEAT_HEIGHT = 32;
// Version tactile : sur téléphone, la carte blanche masquait les tables du
// plan. On garde un rectangle compact avec le nom et l'état, sans libellé.
const COMPACT_TABLE_CARD_MIN_WIDTH = 104;
const COMPACT_TABLE_CARD_MIN_HEIGHT = 52;

type TableStatus = 'free' | 'reserved' | 'upcoming' | 'late' | 'occupied' | 'inactive';

/** Proposition d'allocation explicable renvoyée par l'API (Phase 5). */
type TableSuggestion = {
  tableId: string;
  name: string;
  capacity: number;
  sectionId: string | null;
  score: number;
  reasons: string[];
};

type TableGeometry = Pick<
  FloorPlanTable,
  'id' | 'positionX' | 'positionY' | 'width' | 'height' | 'rotation'
>;

type WallGeometry = Pick<FloorPlanWall, 'id' | 'x1' | 'y1' | 'x2' | 'y2'>;

type ZoneGeometry = Pick<FloorPlanZone, 'id' | 'x' | 'y' | 'width' | 'height' | 'rotation'>;

/** Snapshot atomique d'une ou plusieurs mutations strictement géométriques. */
type GeometrySnapshot = {
  tables: TableGeometry[];
  walls: WallGeometry[];
  zones?: ZoneGeometry[];
};

function snapshotTableGeometry(table: FloorPlanTable): TableGeometry {
  return {
    id: table.id,
    positionX: table.positionX,
    positionY: table.positionY,
    width: table.width,
    height: table.height,
    rotation: table.rotation,
  };
}

function snapshotWallGeometry(wall: FloorPlanWall): WallGeometry {
  return {
    id: wall.id,
    x1: wall.x1,
    y1: wall.y1,
    x2: wall.x2,
    y2: wall.y2,
  };
}

function snapshotZoneGeometry(zone: FloorPlanZone): ZoneGeometry {
  return {
    id: zone.id,
    x: zone.x,
    y: zone.y,
    width: zone.width,
    height: zone.height,
    rotation: zone.rotation,
  };
}

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
  mutationVersion?: number;
};

type PaletteWallType = 'wall' | 'door' | 'bar';

type PaletteItemData =
  | { kind: 'table'; shape: TableShape; capacity: number }
  | { kind: 'placeTable'; table: CanvasTable }
  | { kind: 'wall'; type: PaletteWallType }
  | { kind: 'zone' };

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
  const shape = table.shape ?? 'rect';
  // La capacité est une donnée métier, pas une approximation de l'encombrement.
  // Une table reçoit une taille visuelle stable par défaut et peut ensuite être
  // redimensionnée directement sur le canvas.
  const legacyWidth = shape === 'round' ? 128 : 144;
  const legacyHeight = shape === 'round' ? 128 : 104;
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
  const startX = 32;
  const startY = 32;
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

const TABLE_ALIGN_GUIDE_DISTANCE = 10;
const TABLE_DUPLICATE_GAP = 16;

export type TableAlignmentGuide = {
  axis: 'x' | 'y';
  /** Coordonnée de l'axe de référence, dans l'espace du plan. */
  value: number;
  /** Position de départ à appliquer à la table déplacée pour l'aligner. */
  position: number;
  distance: number;
};

export type TableAlignmentGuides = {
  x: TableAlignmentGuide | null;
  y: TableAlignmentGuide | null;
};

const emptyTableAlignmentGuides = (): TableAlignmentGuides => ({ x: null, y: null });

/**
 * Cherche les axes de bord et de centre les plus proches d'une table déjà
 * placée. Les coordonnées renvoyées sont indépendantes du zoom : elles sont
 * donc réutilisables pendant le drag et au moment de la persistance finale.
 */
export function getTableAlignmentGuides({
  x,
  y,
  width,
  height,
  tables,
  excludedTableId,
  threshold = TABLE_ALIGN_GUIDE_DISTANCE,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  tables: CanvasTable[];
  excludedTableId?: string;
  threshold?: number;
}): TableAlignmentGuides {
  const guides = emptyTableAlignmentGuides();
  const movingAxes = {
    x: [
      { value: x, offset: 0 },
      { value: x + width / 2, offset: width / 2 },
      { value: x + width, offset: width },
    ],
    y: [
      { value: y, offset: 0 },
      { value: y + height / 2, offset: height / 2 },
      { value: y + height, offset: height },
    ],
  };

  for (const table of tables) {
    if (table.id === excludedTableId || table.positionX === null || table.positionY === null) {
      continue;
    }
    const size = getTableSize(table);
    const referenceAxes = {
      x: [table.positionX, table.positionX + size.width / 2, table.positionX + size.width],
      y: [table.positionY, table.positionY + size.height / 2, table.positionY + size.height],
    };

    for (const axis of ['x', 'y'] as const) {
      for (const movingAxis of movingAxes[axis]) {
        for (const referenceValue of referenceAxes[axis]) {
          const distance = Math.abs(movingAxis.value - referenceValue);
          const current = guides[axis];
          if (distance <= threshold && (!current || distance < current.distance)) {
            guides[axis] = {
              axis,
              value: referenceValue,
              position: referenceValue - movingAxis.offset,
              distance,
            };
          }
        }
      }
    }
  }

  return guides;
}

function tableOverlapsAtPosition({
  x,
  y,
  width,
  height,
  tables,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  tables: CanvasTable[];
}) {
  return tables.some((table) => {
    if (table.positionX === null || table.positionY === null) return false;
    const size = getTableSize(table);
    return (
      x < table.positionX + size.width &&
      x + width > table.positionX &&
      y < table.positionY + size.height &&
      y + height > table.positionY
    );
  });
}

/**
 * Place une copie au plus près de sa source, en privilégiant la droite puis
 * les autres directions cardinales. En cas de couloir encombré, une recherche
 * radiale sur la grille évite de masquer une table existante ou de sortir du
 * plan. `null` signifie qu'aucune zone libre ne peut accueillir la copie.
 */
export function findDuplicatePosition(
  table: CanvasTable,
  tables: CanvasTable[],
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } | null {
  const { width, height } = getTableSize(table);
  const originX = table.positionX ?? TABLE_DUPLICATE_GAP;
  const originY = table.positionY ?? TABLE_DUPLICATE_GAP;
  const positionedTables = tables.filter(
    (candidate) => candidate.positionX !== null && candidate.positionY !== null,
  );

  const canPlace = (x: number, y: number) =>
    x >= 0 &&
    y >= 0 &&
    x + width <= canvasWidth &&
    y + height <= canvasHeight &&
    !tableOverlapsAtPosition({ x, y, width, height, tables: positionedTables });

  const normalise = (value: number) => Math.round(value / GRID_SIZE) * GRID_SIZE;
  const directCandidates = [
    { x: originX + width + TABLE_DUPLICATE_GAP, y: originY },
    { x: originX, y: originY + height + TABLE_DUPLICATE_GAP },
    { x: originX - width - TABLE_DUPLICATE_GAP, y: originY },
    { x: originX, y: originY - height - TABLE_DUPLICATE_GAP },
    { x: originX + width + TABLE_DUPLICATE_GAP, y: originY + height + TABLE_DUPLICATE_GAP },
    { x: originX - width - TABLE_DUPLICATE_GAP, y: originY + height + TABLE_DUPLICATE_GAP },
    { x: originX + width + TABLE_DUPLICATE_GAP, y: originY - height - TABLE_DUPLICATE_GAP },
    { x: originX - width - TABLE_DUPLICATE_GAP, y: originY - height - TABLE_DUPLICATE_GAP },
  ];

  for (const candidate of directCandidates) {
    const x = normalise(candidate.x);
    const y = normalise(candidate.y);
    if (canPlace(x, y)) return { x, y };
  }

  const maxRadius = Math.ceil(Math.max(canvasWidth, canvasHeight) / GRID_SIZE);
  for (let radius = 1; radius <= maxRadius; radius++) {
    const candidates: Array<{ x: number; y: number }> = [];
    for (let delta = -radius; delta <= radius; delta++) {
      candidates.push(
        { x: normalise(originX + radius * GRID_SIZE), y: normalise(originY + delta * GRID_SIZE) },
        { x: normalise(originX - radius * GRID_SIZE), y: normalise(originY + delta * GRID_SIZE) },
      );
    }
    for (let delta = -radius + 1; delta < radius; delta++) {
      candidates.push(
        { x: normalise(originX + delta * GRID_SIZE), y: normalise(originY + radius * GRID_SIZE) },
        { x: normalise(originX + delta * GRID_SIZE), y: normalise(originY - radius * GRID_SIZE) },
      );
    }
    const valid = candidates.find((candidate) => canPlace(candidate.x, candidate.y));
    if (valid) return valid;
  }

  return null;
}

function getNextTableName(tables: CanvasTable[]): string {
  const highestNumber = tables.reduce((max, table) => {
    const match = table.name.match(/^T0*(\d+)$/i);
    return Math.max(max, match ? Number(match[1]) : 0);
  }, 0);
  return `T${highestNumber + 1}`;
}

type ChairPosition = {
  left: number;
  top: number;
  rotation?: number;
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
      const rotation = ((angle + Math.PI / 2) * 180) / Math.PI;
      chairs.push({
        left: centerX + radiusX * Math.cos(angle) - halfChairSize,
        top: centerY + radiusY * Math.sin(angle) - halfChairSize,
        rotation,
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
          rotation: 0,
        });
      } else if (side === 'bottom') {
        chairs.push({
          left: position - halfChairSize - borderWidth,
          top: height - borderWidth + chairGap,
          rotation: 180,
        });
      } else if (side === 'left') {
        chairs.push({
          left: -(chairSize + chairGap + borderWidth),
          top: position - halfChairSize - borderWidth,
          rotation: 270,
        });
      } else {
        chairs.push({
          left: width - borderWidth + chairGap,
          top: position - halfChairSize - borderWidth,
          rotation: 90,
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
  positionX: number | null,
  positionY: number | null,
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

function replaceZone(floorPlan: FloorPlan, updated: FloorPlanZone): FloorPlan {
  const previous = (floorPlan.zones ?? []).find((zone) => zone.id === updated.id);
  const sectionChanged = previous && previous.sectionId !== updated.sectionId;
  const linkedSection =
    updated.section ??
    (sectionChanged
      ? (floorPlan.sections.find((section) => section.id === updated.sectionId) ?? null)
      : previous?.section);
  return {
    ...floorPlan,
    zones: (floorPlan.zones ?? []).map((zone) =>
      zone.id === updated.id
        ? {
            ...zone,
            ...updated,
            section: linkedSection,
            sectionName:
              updated.sectionName ??
              linkedSection?.name ??
              (sectionChanged ? null : zone.sectionName),
          }
        : zone,
    ),
  };
}

function removeZone(floorPlan: FloorPlan, zoneId: string): FloorPlan {
  return {
    ...floorPlan,
    zones: (floorPlan.zones ?? []).filter((zone) => zone.id !== zoneId),
  };
}

function getNextZoneName(zones: FloorPlanZone[]): string {
  const used = new Set(
    zones
      .map((zone) => zone.name.match(/^zone\s+(\d+)$/i)?.[1])
      .filter((value): value is string => Boolean(value))
      .map(Number),
  );
  let next = 1;
  while (used.has(next)) next += 1;
  return `Zone ${next}`;
}

function findNextZonePosition(
  width: number,
  height: number,
  zones: FloorPlanZone[],
  maxWidth: number,
  maxHeight: number,
): { x: number; y: number } {
  const step = GRID_SIZE * 2;
  for (let y = 32; y <= maxHeight - height; y += step) {
    for (let x = 32; x <= maxWidth - width; x += step) {
      const overlaps = zones.some(
        (zone) =>
          x < zone.x + zone.width &&
          x + width > zone.x &&
          y < zone.y + zone.height &&
          y + height > zone.y,
      );
      if (!overlaps) return { x, y };
    }
  }
  return {
    x: Math.max(0, Math.round((maxWidth - width) / 2)),
    y: Math.max(0, Math.round((maxHeight - height) / 2)),
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
  isCombinable?: boolean;
  editable?: boolean;
  /** Rendu tactile : nom et point d'état seuls, sans libellé ni client. */
  compact?: boolean;
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
  isCombinable = false,
  editable = true,
  compact = false,
}: TableCardProps) {
  const { width, height, rotation } = getTableSize(table);
  const displayName = table.displayName ?? table.name;
  const title = status?.reservation
    ? formatReservationBadge(status.reservation)
    : `${displayName} · ${table.capacity} places`;

  // Keep one visual language for tables in both modes. The editor and Live
  // still provide different interactions, but the table itself should remain
  // recognisable when moving between them.
  const liveCustomerName = status?.reservation?.customerName?.trim() || null;
  const liveStatusLabel = status ? statusMeta[status.status].label : null;
  const liveRailClass =
    status?.status === 'occupied'
      ? 'bg-floor-table-accent'
      : status?.status === 'late'
        ? 'bg-destructive'
        : status?.status === 'upcoming'
          ? 'bg-warning'
          : status?.status === 'reserved'
            ? 'bg-brand'
            : status
              ? 'bg-floor-table-muted/45'
              : 'bg-floor-table-accent';
  const liveStatusTextClass =
    status?.status === 'occupied'
      ? 'text-floor-table-accent'
      : status?.status === 'late'
        ? 'text-destructive'
        : status?.status === 'upcoming'
          ? 'text-warning'
          : status?.status === 'reserved'
            ? 'text-brand'
            : status?.status === 'free'
              ? 'text-floor-table-text/80'
              : 'text-floor-table-muted';
  const liveStatusDotClass =
    status?.status === 'occupied'
      ? 'bg-floor-table-accent'
      : status?.status === 'late'
        ? 'bg-destructive'
        : status?.status === 'upcoming'
          ? 'bg-warning'
          : status?.status === 'reserved'
            ? 'bg-brand'
            : status
              ? 'bg-floor-table-muted/80'
              : null;
  const isRound = table.shape === 'round';
  const cardMinWidth = compact ? COMPACT_TABLE_CARD_MIN_WIDTH : TABLE_CARD_MIN_WIDTH;
  const cardMinHeight = compact ? COMPACT_TABLE_CARD_MIN_HEIGHT : TABLE_CARD_MIN_HEIGHT;
  const rectBodyWidth = Math.max(width, cardMinWidth);
  // Une table ronde reste un cercle même si une ancienne donnée géométrique
  // est légèrement rectangulaire. On la centre dans son empreinte au lieu de
  // transformer silencieusement les dimensions métier.
  const roundDiameter = Math.max(Math.min(width, height), compact ? 64 : 72);
  const liveBodyWidth = isRound ? roundDiameter : rectBodyWidth;
  const liveBodyHeight = isRound
    ? roundDiameter
    : Math.max(cardMinHeight, Math.round(rectBodyWidth / 2));
  const liveBodyLeft = Math.round((width - liveBodyWidth) / 2);
  const liveChairWidth = Math.min(36, Math.max(24, Math.round(rectBodyWidth * 0.28)));
  const liveBodyTop = isRound
    ? Math.round((height - liveBodyHeight) / 2)
    : Math.max(8, Math.round((height - (liveBodyHeight + TABLE_CARD_SEAT_HEIGHT)) / 2));
  const roundChairSize = compact ? 20 : 24;
  const roundChairPositions = isRound
    ? Array.from({ length: Math.min(Math.max(table.capacity, 1), 8) }, (_, index) => {
        const angle =
          (index / Math.min(Math.max(table.capacity, 1), 8)) * Math.PI * 2 - Math.PI / 2;
        const radiusX = liveBodyWidth / 2 + roundChairSize / 2 + 6;
        const radiusY = liveBodyHeight / 2 + roundChairSize / 2 + 6;
        return {
          left: liveBodyLeft + liveBodyWidth / 2 + Math.cos(angle) * radiusX - roundChairSize / 2,
          top: liveBodyTop + liveBodyHeight / 2 + Math.sin(angle) * radiusY - roundChairSize / 2,
        };
      })
    : [];
  const referenceStatusLabel = liveStatusLabel ?? `${table.capacity} places`;
  // Sur téléphone, une forme courte garde l'état lisible dans la carte sans
  // perdre le libellé métier complet (toujours exposé par aria-label/title).
  const compactStatusLabel =
    status?.status === 'free'
      ? 'Libre'
      : status?.status === 'reserved'
        ? 'Réservée'
        : status?.status === 'upcoming'
          ? 'Arrivée'
          : status?.status === 'late'
            ? 'Retard'
            : status?.status === 'occupied'
              ? 'Occupée'
              : status?.status === 'inactive'
                ? 'Inactive'
                : referenceStatusLabel;
  const referenceStatusTextClass = liveStatusLabel ? liveStatusTextClass : 'text-floor-table-muted';

  return (
    <div
      ref={dragRef}
      className={cn(
        'relative box-border min-w-0 min-h-0 select-none outline-none',
        'overflow-visible',
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
      <>
        {isRound ? (
          roundChairPositions.map((chair, index) => (
            <span
              key={`round-chair-${index}`}
              className="absolute z-0 rounded-full border-2 border-floor-table-muted/35 bg-floor-table-chair shadow-sm"
              style={{
                left: chair.left,
                top: chair.top,
                width: roundChairSize,
                height: roundChairSize,
              }}
              aria-hidden="true"
            />
          ))
        ) : (
          <>
            <span
              className="absolute z-0 h-8 -translate-y-1/2 rounded-full border-2 border-floor-table-muted/35 bg-floor-table-chair shadow-sm"
              style={{
                left: liveBodyLeft + liveBodyWidth * 0.25 - liveChairWidth / 2,
                top: liveBodyTop,
                width: liveChairWidth,
              }}
              aria-hidden="true"
            />
            <span
              className="absolute z-0 h-8 -translate-y-1/2 rounded-full border-2 border-floor-table-muted/35 bg-floor-table-chair shadow-sm"
              style={{
                left: liveBodyLeft + liveBodyWidth * 0.75 - liveChairWidth / 2,
                top: liveBodyTop,
                width: liveChairWidth,
              }}
              aria-hidden="true"
            />
            <span
              className="absolute z-0 h-8 -translate-y-1/2 rounded-full border-2 border-floor-table-muted/35 bg-floor-table-chair shadow-sm"
              style={{
                left: liveBodyLeft + liveBodyWidth * 0.25 - liveChairWidth / 2,
                top: liveBodyTop + liveBodyHeight,
                width: liveChairWidth,
              }}
              aria-hidden="true"
            />
            <span
              className="absolute z-0 h-8 -translate-y-1/2 rounded-full border-2 border-floor-table-muted/35 bg-floor-table-chair shadow-sm"
              style={{
                left: liveBodyLeft + liveBodyWidth * 0.75 - liveChairWidth / 2,
                top: liveBodyTop + liveBodyHeight,
                width: liveChairWidth,
              }}
              aria-hidden="true"
            />
          </>
        )}
        <div
          className={cn(
            'absolute z-10 overflow-hidden border border-floor-table-muted/15 bg-floor-table-surface shadow-sm',
            isRound ? 'rounded-full' : 'rounded-[0.6rem]',
            'transition-[border-color,box-shadow] duration-200',
            isSelected &&
              !isOverlay &&
              'border-floor-table-accent ring-2 ring-inset ring-floor-table-accent/70',
          )}
          style={{
            height: liveBodyHeight,
            left: liveBodyLeft,
            top: liveBodyTop,
            width: liveBodyWidth,
          }}
        >
          <span
            className={cn('absolute inset-y-0 right-0', isRound ? 'w-2' : 'w-3', liveRailClass)}
            aria-label={referenceStatusLabel}
            title={referenceStatusLabel}
          />
          <div
            className={cn(
              'absolute inset-0 flex flex-col items-start justify-between text-left',
              compact ? 'px-2 py-1.5 pr-4' : 'px-3 py-2 pr-5',
            )}
          >
            <p className="max-w-full truncate text-[10px] font-semibold leading-none text-floor-table-text/80">
              {displayName}
            </p>
            <div className="min-w-0 max-w-full leading-tight">
              {liveCustomerName && !compact ? (
                <p className="truncate text-[10px] font-medium text-floor-table-text">
                  {liveCustomerName}
                </p>
              ) : null}
              <p
                className={cn(
                  'flex min-w-0 items-center gap-1 truncate text-[10px] font-medium',
                  referenceStatusTextClass,
                )}
              >
                {liveStatusDotClass ? (
                  <span
                    aria-hidden="true"
                    className={cn('size-1.5 shrink-0 rounded-full', liveStatusDotClass)}
                  />
                ) : null}
                <span className="truncate">
                  {compact ? compactStatusLabel : referenceStatusLabel}
                </span>
              </p>
            </div>
          </div>
          {status?.reservation && !isOverlay ? (
            <DraggableReservation
              reservation={status.reservation}
              fromTableId={table.id}
              disabled={!draggableReservation}
            />
          ) : null}
        </div>
      </>
      {isCombinable ? (
        <span
          className="absolute bottom-1.5 right-1.5 z-20 inline-flex size-5 items-center justify-center rounded-full border border-primary/40 bg-background/90 text-primary shadow-sm"
          title="Tables combinables"
          aria-label="Tables combinables"
        >
          <Link2 size={11} />
        </span>
      ) : null}
      {isSelected && editable && !isOverlay && onResizeStart ? (
        <div
          className="absolute -bottom-1.5 -right-1.5 z-30 size-3 cursor-nwse-resize rounded-full border-2 border-floor-table-surface bg-floor-table-accent shadow-md"
          onPointerDown={(e) => {
            e.stopPropagation();
            onResizeStart(e as unknown as React.PointerEvent);
          }}
          title="Redimensionner"
        />
      ) : null}
      {isSelected && editable && !isOverlay && onRotateStart ? (
        <div
          className="absolute -top-2.5 left-1/2 z-30 flex size-5 -translate-x-1/2 cursor-grab items-center justify-center rounded-full border-2 border-floor-table-accent bg-floor-table-surface text-floor-table-accent shadow-md"
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
  disabled = false,
}: {
  reservation: PlanningReservation;
  fromTableId: string;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `reservation-${reservation.id}`,
    data: { kind: 'reservation', reservation, fromTableId } as ActiveDragData,
    disabled,
  });

  const { onPointerDown, ...otherListeners } = listeners ?? {};

  return (
    <div
      ref={setNodeRef}
      {...otherListeners}
      {...attributes}
      role="presentation"
      tabIndex={-1}
      aria-hidden="true"
      onPointerDown={(e) => {
        onPointerDown?.(e);
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'absolute inset-0 z-20 cursor-grab rounded-[inherit] active:cursor-grabbing',
        isDragging && 'opacity-0',
      )}
      aria-label={formatReservationBadge(reservation)}
    >
      <span className="sr-only">{formatReservationBadge(reservation)}</span>
    </div>
  );
}

function ZoneCard({
  zone,
  isSelected,
  editable,
  showLabel = true,
  onClick,
  onPointerDown,
  onResizeStart,
}: {
  zone: FloorPlanZone;
  isSelected?: boolean;
  editable?: boolean;
  showLabel?: boolean;
  onClick: () => void;
  onPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
  onResizeStart?: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className={cn(
        'absolute flex flex-col items-center justify-center rounded-xl border border-primary/25 bg-primary/5 px-3 text-center text-muted-foreground transition-[border,background,box-shadow] duration-200',
        editable && 'cursor-move hover:border-primary/50 hover:bg-primary/10',
        isSelected && 'border-primary bg-primary/10 ring-2 ring-primary/40 ring-offset-1',
      )}
      style={{
        left: zone.x,
        top: zone.y,
        width: zone.width,
        height: zone.height,
        transform: `rotate(${zone.rotation}deg)`,
        zIndex: 1,
      }}
      role="button"
      tabIndex={0}
      aria-label={`${zone.name}${zone.sectionName ? ` · ${zone.sectionName}` : ''}`}
      onPointerDown={(event) => {
        event.stopPropagation();
        onPointerDown?.(event);
      }}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
    >
      {showLabel ? (
        <>
          <span className="text-xs font-semibold uppercase tracking-[0.14em]">{zone.name}</span>
          {zone.sectionName ? <span className="mt-1 text-[10px]">{zone.sectionName}</span> : null}
        </>
      ) : null}
      {isSelected && editable && onResizeStart ? (
        <div
          className="absolute -bottom-1.5 -right-1.5 z-30 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border border-background bg-primary shadow-sm"
          onPointerDown={(event) => {
            event.stopPropagation();
            event.preventDefault();
            onResizeStart(event);
          }}
          title="Redimensionner la zone"
          aria-label="Redimensionner la zone"
          role="button"
        />
      ) : null}
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
  isCombinable?: boolean;
  editable?: boolean;
  /** Carte tactile compacte (téléphone) : nom + point d'état seulement. */
  compact?: boolean;
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
  isCombinable = false,
  editable = true,
  compact = false,
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
      isCombinable={isCombinable}
      editable={editable}
      compact={compact}
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
  shortLabel?: string;
  data: PaletteItemData;
  onQuickAdd?: (data: PaletteItemData) => void;
};

function PaletteItemCard({ id, icon, label, shortLabel, data, onQuickAdd }: PaletteItemCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: data as Record<string, unknown>,
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      title={`${label} — glissez vers le plan, ou cliquez pour ajouter`}
      aria-label={`${label} — glissez vers le plan, ou cliquez pour ajouter`}
      onClick={() => onQuickAdd?.(data)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onQuickAdd?.(data);
        }
      }}
      className={cn(
        'flex cursor-grab select-none items-center gap-2 rounded-md border border-border bg-background px-2 py-2 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing lg:min-h-9 lg:w-full lg:gap-1 lg:px-1 lg:py-1',
        isDragging && 'opacity-0',
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 text-xs font-medium text-foreground lg:whitespace-normal lg:text-center lg:text-[10px] lg:leading-tight">
        <span className="lg:hidden">{label}</span>
        <span className="hidden lg:inline">{shortLabel}</span>
      </span>
    </div>
  );
}

function PaletteExistingTableCard({
  table,
  onPlace,
}: {
  table: CanvasTable;
  onPlace: (table: CanvasTable) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-table-${table.id}`,
    data: { kind: 'placeTable', table } as Record<string, unknown>,
  });
  const displayName = table.displayName ?? table.name;
  const sectionLabel = table.sectionName || 'Sans section';

  return (
    <div
      id={`palette-table-${table.id}`}
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      title={`${displayName} · ${table.capacity} places · ${sectionLabel} — glissez vers le plan`}
      aria-label={`${displayName}, ${table.capacity} places, ${sectionLabel} — glissez vers le plan`}
      onClick={() => onPlace(table)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onPlace(table);
        }
      }}
      className={cn(
        'flex cursor-grab select-none items-center gap-2 rounded-md border border-border bg-background px-2.5 py-2 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing',
        isDragging && 'opacity-0',
      )}
    >
      <Grip size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-foreground">{displayName}</span>
        <span className="block truncate text-[10px] text-muted-foreground">
          {table.capacity} places · {sectionLabel}
        </span>
      </span>
    </div>
  );
}

type StatsPanelProps = {
  reservations: PlanningReservation[];
  allTables: CanvasTable[];
  tableStatuses: Map<string, { status: TableStatus; reservation: PlanningReservation | null }>;
  liveDate: string;
};

export function StatsPanel({ reservations, allTables, tableStatuses, liveDate }: StatsPanelProps) {
  const now = new Date();
  const stats = useMemo(() => {
    const activeTables = allTables.filter((t) => t.isActive);
    const inactiveTables = allTables.filter((t) => !t.isActive);
    const totalCapacity = activeTables.reduce((sum, t) => sum + t.capacity, 0);

    const seated = reservations.filter((r) => r.state === 'SEATED' && r.tableId);
    const seatedCovers = seated.reduce((sum, r) => sum + r.partySize, 0);
    const occupancyRate = totalCapacity > 0 ? Math.round((seatedCovers / totalCapacity) * 100) : 0;

    const activeReservations = reservations.filter((r) =>
      ['CONFIRMED', 'SEATED'].includes(r.state),
    );
    const plannedCovers = activeReservations.reduce((sum, r) => sum + r.partySize, 0);

    const lateCount = [...tableStatuses.values()].filter((s) => s.status === 'late').length;
    const upcomingCount = [...tableStatuses.values()].filter((s) => s.status === 'upcoming').length;
    const occupiedCount = [...tableStatuses.values()].filter((s) => s.status === 'occupied').length;
    const freeCount = [...tableStatuses.values()].filter((s) => s.status === 'free').length;

    return {
      activeTables: activeTables.length,
      inactiveTables: inactiveTables.length,
      totalCapacity,
      seatedCovers,
      occupancyRate,
      plannedCovers,
      lateCount,
      upcomingCount,
      occupiedCount,
      freeCount,
      totalReservations: reservations.length,
    };
  }, [allTables, reservations, tableStatuses]);

  const forecast = useMemo(() => {
    const dayStart = startOfDay(parseISO(liveDate));
    const slots = Array.from({ length: 48 }, (_, i) => addMinutes(dayStart, i * 30));
    return slots
      .map((slot) => {
        const covers = reservations.reduce((sum, r) => {
          if (!r.startsAt || !r.endsAt || r.state === 'CANCELLED' || r.state === 'NO_SHOW') {
            return sum;
          }
          const start = parseISO(r.startsAt);
          const end = parseISO(r.endsAt);
          if (isWithinInterval(slot, { start, end })) {
            return sum + r.partySize;
          }
          return sum;
        }, 0);
        const newArrivals = reservations.filter((r) => {
          if (!r.startsAt || r.state === 'CANCELLED' || r.state === 'NO_SHOW') return false;
          const start = parseISO(r.startsAt);
          return format(start, 'HH:mm') === format(slot, 'HH:mm');
        }).length;
        return { time: format(slot, 'HH:mm'), covers, newArrivals };
      })
      .filter((s) => s.covers > 0 || s.newArrivals > 0);
  }, [reservations, liveDate]);

  const maxSlotCovers = Math.max(1, ...forecast.map((s) => s.covers));

  const { legacyUnseatedCount, legacyUnseatedExamples } = useMemo(() => {
    const excluded = new Set(['CANCELLED', 'NO_SHOW']);
    const matches = reservations.filter((r) => !excluded.has(r.state) && !r.tableId);
    return {
      legacyUnseatedCount: matches.length,
      legacyUnseatedExamples: matches.slice(0, 3).map((r) => ({
        id: r.id,
        time: r.startsAt ? format(parseISO(r.startsAt), 'HH:mm', { locale: fr }) : '--:--',
        customerName: r.customerName,
        partySize: r.partySize,
      })),
    };
  }, [reservations]);

  const overCapacitySlots = useMemo(
    () => forecast.filter((slot) => slot.covers > stats.totalCapacity),
    [forecast, stats.totalCapacity],
  );

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-2xl font-semibold">{stats.occupancyRate}%</p>
          <p className="text-xs text-muted-foreground">Taux d&apos;occupation</p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {stats.seatedCovers} / {stats.totalCapacity} places
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-2xl font-semibold">{stats.plannedCovers}</p>
          <p className="text-xs text-muted-foreground">Couverts prévus</p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {stats.totalReservations} réservation{stats.totalReservations > 1 ? 's' : ''}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-2xl font-semibold">{stats.activeTables}</p>
          <p className="text-xs text-muted-foreground">Tables actives</p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {stats.inactiveTables} inactive{stats.inactiveTables > 1 ? 's' : ''}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-2xl font-semibold">{stats.occupiedCount}</p>
          <p className="text-xs text-muted-foreground">En service</p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {stats.upcomingCount} prochaines · {stats.lateCount} retard
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-4 text-sm font-semibold">Prévisions de couverts par créneau (30 min)</h3>
        {forecast.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune réservation sur cette journée.</p>
        ) : (
          <div className="space-y-3">
            {forecast.slice(0, 20).map((slot) => (
              <div key={slot.time} className="flex items-center gap-3">
                <div className="w-12 text-xs font-medium tabular-nums">{slot.time}</div>
                <div className="flex-1">
                  <div className="flex h-5 items-center gap-2">
                    <div
                      className="h-2 rounded-full bg-primary transition-all"
                      style={{ width: `${(slot.covers / maxSlotCovers) * 100}%` }}
                    />
                    <span className="text-xs font-medium tabular-nums">{slot.covers} couverts</span>
                  </div>
                </div>
                {slot.newArrivals > 0 ? (
                  <Badge variant="outline" className="text-[10px]">
                    +{slot.newArrivals}
                  </Badge>
                ) : (
                  <span className="w-8" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <Card className="mt-6">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="text-warning" size={16} />
            Alertes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {legacyUnseatedCount === 0 && overCapacitySlots.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-success">
              <CircleCheck size={16} />
              Aucune alerte.
            </div>
          ) : (
            <>
              {legacyUnseatedCount > 0 && (
                <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                  <div className="flex items-center gap-2 font-medium">
                    <AlertTriangle size={16} />
                    {legacyUnseatedCount} réservation{legacyUnseatedCount > 1 ? 's' : ''} sans table
                  </div>
                  {legacyUnseatedExamples.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {legacyUnseatedExamples.map((item) => (
                        <li key={item.id} className="text-xs">
                          {item.time} ·{' '}
                          {item.customerName
                            ? `${item.customerName} · ${item.partySize} couverts`
                            : `${item.partySize} couverts`}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {overCapacitySlots.length > 0 && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  <div className="flex items-center gap-2 font-medium">
                    <AlertTriangle size={16} />
                    Surcapacité détectée
                  </div>
                  <ul className="mt-2 space-y-1">
                    {overCapacitySlots.map((slot) => (
                      <li key={slot.time} className="flex items-center justify-between text-xs">
                        <span>{slot.time}</span>
                        <Badge variant="destructive" className="text-[10px]">
                          {slot.covers} / {stats.totalCapacity}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type WaitingListPanelProps = {
  entries: WaitingListEntry[];
  isLoading: boolean;
  promotingEntryId: string | null;
  entryErrors: Record<string, string>;
  onPromote: (entryId: string) => void;
};

export function WaitingListPanel({
  entries,
  isLoading,
  promotingEntryId,
  entryErrors,
  onPromote,
}: WaitingListPanelProps) {
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ListOrdered size={18} className="text-primary" />
            <h3 className="text-base font-semibold">Liste d&apos;attente</h3>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Les demandes en attente se rafraîchissent avec le plan de salle.
          </p>
        </div>
        <Badge variant="outline">{entries.length} en attente</Badge>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center">
          <ListOrdered size={40} className="mb-3 text-muted-foreground/40" />
          <p className="text-sm font-medium">Aucune demande en attente</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Les demandes apparaîtront ici lorsqu&apos;un créneau est complet.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => {
            const customerName =
              `${entry.customerFirstName} ${entry.customerLastName ?? ''}`.trim();
            const slotTime = format(parseISO(entry.slotStart), 'HH:mm', { locale: fr });

            return (
              <article
                key={entry.id}
                className="rounded-xl border border-border bg-card p-4 transition-all duration-200 hover:border-primary/30"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">#{entry.position}</Badge>
                      <p className="truncate font-medium">{customerName}</p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <Users size={15} /> {entry.partySize} couvert
                        {entry.partySize > 1 ? 's' : ''}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Clock3 size={15} /> {slotTime}
                      </span>
                      <span>{entry.preferredSectionName || 'Sans préférence de section'}</span>
                    </div>
                  </div>
                  <div className="shrink-0">
                    <Button
                      size="sm"
                      disabled={promotingEntryId === entry.id}
                      onClick={() => onPromote(entry.id)}
                    >
                      {promotingEntryId === entry.id ? 'Proposition...' : 'Proposer une table'}
                    </Button>
                    {entryErrors[entry.id] ? (
                      <p className="mt-2 text-right text-xs text-destructive">
                        {entryErrors[entry.id]}
                      </p>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FloorPlanPalette({
  tablesToPlace,
  totalTables,
  onPlaceTable,
  onCreateTable,
  onAutoLayout,
  autoLayoutLoading,
  onQuickAdd,
}: {
  tablesToPlace: CanvasTable[];
  totalTables: number;
  onPlaceTable: (table: CanvasTable) => void;
  onCreateTable: () => void;
  onAutoLayout: () => void;
  autoLayoutLoading: boolean;
  onQuickAdd: (data: PaletteItemData) => void;
}) {
  return (
    <div className="flex max-h-32 w-full min-w-0 flex-row gap-3 overflow-x-auto overflow-y-hidden border-t border-border bg-card p-2.5 lg:order-1 lg:h-full lg:max-h-none lg:w-36 lg:min-w-36 lg:flex-col lg:items-center lg:gap-2 lg:overflow-y-auto lg:border-r lg:border-t-0 lg:p-2">
      <div className="min-w-36 flex-1 lg:w-full lg:min-w-0 lg:flex-none">
        <h4 className="mb-1.5 hidden text-center text-[9px] font-semibold uppercase tracking-wider text-muted-foreground lg:block">
          Tables à placer · {tablesToPlace.length}
        </h4>
        <div className="flex flex-col gap-2">
          {tablesToPlace.length > 0 ? (
            tablesToPlace.map((table) => (
              <PaletteExistingTableCard key={table.id} table={table} onPlace={onPlaceTable} />
            ))
          ) : (
            <p className="px-1 text-[10px] leading-tight text-muted-foreground">
              {totalTables === 0 ? 'Aucune table configurée.' : 'Toutes les tables sont placées.'}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-full justify-center gap-1 px-2 text-[11px] transition-all duration-200"
            onClick={onCreateTable}
          >
            <Plus size={13} />
            <span>Ajouter une table</span>
          </Button>
          {tablesToPlace.length > 1 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-full px-1 text-[10px] text-muted-foreground transition-all duration-200 hover:text-foreground"
              onClick={onAutoLayout}
              disabled={autoLayoutLoading}
            >
              {autoLayoutLoading ? 'Placement…' : 'Disposition automatique'}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="w-full lg:w-full">
        <h4 className="mb-1.5 hidden text-center text-[9px] font-semibold uppercase tracking-wider text-muted-foreground lg:block">
          Aménagement
        </h4>
        <div className="flex flex-col gap-2">
          <PaletteItemCard
            id="palette-zone"
            icon={<Square size={18} className="text-muted-foreground" />}
            label="Zone"
            shortLabel="Zone"
            onQuickAdd={onQuickAdd}
            data={{ kind: 'zone' }}
          />
          <PaletteItemCard
            id="palette-wall"
            icon={<Minus size={18} className="text-muted-foreground" />}
            label="Mur"
            shortLabel="Mur"
            onQuickAdd={onQuickAdd}
            data={{ kind: 'wall', type: 'wall' }}
          />
          <PaletteItemCard
            id="palette-door"
            icon={<DoorOpen size={18} className="text-muted-foreground" />}
            label="Porte"
            shortLabel="Porte"
            onQuickAdd={onQuickAdd}
            data={{ kind: 'wall', type: 'door' }}
          />
          <PaletteItemCard
            id="palette-bar"
            icon={<Wine size={18} className="text-muted-foreground" />}
            label="Bar"
            shortLabel="Bar"
            onQuickAdd={onQuickAdd}
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
  floorPlanId,
  initialDelayImpact,
  onInitialDelayApplied,
  onRequestEdit,
  onRequestWalkIn,
  planOptions,
  onSelectPlan,
}: {
  orgId: string;
  mode?: 'service' | 'design';
  floorPlanId?: string;
  initialDelayImpact?: {
    reservationId: string;
    delayMinutes: number;
    delayReportId?: string;
    serviceDate?: string;
  } | null;
  onInitialDelayApplied?: () => void;
  onRequestEdit?: () => void;
  onRequestWalkIn?: () => void;
  planOptions?: Array<{ id: string; name: string }>;
  onSelectPlan?: (id: string) => void;
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

  // Historique undo/redo des mutations de géométrie (édition uniquement).
  // Une seule pile unifiée tables + murs : ⌘Z défait exactement la dernière
  // mutation, quel que soit l'objet ou le nombre de tables concernées.
  const {
    record: recordGeometry,
    undo: undoGeometrySnapshot,
    redo: redoGeometrySnapshot,
    canUndo,
    canRedo,
    reset: resetGeometryHistory,
  } = useUndoHistory<GeometrySnapshot>();

  const [zoom, setZoom] = useState(1);
  // Dernière échelle appliquée, lue par les gestes natifs (pincement) qui ne
  // re-rendent pas à chaque déplacement de doigt.
  const zoomRef = useRef(zoom);
  // Dernière échelle de cadrage calculée : elle sert de plancher au zoom
  // manuel (dézoomer sous le niveau « la salle entière tient » ne montre
  // que du vide autour du plan).
  const fitZoomRef = useRef(0);
  zoomRef.current = zoom;
  // Un zoom choisi par le restaurateur n'est plus écrasé par le cadrage auto.
  const userAdjustedZoomRef = useRef(false);
  // Chaque plan reçoit son cadrage d'ouverture une seule fois. Cette identité
  // évite de réutiliser le zoom ou le défilement d'une autre salle et permet de
  // réparer un ancien cadrage conservé pendant un rafraîchissement à chaud.
  const autoFittedPlanIdRef = useRef<string | null>(null);
  // Zone occupée par les tables posées : sert au cadrage d'ouverture et au
  // recentrage. Lue via une ref pour que le déplacement d'une table pendant
  // l'édition ne déclenche pas de recadrage automatique.
  const contentBoundsRef = useRef<ContentBounds | null>(null);
  // Repère d'édition : masqué par défaut en service pour garder la salle lisible
  // pendant le coup de feu (le bouton et la touche « G » restent disponibles).
  const [gridVisible, setGridVisible] = useState(mode !== 'service');
  const [snap, setSnap] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const live = mode === 'service';
  // Cadres tactiles : sur téléphone et tablette, le plan est la surface
  // principale. On y adapte l'échelle minimale, le cadrage d'ouverture, les
  // gestes et la taille des cartes de table.
  const touchCanvasLayout = useMediaQuery('(max-width: 1023px)');
  const compactTableCards = useIsMobile();
  const coarsePointer = useMediaQuery('(pointer: coarse)');
  const [liveDate, setLiveDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [serviceTab, setServiceTab] = useState<ServiceTabId>('plan');
  const [selectedServerFilter, setSelectedServerFilter] = useState<string | null>(null);
  const liveDateRef = useRef(liveDate);
  liveDateRef.current = liveDate;
  const [reservations, setReservations] = useState<PlanningReservation[]>([]);
  const [waitingList, setWaitingList] = useState<WaitingListEntry[]>([]);
  const [waitingListLoading, setWaitingListLoading] = useState(false);
  const [promotingWaitingListEntryId, setPromotingWaitingListEntryId] = useState<string | null>(
    null,
  );
  const [waitingListEntryErrors, setWaitingListEntryErrors] = useState<Record<string, string>>({});
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [loadedLiveDate, setLoadedLiveDate] = useState<string | null>(null);
  const [selectedServiceTableId, setSelectedServiceTableId] = useState<string | null>(null);
  const [mobileServiceDetailsOpen, setMobileServiceDetailsOpen] = useState(false);
  const [updatingReservationStateId, setUpdatingReservationStateId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<TableSuggestion[]>([]);
  const [delayMinutes, setDelayMinutes] = useState(20);
  const [delayImpact, setDelayImpact] = useState<ServiceCopilotDelayImpact | null>(null);
  const [delayImpactReservationId, setDelayImpactReservationId] = useState<string | null>(null);
  const [delayImpactLoading, setDelayImpactLoading] = useState(false);
  const [communicationDrafts, setCommunicationDrafts] = useState<ServiceCommunicationDraft[]>([]);
  const [communicationDraftsLoading, setCommunicationDraftsLoading] = useState(false);
  const [delayRecoveryConfirmOpen, setDelayRecoveryConfirmOpen] = useState(false);
  const [applyingDelayRecovery, setApplyingDelayRecovery] = useState(false);
  const applyingDelayRecoveryRef = useRef(false);
  const [delayRecoveryRevertConfirmOpen, setDelayRecoveryRevertConfirmOpen] = useState(false);
  const [revertingDelayRecovery, setRevertingDelayRecovery] = useState(false);
  const revertingDelayRecoveryRef = useRef(false);
  const [reportedDelayBannerDismissed, setReportedDelayBannerDismissed] = useState(false);
  const [delayRecoveryApplied, setDelayRecoveryApplied] = useState(false);
  const [delayRecoveryReverted, setDelayRecoveryReverted] = useState(false);
  const [delayRecoveries, setDelayRecoveries] = useState<ServiceCopilotDelayRecoveryHistoryItem[]>(
    [],
  );
  const [servicePulse, setServicePulse] = useState<ServiceCopilotPulse | null>(null);
  const [delayRecoveryIdempotencyKey, setDelayRecoveryIdempotencyKey] = useState<string | null>(
    null,
  );
  const [waitingListAcceptanceConfirmed, setWaitingListAcceptanceConfirmed] = useState(false);
  const [reportedDelayLookupError, setReportedDelayLookupError] = useState('');
  const [appliedDelayRecovery, setAppliedDelayRecovery] = useState<{
    delayedReservationId: string;
    promotedReservationId: string;
    operationId: string;
    delayedCustomerName: string;
    delayedOriginalTableName: string;
    delayedAlternativeTableName: string;
    waitingCustomerName: string;
    waitingTableName: string;
  } | null>(null);
  const lastInitialDelayImpactRef = useRef(initialDelayImpact);
  if (initialDelayImpact) lastInitialDelayImpactRef.current = initialDelayImpact;
  const displayedInitialDelayImpact =
    initialDelayImpact ?? (appliedDelayRecovery ? lastInitialDelayImpactRef.current : null);
  const initialDelayHandledRef = useRef<string | null>(null);
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
    beforeTable?: FloorPlanTable;
  } | null>(null);
  const [rotateTableId, setRotateTableId] = useState<string | null>(null);
  const rotateStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    startRotation: number;
    centerX: number;
    centerY: number;
    currentRotation?: number;
    beforeTable?: FloorPlanTable;
  } | null>(null);

  const [activeDragData, setActiveDragData] = useState<ActiveDragData | null>(null);
  const [dragStart, setDragStart] = useState<DragStartInfo | null>(null);
  const [autoLayoutLoading, setAutoLayoutLoading] = useState(false);
  const [autoLayoutNotice, setAutoLayoutNotice] = useState(false);
  // Le placement initial ne doit être proposé qu'une seule fois pour un plan
  // fraîchement chargé. On ne le déclenche pas après la création manuelle d'une
  // table, ni après l'actualisation d'un plan déjà configuré.
  const autoLayoutCandidateRef = useRef<string | null>(null);
  const justDraggedRef = useRef(false);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const tableMoveIdRef = useRef(0);
  const tableMutationVersionRef = useRef(new Map<string, number>());
  const wallMutationVersionRef = useRef(new Map<string, number>());
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasViewportRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTable, setEditingTable] = useState<CanvasTable | null>(null);
  const [bulkCreateDialogOpen, setBulkCreateDialogOpen] = useState(false);
  const [bulkCreateLoading, setBulkCreateLoading] = useState(false);
  const [bulkCreateForm, setBulkCreateForm] = useState({
    count: '5',
    capacity: '4',
    sectionId: '',
  });
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
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [zoneDragStart, setZoneDragStart] = useState<{
    zone: FloorPlanZone;
    pointerX: number;
    pointerY: number;
  } | null>(null);
  const [resizeZoneId, setResizeZoneId] = useState<string | null>(null);
  const resizeZoneStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    width: number;
    height: number;
    currentWidth?: number;
    currentHeight?: number;
  } | null>(null);
  const zoneJustDraggedRef = useRef(false);
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
  // Guides de table (bords et centres) visibles pendant le déplacement : ils
  // rendent le magnétisme compréhensible au lieu de laisser un déplacement
  // sembler arbitraire.
  const [tableAlignGuides, setTableAlignGuides] =
    useState<TableAlignmentGuides>(emptyTableAlignmentGuides);
  const [wallLengthGuide, setWallLengthGuide] = useState<WallLengthGuide | null>(null);
  const [wallResizeAlignGuide, setWallResizeAlignGuide] = useState<WallResizeAlignGuide | null>(
    null,
  );
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [floorSettings, setFloorSettings] = useState({
    name: '',
    widthMeters: formatRoomMeters(DEFAULT_CANVAS_WIDTH),
    lengthMeters: formatRoomMeters(DEFAULT_CANVAS_HEIGHT),
  });
  const [settingsError, setSettingsError] = useState('');
  const [savingPlan, setSavingPlan] = useState(false);
  const [planSaved, setPlanSaved] = useState(false);

  const canvasWidth = floorPlan?.width ?? DEFAULT_CANVAS_WIDTH;
  const canvasHeight = floorPlan?.height ?? DEFAULT_CANVAS_HEIGHT;

  // Sur écran tactile, un glissement d'un doigt doit faire défiler le plan :
  // déplacer une table demande donc une pression maintenue. À la souris, on
  // conserve le seuil historique de 3 px.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: coarsePointer ? { delay: 260, tolerance: 8 } : { distance: 3 },
    }),
  );

  const minZoom = touchCanvasLayout ? MIN_ZOOM_TOUCH : MIN_ZOOM;

  /**
   * Cadre le plan dans la fenêtre visible : la zone réellement occupée par les
   * tables quand il y en a (sinon le plan entier, comportement historique), et
   * renvoie l'échelle appliquée ainsi que le défilement qui centre la zone,
   * pour pouvoir enchaîner le cadrage sans attendre le prochain rendu.
   */
  const fitCanvasToViewport = useCallback(() => {
    const viewport = canvasViewportRef.current;
    if (!viewport) return null;
    const viewportWidth = viewport.clientWidth;
    const viewportHeight = viewport.clientHeight;
    if (viewportWidth < 40 || viewportHeight < 40) return null;
    const fitFloor =
      live && serviceTab === 'plan' ? TOUCH_FIT_FLOOR : touchCanvasLayout ? TOUCH_FIT_FLOOR : 1;
    // Plancher du dézoom manuel : cadrer le plan entier.
    const fullCanvasZoom = computeFitZoom({
      viewportWidth,
      viewportHeight,
      canvasWidth,
      canvasHeight,
      minZoom,
      floor: fitFloor,
    });
    const bounds = contentBoundsRef.current;
    let nextZoom = fullCanvasZoom;
    if (bounds) {
      const contentZoom = computeFitZoom({
        viewportWidth,
        viewportHeight,
        canvasWidth: bounds.width,
        canvasHeight: bounds.height,
        minZoom,
        floor: fitFloor,
      });
      // En Live, le cadre est déjà réduit au groupe de tables : on peut donc
      // dépasser 100 % pour remplir utilement la fenêtre sans réintroduire la
      // hauteur vide de la zone d'édition. L'éditeur garde son plafond à 100 %.
      const fitCeiling = live && serviceTab === 'plan' ? MAX_ZOOM : 1;
      nextZoom = clampZoom(
        Math.max(Math.min(contentZoom, fitCeiling), fullCanvasZoom),
        minZoom,
        MAX_ZOOM,
      );
    }
    const scroll =
      live && serviceTab === 'plan' && bounds
        ? {
            left: Math.max(0, (bounds.width * nextZoom - viewportWidth) / 2),
            top: Math.max(0, (bounds.height * nextZoom - viewportHeight) / 2),
          }
        : computeFocusScroll({
            viewportWidth,
            viewportHeight,
            region: bounds ?? { x: 0, y: 0, width: canvasWidth, height: canvasHeight },
            zoom: nextZoom,
          });
    zoomRef.current = nextZoom;
    fitZoomRef.current = fullCanvasZoom;
    setZoom(nextZoom);
    return { zoom: nextZoom, scroll };
  }, [canvasHeight, canvasWidth, live, minZoom, serviceTab, touchCanvasLayout]);

  /**
   * Plancher du zoom manuel sur écran tactile : quand le plan tient déjà
   * entièrement à l'échelle de cadrage, dézoomer davantage ne montre que du
   * vide autour de la salle. Si le cadrage a été plafonné par le plancher
   * tactile (plan plus grand que la fenêtre), on garde la marge MIN_ZOOM_TOUCH.
   */
  const manualMinZoom = useCallback(() => {
    if (!touchCanvasLayout) return MIN_ZOOM;
    const fit = fitZoomRef.current;
    return fit >= TOUCH_FIT_FLOOR ? fit : MIN_ZOOM_TOUCH;
  }, [touchCanvasLayout]);

  /** Zoom manuel : il ne doit plus être écrasé par le cadrage automatique. */
  function changeZoom(delta: number) {
    userAdjustedZoomRef.current = true;
    setZoom((current) => clampZoom(Math.round((current + delta) * 100) / 100, manualMinZoom()));
  }

  /** Replace le plan à l'échelle de cadrage et le centre (double-tap, bouton). */
  function resetView() {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;
    userAdjustedZoomRef.current = false;
    const fit = fitCanvasToViewport();
    const scroll = fit?.scroll ?? {
      ...computeCenterScroll({
        viewportWidth: viewport.clientWidth,
        viewportHeight: viewport.clientHeight,
        canvasWidth,
        canvasHeight,
        zoom: zoomRef.current,
      }),
    };
    window.requestAnimationFrame(() => {
      viewport.scrollTo({ ...scroll, behavior: 'smooth' });
    });
  }

  const resetViewRef = useRef(resetView);
  resetViewRef.current = resetView;

  // Cadrage d'ouverture : sur téléphone et tablette, un plan de 14 m affiché à
  // 100 % ne montre qu'un quart de la salle. On cadre la zone occupée par les
  // tables (et on la centre) une fois, puis on respecte le zoom choisi par le
  // restaurateur.
  useEffect(() => {
    if (!touchCanvasLayout && !live) return;
    if (loading || error) return;
    if (serviceTab !== 'plan') return;
    const planId = floorPlan?.id;
    if (!planId || autoFittedPlanIdRef.current === planId) return;
    const viewport = canvasViewportRef.current;
    userAdjustedZoomRef.current = false;
    let retryFrame: number | null = null;
    const applyInitialFit = () => {
      const fit = fitCanvasToViewport();
      if (!viewport || !fit) {
        // Le premier frame peut précéder la mesure finale du panneau sur
        // Safari. Un second essai suffit sans installer d'observateur durable.
        retryFrame = window.requestAnimationFrame(() => {
          const retryFit = fitCanvasToViewport();
          if (!viewport || !retryFit) return;
          viewport.scrollLeft = retryFit.scroll.left;
          viewport.scrollTop = retryFit.scroll.top;
          autoFittedPlanIdRef.current = planId;
        });
        return;
      }
      viewport.scrollLeft = fit.scroll.left;
      viewport.scrollTop = fit.scroll.top;
      autoFittedPlanIdRef.current = planId;
    };
    const frame = window.requestAnimationFrame(applyInitialFit);
    return () => {
      window.cancelAnimationFrame(frame);
      if (retryFrame !== null) window.cancelAnimationFrame(retryFrame);
    };
  }, [touchCanvasLayout, live, loading, error, serviceTab, floorPlan?.id, fitCanvasToViewport]);

  // Gestes du plan : pincer pour zoomer, double-tap pour recadrer. Le
  // défilement à un doigt reste natif (voir `touch-action` sur la fenêtre).
  useEffect(() => {
    const viewport = canvasViewportRef.current;
    // Live est une vue finalisée : pas de zoom local ni de double-tap qui
    // permettrait de sortir du cadrage utile. Le défilement natif reste
    // disponible lorsque la zone est plus large que la fenêtre.
    if (!viewport || (live && serviceTab === 'plan')) return;

    let pinchStart: { distance: number; zoom: number } | null = null;
    let lastTap: { time: number; x: number; y: number } | null = null;

    function distanceBetween(a: { x: number; y: number }, b: { x: number; y: number }) {
      return Math.hypot(a.x - b.x, a.y - b.y);
    }

    function applyZoomAtPoint(nextZoom: number, clientX: number, clientY: number) {
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const offsetX = clientX - rect.left;
      const offsetY = clientY - rect.top;
      const currentZoom = zoomRef.current;
      if (Math.abs(nextZoom - currentZoom) < 0.005) return;
      const nextScroll = computeZoomAnchorScroll({
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
        offsetX,
        offsetY,
        zoom: currentZoom,
        nextZoom,
      });
      userAdjustedZoomRef.current = true;
      zoomRef.current = nextZoom;
      setZoom(nextZoom);
      // La surface de défilement suit l'échelle : on repositionne le point
      // touché une fois le rendu appliqué.
      window.requestAnimationFrame(() => {
        viewport.scrollLeft = nextScroll.left;
        viewport.scrollTop = nextScroll.top;
      });
    }

    function handleTouchStart(event: TouchEvent) {
      const touches = Array.from(event.touches).map((touch) => ({
        x: touch.clientX,
        y: touch.clientY,
      }));
      if (touches.length >= 2) {
        pinchStart = {
          distance: distanceBetween(touches[0], touches[1]),
          zoom: zoomRef.current,
        };
        lastTap = null;
        return;
      }
      if (touches.length !== 1) return;
      const target = event.target as HTMLElement | null;
      // Un appui sur une table ou un bouton garde son action : pas de recadrage.
      if (target?.closest('[role="button"], button, a, input, select')) {
        lastTap = null;
        return;
      }
      const tap = { time: event.timeStamp, x: touches[0].x, y: touches[0].y };
      if (isDoubleTap(lastTap, tap)) {
        lastTap = null;
        resetViewRef.current();
        return;
      }
      lastTap = tap;
    }

    function handleTouchMove(event: TouchEvent) {
      if (!pinchStart || event.touches.length < 2) return;
      const touches = Array.from(event.touches).map((touch) => ({
        x: touch.clientX,
        y: touch.clientY,
      }));
      // Le pincement pilote le plan, pas la page : sans cela Safari zoome la vue.
      if (event.cancelable) event.preventDefault();
      if (pinchStart.distance < 8) return;
      const ratio = distanceBetween(touches[0], touches[1]) / pinchStart.distance;
      applyZoomAtPoint(
        clampZoom(pinchStart.zoom * ratio, manualMinZoom()),
        (touches[0].x + touches[1].x) / 2,
        (touches[0].y + touches[1].y) / 2,
      );
    }

    function handleTouchEnd(event: TouchEvent) {
      if (event.touches.length < 2) pinchStart = null;
    }

    function handleWheel(event: WheelEvent) {
      // Pincement sur pavé tactile (Ctrl + molette). Le zoom navigateur reste
      // disponible ailleurs dans la page.
      if (!event.ctrlKey) return;
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0025);
      applyZoomAtPoint(clampZoom(zoomRef.current * factor, minZoom), event.clientX, event.clientY);
    }

    function handleDoubleClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[role="button"], button, a, input, select')) return;
      resetViewRef.current();
    }

    viewport.addEventListener('touchstart', handleTouchStart, { passive: true });
    viewport.addEventListener('touchmove', handleTouchMove, { passive: false });
    viewport.addEventListener('touchend', handleTouchEnd, { passive: true });
    viewport.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    viewport.addEventListener('wheel', handleWheel, { passive: false });
    viewport.addEventListener('dblclick', handleDoubleClick);
    return () => {
      viewport.removeEventListener('touchstart', handleTouchStart);
      viewport.removeEventListener('touchmove', handleTouchMove);
      viewport.removeEventListener('touchend', handleTouchEnd);
      viewport.removeEventListener('touchcancel', handleTouchEnd);
      viewport.removeEventListener('wheel', handleWheel);
      viewport.removeEventListener('dblclick', handleDoubleClick);
    };
  }, [loading, live, manualMinZoom, minZoom, serviceTab]);

  const loadFloorPlan = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const path = floorPlanId
        ? `restaurants/${orgId}/floor-plans/${floorPlanId}`
        : `restaurants/${orgId}/floor-plan`;
      const data = await getRef.current<FloorPlan>(path);
      const loadedTables = [
        ...data.sections.flatMap((section) => section.tables),
        ...(data.tables ?? []),
      ];
      const allLoadedTablesAreUnplaced =
        loadedTables.length > 0 &&
        loadedTables.every((table) => table.positionX === null || table.positionY === null);
      autoLayoutCandidateRef.current = !live && allLoadedTablesAreUnplaced ? data.id : null;
      setAutoLayoutNotice(false);
      // purge tout historique et version obsolète avant de remplacer le plan —
      // les snapshots référencent les objets de l'ancien chargement
      resetGeometryHistory();
      tableMutationVersionRef.current.clear();
      wallMutationVersionRef.current.clear();
      setFloorPlan(data);
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de charger le plan de salle'));
    } finally {
      setLoading(false);
    }
  }, [orgId, floorPlanId, live, resetGeometryHistory]);

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
        const query = floorPlanId
          ? `date=${liveDate}&floorPlanId=${floorPlanId}`
          : `date=${liveDate}`;
        setWaitingListLoading(true);
        const [reservationsResult, waitingListResult, delayRecoveriesResult, pulseResult] =
          await Promise.allSettled([
            getRef.current<PlanningReservation[]>(
              `restaurants/${orgId}/floor-plan/reservations?${query}`,
              {
                signal: controller.signal,
              },
            ),
            getRef.current<unknown[]>(
              `restaurants/${orgId}/waiting-list?date=${liveDate}&status=PENDING`,
              { signal: controller.signal },
            ),
            getRef.current<ServiceCopilotDelayRecoveryHistoryResponse>(
              `restaurants/${orgId}/service-copilot/delay-recoveries?date=${liveDate}&limit=10`,
              { signal: controller.signal },
            ),
            getRef.current<ServiceCopilotPulse>(
              `restaurants/${orgId}/service-copilot/pulse?date=${liveDate}`,
              { signal: controller.signal },
            ),
          ]);
        if (pollAbortRef.current !== controller) return;
        if (liveDateRef.current !== liveDate) return;
        if (reservationsResult.status === 'rejected') throw reservationsResult.reason;
        setReservations(reservationsResult.value);
        if (waitingListResult.status === 'fulfilled') {
          setWaitingList(
            mapWaitingListEntries(
              Array.isArray(waitingListResult.value) ? waitingListResult.value : [],
            ),
          );
        } else {
          setError(
            getErrorMessage(waitingListResult.reason, "Impossible de charger la liste d'attente"),
          );
        }
        if (delayRecoveriesResult.status === 'fulfilled') {
          setDelayRecoveries(
            Array.isArray(delayRecoveriesResult.value.recoveries)
              ? delayRecoveriesResult.value.recoveries
              : [],
          );
        } else {
          setError(
            getErrorMessage(
              delayRecoveriesResult.reason,
              'Impossible de charger l’historique des plans',
            ),
          );
        }
        if (pulseResult.status === 'fulfilled') {
          setServicePulse(pulseResult.value);
        } else {
          // Le plan et les actions restent utilisables si le résumé secondaire
          // est temporairement indisponible.
          setServicePulse(null);
        }
        setLastUpdatedAt(Date.now());
        setLoadedLiveDate(liveDate);
      } catch (err) {
        if (pollAbortRef.current !== controller) return;
        if (controller.signal.aborted) return;
        setError(getErrorMessage(err, 'Impossible de charger les réservations'));
      } finally {
        if (pollAbortRef.current === controller) {
          setWaitingListLoading(false);
        }
        if (pollAbortRef.current === controller) {
          pollInFlightRef.current = false;
        }
      }
    },
    [orgId, live, liveDate, floorPlanId],
  );

  const updateReservationState = useCallback(
    async (reservationId: string, state: 'SEATED' | 'HONORED') => {
      if (!orgId) return;
      setUpdatingReservationStateId(reservationId);
      try {
        await patchRef.current<void>(
          `restaurants/${orgId}/floor-plan/reservations/${reservationId}/state`,
          { state },
        );
        setReservations((prev) => prev.map((r) => (r.id === reservationId ? { ...r, state } : r)));
        await loadReservations({ force: true });
      } catch (err) {
        setError(getErrorMessage(err, 'Impossible de mettre à jour le statut'));
      } finally {
        setUpdatingReservationStateId(null);
      }
    },
    [orgId, loadReservations],
  );

  const createWalkIn = useCallback(
    async (tableId: string, partySize?: number, customerName?: string) => {
      if (!orgId) return;
      try {
        const table = floorPlan?.tables?.find((t) => t.id === tableId);
        const resolvedPartySize = partySize ?? table?.capacity ?? 2;
        const resolvedCustomerName = customerName?.trim() || 'Walk-in';
        const idempotencyKey = crypto.randomUUID();
        const res = await postRef.current<{ id: string }>(
          `restaurants/${orgId}/floor-plan/walk-ins`,
          {
            tableId,
            partySize: resolvedPartySize,
            customerName: resolvedCustomerName,
            idempotencyKey,
          },
        );
        const now = new Date().toISOString();
        setReservations((prev) => [
          ...prev,
          {
            id: res.id,
            tableId,
            tableName: table?.name ?? null,
            sectionName: table?.sectionName ?? null,
            startsAt: now,
            endsAt: now,
            partySize: resolvedPartySize,
            customerName: resolvedCustomerName,
            state: 'SEATED',
            seatedAt: now,
          },
        ]);
        await loadReservations({ force: true });
      } catch (err) {
        setError(getErrorMessage(err, 'Impossible de créer le walk-in'));
      }
    },
    [orgId, floorPlan?.tables, loadReservations],
  );

  const promoteWaitingListEntry = useCallback(
    async (entryId: string) => {
      if (!orgId) return;
      setPromotingWaitingListEntryId(entryId);
      setWaitingListEntryErrors((prev) => {
        const next = { ...prev };
        delete next[entryId];
        return next;
      });
      try {
        await postRef.current(`restaurants/${orgId}/waiting-list/${entryId}/promote`);
        await loadReservations({ force: true });
      } catch (err) {
        const message = getErrorMessage(err, 'Impossible de proposer une table');
        if (message === 'no_compatible_table' || message.includes('no_compatible_table')) {
          setWaitingListEntryErrors((prev) => ({ ...prev, [entryId]: 'Aucune table compatible' }));
        } else {
          setError(message);
        }
      } finally {
        setPromotingWaitingListEntryId(null);
      }
    },
    [orgId, loadReservations],
  );

  const suggestTable = useCallback(
    async (reservationId: string) => {
      if (!orgId) return;
      setSuggestions([]);
      try {
        const query = floorPlanId ? `?floorPlanId=${floorPlanId}` : '';
        const res = await getRef.current<{ suggestions?: TableSuggestion[]; reason?: string }>(
          `restaurants/${orgId}/floor-plan/reservations/${reservationId}/suggest-table${query}`,
        );
        const list = res.suggestions ?? [];
        if (list.length > 0) setSuggestions(list);
        else setError(res.reason || 'Aucune table disponible');
      } catch (err) {
        setError(getErrorMessage(err, 'Impossible de suggérer une table'));
      }
    },
    [orgId, floorPlanId],
  );

  const simulateDelayImpact = useCallback(
    async (reservationId: string) => {
      if (!orgId) return;
      setDelayImpactLoading(true);
      setDelayImpact(null);
      setCommunicationDrafts([]);
      setWaitingListAcceptanceConfirmed(false);
      setDelayRecoveryApplied(false);
      setDelayRecoveryReverted(false);
      setAppliedDelayRecovery(null);
      lastInitialDelayImpactRef.current = { reservationId, delayMinutes };
      setDelayRecoveryIdempotencyKey(crypto.randomUUID());
      setDelayImpactReservationId(reservationId);
      try {
        const result = await postRef.current<ServiceCopilotDelayImpact>(
          `restaurants/${orgId}/service-copilot/delay-impact`,
          { reservationId, delayMinutes },
        );
        setDelayImpact(result);
      } catch (err) {
        setError(getErrorMessage(err, 'Impossible d’analyser ce retard'));
      } finally {
        setDelayImpactLoading(false);
      }
    },
    [orgId, delayMinutes],
  );

  const updateDelayMinutes = useCallback(
    (nextDelayMinutes: number) => {
      const normalized = Math.min(180, Math.max(5, nextDelayMinutes || 5));
      setDelayMinutes(normalized);
      if (delayImpact && normalized !== delayImpact.delayMinutes) {
        setDelayImpact(null);
        setCommunicationDrafts([]);
        setWaitingListAcceptanceConfirmed(false);
        setDelayRecoveryIdempotencyKey(null);
      }
    },
    [delayImpact],
  );

  useEffect(() => {
    if (live && initialDelayImpact?.serviceDate && initialDelayImpact.serviceDate !== liveDate) {
      setLiveDate(initialDelayImpact.serviceDate);
    }
  }, [initialDelayImpact?.serviceDate, live, liveDate]);

  useEffect(() => {
    if (!live || !initialDelayImpact) {
      initialDelayHandledRef.current = null;
      setReportedDelayLookupError('');
      return;
    }
    if (initialDelayImpact.serviceDate && initialDelayImpact.serviceDate !== liveDate) return;
    const handledKey = `${initialDelayImpact.reservationId}:${initialDelayImpact.delayMinutes}:${initialDelayImpact.delayReportId ?? 'manual'}`;
    if (initialDelayHandledRef.current === handledKey) return;
    const reservation = reservations.find((item) => item.id === initialDelayImpact.reservationId);
    if (!reservation) {
      if (lastUpdatedAt && loadedLiveDate === liveDate) {
        setReportedDelayLookupError(
          'La réservation signalée n’est pas visible pour cette date. Vérifiez la date du service.',
        );
      }
      return;
    }
    if (!reservation.tableId) {
      setReportedDelayLookupError(
        'Cette réservation n’a pas de table initiale : aucun déplacement automatique n’est possible.',
      );
      initialDelayHandledRef.current = handledKey;
      return;
    }
    initialDelayHandledRef.current = handledKey;
    setDelayMinutes(initialDelayImpact.delayMinutes);
    setReportedDelayBannerDismissed(false);
    setDelayRecoveryApplied(false);
    setDelayRecoveryReverted(false);
    setAppliedDelayRecovery(null);
    setWaitingListAcceptanceConfirmed(false);
    setCommunicationDrafts([]);
    setReportedDelayLookupError('');
    setDelayRecoveryIdempotencyKey(crypto.randomUUID());
    setSelectedServiceTableId(reservation.tableId);
    void (async () => {
      setDelayImpactLoading(true);
      setDelayImpactReservationId(reservation.id);
      try {
        const result = await postRef.current<ServiceCopilotDelayImpact>(
          `restaurants/${orgId}/service-copilot/delay-impact`,
          { reservationId: reservation.id, delayMinutes: initialDelayImpact.delayMinutes },
        );
        setDelayImpact(result);
      } catch (err) {
        setError(getErrorMessage(err, 'Impossible d’analyser ce retard'));
      } finally {
        setDelayImpactLoading(false);
      }
    })();
  }, [initialDelayImpact, lastUpdatedAt, live, liveDate, loadedLiveDate, orgId, reservations]);

  const applyDelayRecovery = useCallback(async () => {
    if (applyingDelayRecoveryRef.current) return;
    if (
      !orgId ||
      !delayImpact ||
      !delayImpact.feasible ||
      !delayImpactReservationId ||
      !delayImpact.alternativeTable ||
      !delayImpact.waitingListEntry
    ) {
      return;
    }
    applyingDelayRecoveryRef.current = true;
    setApplyingDelayRecovery(true);
    try {
      const result = await postRef.current<DelayRecoveryApiResult>(
        `restaurants/${orgId}/service-copilot/delay-impact/apply`,
        {
          reservationId: delayImpactReservationId,
          delayMinutes: delayImpact.delayMinutes,
          alternativeTableId: delayImpact.alternativeTable.id,
          waitingListEntryId: delayImpact.waitingListEntry.id,
          waitingListAcceptanceConfirmed,
          delayReportId: initialDelayImpact?.delayReportId,
          idempotencyKey: delayRecoveryIdempotencyKey ?? crypto.randomUUID(),
        },
      );
      setAppliedDelayRecovery({
        delayedReservationId: result.delayedReservationId,
        promotedReservationId: result.promotedReservationId,
        operationId: result.operationId,
        delayedCustomerName: delayImpact.delayedReservation?.customerName || 'Client',
        delayedOriginalTableName:
          delayImpact.delayedReservation?.originalTableName || 'Table initiale',
        delayedAlternativeTableName: delayImpact.alternativeTable.name,
        waitingCustomerName: delayImpact.waitingListEntry.customerName,
        waitingTableName: delayImpact.delayedReservation?.originalTableName || 'Table libérée',
      });
      setDelayRecoveryConfirmOpen(false);
      setDelayImpact(null);
      setCommunicationDrafts([]);
      setDelayRecoveryApplied(true);
      setDelayRecoveryReverted(false);
      onInitialDelayApplied?.();
      await loadReservations({ force: true });
    } catch (err) {
      setDelayRecoveryConfirmOpen(false);
      setError(getErrorMessage(err, 'Le plan a changé ; relancez l’analyse avant de confirmer.'));
    } finally {
      applyingDelayRecoveryRef.current = false;
      setApplyingDelayRecovery(false);
    }
  }, [
    orgId,
    delayImpact,
    delayImpactReservationId,
    waitingListAcceptanceConfirmed,
    initialDelayImpact?.delayReportId,
    delayRecoveryIdempotencyKey,
    onInitialDelayApplied,
    loadReservations,
  ]);

  const revertDelayRecovery = useCallback(async () => {
    if (revertingDelayRecoveryRef.current || !orgId || !appliedDelayRecovery) return;
    revertingDelayRecoveryRef.current = true;
    setRevertingDelayRecovery(true);
    try {
      await postRef.current(`restaurants/${orgId}/service-copilot/delay-impact/revert`, {
        reservationId: appliedDelayRecovery.delayedReservationId,
        operationId: appliedDelayRecovery.operationId,
      });
      setDelayRecoveryRevertConfirmOpen(false);
      setDelayRecoveryReverted(true);
      await loadReservations({ force: true });
    } catch (err) {
      setDelayRecoveryRevertConfirmOpen(false);
      setError(
        getErrorMessage(
          err,
          'Le service a évolué depuis l’application. Corrigez la situation manuellement.',
        ),
      );
    } finally {
      revertingDelayRecoveryRef.current = false;
      setRevertingDelayRecovery(false);
    }
  }, [orgId, appliedDelayRecovery, loadReservations]);

  const openPersistedRecoveryRevert = useCallback(
    (recovery: ServiceCopilotDelayRecoveryHistoryItem) => {
      if (!recovery.revertible) return;
      lastInitialDelayImpactRef.current = {
        reservationId: recovery.delayedReservationId,
        delayMinutes: recovery.delayMinutes,
      };
      setAppliedDelayRecovery({
        delayedReservationId: recovery.delayedReservationId,
        promotedReservationId: recovery.promotedReservationId,
        operationId: recovery.operationId,
        delayedCustomerName: recovery.delayedCustomerName,
        delayedOriginalTableName: recovery.originalTableName,
        delayedAlternativeTableName: recovery.alternativeTableName,
        waitingCustomerName: recovery.waitingCustomerName,
        waitingTableName: recovery.originalTableName,
      });
      setDelayRecoveryApplied(true);
      setDelayRecoveryReverted(false);
      setReportedDelayBannerDismissed(false);
      setDelayRecoveryRevertConfirmOpen(true);
    },
    [],
  );

  const loadCommunicationDrafts = useCallback(async () => {
    if (!orgId || !delayImpactReservationId || !delayImpact?.feasible) return;
    setCommunicationDraftsLoading(true);
    try {
      const result = await postRef.current<ServiceCommunicationDraftsResponse>(
        `restaurants/${orgId}/service-copilot/delay-impact/drafts`,
        { reservationId: delayImpactReservationId, delayMinutes: delayImpact.delayMinutes },
      );
      const planChanged =
        result.impact.alternativeTable?.id !== delayImpact.alternativeTable?.id ||
        result.impact.waitingListEntry?.id !== delayImpact.waitingListEntry?.id;
      setDelayImpact(result.impact);
      setCommunicationDrafts(result.drafts);
      if (planChanged) {
        setWaitingListAcceptanceConfirmed(false);
        setError('Le plan a évolué pendant la préparation des messages. Vérifiez-le à nouveau.');
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de préparer les brouillons'));
    } finally {
      setCommunicationDraftsLoading(false);
    }
  }, [orgId, delayImpact, delayImpactReservationId]);

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
        setSuggestions([]);
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
      const path = floorPlanId
        ? `restaurants/${orgId}/floor-plans/${floorPlanId}`
        : `restaurants/${orgId}/floor-plan`;
      const savedPlan = await getRef.current<FloorPlan>(path);
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
      const tableName = table.name.trim();
      const existingNumber = Number(table.name.match(/^T0*(\d+)$/i)?.[1] ?? 0);
      if (existingNumber > 0) return { ...table, displayName: `T${existingNumber}` };
      if (tableName) return { ...table, displayName: tableName };
      while (usedNumbers.has(nextNumber)) nextNumber += 1;
      const displayName = `T${nextNumber}`;
      usedNumbers.add(nextNumber);
      nextNumber += 1;
      return { ...table, displayName };
    });
  }, [floorPlan]);

  const placedTables = useMemo(
    () => allTables.filter((table) => table.positionX !== null && table.positionY !== null),
    [allTables],
  );
  const tablesToPlace = useMemo(
    () => allTables.filter((table) => table.positionX === null || table.positionY === null),
    [allTables],
  );
  const zones = useMemo<FloorPlanZone[]>(
    () =>
      (floorPlan?.zones ?? []).map((zone) => ({
        ...zone,
        sectionName: zone.sectionName ?? zone.section?.name ?? null,
      })),
    [floorPlan?.zones],
  );
  // En Live, seules les zones qui contiennent une table posée sont pertinentes
  // pour l'exploitation. Une zone vide ne doit ni être affichée ni agrandir la
  // surface défilable ; l'édition conserve toutes les zones du plan.
  const liveZones = useMemo(
    () =>
      live
        ? zones.filter((zone) => placedTables.some((table) => isTableInsideZone(table, zone)))
        : zones,
    [live, placedTables, zones],
  );
  const contentBounds = useMemo(
    () =>
      live
        ? computeLiveContentBounds(liveZones, placedTables, canvasWidth, canvasHeight)
        : computeContentBounds(placedTables, canvasWidth, canvasHeight),
    [canvasHeight, canvasWidth, live, liveZones, placedTables],
  );
  // Mise à jour pendant le rendu (convention du fichier, cf. zoomRef) : la
  // lecture par ref dans le cadrage évite tout recadrage automatique quand le
  // restaurateur déplace ou redimensionne une table.
  contentBoundsRef.current = contentBounds;
  const tableCombinations = useMemo<FloorPlanTableCombination[]>(
    () => floorPlan?.tableCombinations ?? [],
    [floorPlan?.tableCombinations],
  );
  const combinableTableIds = useMemo(
    () =>
      new Set(
        tableCombinations.flatMap((combination) => combination.members.map((m) => m.tableId)),
      ),
    [tableCombinations],
  );
  const selectedZone = selectedZoneId
    ? (zones.find((zone) => zone.id === selectedZoneId) ?? null)
    : null;
  const selectedCombination = useMemo(() => {
    if (selectedTableIds.size < 2) return null;
    return (
      tableCombinations.find((combination) => {
        const ids = new Set(combination.members.map((member) => member.tableId));
        return (
          ids.size === selectedTableIds.size && [...selectedTableIds].every((id) => ids.has(id))
        );
      }) ?? null
    );
  }, [selectedTableIds, tableCombinations]);

  const tableStatuses = useMemo(() => {
    const map = new Map<string, { status: TableStatus; reservation: PlanningReservation | null }>();
    if (!live) return map;
    const now = new Date();
    for (const table of allTables) {
      map.set(table.id, getTableStatus(table, reservations, now));
    }
    return map;
  }, [live, allTables, reservations]);

  const serverSummary = useMemo(() => {
    const counts = new Map<string, number>();
    let unassigned = 0;

    for (const table of allTables) {
      const server = table.assignedServer?.trim();
      if (!server) {
        unassigned += 1;
        continue;
      }
      counts.set(server, (counts.get(server) ?? 0) + 1);
    }

    return {
      counts,
      servers: Array.from(counts.keys()).sort((a, b) => a.localeCompare(b, 'fr')),
      unassigned,
    };
  }, [allTables]);

  const allServers = serverSummary.servers;
  const serverTableCounts = serverSummary.counts;
  const unassignedCount = serverSummary.unassigned;
  const hasServerFilter = allTables.length > 0 && (allServers.length > 0 || unassignedCount > 0);

  useEffect(() => {
    if (selectedServerFilter === '_unassigned_' && unassignedCount === 0) {
      setSelectedServerFilter(null);
      return;
    }
    if (
      selectedServerFilter &&
      selectedServerFilter !== '_unassigned_' &&
      !serverTableCounts.has(selectedServerFilter)
    ) {
      setSelectedServerFilter(null);
    }
  }, [selectedServerFilter, serverTableCounts, unassignedCount]);

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
  const reportedDelayReservation = useMemo(
    () =>
      displayedInitialDelayImpact
        ? (reservations.find(
            (reservation) => reservation.id === displayedInitialDelayImpact.reservationId,
          ) ?? null)
        : null,
    [displayedInitialDelayImpact, reservations],
  );
  const reportedDelayOriginalTableId = delayImpact ? reportedDelayReservation?.tableId : null;
  const reportedDelayAlternativeTableId = delayImpact?.alternativeTable?.id ?? null;

  function centerCanvas() {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({
      left: Math.max(0, (canvasWidth * zoom - viewport.clientWidth) / 2),
      top: Math.max(0, (canvasHeight * zoom - viewport.clientHeight) / 2),
      behavior: 'smooth',
    });
  }

  function openRoomSettings() {
    setFloorSettings({
      name: floorPlan?.name ?? '',
      widthMeters: formatRoomMeters(floorPlan?.width ?? DEFAULT_CANVAS_WIDTH),
      lengthMeters: formatRoomMeters(floorPlan?.height ?? DEFAULT_CANVAS_HEIGHT),
    });
    setSettingsError('');
    setSettingsDialogOpen(true);
  }

  function focusTablesToPlace() {
    const firstTableId = tablesToPlace[0]?.id;
    if (!firstTableId) return;
    document.getElementById(`palette-table-${firstTableId}`)?.focus();
  }

  async function placeExistingTable(table: CanvasTable) {
    if (!orgId || live) return;
    const { width, height } = getTableSize(table);
    const { x, y } = findNextPosition(width, height, placedTables, canvasWidth, canvasHeight);
    const before = snapshotTableGeometry(table);
    const after = snapshotTableGeometry({ ...table, positionX: x, positionY: y });
    recordGeometry({
      before: { tables: [before], walls: [] },
      after: { tables: [after], walls: [] },
    });
    setPlanSaved(false);
    setSelectedTableIds(new Set([table.id]));
    setLastSelectedTableId(table.id);
    setSelectedWallId(null);
    setFloorPlan((prev) => (prev ? replaceTablePosition(prev, table.id, x, y) : prev));

    try {
      setError('');
      const updated = await patch<FloorPlanTable>(
        `restaurants/${orgId}/floor-plan/tables/${table.id}`,
        {
          positionX: x,
          positionY: y,
          ...(floorPlanId ? { floorPlanId } : {}),
        },
      );
      setFloorPlan((prev) =>
        prev
          ? replaceTablePosition(prev, table.id, updated.positionX ?? x, updated.positionY ?? y)
          : prev,
      );
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de placer la table'));
      setFloorPlan((prev) =>
        prev ? replaceTablePosition(prev, table.id, table.positionX, table.positionY) : prev,
      );
    }
  }

  async function createUnplacedTable() {
    if (!orgId || live) return;
    const name = getNextTableName(allTables);
    try {
      setError('');
      setPlanSaved(false);
      const created = await post<FloorPlanTable>(`restaurants/${orgId}/floor-plan/tables`, {
        sectionId: null,
        minCapacity: 1,
        positionX: null,
        positionY: null,
        capacity: 4,
        shape: 'rect',
        name,
        ...(floorPlanId ? { floorPlanId } : {}),
      });
      setFloorPlan((prev) => (prev ? replaceTable(prev, created) : prev));
      setSelectedTableIds(new Set([created.id]));
      setLastSelectedTableId(created.id);
      setSelectedWallId(null);
      window.setTimeout(() => document.getElementById(`palette-table-${created.id}`)?.focus(), 0);
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de créer la table'));
    }
  }

  async function createTablesBatch(event: React.FormEvent) {
    event.preventDefault();
    if (!orgId || live || bulkCreateLoading) return;
    const count = Number(bulkCreateForm.count);
    const capacity = Number(bulkCreateForm.capacity);
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      setError('Choisissez entre 1 et 50 tables.');
      return;
    }
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 30) {
      setError('La capacité doit être comprise entre 1 et 30 places.');
      return;
    }

    setBulkCreateLoading(true);
    setError('');
    setPlanSaved(false);
    const names = [...allTables];
    const created: FloorPlanTable[] = [];
    try {
      for (let index = 0; index < count; index += 1) {
        const name = getNextTableName(names);
        const table = await post<FloorPlanTable>(`restaurants/${orgId}/floor-plan/tables`, {
          sectionId: bulkCreateForm.sectionId || null,
          minCapacity: 1,
          positionX: null,
          positionY: null,
          capacity,
          shape: 'rect',
          name,
          ...(floorPlanId ? { floorPlanId } : {}),
        });
        created.push(table);
        names.push({ ...table, name } as CanvasTable);
      }
      setFloorPlan((prev) => {
        if (!prev) return prev;
        return created.reduce((next, table) => replaceTable(next, table), prev);
      });
      setSelectedTableIds(new Set(created.map((table) => table.id)));
      setLastSelectedTableId(created[0]?.id ?? null);
      setSelectedWallId(null);
      setBulkCreateDialogOpen(false);
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de créer les tables'));
    } finally {
      setBulkCreateLoading(false);
    }
  }

  async function autoLayoutTables({ initial = false }: { initial?: boolean } = {}) {
    if (!orgId || live || autoLayoutLoading || tablesToPlace.length === 0 || !floorPlan) return;
    setAutoLayoutLoading(true);
    setError('');
    setPlanSaved(false);
    const occupied = [...placedTables];
    const placements = tablesToPlace.map((table) => {
      const { width, height } = getTableSize(table);
      const position = findNextPosition(width, height, occupied, canvasWidth, canvasHeight);
      occupied.push({ ...table, positionX: position.x, positionY: position.y });
      return { table, ...position };
    });

    try {
      const updatedTables = await Promise.all(
        placements.map(({ table, x, y }) =>
          patch<FloorPlanTable>(`restaurants/${orgId}/floor-plan/tables/${table.id}`, {
            positionX: x,
            positionY: y,
            ...(floorPlanId ? { floorPlanId } : {}),
          }),
        ),
      );
      const nextPlan = updatedTables.reduce(
        (plan, updated, index) =>
          replaceTablePosition(
            plan,
            placements[index].table.id,
            updated.positionX ?? placements[index].x,
            updated.positionY ?? placements[index].y,
          ),
        floorPlan,
      );
      recordGeometry({
        before: { tables: tablesToPlace.map(snapshotTableGeometry), walls: [] },
        after: {
          tables: updatedTables.map((updated, index) =>
            snapshotTableGeometry({
              ...placements[index].table,
              positionX: updated.positionX ?? placements[index].x,
              positionY: updated.positionY ?? placements[index].y,
            }),
          ),
          walls: [],
        },
      });
      setFloorPlan(nextPlan);
      if (initial) {
        setSelectedTableIds(new Set());
        setLastSelectedTableId(null);
        setSelectedWallId(null);
        setAutoLayoutNotice(true);
      } else {
        setSelectedTableIds(new Set(updatedTables.map((table) => table.id)));
        setLastSelectedTableId(updatedTables[0]?.id ?? null);
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de générer la disposition automatique'));
    } finally {
      setAutoLayoutLoading(false);
    }
  }

  useEffect(() => {
    if (
      live ||
      !floorPlan ||
      autoLayoutCandidateRef.current !== floorPlan.id ||
      autoLayoutLoading ||
      allTables.length === 0 ||
      placedTables.length > 0
    ) {
      return;
    }

    // Consommer le candidat avant la mutation asynchrone évite qu'un rerender
    // ou la réponse de l'API ne relance une seconde disposition automatique.
    autoLayoutCandidateRef.current = null;
    void autoLayoutTables({ initial: true });
  }, [allTables.length, autoLayoutLoading, autoLayoutTables, floorPlan, live, placedTables.length]);

  const quickAddFromPalette = useCallback(
    async (data: PaletteItemData) => {
      if (!orgId || live) return;
      if (data.kind === 'table') {
        const { width, height } = getTableSize({
          capacity: data.capacity,
          shape: data.shape,
        } as FloorPlanTable);
        const { x, y } = findNextPosition(width, height, placedTables, canvasWidth, canvasHeight);
        const name = getNextTableName(allTables);
        try {
          setError('');
          const created = await post<FloorPlanTable>(`restaurants/${orgId}/floor-plan/tables`, {
            sectionId: null,
            minCapacity: 1,
            positionX: x,
            positionY: y,
            capacity: data.capacity,
            shape: data.shape,
            name,
            ...(floorPlanId ? { floorPlanId } : {}),
          });
          setFloorPlan((prev) => (prev ? replaceTable(prev, created) : prev));
          setSelectedTableIds(new Set([created.id]));
          setLastSelectedTableId(created.id);
          setSelectedWallId(null);
        } catch (err) {
          setError(getErrorMessage(err, 'Impossible de créer la table'));
        }
        return;
      }
      if (data.kind === 'zone') {
        const width = Math.min(360, canvasWidth - 64);
        const height = Math.min(220, canvasHeight - 64);
        const position = findNextZonePosition(width, height, zones, canvasWidth, canvasHeight);
        try {
          setError('');
          const created = await post<FloorPlanZone>(`restaurants/${orgId}/floor-plan/zones`, {
            name: getNextZoneName(zones),
            sectionId: null,
            ...position,
            width,
            height,
            rotation: 0,
            ...(floorPlanId ? { floorPlanId } : {}),
          });
          setFloorPlan((prev) =>
            prev
              ? {
                  ...prev,
                  zones: [...(prev.zones ?? []), created],
                }
              : prev,
          );
          setSelectedTableIds(new Set());
          setLastSelectedTableId(null);
          setSelectedWallId(null);
          setSelectedZoneId(created.id);
        } catch (err) {
          setError(getErrorMessage(err, 'Impossible de créer la zone'));
        }
        return;
      }
      if (data.kind !== 'wall') return;
      const wallLengths: Record<PaletteWallType, number> = { wall: 160, door: 110, bar: 160 };
      const length = wallLengths[data.type];
      const centerX = Math.round(canvasWidth / 2);
      const centerY = Math.round(canvasHeight / 2);
      try {
        setError('');
        const wall = await post<FloorPlanWall>(`restaurants/${orgId}/floor-plan/walls`, {
          x1: Math.max(0, centerX - length / 2),
          y1: centerY,
          x2: Math.min(canvasWidth, centerX + length / 2),
          y2: centerY,
          type: data.type as WallType,
          name: null,
          ...(floorPlanId ? { floorPlanId } : {}),
        });
        setFloorPlan((prev) => (prev ? { ...prev, walls: [...(prev.walls ?? []), wall] } : prev));
        setSelectedTableIds(new Set());
        setLastSelectedTableId(null);
        setSelectedWallId(wall.id);
        setSelectedZoneId(null);
      } catch (err) {
        setError(getErrorMessage(err, 'Impossible de créer le mur'));
      }
    },
    [orgId, live, allTables, placedTables, zones, canvasWidth, canvasHeight, floorPlanId, post],
  );

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
      setSelectedZoneId(null);
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
      setSelectedZoneId(null);
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
      setSelectedZoneId(null);
      return;
    }
    setSelectedTableIds(new Set([table.id]));
    setLastSelectedTableId(table.id);
    setSelectedWallId(null);
    setSelectedZoneId(null);
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

  function selectZone(zone: FloorPlanZone) {
    if (live) return;
    if (zoneJustDraggedRef.current) {
      zoneJustDraggedRef.current = false;
      return;
    }
    setSelectedZoneId(zone.id);
    setSelectedTableIds(new Set());
    setLastSelectedTableId(null);
    setSelectedWallId(null);
  }

  function handleZonePointerDown(event: React.PointerEvent<HTMLDivElement>, zone: FloorPlanZone) {
    if (live) return;
    zoneJustDraggedRef.current = false;
    setSelectedZoneId(zone.id);
    setSelectedTableIds(new Set());
    setSelectedWallId(null);
    setZoneDragStart({ zone, pointerX: event.clientX, pointerY: event.clientY });
  }

  function startZoneResize(event: React.PointerEvent<HTMLDivElement>, zone: FloorPlanZone) {
    if (live) return;
    event.stopPropagation();
    event.preventDefault();
    resizeZoneStartRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      width: zone.width,
      height: zone.height,
    };
    setSelectedZoneId(zone.id);
    setSelectedTableIds(new Set());
    setSelectedWallId(null);
    setResizeZoneId(zone.id);
  }

  useEffect(() => {
    if (!zoneDragStart) return;
    const handleMove = (event: PointerEvent) => {
      const dx = (event.clientX - zoneDragStart.pointerX) / zoom;
      const dy = (event.clientY - zoneDragStart.pointerY) / zoom;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) zoneJustDraggedRef.current = true;
      const grid = snap ? GRID_SIZE : 1;
      const nextX = Math.max(
        0,
        Math.min(
          canvasWidth - zoneDragStart.zone.width,
          Math.round((zoneDragStart.zone.x + dx) / grid) * grid,
        ),
      );
      const nextY = Math.max(
        0,
        Math.min(
          canvasHeight - zoneDragStart.zone.height,
          Math.round((zoneDragStart.zone.y + dy) / grid) * grid,
        ),
      );
      setFloorPlan((prev) =>
        prev
          ? replaceZone(prev, {
              ...zoneDragStart.zone,
              x: nextX,
              y: nextY,
            })
          : prev,
      );
    };
    const handleUp = () => {
      const current = zoneDragStart.zone;
      const latest = zones.find((zone) => zone.id === current.id);
      if (latest && (latest.x !== current.x || latest.y !== current.y)) {
        recordGeometry({
          before: { tables: [], walls: [], zones: [snapshotZoneGeometry(current)] },
          after: { tables: [], walls: [], zones: [snapshotZoneGeometry(latest)] },
        });
        void patchZone(current.id, { x: latest.x, y: latest.y });
      }
      setZoneDragStart(null);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [zoneDragStart, zoom, snap, canvasWidth, canvasHeight, zones]);

  useEffect(() => {
    if (!resizeZoneId || !resizeZoneStartRef.current) return;
    const handleMove = (event: PointerEvent) => {
      const start = resizeZoneStartRef.current;
      if (!start) return;
      const zone = zones.find((item) => item.id === resizeZoneId);
      if (!zone) return;
      const dx = (event.clientX - start.pointerX) / zoom;
      const dy = (event.clientY - start.pointerY) / zoom;
      const grid = snap ? GRID_SIZE : 1;
      const width = Math.max(
        ZONE_MIN_WIDTH,
        Math.min(canvasWidth - zone.x, Math.round((start.width + dx) / grid) * grid),
      );
      const height = Math.max(
        ZONE_MIN_HEIGHT,
        Math.min(canvasHeight - zone.y, Math.round((start.height + dy) / grid) * grid),
      );
      start.currentWidth = width;
      start.currentHeight = height;
      setFloorPlan((prev) =>
        prev
          ? replaceZone(prev, {
              ...zone,
              width,
              height,
            })
          : prev,
      );
    };
    const handleUp = () => {
      const start = resizeZoneStartRef.current;
      const zone = zones.find((item) => item.id === resizeZoneId);
      if (start && zone) {
        const width = Math.round(start.currentWidth ?? start.width);
        const height = Math.round(start.currentHeight ?? start.height);
        if (width !== start.width || height !== start.height) {
          const before = zone
            ? snapshotZoneGeometry({ ...zone, width: start.width, height: start.height })
            : null;
          const after = zone ? snapshotZoneGeometry({ ...zone, width, height }) : null;
          if (before && after) {
            recordGeometry({
              before: { tables: [], walls: [], zones: [before] },
              after: { tables: [], walls: [], zones: [after] },
            });
          }
          void patchZone(resizeZoneId, { width, height });
        }
      }
      setResizeZoneId(null);
      resizeZoneStartRef.current = null;
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [resizeZoneId, zoom, snap, canvasWidth, canvasHeight, zones]);

  function handleTableDoubleClick(table: CanvasTable) {
    if (live) return;
    openEditDialog(table);
  }

  async function patchTable(tableId: string, updates: Partial<FloorPlanTable>) {
    if (!orgId) return;
    const mutationVersion = (tableMutationVersionRef.current.get(tableId) ?? 0) + 1;
    tableMutationVersionRef.current.set(tableId, mutationVersion);
    setPlanSaved(false);
    try {
      setError('');
      const updated = await patch<FloorPlanTable>(
        `restaurants/${orgId}/floor-plan/tables/${tableId}`,
        { ...updates, ...(floorPlanId ? { floorPlanId } : {}) },
      );
      if (tableMutationVersionRef.current.get(tableId) !== mutationVersion) return;
      setFloorPlan((prev) => (prev ? replaceTable(prev, updated) : prev));
    } catch (err) {
      if (tableMutationVersionRef.current.get(tableId) !== mutationVersion) return;
      setError(getErrorMessage(err, 'Impossible de modifier la table'));
    }
  }

  function saveTableName(table: CanvasTable, rawName: string) {
    const name = rawName.trim();
    if (!name || name === table.name) return;
    void patchTable(table.id, { name });
  }

  function changeTableCapacity(table: CanvasTable, delta: number) {
    const capacity = Math.max(1, table.capacity + delta);
    if (capacity === table.capacity) return;
    void patchTable(table.id, { capacity });
  }

  async function patchZone(zoneId: string, updates: Partial<FloorPlanZone>) {
    if (!orgId) return;
    setPlanSaved(false);
    try {
      setError('');
      const updated = await patch<FloorPlanZone>(
        `restaurants/${orgId}/floor-plan/zones/${zoneId}`,
        { ...updates, ...(floorPlanId ? { floorPlanId } : {}) },
      );
      setFloorPlan((prev) => (prev ? replaceZone(prev, updated) : prev));
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de modifier la zone'));
    }
  }

  async function deleteZone(zoneId: string) {
    if (!orgId) return;
    setPlanSaved(false);
    try {
      setError('');
      await del(
        `restaurants/${orgId}/floor-plan/zones/${zoneId}${floorPlanId ? `?floorPlanId=${floorPlanId}` : ''}`,
      );
      setFloorPlan((prev) => (prev ? removeZone(prev, zoneId) : prev));
      setSelectedZoneId(null);
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de supprimer la zone'));
    }
  }

  async function createTableCombination() {
    if (!orgId || selectedTableIds.size < 2) return;
    const tableIds = [...selectedTableIds];
    try {
      setError('');
      setPlanSaved(false);
      const created = await post<{
        id: string;
        floorPlanId: string;
        name: string | null;
        tableIds: string[];
      }>(`restaurants/${orgId}/floor-plan/table-combinations`, {
        tableIds,
        ...(floorPlanId ? { floorPlanId } : {}),
      });
      const combination: FloorPlanTableCombination = {
        id: created.id,
        floorPlanId: created.floorPlanId,
        name: created.name,
        members: created.tableIds.map((tableId) => ({ tableId })),
      };
      setFloorPlan((prev) =>
        prev
          ? {
              ...prev,
              tableCombinations: [
                ...(prev.tableCombinations ?? []).filter((item) => item.id !== combination.id),
                combination,
              ],
            }
          : prev,
      );
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de créer la combinaison'));
    }
  }

  async function deleteTableCombination(combination: FloorPlanTableCombination) {
    if (!orgId) return;
    try {
      setError('');
      setPlanSaved(false);
      await del(
        `restaurants/${orgId}/floor-plan/table-combinations/${combination.id}${floorPlanId ? `?floorPlanId=${floorPlanId}` : ''}`,
      );
      setFloorPlan((prev) =>
        prev
          ? {
              ...prev,
              tableCombinations: (prev.tableCombinations ?? []).filter(
                (item) => item.id !== combination.id,
              ),
            }
          : prev,
      );
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de retirer la combinaison'));
    }
  }

  async function unplaceTable(table: CanvasTable) {
    if (!orgId) return;
    setPlanSaved(false);
    setSelectedTableIds(new Set());
    try {
      setError('');
      const updated = await patch<FloorPlanTable>(
        `restaurants/${orgId}/floor-plan/tables/${table.id}`,
        {
          positionX: null,
          positionY: null,
          ...(floorPlanId ? { floorPlanId } : {}),
        },
      );
      setFloorPlan((prev) => (prev ? replaceTable(prev, updated) : prev));
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de retirer la table du plan'));
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
      ...(floorPlanId ? { floorPlanId } : {}),
    });
    return created;
  }

  async function duplicateSingleTable(table: FloorPlanTable) {
    if (!orgId || !floorPlan) return;
    try {
      setPlanSaved(false);
      const position = findDuplicatePosition(table, allTables, canvasWidth, canvasHeight);
      if (!position) {
        setError('Aucun emplacement libre pour dupliquer cette table dans le plan.');
        return;
      }
      const created = await duplicateTable(table, position.x, position.y);
      if (created) {
        setFloorPlan((prev) =>
          prev ? { ...prev, tables: [...(prev.tables ?? []), created] } : prev,
        );
        setSelectedTableIds(new Set([created.id]));
        setLastSelectedTableId(created.id);
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de dupliquer la table'));
    }
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
    // Invalide tout snapshot qui ciblerait l'une de ces tables supprimées.
    resetGeometryHistory();
    for (const table of selectedTables) {
      tableMutationVersionRef.current.delete(table.id);
    }
    try {
      setError('');
      await Promise.all(
        selectedTables.map((table) =>
          del(
            `restaurants/${orgId}/floor-plan/tables/${table.id}${
              floorPlanId ? `?floorPlanId=${floorPlanId}` : ''
            }`,
          ),
        ),
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
    const nextTables = dimensions.map(({ table, width, height, x, y }) => {
      let nextX = x;
      let nextY = y;
      if (axis === 'x') {
        nextX = anchor === 'min' ? target : anchor === 'max' ? target - width : target - width / 2;
      } else {
        nextY =
          anchor === 'min' ? target : anchor === 'max' ? target - height : target - height / 2;
      }
      return {
        ...table,
        positionX: Math.round(nextX),
        positionY: Math.round(nextY),
      };
    });

    if (
      nextTables.every(
        (table, index) =>
          table.positionX === dimensions[index].table.positionX &&
          table.positionY === dimensions[index].table.positionY,
      )
    ) {
      return;
    }

    const before: GeometrySnapshot = {
      tables: dimensions.map(({ table }) => snapshotTableGeometry(table)),
      walls: [],
    };
    const after: GeometrySnapshot = { tables: nextTables.map(snapshotTableGeometry), walls: [] };
    recordGeometry({ before, after });
    applyGeometrySnapshot(after);
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
    const nextTables = sorted.map(({ table, size }) => {
      const dimension = axis === 'x' ? size.width : size.height;
      const nextTable = {
        ...table,
        positionX: axis === 'x' ? Math.round(cursor) : table.positionX,
        positionY: axis === 'y' ? Math.round(cursor) : table.positionY,
      };
      cursor += dimension + gap;
      return nextTable;
    });

    if (
      nextTables.every(
        (table, index) =>
          table.positionX === sorted[index].table.positionX &&
          table.positionY === sorted[index].table.positionY,
      )
    ) {
      return;
    }

    const before: GeometrySnapshot = {
      tables: sorted.map(({ table }) => snapshotTableGeometry(table)),
      walls: [],
    };
    const after: GeometrySnapshot = { tables: nextTables.map(snapshotTableGeometry), walls: [] };
    recordGeometry({ before, after });
    applyGeometrySnapshot(after);
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
      beforeTable: { ...table },
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
      beforeTable: { ...table },
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
      const start = resizeStartRef.current;
      const finalWidth = Math.round(start.currentWidth ?? start.width);
      const finalHeight = Math.round(start.currentHeight ?? start.height);
      if (start.beforeTable && (finalWidth !== start.width || finalHeight !== start.height)) {
        recordGeometry({
          before: { tables: [snapshotTableGeometry(start.beforeTable)], walls: [] },
          after: {
            tables: [
              snapshotTableGeometry({
                ...start.beforeTable,
                width: finalWidth,
                height: finalHeight,
              }),
            ],
            walls: [],
          },
        });
      }
      void patchTable(resizeTableId, {
        width: finalWidth,
        height: finalHeight,
      });
      setResizeTableId(null);
      resizeStartRef.current = null;
    }
    if (rotateTableId && rotateStartRef.current) {
      const start = rotateStartRef.current;
      const finalRotation = start.currentRotation ?? start.startRotation;
      if (start.beforeTable && finalRotation !== start.startRotation) {
        recordGeometry({
          before: { tables: [snapshotTableGeometry(start.beforeTable)], walls: [] },
          after: {
            tables: [snapshotTableGeometry({ ...start.beforeTable, rotation: finalRotation })],
            walls: [],
          },
        });
      }
      void patchTable(rotateTableId, {
        rotation: finalRotation,
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
    if (!orgId || !form.name.trim() || !editingTable) return;

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
      const updated = await patch<FloorPlanTable>(
        `restaurants/${orgId}/floor-plan/tables/${editingTable.id}`,
        {
          sectionId: form.sectionId || null,
          name: form.name.trim(),
          capacity,
          minCapacity,
          shape: form.shape,
          isActive: form.isActive,
          ...(floorPlanId ? { floorPlanId } : {}),
        },
      );
      setFloorPlan((prev) => (prev ? replaceTable(prev, updated) : prev));
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
    // Invalide tout snapshot qui ciblerait cette table supprimée.
    // Appliquer un undo ultérieur la recréerait silencieusement en base.
    resetGeometryHistory();
    tableMutationVersionRef.current.delete(tableId);
    try {
      setError('');
      await del(
        `restaurants/${orgId}/floor-plan/tables/${tableId}${
          floorPlanId ? `?floorPlanId=${floorPlanId}` : ''
        }`,
      );
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
    const mutationVersion = (wallMutationVersionRef.current.get(wall.id) ?? 0) + 1;
    wallMutationVersionRef.current.set(wall.id, mutationVersion);
    setError('');
    setPlanSaved(false);
    try {
      const updated = await patch<FloorPlanWall>(
        `restaurants/${orgId}/floor-plan/walls/${wall.id}`,
        { ...wall, type, name, ...(floorPlanId ? { floorPlanId } : {}) },
      );
      if (wallMutationVersionRef.current.get(wall.id) !== mutationVersion) return;
      setFloorPlan((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          walls: (prev.walls ?? []).map((w) => (w.id === updated.id ? updated : w)),
        };
      });
    } catch (err) {
      if (wallMutationVersionRef.current.get(wall.id) !== mutationVersion) return;
      setError(getErrorMessage(err, 'Impossible de modifier le mur'));
      throw err;
    }
  }

  /** Met à jour la géométrie d'un mur sans toucher à type/name (undo/redo). */
  async function updateWallGeometry(geometry: WallGeometry) {
    if (!orgId) return;
    const mutationVersion = (wallMutationVersionRef.current.get(geometry.id) ?? 0) + 1;
    wallMutationVersionRef.current.set(geometry.id, mutationVersion);
    setError('');
    setPlanSaved(false);
    try {
      const updated = await patch<FloorPlanWall>(
        `restaurants/${orgId}/floor-plan/walls/${geometry.id}`,
        { ...geometry, ...(floorPlanId ? { floorPlanId } : {}) },
      );
      if (wallMutationVersionRef.current.get(geometry.id) !== mutationVersion) return;
      setFloorPlan((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          walls: (prev.walls ?? []).map((w) => (w.id === updated.id ? updated : w)),
        };
      });
    } catch (err) {
      if (wallMutationVersionRef.current.get(geometry.id) !== mutationVersion) return;
      setError(getErrorMessage(err, 'Impossible de modifier le mur'));
    }
  }

  function tableGeometry(table: TableGeometry): Partial<FloorPlanTable> {
    return {
      positionX: table.positionX,
      positionY: table.positionY,
      width: table.width,
      height: table.height,
      rotation: table.rotation,
    };
  }

  /**
   * Réapplique un snapshot immédiatement dans le canvas, puis persiste sa
   * géométrie. Une action de groupe (aligner/répartir) reste donc atomique du
   * point de vue de la pile, tout en conservant les mutations API existantes.
   */
  function applyGeometrySnapshot(snapshot: GeometrySnapshot) {
    if (snapshot.tables.length === 0 && snapshot.walls.length === 0 && !snapshot.zones?.length)
      return;

    const tableUpdates = new Map(snapshot.tables.map((table) => [table.id, table]));
    const wallUpdates = new Map(snapshot.walls.map((wall) => [wall.id, wall]));
    const zoneUpdates = new Map((snapshot.zones ?? []).map((zone) => [zone.id, zone]));
    const currentTableIds = new Set(
      [
        ...(floorPlan?.sections.flatMap((section) => section.tables) ?? []),
        ...(floorPlan?.tables ?? []),
      ].map((table) => table.id),
    );
    const currentWalls = new Map((floorPlan?.walls ?? []).map((wall) => [wall.id, wall]));
    const currentZones = new Map((floorPlan?.zones ?? []).map((zone) => [zone.id, zone]));

    setFloorPlan((prev) => {
      if (!prev) return prev;
      const mergeTableGeometry = (table: FloorPlanTable): FloorPlanTable => {
        const geometry = tableUpdates.get(table.id);
        return geometry ? { ...table, ...geometry } : table;
      };
      return {
        ...prev,
        sections: prev.sections.map((section) => ({
          ...section,
          tables: section.tables.map(mergeTableGeometry),
        })),
        tables: (prev.tables ?? []).map(mergeTableGeometry),
        walls: (prev.walls ?? []).map((wall) => {
          const geometry = wallUpdates.get(wall.id);
          return geometry ? { ...wall, ...geometry } : wall;
        }),
        zones: (prev.zones ?? []).map((zone) => {
          const geometry = zoneUpdates.get(zone.id);
          return geometry ? { ...zone, ...geometry } : zone;
        }),
      };
    });

    for (const table of snapshot.tables) {
      if (currentTableIds.has(table.id)) void patchTable(table.id, tableGeometry(table));
    }
    for (const geometry of snapshot.walls) {
      if (!currentWalls.has(geometry.id)) continue;
      void updateWallGeometry(geometry);
    }
    for (const geometry of snapshot.zones ?? []) {
      if (!currentZones.has(geometry.id)) continue;
      void patchZone(geometry.id, geometry);
    }
  }

  function undoGeometry() {
    const snapshot = undoGeometrySnapshot();
    if (snapshot) applyGeometrySnapshot(snapshot);
  }

  function redoGeometry() {
    const snapshot = redoGeometrySnapshot();
    if (snapshot) applyGeometrySnapshot(snapshot);
  }

  async function deleteWall(wallId: string) {
    if (!orgId) return;
    setError('');
    setPlanSaved(false);
    // Invalide tout snapshot qui ciblerait ce mur supprimé.
    resetGeometryHistory();
    wallMutationVersionRef.current.delete(wallId);
    try {
      await del(
        `restaurants/${orgId}/floor-plan/walls/${wallId}${
          floorPlanId ? `?floorPlanId=${floorPlanId}` : ''
        }`,
      );
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
        ...(floorPlanId ? { floorPlanId } : {}),
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
    if (nextWall.x2 === wall.x2 && nextWall.y2 === wall.y2) return;
    const before: GeometrySnapshot = { tables: [], walls: [snapshotWallGeometry(wall)] };
    const after: GeometrySnapshot = { tables: [], walls: [snapshotWallGeometry(nextWall)] };
    recordGeometry({ before, after });
    applyGeometrySnapshot(after);
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
    if (nextWall.x2 === wall.x2 && nextWall.y2 === wall.y2) return;
    const before: GeometrySnapshot = { tables: [], walls: [snapshotWallGeometry(wall)] };
    const after: GeometrySnapshot = { tables: [], walls: [snapshotWallGeometry(nextWall)] };
    recordGeometry({ before, after });
    applyGeometrySnapshot(after);
  }

  async function handleSaveFloorSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    const widthMeters = parseRoomMeters(floorSettings.widthMeters);
    const lengthMeters = parseRoomMeters(floorSettings.lengthMeters);
    if (widthMeters === null || lengthMeters === null) {
      setSettingsError(
        `Utilisez des dimensions comprises entre ${MIN_ROOM_DIMENSION_METERS} et ${MAX_ROOM_DIMENSION_METERS} m, avec au maximum deux décimales.`,
      );
      return;
    }
    setError('');
    setSettingsError('');
    setPlanSaved(false);
    try {
      const path = floorPlanId
        ? `restaurants/${orgId}/floor-plans/${floorPlanId}`
        : `restaurants/${orgId}/floor-plan`;
      const updated = await patch<FloorPlan>(path, {
        name: floorSettings.name.trim() || 'Salle principale',
        width: Math.round(widthMeters * CANVAS_PIXELS_PER_METER),
        height: Math.round(lengthMeters * CANVAS_PIXELS_PER_METER),
      });
      setFloorPlan(updated);
      setPlanSaved(true);
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
      const before = wallDragStart.wall;
      if (
        currentWall.x1 !== before.x1 ||
        currentWall.y1 !== before.y1 ||
        currentWall.x2 !== before.x2 ||
        currentWall.y2 !== before.y2
      ) {
        recordGeometry({
          before: { tables: [], walls: [snapshotWallGeometry(before)] },
          after: { tables: [], walls: [snapshotWallGeometry(currentWall)] },
        });
      }
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
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.matches('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }

      if (event.key.toLowerCase() === 'g' && !live) {
        event.preventDefault();
        setGridVisible((visible) => !visible);
      } else if (event.key.toLowerCase() === 's' && !live) {
        event.preventDefault();
        setSnap((enabled) => !enabled);
      } else if (event.key.toLowerCase() === 'f' && !live) {
        event.preventDefault();
        centerCanvas();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
        if (selectedWall && !live) {
          event.preventDefault();
          void duplicateWall(selectedWall);
        }
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !live) {
        // Undo/redo des mutations de géométrie (édition uniquement).
        event.preventDefault();
        if (event.shiftKey) {
          redoGeometry();
        } else {
          undoGeometry();
        }
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && !live) {
        if (selectedTables.length > 0) {
          event.preventDefault();
          setMultiDeleteConfirmOpen(true);
        } else if (selectedZone) {
          event.preventDefault();
          void deleteZone(selectedZone.id);
        } else if (selectedWall) {
          event.preventDefault();
          void deleteWall(selectedWall.id);
        }
      } else if (
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) &&
        !live &&
        selectedTables.length > 0
      ) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        const nextTables = selectedTables.map((table) => {
          const dimensions = getTableSize(table);
          return {
            ...table,
            positionX: Math.min(
              Math.max(0, (table.positionX ?? 0) + dx),
              Math.max(0, (floorPlan?.width ?? DEFAULT_CANVAS_WIDTH) - dimensions.width),
            ),
            positionY: Math.min(
              Math.max(0, (table.positionY ?? 0) + dy),
              Math.max(0, (floorPlan?.height ?? DEFAULT_CANVAS_HEIGHT) - dimensions.height),
            ),
          };
        });
        const before: GeometrySnapshot = {
          tables: selectedTables.map((t) => snapshotTableGeometry(t)),
          walls: [],
        };
        const after: GeometrySnapshot = {
          tables: nextTables.map((t) => snapshotTableGeometry(t)),
          walls: [],
        };
        recordGeometry({ before, after });
        applyGeometrySnapshot(after);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  });

  function resolveTableDragPosition(
    start: DragStartInfo,
    delta: { x: number; y: number },
  ): { positionX: number; positionY: number; guides: TableAlignmentGuides } {
    const rawX = start.originalX + delta.x / zoom;
    const rawY = start.originalY + delta.y / zoom;
    const boundedX = Math.max(0, Math.min(canvasWidth - start.width, rawX));
    const boundedY = Math.max(0, Math.min(canvasHeight - start.height, rawY));
    const guides = snap
      ? getTableAlignmentGuides({
          x: boundedX,
          y: boundedY,
          width: start.width,
          height: start.height,
          tables: allTables,
          excludedTableId: start.tableId,
        })
      : emptyTableAlignmentGuides();
    const grid = snap ? GRID_SIZE : 1;
    const snappedX = guides.x?.position ?? Math.round(boundedX / grid) * grid;
    const snappedY = guides.y?.position ?? Math.round(boundedY / grid) * grid;
    const positionX = Math.max(0, Math.min(canvasWidth - start.width, snappedX));
    const positionY = Math.max(0, Math.min(canvasHeight - start.height, snappedY));

    return {
      positionX,
      positionY,
      guides: {
        x: guides.x && positionX === guides.x.position ? guides.x : null,
        y: guides.y && positionY === guides.y.position ? guides.y : null,
      },
    };
  }

  function handleDragStart(event: DragStartEvent) {
    setPlanSaved(false);
    justDraggedRef.current = true;
    setTableAlignGuides(emptyTableAlignmentGuides());
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
      const mutationVersion = (tableMutationVersionRef.current.get(table.id) ?? 0) + 1;
      tableMutationVersionRef.current.set(table.id, mutationVersion);
      setActiveDragData({ kind: 'existingTable', table });
      setDragStart({
        tableId: table.id,
        originalX: table.positionX ?? 0,
        originalY: table.positionY ?? 0,
        width,
        height,
        table,
        moveId,
        mutationVersion,
      });
    } else {
      setActiveDragData((event.active.data.current as PaletteItemData | undefined) ?? null);
    }
  }

  function handleDragCancel() {
    setActiveDragData(null);
    setDragStart(null);
    setWallAlignGuide(null);
    setTableAlignGuides(emptyTableAlignmentGuides());
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
    setTableAlignGuides(emptyTableAlignmentGuides());
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
      const { positionX: clampedX, positionY: clampedY } = resolveTableDragPosition(
        start,
        event.delta,
      );

      if (clampedX !== start.originalX || clampedY !== start.originalY) {
        recordGeometry({
          before: {
            tables: [
              snapshotTableGeometry({
                ...start.table,
                positionX: start.originalX,
                positionY: start.originalY,
              }),
            ],
            walls: [],
          },
          after: {
            tables: [
              snapshotTableGeometry({ ...start.table, positionX: clampedX, positionY: clampedY }),
            ],
            walls: [],
          },
        });
      }

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
            ...(floorPlanId ? { floorPlanId } : {}),
          },
        );
        if (
          start.moveId !== tableMoveIdRef.current ||
          start.mutationVersion !== tableMutationVersionRef.current.get(start.tableId)
        ) {
          return;
        }
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
        if (
          start.moveId !== tableMoveIdRef.current ||
          start.mutationVersion !== tableMutationVersionRef.current.get(start.tableId)
        ) {
          return;
        }
        setError(getErrorMessage(err, 'Impossible de déplacer la table'));
        setFloorPlan((prev) =>
          prev ? replaceTablePosition(prev, start.tableId, start.originalX, start.originalY) : prev,
        );
      }
      return;
    }

    if (data?.kind === 'placeTable' && pointerStart && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const { width, height } = getTableSize(data.table);
      const grid = snap ? GRID_SIZE : 1;
      const cursorX = (pointerStart.x + event.delta.x - rect.left) / zoom;
      const cursorY = (pointerStart.y + event.delta.y - rect.top) / zoom;
      const positionX = Math.max(
        0,
        Math.min(canvasWidth - width, Math.round((cursorX - width / 2) / grid) * grid),
      );
      const positionY = Math.max(
        0,
        Math.min(canvasHeight - height, Math.round((cursorY - height / 2) / grid) * grid),
      );
      const before = snapshotTableGeometry(data.table);
      const after = snapshotTableGeometry({ ...data.table, positionX, positionY });
      recordGeometry({
        before: { tables: [before], walls: [] },
        after: { tables: [after], walls: [] },
      });
      setPlanSaved(false);
      setSelectedTableIds(new Set([data.table.id]));
      setLastSelectedTableId(data.table.id);
      setSelectedWallId(null);
      setFloorPlan((prev) =>
        prev ? replaceTablePosition(prev, data.table.id, positionX, positionY) : prev,
      );
      try {
        setError('');
        const updated = await patch<FloorPlanTable>(
          `restaurants/${orgId}/floor-plan/tables/${data.table.id}`,
          {
            positionX,
            positionY,
            ...(floorPlanId ? { floorPlanId } : {}),
          },
        );
        setFloorPlan((prev) =>
          prev
            ? replaceTablePosition(
                prev,
                data.table.id,
                updated.positionX ?? positionX,
                updated.positionY ?? positionY,
              )
            : prev,
        );
      } catch (err) {
        setError(getErrorMessage(err, 'Impossible de placer la table'));
        setFloorPlan((prev) =>
          prev
            ? replaceTablePosition(prev, data.table.id, data.table.positionX, data.table.positionY)
            : prev,
        );
      }
      return;
    }

    if (data?.kind === 'zone' && pointerStart && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const width = Math.min(360, canvasWidth - 64);
      const height = Math.min(220, canvasHeight - 64);
      const grid = snap ? GRID_SIZE : 1;
      const cursorX = (pointerStart.x + event.delta.x - rect.left) / zoom;
      const cursorY = (pointerStart.y + event.delta.y - rect.top) / zoom;
      const x = Math.max(
        0,
        Math.min(canvasWidth - width, Math.round((cursorX - width / 2) / grid) * grid),
      );
      const y = Math.max(
        0,
        Math.min(canvasHeight - height, Math.round((cursorY - height / 2) / grid) * grid),
      );
      try {
        setError('');
        const zone = await post<FloorPlanZone>(`restaurants/${orgId}/floor-plan/zones`, {
          name: getNextZoneName(zones),
          sectionId: null,
          x,
          y,
          width,
          height,
          rotation: 0,
          ...(floorPlanId ? { floorPlanId } : {}),
        });
        setFloorPlan((prev) => (prev ? { ...prev, zones: [...(prev.zones ?? []), zone] } : prev));
        setSelectedTableIds(new Set());
        setLastSelectedTableId(null);
        setSelectedWallId(null);
        setSelectedZoneId(zone.id);
      } catch (err) {
        setError(getErrorMessage(err, 'Impossible de créer la zone'));
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
            ...(floorPlanId ? { floorPlanId } : {}),
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
            ...(floorPlanId ? { floorPlanId } : {}),
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

    if (data?.kind === 'existingTable' && dragStart) {
      const nextGuides = resolveTableDragPosition(dragStart, event.delta).guides;
      setTableAlignGuides((current) => {
        const sameGuide = (a: TableAlignmentGuide | null, b: TableAlignmentGuide | null) =>
          a?.value === b?.value && a?.position === b?.position;
        return sameGuide(current.x, nextGuides.x) && sameGuide(current.y, nextGuides.y)
          ? current
          : nextGuides;
      });
      if (wallAlignGuide) setWallAlignGuide(null);
      return;
    }

    setTableAlignGuides((current) =>
      current.x || current.y ? emptyTableAlignmentGuides() : current,
    );

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
          <DialogTitle>Modifier la table</DialogTitle>
          <DialogDescription>Modifiez les informations de la table.</DialogDescription>
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
            Enregistrer
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

  const delayRecoveryConfirm = (
    <ConfirmDialog
      open={delayRecoveryConfirmOpen}
      onConfirm={() => void applyDelayRecovery()}
      onCancel={() => {
        setDelayRecoveryConfirmOpen(false);
        setWaitingListAcceptanceConfirmed(false);
      }}
      title="Confirmer les deux changements ?"
      description={
        delayImpact?.alternativeTable && delayImpact.waitingListEntry
          ? `${delayImpact.waitingListEntry.customerName} prendra la table libérée et ${reportedDelayReservation?.customerName || 'la réservation retardée'} passera sur ${delayImpact.alternativeTable.name}. Sokar vérifiera encore les disponibilités. Aucun message n’est envoyé automatiquement.`
          : 'Sokar vérifiera encore les disponibilités avant application. Aucun message n’est envoyé automatiquement.'
      }
      confirmLabel={applyingDelayRecovery ? 'Application…' : 'Confirmer les changements'}
      cancelLabel="Annuler"
      pending={applyingDelayRecovery}
      acknowledgementLabel={
        delayImpact?.waitingListEntry
          ? `${delayImpact.waitingListEntry.customerName} est présent(e) et accepte la table proposée.`
          : undefined
      }
      acknowledgementChecked={waitingListAcceptanceConfirmed}
      onAcknowledgementChange={setWaitingListAcceptanceConfirmed}
    />
  );

  const delayRecoveryRevertConfirm = (
    <ConfirmDialog
      open={delayRecoveryRevertConfirmOpen}
      onConfirm={() => void revertDelayRecovery()}
      onCancel={() => setDelayRecoveryRevertConfirmOpen(false)}
      title="Annuler ce plan ?"
      description={
        appliedDelayRecovery
          ? `${appliedDelayRecovery.delayedCustomerName} retrouvera ${appliedDelayRecovery.delayedOriginalTableName} et son horaire initial. La réservation créée pour ${appliedDelayRecovery.waitingCustomerName} sera annulée et le groupe retournera en liste d’attente. Les communications déjà effectuées ne peuvent pas être annulées.`
          : 'Sokar restaurera le plan initial seulement si aucune donnée n’a changé depuis son application.'
      }
      confirmLabel={revertingDelayRecovery ? 'Annulation…' : 'Annuler ce plan'}
      cancelLabel="Conserver le plan"
      pending={revertingDelayRecovery}
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
      <DialogContent className="bg-card/95 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Paramètres de la salle</DialogTitle>
          <DialogDescription>Modifiez le nom et les dimensions du plan.</DialogDescription>
        </DialogHeader>

        <form id="floor-settings-form" onSubmit={handleSaveFloorSettings} className="space-y-3.5">
          <div className="space-y-1.5">
            <Label htmlFor="floor-name">Nom</Label>
            <Input
              id="floor-name"
              value={floorSettings.name}
              onChange={(e) => {
                setSettingsError('');
                setFloorSettings((s) => ({ ...s, name: e.target.value }));
              }}
              placeholder="Salle principale"
              className="bg-background"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="floor-width">Largeur</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="floor-width"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={floorSettings.widthMeters}
                  onChange={(e) => {
                    setSettingsError('');
                    setFloorSettings((s) => ({ ...s, widthMeters: e.target.value }));
                  }}
                  aria-invalid={Boolean(settingsError)}
                  aria-describedby="floor-settings-help"
                  className="bg-background tabular-nums"
                />
                <span className="text-sm text-muted-foreground">m</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="floor-length">Longueur</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="floor-length"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={floorSettings.lengthMeters}
                  onChange={(e) => {
                    setSettingsError('');
                    setFloorSettings((s) => ({ ...s, lengthMeters: e.target.value }));
                  }}
                  aria-invalid={Boolean(settingsError)}
                  aria-describedby="floor-settings-help"
                  className="bg-background tabular-nums"
                />
                <span className="text-sm text-muted-foreground">m</span>
              </div>
            </div>
          </div>
          <p
            id="floor-settings-help"
            className={cn('text-xs text-muted-foreground', settingsError && 'text-destructive')}
            role={settingsError ? 'alert' : undefined}
          >
            {settingsError ||
              `De ${MIN_ROOM_DIMENSION_METERS} à ${MAX_ROOM_DIMENSION_METERS} m · 12,5 et 12.5 sont acceptés.`}
          </p>
        </form>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" type="button" onClick={() => setSettingsDialogOpen(false)}>
            Annuler
          </Button>
          <Button type="submit" form="floor-settings-form">
            Appliquer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const bulkCreateDialog = (
    <Dialog open={bulkCreateDialogOpen} onOpenChange={setBulkCreateDialogOpen}>
      <DialogContent className="bg-card/95 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Créer mes tables</DialogTitle>
          <DialogDescription>
            Créez rapidement un lot de tables. Elles apparaîtront ensuite dans « À placer ».
          </DialogDescription>
        </DialogHeader>

        <form id="bulk-create-tables-form" onSubmit={createTablesBatch} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bulk-table-count">Nombre de tables</Label>
              <Input
                id="bulk-table-count"
                type="number"
                min={1}
                max={50}
                value={bulkCreateForm.count}
                onChange={(event) =>
                  setBulkCreateForm((form) => ({ ...form, count: event.target.value }))
                }
                className="bg-background tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bulk-table-capacity">Places par table</Label>
              <Input
                id="bulk-table-capacity"
                type="number"
                min={1}
                max={30}
                value={bulkCreateForm.capacity}
                onChange={(event) =>
                  setBulkCreateForm((form) => ({ ...form, capacity: event.target.value }))
                }
                className="bg-background tabular-nums"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bulk-table-section">Section (optionnel)</Label>
            <Select
              value={bulkCreateForm.sectionId || '_none_'}
              onValueChange={(value) =>
                setBulkCreateForm((form) => ({
                  ...form,
                  sectionId: value === '_none_' ? '' : value,
                }))
              }
            >
              <SelectTrigger id="bulk-table-section" className="bg-background">
                <SelectValue placeholder="Aucune section" />
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
        </form>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={() => setBulkCreateDialogOpen(false)}>
            Annuler
          </Button>
          <Button type="submit" form="bulk-create-tables-form" disabled={bulkCreateLoading}>
            {bulkCreateLoading ? 'Création…' : 'Créer les tables'}
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

  // Le plein écran est piloté par la carte : on reflète l'état réel du navigateur
  // pour proposer une sortie explicite au lieu du seul raccourci Échap.
  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === cardRef.current);
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const selectedServiceStatus = selectedServiceTable
    ? tableStatuses.get(selectedServiceTable.id)
    : undefined;
  const selectedServiceReservation = selectedServiceStatus?.reservation ?? null;

  useEffect(() => {
    setMobileServiceDetailsOpen(false);
  }, [selectedServiceTableId]);

  const selectedServiceStatusDotClass =
    selectedServiceStatus?.status === 'occupied'
      ? 'bg-floor-table-accent'
      : selectedServiceStatus?.status === 'late'
        ? 'bg-destructive'
        : selectedServiceStatus?.status === 'upcoming'
          ? 'bg-warning'
          : selectedServiceStatus?.status === 'reserved'
            ? 'bg-brand'
            : 'bg-floor-table-muted/80';

  const mobileServiceInspector =
    live && serviceTab === 'plan' && selectedServiceTable ? (
      <aside
        role="dialog"
        aria-label={`Actions pour ${selectedServiceTable.displayName ?? selectedServiceTable.name}`}
        className="floor-plan-mobile-service-sheet pointer-events-auto max-h-[18rem] overflow-y-auto rounded-2xl border border-border bg-card/95 p-3 shadow-2xl backdrop-blur-md lg:hidden"
      >
        <div
          className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted-foreground/25"
          aria-hidden="true"
        />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {selectedServiceTable.displayName ?? selectedServiceTable.name}
              <span className="font-normal text-muted-foreground">
                {' · '}
                {selectedServiceTable.capacity} places
              </span>
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <span
                aria-hidden="true"
                className={cn('size-1.5 shrink-0 rounded-full', selectedServiceStatusDotClass)}
              />
              {selectedServiceStatus
                ? statusMeta[selectedServiceStatus.status].label
                : 'Disponible'}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="size-8 shrink-0 rounded-full p-0 text-muted-foreground transition-all duration-200 hover:text-foreground"
            aria-label="Fermer les actions de la table"
            onClick={() => setSelectedServiceTableId(null)}
          >
            <X size={16} />
          </Button>
        </div>

        {selectedServiceReservation ? (
          <div className="mt-2 space-y-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <UserRound size={13} aria-hidden="true" />
                <span className="truncate">
                  {selectedServiceReservation.customerName || 'Sans nom'} ·{' '}
                  {selectedServiceReservation.partySize} pers.
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock3 size={13} aria-hidden="true" />
                {format(parseISO(selectedServiceReservation.startsAt), 'HH:mm')}
              </span>
            </div>
            {selectedServiceReservation.state === 'SEATED' &&
              selectedServiceReservation.seatedAt && (
                <p className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  <Clock3 size={11} aria-hidden="true" />
                  <span>
                    À table depuis{' '}
                    {formatDistanceToNow(parseISO(selectedServiceReservation.seatedAt), {
                      locale: fr,
                      addSuffix: true,
                    })}
                  </span>
                </p>
              )}
          </div>
        ) : null}

        <div className="mt-3 flex gap-2">
          {selectedServiceReservation ? (
            <Button
              type="button"
              size="sm"
              className="h-10 min-w-0 flex-1 transition-all duration-200"
              disabled={updatingReservationStateId === selectedServiceReservation.id}
              onClick={() =>
                void updateReservationState(
                  selectedServiceReservation.id,
                  selectedServiceReservation.state === 'SEATED' ? 'HONORED' : 'SEATED',
                )
              }
            >
              {selectedServiceReservation.state === 'SEATED' ? 'Terminer le service' : 'Installer'}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                size="sm"
                className="h-10 min-w-0 flex-1 font-medium transition-all duration-200"
                onClick={() =>
                  void createWalkIn(selectedServiceTable.id, selectedServiceTable.capacity)
                }
              >
                ⚡ Installer ({selectedServiceTable.capacity} pers.)
              </Button>
              {selectedServiceTable.capacity > 2 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-10 shrink-0 px-3 text-xs transition-all duration-200"
                  onClick={() => void createWalkIn(selectedServiceTable.id, 2)}
                  title="Installer 2 personnes"
                >
                  2 pers.
                </Button>
              ) : null}
            </>
          )}
          {selectedServiceReservation ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-10 min-w-0 flex-1 transition-all duration-200"
              disabled={!selectedServiceReservation}
              aria-expanded={Boolean(selectedServiceReservation && mobileServiceDetailsOpen)}
              onClick={() => setMobileServiceDetailsOpen((open) => !open)}
            >
              Voir la réservation
            </Button>
          ) : null}
        </div>

        {selectedServiceReservation && mobileServiceDetailsOpen ? (
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-border bg-background/70 p-3 text-xs">
            <div>
              <p className="text-muted-foreground">Arrivée</p>
              <p className="mt-0.5 font-medium text-foreground">
                {format(parseISO(selectedServiceReservation.startsAt), 'HH:mm')}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Suivi</p>
              <p className="mt-0.5 font-medium text-foreground">
                {formatServiceTiming(
                  selectedServiceReservation,
                  selectedServiceStatus?.status ?? 'upcoming',
                  new Date(),
                )}
              </p>
            </div>
          </div>
        ) : null}
      </aside>
    ) : null;

  const mobileEditInspector =
    !live && selectedTables.length > 0 && selectedTables.some((t) => t.positionX !== null) ? (
      <aside
        aria-label={
          selectedTable
            ? `Actions pour ${selectedTable.displayName ?? selectedTable.name}`
            : `${selectedTables.length} tables sélectionnées`
        }
        className="floor-plan-mobile-service-sheet pointer-events-auto max-h-[26rem] overflow-y-auto rounded-2xl border border-border bg-card/95 p-3 shadow-2xl backdrop-blur-md lg:hidden"
      >
        <div
          className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted-foreground/25"
          aria-hidden="true"
        />
        {selectedTable ? (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {selectedTable.displayName ?? selectedTable.name}
                  <span className="font-normal text-muted-foreground">
                    {' · '}
                    {selectedTable.capacity} places
                    {selectedTable.sectionName ? ` · ${selectedTable.sectionName}` : ''}
                  </span>
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {selectedTable.shape === 'round' ? 'Table ronde' : 'Table rectangulaire'}
                  {selectedTable.rotation ? ` · ${selectedTable.rotation}°` : ''}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="size-8 shrink-0 rounded-full p-0 text-muted-foreground transition-all duration-200 hover:text-foreground"
                aria-label="Fermer"
                onClick={() => setSelectedTableIds(new Set())}
              >
                <X size={16} />
              </Button>
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
              <div className="min-w-0 space-y-1">
                <Label
                  className="text-[10px] text-muted-foreground"
                  htmlFor="mobile-selected-table-name"
                >
                  Nom de la table
                </Label>
                <Input
                  key={`mobile-name-${selectedTable.id}-${selectedTable.name}`}
                  id="mobile-selected-table-name"
                  defaultValue={selectedTable.name}
                  className="h-9 bg-background text-sm"
                  onBlur={(event) => saveTableName(selectedTable, event.currentTarget.value)}
                />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground">Couverts</p>
                <div className="flex h-9 items-center rounded-md border border-input bg-background">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="size-8 rounded-r-none p-0"
                    aria-label="Diminuer la capacité"
                    disabled={selectedTable.capacity <= 1}
                    onClick={() => changeTableCapacity(selectedTable, -1)}
                  >
                    <Minus size={14} />
                  </Button>
                  <span
                    aria-live="polite"
                    className="min-w-7 px-1 text-center text-xs font-semibold tabular-nums"
                  >
                    {selectedTable.capacity}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="size-8 rounded-l-none p-0"
                    aria-label="Augmenter la capacité"
                    onClick={() => changeTableCapacity(selectedTable, 1)}
                  >
                    <Plus size={14} />
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-9 justify-center gap-1.5 text-xs font-medium transition-all duration-200"
                onClick={() => void duplicateSingleTable(selectedTable)}
              >
                <Copy size={14} />
                Dupliquer
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 justify-center gap-1.5 text-xs font-medium transition-all duration-200"
                onClick={() =>
                  void patchTable(selectedTable.id, {
                    rotation: ((selectedTable.rotation ?? 0) + 90) % 360,
                  })
                }
              >
                <RotateCw size={14} />
                90°
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 justify-center gap-1.5 text-xs font-medium transition-all duration-200"
                onClick={() =>
                  void patchTable(selectedTable.id, {
                    shape: selectedTable.shape === 'round' ? 'rect' : 'round',
                  })
                }
              >
                {selectedTable.shape === 'round' ? (
                  <>
                    <Square size={14} />
                    Rect.
                  </>
                ) : (
                  <>
                    <Circle size={14} />
                    Ronde
                  </>
                )}
              </Button>
            </div>

            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <Select
                  value={selectedTable.sectionId || '_none_'}
                  onValueChange={(value) =>
                    void patchTable(selectedTable.id, {
                      sectionId: value === '_none_' ? null : value,
                    })
                  }
                >
                  <SelectTrigger className="h-9 bg-background text-xs">
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
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 shrink-0 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive transition-all duration-200"
                onClick={() => void unplaceTable(selectedTable)}
              >
                <Trash2 size={14} className="mr-1" />
                Retirer
              </Button>
            </div>
          </div>
        ) : selectedTables.length > 1 ? (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {selectedTables.length} tables sélectionnées
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Capacité cumulée : {selectedTables.reduce((acc, t) => acc + t.capacity, 0)} places
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="size-8 shrink-0 rounded-full p-0 text-muted-foreground transition-all duration-200 hover:text-foreground"
                aria-label="Fermer"
                onClick={() => setSelectedTableIds(new Set())}
              >
                <X size={16} />
              </Button>
            </div>

            <div className="flex gap-2">
              {selectedCombination ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 flex-1 gap-1.5 text-xs font-medium transition-all duration-200"
                  onClick={() => void deleteTableCombination(selectedCombination)}
                >
                  <Link2 size={14} />
                  Délier combinaison
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  className="h-9 flex-1 gap-1.5 text-xs font-medium transition-all duration-200"
                  onClick={() => void createTableCombination()}
                >
                  <Link2 size={14} />
                  Combiner les tables
                </Button>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 flex-1 gap-1 text-xs"
                onClick={() => alignSelectedTables('x', 'center')}
              >
                <AlignCenter size={13} />
                Aligner
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="h-9 shrink-0 gap-1 text-xs"
                onClick={() => setMultiDeleteConfirmOpen(true)}
              >
                <Trash2 size={13} />
                Supprimer
              </Button>
            </div>
          </div>
        ) : null}
      </aside>
    ) : null;

  const inspector = live ? (
    <aside
      className={cn(
        'order-3 h-auto max-h-72 w-full min-w-0 flex-col overflow-hidden border-t border-border bg-card lg:h-full lg:max-h-none lg:w-72 lg:min-w-72 lg:border-l lg:border-t-0',
        selectedServiceTable ? 'hidden lg:flex' : 'flex',
      )}
    >
      {/* L'en-tête live n'a de sens que dans la sidebar desktop : sur téléphone,
          l'inspecteur s'empile sous le plan et répétait une troisième fois le
          statut déjà porté par le cockpit et le badge. */}
      <div className="hidden border-b border-border p-4 lg:block">
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
                    title="Confirme l’arrivée réelle du groupe et occupe la table"
                    disabled={updatingReservationStateId === selectedServiceReservation.id}
                    onClick={() =>
                      void updateReservationState(selectedServiceReservation.id, 'SEATED')
                    }
                  >
                    <UserRound size={15} className="mr-1.5" />
                    {updatingReservationStateId === selectedServiceReservation.id
                      ? 'Mise à jour…'
                      : 'Installer à table'}
                  </Button>
                )}
                {selectedServiceReservation.state === 'SEATED' && (
                  <Button
                    size="sm"
                    className="flex-1"
                    title="Clôture la réservation et rend la table disponible"
                    disabled={updatingReservationStateId === selectedServiceReservation.id}
                    onClick={() =>
                      void updateReservationState(selectedServiceReservation.id, 'HONORED')
                    }
                  >
                    <CircleCheck size={15} className="mr-1.5" />
                    {updatingReservationStateId === selectedServiceReservation.id
                      ? 'Mise à jour…'
                      : 'Libérer la table'}
                  </Button>
                )}
              </div>
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => void suggestTable(selectedServiceReservation.id)}
                >
                  Suggérer des tables
                </Button>
              </div>
              {selectedServiceReservation.state === 'CONFIRMED' && (
                <div className="space-y-2 rounded-md border border-border bg-card p-3">
                  <p className="text-xs font-semibold text-foreground">Retard annoncé</p>
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label="Retard annoncé en minutes"
                      type="number"
                      min={5}
                      max={180}
                      value={delayMinutes}
                      disabled={Boolean(
                        initialDelayImpact?.delayReportId &&
                        delayImpactReservationId === selectedServiceReservation.id,
                      )}
                      onChange={(event) => updateDelayMinutes(Number(event.target.value))}
                      className="h-8 bg-background text-xs"
                    />
                    <span className="shrink-0 text-xs text-muted-foreground">min</span>
                  </div>
                  {initialDelayImpact?.delayReportId &&
                  delayImpactReservationId === selectedServiceReservation.id ? (
                    <p className="text-[11px] text-muted-foreground">
                      Durée confirmée pendant l’appel client.
                    </p>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    disabled={delayImpactLoading}
                    onClick={() => void simulateDelayImpact(selectedServiceReservation.id)}
                  >
                    {delayImpactLoading ? 'Analyse…' : 'Analyser l’impact'}
                  </Button>
                  {delayImpact && delayImpactReservationId === selectedServiceReservation.id && (
                    <div
                      className={cn(
                        'space-y-2 rounded-md border p-2 text-xs',
                        delayImpact.feasible
                          ? 'border-success/25 bg-success/[0.04]'
                          : 'border-warning/25 bg-warning/[0.04]',
                      )}
                    >
                      <p className="font-medium text-foreground">{delayImpact.summary}</p>
                      {delayImpact.feasible &&
                      delayImpact.alternativeTable &&
                      delayImpact.waitingListEntry ? (
                        <>
                          <p className="text-muted-foreground">
                            Plan proposé : {delayImpact.waitingListEntry.customerName} · liste
                            d’attente, sans table →{' '}
                            {delayImpact.delayedReservation?.originalTableName ||
                              selectedServiceTable.displayName ||
                              selectedServiceTable.name}
                            {' ; '}
                            {selectedServiceReservation.customerName || 'Client'} ·{' '}
                            {delayImpact.delayedReservation?.originalTableName ||
                              selectedServiceTable.displayName ||
                              selectedServiceTable.name}{' '}
                            → {delayImpact.alternativeTable.name}.
                          </p>
                          {delayImpact.delayedReservation?.customerFacingProposedStartsAt ? (
                            <p className="text-muted-foreground">
                              Heure à communiquer au client :{' '}
                              {format(
                                parseISO(
                                  delayImpact.delayedReservation.customerFacingProposedStartsAt,
                                ),
                                'HH:mm',
                              )}
                              .
                            </p>
                          ) : null}
                          <Button
                            size="sm"
                            className="w-full"
                            onClick={() => setDelayRecoveryConfirmOpen(true)}
                          >
                            Vérifier et appliquer
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full"
                            disabled={communicationDraftsLoading}
                            onClick={() => void loadCommunicationDrafts()}
                          >
                            {communicationDraftsLoading ? 'Préparation…' : 'Préparer les messages'}
                          </Button>
                          {communicationDrafts.length > 0 ? (
                            <div className="space-y-2 border-t border-border pt-2">
                              {communicationDrafts.map((draft) => (
                                <div
                                  key={draft.recipient}
                                  className="rounded border border-border p-2"
                                >
                                  <p className="font-medium text-foreground">
                                    {draft.customerName} ·{' '}
                                    {draft.eligibleChannel
                                      ? `canal ${draft.eligibleChannel.toUpperCase()} autorisé`
                                      : draft.deliveryBlocker === 'no-contact'
                                        ? 'aucun contact'
                                        : 'consentement transactionnel requis'}
                                  </p>
                                  <p className="mt-1 text-muted-foreground">{draft.message}</p>
                                  <p className="mt-1 text-muted-foreground">
                                    Brouillon uniquement — aucun envoi automatique.
                                  </p>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </>
                      ) : null}
                      <p className="text-muted-foreground">
                        {delayImpact.feasible
                          ? 'La confirmation reverra les conflits juste avant application.'
                          : 'Aucune modification n’est appliquée.'}
                      </p>
                    </div>
                  )}
                </div>
              )}
              {suggestions.length > 0 && (
                <ul className="mt-2 space-y-2">
                  {suggestions.map((s, idx) => (
                    <li key={s.tableId} className="rounded-md border border-border p-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">
                          {idx === 0 ? 'Meilleure · ' : ''}
                          {s.name} · {s.capacity} couverts
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-xs"
                          onClick={() => void assignTable(selectedServiceReservation.id, s.tableId)}
                        >
                          Assigner
                        </Button>
                      </div>
                      <p className="mt-1 text-muted-foreground">{s.reasons.join(' · ')}</p>
                    </li>
                  ))}
                </ul>
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
                onClick={() =>
                  void createWalkIn(
                    selectedServiceTable?.id ?? '',
                    selectedServiceTable?.capacity ?? 2,
                  )
                }
                disabled={!selectedServiceTable?.id}
              >
                ⚡ Installer Walk-in ({selectedServiceTable?.capacity ?? 2} pers.)
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 space-y-3 p-4">
          {/* Vue d'ensemble condensée : une ligne porte la volumétrie, la légende
              se déplie à la demande. Sur téléphone, deux grandes cartes et un
              texte d'invite consommaient la hauteur du plan pour peu
              d'information — le détail d'une table vit dans la feuille qui
              s'ouvre au toucher. */}
          <p
            role="status"
            aria-label="Vue d’ensemble de la salle"
            className="text-xs text-muted-foreground"
          >
            <span className="font-semibold tabular-nums text-foreground">
              {[...tableStatuses.values()].filter((item) => item.status === 'occupied').length}
            </span>{' '}
            occupées ·{' '}
            <span className="font-semibold tabular-nums text-foreground">
              {
                [...tableStatuses.values()].filter((item) =>
                  ['reserved', 'upcoming', 'late'].includes(item.status),
                ).length
              }
            </span>{' '}
            attendues ·{' '}
            <span className="font-semibold tabular-nums text-foreground">
              {
                allTables.filter(
                  (table) =>
                    table.isActive && (tableStatuses.get(table.id)?.status ?? 'free') === 'free',
                ).length
              }
            </span>{' '}
            disponibles
          </p>
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
              Légende des statuts
              <ChevronDown
                size={14}
                aria-hidden="true"
                className="transition-transform duration-200 group-open:rotate-180"
              />
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-3">
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
          </details>
        </div>
      )}
    </aside>
  ) : selectedWall || selectedZone || selectedTables.length > 0 ? (
    <aside
      className={cn(
        'order-3 h-auto max-h-72 w-full min-w-0 flex-col overflow-hidden border-t border-border bg-card lg:h-full lg:max-h-none lg:w-72 lg:min-w-72 lg:border-l lg:border-t-0',
        selectedTables.length > 0 ? 'hidden lg:flex' : 'flex',
      )}
    >
      <div className="border-b border-border px-4 py-3">
        <p className="text-sm font-semibold">Inspecteur</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {selectedWall
            ? 'Mur sélectionné'
            : selectedZone
              ? `Zone ${selectedZone.name}`
              : selectedTables.length === 1
                ? `Table ${selectedTables[0]?.name ?? ''}`
                : `${selectedTables.length} tables sélectionnées`}
        </p>
      </div>
      {selectedWall ? (
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="space-y-2">
            <Label htmlFor="wall-inspector-type">Type</Label>
            <Select
              value={selectedWall.type}
              onValueChange={(value) => {
                void updateWall(selectedWall, value as WallType, selectedWall.name ?? null).catch(
                  () => {},
                );
              }}
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
              onBlur={(event) => {
                void updateWall(
                  selectedWall,
                  selectedWall.type,
                  event.currentTarget.value.trim() || null,
                ).catch(() => {});
              }}
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
                    if (delta === 0) return;
                    recordGeometry({
                      before: { tables: [], walls: [snapshotWallGeometry(selectedWall)] },
                      after: { tables: [], walls: [snapshotWallGeometry(nextWall)] },
                    });
                    applyGeometrySnapshot({
                      tables: [],
                      walls: [snapshotWallGeometry(nextWall)],
                    });
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
      ) : selectedZone ? (
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="space-y-2">
            <Label htmlFor="zone-inspector-name">Nom de la zone</Label>
            <Input
              key={`zone-name-${selectedZone.id}-${selectedZone.name}`}
              id="zone-inspector-name"
              defaultValue={selectedZone.name}
              className="bg-background"
              onBlur={(event) =>
                void patchZone(selectedZone.id, { name: event.currentTarget.value.trim() }).catch(
                  () => {},
                )
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="zone-inspector-section">Section liée</Label>
            <Select
              value={selectedZone.sectionId ?? '_none_'}
              onValueChange={(value) =>
                void patchZone(selectedZone.id, {
                  sectionId: value === '_none_' ? null : value,
                })
              }
            >
              <SelectTrigger id="zone-inspector-section" className="bg-background">
                <SelectValue placeholder="Aucune section" />
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
          <p className="text-xs text-muted-foreground">
            Une zone matérialise une section de la salle. Déplacez les tables à l&apos;intérieur et
            utilisez la poignée du coin pour l&apos;adapter au plan.
          </p>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="w-full transition-all duration-200"
            onClick={() => void deleteZone(selectedZone.id)}
          >
            <Trash2 size={14} className="mr-1.5" />
            Supprimer la zone
          </Button>
        </div>
      ) : selectedTables.length > 0 ? (
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {selectedTable ? (
            <div className="space-y-4">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
                <div className="min-w-0 space-y-2">
                  <Label htmlFor="selected-table-name">Nom de la table</Label>
                  <Input
                    key={`selected-table-name-${selectedTable.id}-${selectedTable.name}`}
                    id="selected-table-name"
                    defaultValue={selectedTable.name}
                    className="bg-background"
                    onBlur={(event) => saveTableName(selectedTable, event.currentTarget.value)}
                  />
                  {selectedTable.sectionName ? (
                    <p className="text-xs text-muted-foreground">{selectedTable.sectionName}</p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label>Couverts</Label>
                  <div className="flex h-10 items-center rounded-md border border-input bg-background">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="size-9 rounded-r-none p-0"
                      aria-label="Diminuer la capacité"
                      disabled={selectedTable.capacity <= 1}
                      onClick={() => changeTableCapacity(selectedTable, -1)}
                    >
                      <Minus size={15} />
                    </Button>
                    <span
                      aria-live="polite"
                      className="min-w-8 px-1 text-center text-sm font-semibold tabular-nums"
                    >
                      {selectedTable.capacity}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="size-9 rounded-l-none p-0"
                      aria-label="Augmenter la capacité"
                      onClick={() => changeTableCapacity(selectedTable, 1)}
                    >
                      <Plus size={15} />
                    </Button>
                  </div>
                </div>
              </div>
              <div className="space-y-2 border-t border-border pt-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Forme
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      'px-1 transition-all duration-200',
                      selectedTable.shape !== 'round' && 'bg-secondary font-semibold',
                    )}
                    aria-label="Forme rectangle"
                    aria-pressed={selectedTable.shape !== 'round'}
                    onClick={() => void patchTable(selectedTable.id, { shape: 'rect' })}
                  >
                    <Square size={14} className="mr-1" />
                    Rectangle
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      'px-1 transition-all duration-200',
                      selectedTable.shape === 'round' && 'bg-secondary font-semibold',
                    )}
                    aria-label="Forme ronde"
                    aria-pressed={selectedTable.shape === 'round'}
                    onClick={() => void patchTable(selectedTable.id, { shape: 'round' })}
                  >
                    <Circle size={14} className="mr-1" />
                    Ronde
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="selected-table-section">Section</Label>
                <Select
                  value={selectedTable.sectionId || '_none_'}
                  onValueChange={(value) =>
                    void patchTable(selectedTable.id, {
                      sectionId: value === '_none_' ? null : value,
                    })
                  }
                >
                  <SelectTrigger id="selected-table-section" className="bg-background">
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
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full justify-center transition-all duration-200"
                  onClick={() => void duplicateSingleTable(selectedTable)}
                >
                  <Copy size={14} className="mr-1.5" />
                  Dupliquer
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full justify-center transition-all duration-200"
                  title="Pivoter de 90°"
                  onClick={() =>
                    void patchTable(selectedTable.id, {
                      rotation: ((selectedTable.rotation ?? 0) + 90) % 360,
                    })
                  }
                >
                  <RotateCw size={14} className="mr-1.5" />
                  Pivoter 90°
                </Button>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full justify-center transition-all duration-200"
                onClick={() => void unplaceTable(selectedTable)}
              >
                Retirer du plan
              </Button>
            </div>
          ) : null}

          {selectedTables.length > 1 ? (
            <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-start gap-2">
                <Link2 size={15} className="mt-0.5 shrink-0 text-primary" />
                <div>
                  <p className="text-xs font-semibold">Tables combinables</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Signalez que cette sélection peut accueillir un même groupe.
                  </p>
                </div>
              </div>
              {selectedCombination ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full transition-all duration-200"
                  onClick={() => void deleteTableCombination(selectedCombination)}
                >
                  Retirer la combinaison
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  className="w-full transition-all duration-200"
                  onClick={() => void createTableCombination()}
                >
                  Marquer comme combinables
                </Button>
              )}
            </div>
          ) : null}

          {selectedTables.length > 1 ? (
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
          ) : null}

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

          {selectedTables.length > 1 ? (
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
          ) : null}

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
      ) : null}
    </aside>
  ) : null;

  if (loading) {
    return (
      <>
        <Card className="sokar-card">
          <CardHeader className="p-4">
            <Skeleton className="h-6 w-32 rounded-md" />
          </CardHeader>
          <CardContent
            className={cn(
              'overflow-hidden p-0',
              // Le squelette reprend la hauteur de la vue cible : sinon la page
              // saute d'un cran quand le plan arrive sur téléphone.
              live
                ? 'h-[calc(100dvh-26rem)] min-h-[18rem] md:h-[600px] md:min-h-0'
                : 'h-[calc(100dvh-13.5rem)] min-h-[20rem] md:h-[600px] md:min-h-0',
            )}
          >
            <Skeleton className="h-full w-full" />
          </CardContent>
        </Card>
        {dialog}
        {confirm}
        {settingsDialog}
        {delayRecoveryConfirm}
        {delayRecoveryRevertConfirm}
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
        {delayRecoveryConfirm}
        {delayRecoveryRevertConfirm}
      </>
    );
  }

  const activeDragTable = activeDragData?.kind === 'existingTable' ? activeDragData.table : null;
  const livePlanIsEmpty = live && serviceTab === 'plan' && placedTables.length === 0;
  const liveViewportBounds = live && serviceTab === 'plan' ? contentBounds : null;
  // En Live, le viewport est lui-même dimensionné sur la zone utile. Le canvas
  // complet est ensuite translaté sous ce cadre : les coordonnées métier restent
  // inchangées, mais le défilement ne peut plus atteindre le vide extérieur.
  const stageWidth = (liveViewportBounds?.width ?? canvasWidth) * zoom;
  const stageHeight = (liveViewportBounds?.height ?? canvasHeight) * zoom;
  const canvasTransform = liveViewportBounds
    ? `translate(${-liveViewportBounds.x * zoom}px, ${-liveViewportBounds.y * zoom}px) scale(${zoom})`
    : `scale(${zoom})`;

  // --- Cockpit de service : état, volumétrie, navigation ---------------------
  // Une seule source de vérité par information : le bandeau d'état porte le
  // statut et les actions à mener, la bande KPI ne porte que la volumétrie.
  const serviceToday = format(new Date(), 'yyyy-MM-dd');
  // Dérivé de la date affichée uniquement : `servicePulse.isLiveDate` décrit la
  // date du dernier pulse chargé et peut donc être périmé pendant le changement
  // de jour, ce qui ferait diverger le badge du champ date.
  const serviceIsToday = liveDate === serviceToday;
  const serviceDateLabel = format(parseISO(liveDate), 'd MMM yyyy', { locale: fr });
  const serviceActiveTables = allTables.filter((table) => table.isActive);
  const serviceOccupiedTables = [...tableStatuses.values()].filter(
    (item) => item.status === 'occupied',
  ).length;
  const serviceOccupancyRate =
    serviceActiveTables.length > 0
      ? Math.round((serviceOccupiedTables / serviceActiveTables.length) * 100)
      : 0;
  const serviceCovers = reservations
    .filter((reservation) => !['CANCELLED', 'NO_SHOW'].includes(reservation.state))
    .reduce((total, reservation) => total + (reservation.partySize ?? 0), 0);
  // Service vide : sans réservation ni action en attente, le cockpit complet
  // affichait deux bandes de zéros (statut + volumétrie) et un message d'état
  // vide, soit près de la moitié de l'écran d'un téléphone pour ne rien dire.
  // Les compteurs restent masqués dans cet état ; la navigation du service
  // devient le premier repère visuel et le plan démarre immédiatement dessous.
  const compactServiceCockpit = Boolean(
    live &&
    servicePulse &&
    servicePulse.status === 'calm' &&
    reservations.length === 0 &&
    servicePulse.lateArrivals === 0 &&
    servicePulse.arrivalsToSeat === 0 &&
    servicePulse.arrivalsNext30Minutes === 0 &&
    servicePulse.seatedTables === 0 &&
    servicePulse.pendingWaitingList === 0,
  );
  function shiftServiceDate(days: number) {
    setLiveDate(format(addDays(parseISO(liveDate), days), 'yyyy-MM-dd'));
  }

  // Navigation clavier du groupe d'onglets (flèches, Début, Fin) : sans elle,
  // l'onglet inactif devient inatteignable au clavier à cause du tabIndex mobile.
  function handleServiceTabKeyDown(event: React.KeyboardEvent, index: number) {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % SERVICE_TABS.length;
    else if (event.key === 'ArrowLeft')
      nextIndex = (index - 1 + SERVICE_TABS.length) % SERVICE_TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = SERVICE_TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = SERVICE_TABS[nextIndex];
    setServiceTab(nextTab.id);
    document.getElementById(`service-tab-${nextTab.id}`)?.focus();
  }

  const serviceTablist = (
    <div
      role="tablist"
      aria-label="Vue du service"
      className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {SERVICE_TABS.map((tab, index) => (
        <Button
          key={tab.id}
          type="button"
          role="tab"
          id={`service-tab-${tab.id}`}
          aria-selected={serviceTab === tab.id}
          aria-controls="service-tabpanel"
          tabIndex={serviceTab === tab.id ? 0 : -1}
          variant={serviceTab === tab.id ? 'secondary' : 'ghost'}
          size="sm"
          className="h-9 min-w-0 flex-1 rounded-lg px-2.5 text-xs transition-all duration-200 sm:flex-none sm:px-3 sm:text-sm"
          onClick={() => setServiceTab(tab.id)}
          onKeyDown={(event) => handleServiceTabKeyDown(event, index)}
        >
          {tab.label}
        </Button>
      ))}
    </div>
  );

  return (
    <>
      <Card
        ref={cardRef}
        className={cn(
          // Vue service : même surface que les autres rubriques (arrondis, bordure,
          // fond carte). Le plein écran repasse en angles droits pour ne pas laisser
          // apparaître la page dans les coins de l'écran.
          'sokar-card',
          live && isFullscreen && 'rounded-none',
        )}
      >
        <CardHeader
          className={cn(
            'border-b border-border',
            // `space-y-0` neutralise le `space-y-1.5` du CardHeader de base : sinon
            // une couture de 6 px apparaît entre les bandes du cockpit.
            live ? 'gap-0 space-y-0 p-0' : 'flex flex-col gap-2 p-2.5',
          )}
        >
          {live ? (
            <div className="px-3 py-2 sm:px-4">{serviceTablist}</div>
          ) : (
            <div className="flex min-w-0 items-center justify-between gap-2 overflow-hidden sm:justify-start sm:overflow-x-auto">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="hidden h-8 shrink-0 px-2 sm:flex"
                title="Paramètres du plan"
                aria-label="Paramètres du plan"
                onClick={openRoomSettings}
              >
                <Settings2 size={16} />
              </Button>
              <div
                role="toolbar"
                aria-label="Affichage du plan"
                className="hidden shrink-0 items-center gap-0.5 rounded-md border border-border bg-background p-1 sm:flex"
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                  title="Zoom arrière — −"
                  aria-label="Zoom arrière"
                  onClick={() => changeZoom(-ZOOM_STEP)}
                >
                  <ZoomOut size={16} />
                </Button>
                <button
                  type="button"
                  className="min-w-11 rounded-md px-1 text-center text-xs tabular-nums text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
                  title="Ajuster le plan à l'écran"
                  aria-label="Ajuster le plan à l'écran"
                  onClick={resetView}
                >
                  {Math.round(zoom * 100)}%
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                  title="Zoom avant — +"
                  aria-label="Zoom avant"
                  onClick={() => changeZoom(ZOOM_STEP)}
                >
                  <ZoomIn size={16} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                  title="Centrer le plan — F"
                  aria-label="Centrer le plan"
                  onClick={centerCanvas}
                >
                  <LocateFixed size={16} className="sm:mr-1.5" />
                  <span className="hidden sm:inline">Centrer</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                  title="Plein écran"
                  aria-label="Plein écran"
                  onClick={() => {
                    if (document.fullscreenElement) void document.exitFullscreen();
                    else void cardRef.current?.requestFullscreen();
                  }}
                >
                  <Maximize2 size={16} />
                </Button>
              </div>
              <div
                role="toolbar"
                aria-label="Aides au placement"
                className="flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-background p-1 shadow-sm"
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-9 gap-1 rounded-md px-1.5 transition-all duration-200 sm:gap-1.5 sm:px-2',
                    gridVisible
                      ? 'border border-primary/20 bg-secondary font-semibold text-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
                  )}
                  title={
                    gridVisible
                      ? 'Grille active — masquer avec G'
                      : 'Grille inactive — afficher avec G'
                  }
                  aria-label={gridVisible ? 'Grille active, masquer' : 'Grille inactive, afficher'}
                  aria-pressed={gridVisible}
                  onClick={() => setGridVisible((v) => !v)}
                >
                  <Grid2x2 size={16} className="sm:mr-1.5" />
                  <span className="hidden sm:inline">Grille</span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'ml-0.5 h-1.5 w-1.5 shrink-0 rounded-full',
                      gridVisible ? 'bg-primary' : 'bg-muted-foreground/40',
                    )}
                  />
                </Button>
                <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-9 gap-1 rounded-md px-1.5 transition-all duration-200 sm:gap-1.5 sm:px-2',
                    snap
                      ? 'border border-primary/20 bg-secondary font-semibold text-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
                  )}
                  title={
                    snap
                      ? 'Magnétisme actif — désactiver avec S'
                      : 'Magnétisme inactif — activer avec S'
                  }
                  aria-label={snap ? 'Magnétisme actif, désactiver' : 'Magnétisme inactif, activer'}
                  aria-pressed={snap}
                  onClick={() => setSnap((s) => !s)}
                >
                  <Magnet size={16} className="sm:mr-1.5" />
                  <span className="hidden sm:inline">Magnétisme</span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'ml-0.5 h-1.5 w-1.5 shrink-0 rounded-full',
                      snap ? 'bg-primary' : 'bg-muted-foreground/40',
                    )}
                  />
                </Button>
              </div>
              <div
                role="toolbar"
                aria-label="Historique"
                className="flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-background p-1 shadow-sm"
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 w-9 p-0"
                  title="Annuler — ⌘Z"
                  aria-label="Annuler"
                  disabled={!canUndo}
                  onClick={undoGeometry}
                >
                  <Undo2 size={16} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 w-9 p-0"
                  title="Rétablir — ⌘⇧Z"
                  aria-label="Rétablir"
                  disabled={!canRedo}
                  onClick={redoGeometry}
                >
                  <Redo2 size={16} />
                </Button>
              </div>
              <Button
                type="button"
                variant={planSaved ? 'outline' : 'default'}
                size="sm"
                className="ml-0 h-11 min-w-[6.5rem] shrink-0 justify-center gap-1 rounded-xl px-2 text-xs shadow-sm transition-all duration-200 sm:ml-auto sm:h-9 sm:gap-2 sm:px-3 sm:text-sm"
                disabled={savingPlan}
                onClick={() => void savePlan()}
                aria-label="Enregistrer le plan"
              >
                {planSaved ? <Check size={16} /> : <Save size={16} />}
                {savingPlan ? (
                  'Enregistrement…'
                ) : planSaved ? (
                  <>
                    <span className="sm:hidden">Enregistré</span>
                    <span className="hidden sm:inline">Plan enregistré</span>
                  </>
                ) : (
                  <>
                    <span className="sm:hidden">Enregistrer</span>
                    <span className="hidden sm:inline">Enregistrer</span>
                  </>
                )}
              </Button>
            </div>
          )}
          {live ? (
            <>
              {/* Volumétrie du service. Chaque information n'apparaît qu'une fois :
                  les compteurs d'action (retards, à installer, en service, en attente)
                  restent portés par le bandeau d'état ci-dessus. Sur téléphone, une
                  seule ligne porte valeurs et jauge : deux étages de chiffres
                  consommaient la hauteur utile du plan. */}
              {compactServiceCockpit ? null : (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border px-4 py-2 lg:flex-nowrap lg:gap-8">
                  <div className="flex min-w-0 items-center gap-x-3 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Users size={12} className="hidden sm:block" aria-hidden="true" />
                      <span className="text-sm font-semibold tabular-nums text-foreground">
                        {serviceCovers}
                      </span>
                      couverts
                    </span>
                    <span className="h-3 w-px shrink-0 bg-border" aria-hidden="true" />
                    <span className="inline-flex items-center gap-1">
                      <Armchair size={12} className="hidden sm:block" aria-hidden="true" />
                      <span className="text-sm font-semibold tabular-nums text-foreground">
                        {serviceOccupiedTables}
                        <span className="text-muted-foreground">/{serviceActiveTables.length}</span>
                      </span>
                      <span className="sm:hidden">tables</span>
                      <span className="hidden sm:inline">tables occupées</span>
                    </span>
                    <span className="h-3 w-px shrink-0 bg-border" aria-hidden="true" />
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays size={12} className="hidden sm:block" aria-hidden="true" />
                      <span className="text-sm font-semibold tabular-nums text-foreground">
                        {reservations.length}
                      </span>
                      réservations
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <div
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={serviceOccupancyRate}
                      aria-label={`Taux d’occupation de la salle : ${serviceOccupancyRate} %`}
                      className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary"
                    >
                      <div
                        className="h-full rounded-full bg-foreground/70 transition-all duration-200"
                        style={{ width: `${serviceOccupancyRate}%` }}
                      />
                    </div>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {serviceOccupancyRate}&nbsp;%
                    </span>
                  </div>
                </div>
              )}

              {/* Navigation du service : jour et filtre serveur. Les onglets sont
                  placés en tête du cockpit pour remplacer l'ancien bandeau de pouls. */}
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 border-t border-border px-3 py-2 sm:flex-nowrap sm:px-4">
                <div
                  title={serviceDateLabel}
                  className="order-1 flex min-w-0 items-center gap-0.5 rounded-md border border-border bg-background p-0.5 sm:order-none"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="hidden h-8 px-1.5 transition-all duration-200 sm:inline-flex"
                    title="Jour précédent"
                    aria-label="Jour précédent"
                    onClick={() => shiftServiceDate(-1)}
                  >
                    <ChevronLeft size={16} />
                  </Button>
                  <div className="relative h-8 w-32 min-w-0">
                    <Input
                      type="date"
                      value={liveDate}
                      aria-label="Date du service"
                      onChange={(e) => setLiveDate(e.target.value)}
                      className="floor-plan-service-date-input peer relative z-10 h-8 w-32 border-0 bg-transparent px-1 text-center text-sm text-transparent focus:text-foreground sm:text-foreground"
                    />
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center truncate px-1 text-sm text-foreground peer-focus:opacity-0 sm:hidden"
                    >
                      {serviceDateLabel}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="hidden h-8 px-1.5 transition-all duration-200 sm:inline-flex"
                    title="Jour suivant"
                    aria-label="Jour suivant"
                    onClick={() => shiftServiceDate(1)}
                  >
                    <ChevronRight size={16} />
                  </Button>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    // En direct, l'onglet et la date suffisent à identifier le
                    // contexte ; le badge n'est donc affiché que pour Archive.
                    'h-7 gap-1.5 whitespace-nowrap px-2 text-[10px] sm:h-8 sm:px-2.5 sm:text-[11px]',
                    serviceIsToday ? 'hidden sm:inline-flex' : 'inline-flex',
                    serviceIsToday
                      ? 'border-brand/40 text-brand'
                      : 'border-border text-muted-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      serviceIsToday ? 'bg-brand' : 'bg-muted-foreground',
                    )}
                    aria-hidden="true"
                  />
                  {serviceIsToday ? 'En direct' : 'Archive'}
                </Badge>
                {!serviceIsToday ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 transition-all duration-200"
                    onClick={() => setLiveDate(serviceToday)}
                  >
                    Aujourd’hui
                  </Button>
                ) : null}
                {hasServerFilter ? (
                  <Select
                    value={selectedServerFilter ?? '_all_'}
                    onValueChange={(val) => setSelectedServerFilter(val === '_all_' ? null : val)}
                  >
                    <SelectTrigger
                      aria-label="Filtrer par serveur"
                      title="Filtrer par serveur"
                      className="order-3 ml-auto h-8 w-9 justify-center gap-1 border-border bg-background px-0 text-xs font-medium sm:order-none sm:w-auto sm:max-w-[11rem] sm:justify-start sm:px-2.5"
                    >
                      {selectedServerFilter === '_unassigned_' ? (
                        <UserX size={13} className="shrink-0 text-muted-foreground" />
                      ) : (
                        <UserRound size={13} className="shrink-0 text-primary" />
                      )}
                      {/* Sur téléphone le filtre reste une icône : la ligne du jour
                          doit tenir sans repousser les onglets sur une 3e ligne. */}
                      <span className="!hidden min-w-0 truncate sm:!inline-flex">
                        <SelectValue placeholder="Tous les serveurs" />
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_all_">Toutes les tables ({allTables.length})</SelectItem>
                      {unassignedCount > 0 ? (
                        <SelectItem value="_unassigned_">
                          <span className="flex items-center gap-1.5">
                            <UserX size={13} className="shrink-0 text-muted-foreground" />
                            Non affectées ({unassignedCount})
                          </span>
                        </SelectItem>
                      ) : null}
                      {allServers.map((server) => {
                        const count = serverTableCounts.get(server) ?? 0;
                        return (
                          <SelectItem key={server} value={server}>
                            {server} ({count} {count > 1 ? 'tables' : 'table'})
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                ) : null}
              </div>
            </>
          ) : null}
        </CardHeader>

        {error ? (
          <div className="sokar-error m-4 text-sm">
            <AlertCircle size={16} />
            {error}
          </div>
        ) : null}

        {!live && autoLayoutNotice ? (
          <div
            role="status"
            className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground"
          >
            <CircleCheck size={15} className="shrink-0 text-primary" aria-hidden="true" />
            <p className="min-w-0 flex-1">
              Disposition initiale appliquée. Ajustez les tables, puis enregistrez le plan. Vous
              pouvez annuler avec ⌘Z.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              aria-label="Masquer le message de disposition automatique"
              onClick={() => setAutoLayoutNotice(false)}
            >
              <X size={14} />
            </Button>
          </div>
        ) : null}

        {live && serviceTab === 'plan' && delayRecoveries.length > 0 ? (
          <section
            role="region"
            aria-label="Historique des plans de retard"
            className="border-b border-border bg-muted/30 px-4 py-2.5"
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Clock3 size={15} className="text-muted-foreground" />
                <p className="text-xs font-semibold text-foreground">Plans de retard</p>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Conservés après actualisation · {delayRecoveries.length} opération
                {delayRecoveries.length > 1 ? 's' : ''}
              </p>
            </div>
            <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
              {delayRecoveries.slice(0, 3).map((recovery) => (
                <div
                  key={recovery.operationId}
                  className="flex min-w-0 items-start justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2 transition-all duration-200"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-xs font-semibold text-foreground">
                        {recovery.delayedCustomerName} · +{recovery.delayMinutes} min
                      </p>
                      <Badge
                        variant="outline"
                        className={cn(
                          'h-5 text-[10px]',
                          recovery.status === 'reverted'
                            ? 'border-success/30 text-success'
                            : recovery.status === 'blocked'
                              ? 'border-warning/30 text-warning'
                              : 'border-primary/30 text-primary',
                        )}
                      >
                        {recovery.status === 'reverted'
                          ? 'Annulé'
                          : recovery.status === 'blocked'
                            ? 'À vérifier'
                            : 'Appliqué'}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">
                      {recovery.delayedCustomerName} : {recovery.originalTableName} →{' '}
                      {recovery.alternativeTableName} · {recovery.waitingCustomerName} →{' '}
                      {recovery.originalTableName}
                    </p>
                    <p
                      className={cn(
                        'mt-1 truncate text-[10px]',
                        recovery.blockedReason ? 'text-warning' : 'text-muted-foreground',
                      )}
                    >
                      {recovery.blockedReason ??
                        (recovery.revertedAt
                          ? `Annulé à ${format(parseISO(recovery.revertedAt), 'HH:mm')}`
                          : `Appliqué à ${format(parseISO(recovery.appliedAt), 'HH:mm')}`)}
                    </p>
                  </div>
                  {recovery.revertible ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 shrink-0 transition-all duration-200"
                      onClick={() => openPersistedRecoveryRevert(recovery)}
                    >
                      <Undo2 size={13} className="mr-1" />
                      Annuler
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* État vide : quand le cockpit est déjà réduit à une ligne, le message
            d'absence de réservation est porté par cette ligne. Ici on ne garde
            la bande que pour les services qui ont des tables ou des actions. */}
        {live &&
        !compactServiceCockpit &&
        serviceTab === 'plan' &&
        allTables.length > 0 &&
        reservations.length === 0 &&
        loadedLiveDate === liveDate ? (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground"
          >
            <span className="flex items-center gap-1.5">
              <CalendarDays size={14} aria-hidden="true" />
              {serviceIsToday
                ? 'Aucune réservation pour aujourd’hui.'
                : `Aucune réservation pour le ${serviceDateLabel}.`}
            </span>
            {!serviceIsToday ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs transition-all duration-200"
                onClick={() => setLiveDate(serviceToday)}
              >
                Revenir à aujourd’hui
              </Button>
            ) : null}
          </div>
        ) : null}

        <CardContent
          role={live ? 'tabpanel' : undefined}
          id={live ? 'service-tabpanel' : undefined}
          aria-labelledby={live ? `service-tab-${serviceTab}` : undefined}
          className={cn(
            'overflow-hidden p-0',
            live
              ? liveViewportBounds
                ? // Les tables cadrées occupent parfois moins de hauteur que
                  // l'écran d'un téléphone. Garder une surface utile jusqu'au
                  // dessus de la navigation tactile évite le vide mort entre
                  // la légende et la barre fixe.
                  'h-auto min-h-[calc(100dvh-15rem)] md:min-h-0'
                : cn(
                    // Sur téléphone, la surface du plan prend la hauteur restante de
                    // l'écran : un cockpit compact laisse plus de place qu'un
                    // cockpit complet. La réserve couvre le chrome au-dessus du plan
                    // et la navigation tactile fixe ; elle est calibrée sur un
                    // iPhone 13 et se règle ici si le chrome change.
                    compactServiceCockpit ? 'h-[calc(100dvh-21.5rem)]' : 'h-[calc(100dvh-28.5rem)]',
                    'min-h-[18rem] md:min-h-0',
                    livePlanIsEmpty ? 'md:h-[24rem]' : 'md:h-[600px]',
                  )
              : 'h-[calc(100dvh-13.5rem)] min-h-[20rem] md:h-[600px] md:min-h-0',
          )}
        >
          {live && serviceTab === 'stats' ? (
            <StatsPanel
              reservations={reservations}
              allTables={allTables}
              tableStatuses={tableStatuses}
              liveDate={liveDate}
            />
          ) : live && serviceTab === 'waiting-list' ? (
            <WaitingListPanel
              entries={waitingList}
              isLoading={waitingListLoading}
              promotingEntryId={promotingWaitingListEntryId}
              entryErrors={waitingListEntryErrors}
              onPromote={promoteWaitingListEntry}
            />
          ) : (
            <DndContext
              sensors={sensors}
              onDragStart={handleDragStart}
              onDragMove={handleDragMove}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <div className="flex h-full min-h-0 flex-col lg:flex-row">
                <div className="order-2 lg:order-1 lg:contents">
                  {!live ? (
                    <FloorPlanPalette
                      tablesToPlace={tablesToPlace}
                      totalTables={allTables.length}
                      onPlaceTable={(table) => void placeExistingTable(table)}
                      onCreateTable={() => void createUnplacedTable()}
                      onAutoLayout={() => void autoLayoutTables()}
                      autoLayoutLoading={autoLayoutLoading}
                      onQuickAdd={quickAddFromPalette}
                    />
                  ) : null}
                </div>
                <div className="relative order-1 flex min-h-0 min-w-0 flex-1 flex-col lg:order-2">
                  {/* Le pincement à deux doigts pilote le zoom du plan ; le
                      glissement d'un doigt le défile (défilement natif). */}
                  <div
                    ref={canvasViewportRef}
                    style={{ touchAction: 'pan-x pan-y' }}
                    className={cn(
                      'relative min-h-0 w-full flex-1 overflow-auto bg-muted/50',
                      livePlanIsEmpty ? 'min-h-0' : 'min-h-[14rem] md:min-h-[22rem]',
                      activeDragData?.kind === 'table' ||
                        activeDragData?.kind === 'wall' ||
                        activeDragData?.kind === 'zone'
                        ? 'cursor-copy'
                        : activeDragTable
                          ? 'cursor-grabbing'
                          : undefined,
                    )}
                  >
                    {displayedInitialDelayImpact && !reportedDelayBannerDismissed ? (
                      <div
                        role="region"
                        aria-label="Retard signalé par téléphone"
                        className={cn(
                          'absolute left-3 right-3 top-3 z-40 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur transition-all duration-200',
                          delayRecoveryApplied ? 'border-success/30' : 'border-warning/30',
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className={cn(
                              'mt-0.5 rounded-full p-2',
                              delayRecoveryApplied ? 'bg-success/10' : 'bg-warning/10',
                            )}
                          >
                            {delayRecoveryApplied ? (
                              <CircleCheck size={18} className="text-success" />
                            ) : (
                              <Phone size={18} className="text-warning" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge
                                variant="outline"
                                className={cn(
                                  'h-5 text-[10px] uppercase tracking-wide',
                                  delayRecoveryApplied
                                    ? 'border-success/30 text-success'
                                    : 'border-warning/30 text-warning',
                                )}
                              >
                                {delayRecoveryReverted
                                  ? 'Plan restauré'
                                  : delayRecoveryApplied
                                    ? 'Communication requise'
                                    : 'Appel reçu'}
                              </Badge>
                              <p className="text-sm font-semibold text-foreground">
                                {delayRecoveryApplied
                                  ? delayRecoveryReverted
                                    ? 'Plan de retard annulé'
                                    : 'Plan de retard appliqué'
                                  : `${reportedDelayReservation?.customerName || 'Client'} · ${reportedDelayReservation?.partySize ?? '—'} pers. · +${displayedInitialDelayImpact.delayMinutes} min`}
                              </p>
                            </div>
                            {delayRecoveryApplied ? (
                              <div className="mt-2 rounded-lg border border-warning/25 bg-warning/[0.05] px-3 py-2">
                                <p className="text-xs font-semibold text-foreground">
                                  {delayRecoveryReverted
                                    ? 'Plan initial restauré'
                                    : 'Plan appliqué'}
                                </p>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {appliedDelayRecovery
                                    ? delayRecoveryReverted
                                      ? `${appliedDelayRecovery.delayedCustomerName} retrouve ${appliedDelayRecovery.delayedOriginalTableName} et son horaire initial. ${appliedDelayRecovery.waitingCustomerName} retourne en liste d’attente.`
                                      : `${appliedDelayRecovery.waitingCustomerName} : liste d’attente → ${appliedDelayRecovery.waitingTableName}. ${appliedDelayRecovery.delayedCustomerName} : ${appliedDelayRecovery.delayedOriginalTableName} → ${appliedDelayRecovery.delayedAlternativeTableName}.`
                                    : 'Les deux changements de table ont été enregistrés.'}
                                </p>
                                {delayRecoveryReverted ? (
                                  <p className="mt-1 text-xs font-medium text-warning">
                                    Prévenez les deux clients : les communications humaines déjà
                                    effectuées ne peuvent pas être annulées.
                                  </p>
                                ) : (
                                  <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <p className="text-xs font-medium text-warning">
                                      Prévenez les deux clients. Aucun message n’a été envoyé
                                      automatiquement.
                                    </p>
                                    {appliedDelayRecovery ? (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="shrink-0 transition-all duration-200"
                                        onClick={() => setDelayRecoveryRevertConfirmOpen(true)}
                                      >
                                        <Undo2 size={14} className="mr-1.5" />
                                        Annuler ce plan
                                      </Button>
                                    ) : null}
                                  </div>
                                )}
                              </div>
                            ) : reportedDelayLookupError ? (
                              <p className="mt-2 text-xs font-medium text-warning">
                                {reportedDelayLookupError}
                              </p>
                            ) : delayImpactLoading ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Analyse de la salle et de la liste d’attente…
                              </p>
                            ) : delayImpact &&
                              delayImpactReservationId ===
                                displayedInitialDelayImpact.reservationId ? (
                              <>
                                {delayImpact.feasible &&
                                delayImpact.alternativeTable &&
                                delayImpact.waitingListEntry ? (
                                  <div className="mt-2 space-y-2">
                                    <div className="grid gap-2 sm:grid-cols-2">
                                      <div className="rounded-lg border border-border bg-card px-3 py-2">
                                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                          {delayImpact.waitingListEntry.isAvailableNow
                                            ? 'Disponible maintenant'
                                            : `Créneau ${format(
                                                parseISO(
                                                  delayImpact.waitingListEntry
                                                    .customerFacingRequestedStartsAt ??
                                                    delayImpact.waitingListEntry.proposedStartsAt,
                                                ),
                                                'HH:mm',
                                              )}`}
                                        </p>
                                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-semibold text-foreground">
                                          <span className="truncate">Liste d’attente</span>
                                          <ArrowRight
                                            size={13}
                                            className="shrink-0 text-muted-foreground"
                                          />
                                          <span className="shrink-0">
                                            {delayImpact.delayedReservation?.originalTableName ||
                                              reportedDelayReservation?.tableName ||
                                              'Table actuelle'}
                                          </span>
                                        </div>
                                        <p className="mt-1 truncate text-[11px] text-muted-foreground">
                                          {delayImpact.waitingListEntry.customerName} n’avait pas
                                          encore de table.
                                        </p>
                                      </div>
                                      <div className="rounded-lg border border-border bg-card px-3 py-2">
                                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                          {delayImpact.delayedReservation
                                            ?.customerFacingProposedStartsAt
                                            ? `À ${format(
                                                parseISO(
                                                  delayImpact.delayedReservation
                                                    .customerFacingProposedStartsAt,
                                                ),
                                                'HH:mm',
                                              )}`
                                            : 'À son arrivée'}
                                        </p>
                                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-semibold text-foreground">
                                          <span className="truncate">
                                            {reportedDelayReservation?.customerName ||
                                              'Réservation retardée'}
                                          </span>
                                          <span className="shrink-0 text-muted-foreground">
                                            ·{' '}
                                            {delayImpact.delayedReservation?.originalTableName ||
                                              reportedDelayReservation?.tableName ||
                                              'Table actuelle'}
                                          </span>
                                          <ArrowRight
                                            size={13}
                                            className="shrink-0 text-muted-foreground"
                                          />
                                          <span className="shrink-0">
                                            {delayImpact.alternativeTable.name}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                      <p className="text-[11px] text-muted-foreground">
                                        Vérification automatique avant application · Aucun SMS
                                        envoyé
                                      </p>
                                      <Button
                                        size="sm"
                                        className="shrink-0"
                                        onClick={() => setDelayRecoveryConfirmOpen(true)}
                                      >
                                        Vérifier et appliquer
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <p className="mt-2 text-xs font-medium text-warning">
                                    Aucun changement sûr n’est proposé. Aucune modification n’est
                                    appliquée.
                                  </p>
                                )}
                              </>
                            ) : (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Ouvrez la table sélectionnée pour relancer l’analyse.
                              </p>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 shrink-0 p-0"
                            aria-label="Masquer le retard signalé"
                            onClick={() => setReportedDelayBannerDismissed(true)}
                          >
                            <X size={16} />
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    <div
                      className={cn(
                        'relative',
                        liveViewportBounds ? 'mx-auto overflow-hidden' : undefined,
                      )}
                      data-testid={liveViewportBounds ? 'floor-plan-live-stage' : undefined}
                      style={{ width: stageWidth, height: stageHeight }}
                    >
                      {/* Garantie d'aire défilable : l'espaceur fait exactement la
                          taille de la scène visible. En Live, cette scène est
                          limitée à la zone utile ; l'édition conserve la salle
                          entière comme surface de travail. */}
                      <div
                        aria-hidden="true"
                        className="pointer-events-none"
                        style={{ width: stageWidth, height: stageHeight }}
                      />
                      <div
                        ref={canvasRef}
                        className={cn(
                          // Le canvas doit recouvrir l'espaceur de scroll, pas se
                          // placer apres lui a sa position statique. Sans cet
                          // ancrage, sa hauteur zoomée apparaissait comme un grand
                          // vide au-dessus des tables, surtout en Live mobile.
                          liveViewportBounds
                            ? 'absolute left-0 top-0 origin-top-left border-0 bg-transparent shadow-none'
                            : 'absolute left-0 top-0 origin-top-left border border-border bg-background shadow-sm',
                          activeDragData?.kind === 'table' ||
                            activeDragData?.kind === 'wall' ||
                            activeDragData?.kind === 'zone'
                            ? 'cursor-copy border-primary/50 ring-2 ring-primary/30'
                            : undefined,
                        )}
                        onClick={() => {
                          setSelectedTableIds(new Set());
                          setSelectedServiceTableId(null);
                          setSelectedWallId(null);
                          setSelectedZoneId(null);
                        }}
                        style={{
                          width: canvasWidth,
                          height: canvasHeight,
                          transform: canvasTransform,
                          transformOrigin: 'top left',
                          backgroundImage:
                            !live && gridVisible
                              ? `linear-gradient(to right, hsl(var(--muted-foreground) / 0.22) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--muted-foreground) / 0.22) 1px, transparent 1px), linear-gradient(to right, hsl(var(--muted-foreground) / 0.08) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--muted-foreground) / 0.08) 1px, transparent 1px)`
                              : undefined,
                          backgroundSize: `${GRID_SIZE * 5}px ${GRID_SIZE * 5}px, ${GRID_SIZE * 5}px ${
                            GRID_SIZE * 5
                          }px, ${GRID_SIZE}px ${GRID_SIZE}px, ${GRID_SIZE}px ${GRID_SIZE}px`,
                        }}
                      >
                        {!live ? (
                          <div
                            className="absolute left-0 top-0 z-20 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background"
                            title="Origine du plan"
                            aria-hidden="true"
                          />
                        ) : null}
                        {(live ? liveZones : zones).map((zone) => (
                          <ZoneCard
                            key={zone.id}
                            zone={zone}
                            editable={!live}
                            showLabel={!liveViewportBounds}
                            isSelected={!live && selectedZoneId === zone.id}
                            onClick={() => selectZone(zone)}
                            onPointerDown={(event) => handleZonePointerDown(event, zone)}
                            onResizeStart={(event) => startZoneResize(event, zone)}
                          />
                        ))}
                        <svg
                          className="absolute inset-0 w-full h-full pointer-events-none"
                          style={{ zIndex: 10 }}
                          onClick={() => {
                            setSelectedWallId(null);
                            setSelectedZoneId(null);
                          }}
                        >
                          <g className="pointer-events-auto">
                            {!live
                              ? floorPlan?.walls?.map((w) => (
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
                                    onPointerDownStart={(e) =>
                                      handleWallPointerDown(e, w, 'resize-start')
                                    }
                                    onPointerDownEnd={(e) =>
                                      handleWallPointerDown(e, w, 'resize-end')
                                    }
                                  />
                                ))
                              : null}
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
                                  x1={
                                    (wallLengthGuide.activeWall.x1 +
                                      wallLengthGuide.activeWall.x2) /
                                    2
                                  }
                                  y1={
                                    (wallLengthGuide.activeWall.y1 +
                                      wallLengthGuide.activeWall.y2) /
                                    2
                                  }
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
                                  cx={
                                    (wallLengthGuide.activeWall.x1 +
                                      wallLengthGuide.activeWall.x2) /
                                    2
                                  }
                                  cy={
                                    (wallLengthGuide.activeWall.y1 +
                                      wallLengthGuide.activeWall.y2) /
                                    2
                                  }
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
                        {tableAlignGuides.x || tableAlignGuides.y ? (
                          <svg
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0 h-full w-full"
                            style={{ zIndex: 12 }}
                          >
                            {tableAlignGuides.x ? (
                              <line
                                x1={tableAlignGuides.x.value}
                                y1={0}
                                x2={tableAlignGuides.x.value}
                                y2={canvasHeight}
                                stroke="hsl(var(--primary))"
                                strokeWidth={1.5}
                                strokeDasharray="5 4"
                                opacity={0.9}
                              />
                            ) : null}
                            {tableAlignGuides.y ? (
                              <line
                                x1={0}
                                y1={tableAlignGuides.y.value}
                                x2={canvasWidth}
                                y2={tableAlignGuides.y.value}
                                stroke="hsl(var(--primary))"
                                strokeWidth={1.5}
                                strokeDasharray="5 4"
                                opacity={0.9}
                              />
                            ) : null}
                          </svg>
                        ) : null}
                        {placedTables.map((table) => {
                          const { width, height } = getTableSize(table);
                          const status = live ? tableStatuses.get(table.id) : undefined;
                          const tableServer = table.assignedServer?.trim() || null;
                          const isFilteredOut =
                            live &&
                            selectedServerFilter !== null &&
                            (selectedServerFilter === '_unassigned_'
                              ? Boolean(tableServer)
                              : tableServer !== selectedServerFilter);
                          return (
                            <DraggableTable
                              key={table.id}
                              table={table}
                              status={status}
                              isSelected={
                                live
                                  ? selectedServiceTableId === table.id ||
                                    (!reportedDelayBannerDismissed &&
                                      (reportedDelayOriginalTableId === table.id ||
                                        reportedDelayAlternativeTableId === table.id))
                                  : selectedTableIds.has(table.id)
                              }
                              draggable={!live}
                              droppable={live}
                              draggableReservation={live}
                              editable={!live}
                              zoom={zoom}
                              compact={compactTableCards}
                              onClick={(e) => handleTableClick(table, e)}
                              onDoubleClick={() => handleTableDoubleClick(table)}
                              onResizeStart={(e) => startTableResize(e, table)}
                              onRotateStart={(e) => startTableRotate(e, table)}
                              isCombinable={combinableTableIds.has(table.id)}
                              style={{
                                left: table.positionX ?? 0,
                                top: table.positionY ?? 0,
                                width,
                                height,
                                position: 'absolute',
                                zIndex: selectedTableIds.has(table.id) ? 3 : 2,
                                opacity: isFilteredOut ? 0.25 : 1,
                                filter: isFilteredOut ? 'grayscale(80%)' : undefined,
                                transition: 'all 0.2s ease',
                              }}
                            />
                          );
                        })}
                      </div>
                      {liveViewportBounds && liveZones.length > 0 ? (
                        <div
                          className="pointer-events-none absolute left-2 top-2 z-30 flex max-w-[calc(100%-1rem)] flex-wrap gap-1.5"
                          aria-hidden="true"
                        >
                          {liveZones.map((zone) => (
                            <span
                              key={`live-zone-label-${zone.id}`}
                              className="rounded-md border border-primary/20 bg-background/85 px-1.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground shadow-sm backdrop-blur-sm"
                            >
                              {zone.name}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    {!live ? (
                      <div className="pointer-events-none absolute bottom-3 left-3 z-30 flex items-center gap-1.5">
                        <div className="flex items-center gap-1.5 rounded-full border border-border bg-background/90 px-2.5 py-1 text-[10px] tabular-nums text-muted-foreground shadow-sm backdrop-blur">
                          <span>
                            {formatRoomMeters(canvasWidth)} × {formatRoomMeters(canvasHeight)} m
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>1 carreau = {formatRoomCentimeters(GRID_SIZE)} cm</span>
                        </div>
                        {!selectedWall && selectedTables.length === 0 ? (
                          <p className="flex items-center rounded-full border border-border bg-background/90 px-2.5 py-1 text-[10px] text-muted-foreground shadow-sm backdrop-blur">
                            Sélectionnez un élément pour modifier ses propriétés.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {placedTables.length === 0 &&
                    ((floorPlan?.walls ?? []).length === 0 || !live) ? (
                      <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-6">
                        <div className="flex max-w-xs flex-col items-center text-center">
                          {live ? (
                            <span
                              className="flex h-11 w-11 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 bg-background/90 text-muted-foreground shadow-sm"
                              aria-hidden="true"
                            >
                              <Armchair size={20} />
                            </span>
                          ) : null}
                          <p
                            className={cn('text-sm font-medium text-foreground', live && 'mt-2.5')}
                          >
                            {live
                              ? allTables.length > 0
                                ? `${allTables.length} table${allTables.length > 1 ? 's' : ''} à placer`
                                : 'Aucune table dans ce plan'
                              : tablesToPlace.length > 0
                                ? 'Construisez votre plan'
                                : 'Aucune table configurée'}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {live
                              ? allTables.length > 0
                                ? 'Placez les tables depuis Plan visuel pour suivre le service ici.'
                                : 'Ajoutez vos tables depuis Plan visuel pour suivre le service ici.'
                              : tablesToPlace.length > 0
                                ? `${tablesToPlace.length} table${tablesToPlace.length > 1 ? 's restent' : ' reste'} à placer.`
                                : 'Créez vos tables métier avant de les positionner dans la salle.'}
                          </p>
                          {!live && tablesToPlace.length > 0 ? (
                            <div className="pointer-events-auto mt-3 flex flex-wrap justify-center gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="transition-all duration-200"
                                onClick={focusTablesToPlace}
                              >
                                Placer les tables
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                className="transition-all duration-200"
                                onClick={() => void autoLayoutTables()}
                                disabled={autoLayoutLoading}
                              >
                                {autoLayoutLoading ? 'Placement…' : 'Disposition automatique'}
                              </Button>
                            </div>
                          ) : null}
                          {!live && allTables.length === 0 ? (
                            <Button
                              type="button"
                              size="sm"
                              className="pointer-events-auto mt-3 transition-all duration-200"
                              onClick={() => setBulkCreateDialogOpen(true)}
                            >
                              <Plus size={15} className="mr-1.5" />
                              Créer mes tables
                            </Button>
                          ) : null}
                          {live && onRequestEdit ? (
                            <Button
                              type="button"
                              size="sm"
                              className="pointer-events-auto mt-3 w-full transition-all duration-200 sm:w-auto"
                              onClick={onRequestEdit}
                            >
                              Configurer la salle
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
                {!live || allTables.length > 0 ? inspector : null}
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
                                compact={compactTableCards}
                                style={{
                                  transform: `scale(${zoom})`,
                                  transformOrigin: 'top left',
                                }}
                              />
                            );
                          })()
                        : null}
                      {activeDragData?.kind === 'placeTable' ? (
                        <TableCard
                          table={activeDragData.table}
                          isOverlay
                          zoom={zoom}
                          compact={compactTableCards}
                          style={{
                            transform: `scale(${zoom})`,
                            transformOrigin: 'top left',
                          }}
                        />
                      ) : null}
                      {activeDragData?.kind === 'table' ? (
                        <NewTableOverlay
                          shape={activeDragData.shape}
                          capacity={activeDragData.capacity}
                          zoom={zoom}
                        />
                      ) : null}
                      {activeDragData?.kind === 'zone' ? (
                        <div className="flex h-28 w-44 items-center justify-center rounded-xl border border-primary/40 bg-primary/10 text-xs font-semibold uppercase tracking-[0.14em] text-primary shadow-lg">
                          Zone
                        </div>
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
          )}
        </CardContent>
      </Card>
      {typeof document !== 'undefined'
        ? createPortal(
            <>
              {mobileServiceInspector}
              {mobileEditInspector}
            </>,
            document.body,
          )
        : null}
      {dialog}
      {confirm}
      {delayRecoveryConfirm}
      {delayRecoveryRevertConfirm}
      {multiDeleteConfirm}
      {settingsDialog}
      {bulkCreateDialog}
      {duplicateDialog}
    </>
  );
}
