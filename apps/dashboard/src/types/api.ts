/**
 * Types TypeScript pour les réponses API consommées par le dashboard.
 *
 * Ces interfaces ne couvrent que les champs réellement utilisés côté dashboard.
 * Elles sont volontairement simples et pragmatiques — pour les types complets,
 * voir les schémas Prisma (packages/database/prisma/schema.prisma) et les
 * types API (apps/api/src/modules/.../types.ts).
 */

// ─── Restaurant ─────────────────────────────────────────────────────────

export type Plan = 'STARTER' | 'PRO' | 'PREMIUM';

export type OpeningHours = {
  open: string;
  close: string;
};

export interface Restaurant {
  id: string;
  name: string;
  plan: Plan;
  managerPhone: string;
  managerEmail: string;
  phoneNumber: string;
  googleCalendarId: string | null;
  googleRefreshToken: string | null;
  giftCardMinimumAmount: number | null;
  giftCardCommissionRate: number;
  slug: string | null;
  openingHours?: Record<string, OpeningHours | null>;
  exposureSettings?: RestaurantExposureSettings | null;
}

// ─── AgentPersonality ───────────────────────────────────────────────────

export type ProfileType = 'BISTROT_BRASSERIE' | 'GASTRONOMIQUE' | 'SEMI_GASTRO';
export type FillerStyle = 'CASUAL' | 'WARM' | 'FORMAL';

export interface AgentPersonality {
  id: string;
  restaurantId: string;
  profileType: ProfileType;
  speakingRate: number;
  fillerStyle: FillerStyle;
  systemPromptExtra: string | null;
  voiceIdCa: string | null;
}

// ─── Reservation ────────────────────────────────────────────────────────

export type ReservationStatus = 'CONFIRMED' | 'CANCELLED' | 'SEATED' | 'NO_SHOW';

export interface Reservation {
  id: string;
  restaurantId: string;
  reservedAt: string;
  partySize: number;
  customerName: string;
  customerPhone: string | null;
  status: ReservationStatus;
  estimatedRevenue: number | null;
  tableId: string | null;
  table?: { name: string } | null;
}

// ─── Call ───────────────────────────────────────────────────────────────

export type CallIntent = 'RESERVATION' | 'HOURS' | 'MENU' | 'CANCEL' | 'OTHER';
export type CallOutcome = 'RESERVED' | 'INFO' | 'HANDOFF' | 'NO_ACTION' | 'ERROR';

export interface Call {
  id: string;
  callSid: string;
  durationSec: number | null;
  transcript: string | null;
  intent: CallIntent | null;
  outcome: CallOutcome | null;
  carrier: string | null;
  createdAt: string;
}

export interface CallListResponse {
  data: Call[];
  total: number;
}

// ─── Customer ───────────────────────────────────────────────────────────

export interface Customer {
  id: string;
  name: string | null;
  phone: string;
  visitCount: number;
  loyaltyScore: number;
  isVip: boolean;
  notes: string | null;
  lastSeenAt: string | null;
}

// ─── GiftCard & GiftCardPack ────────────────────────────────────────────
// (Les types complets sont dans `@/lib/api/gift-cards` — on ré-exporte ici
// pour centraliser, mais on évite la duplication.)

// ─── FloorPlan ──────────────────────────────────────────────────────────

export type TableShape = 'rect' | 'round';
export type WallType = 'wall' | 'door' | 'window' | 'bar' | 'plant';

export interface FloorPlanWall {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  type: WallType;
  name: string | null;
}

export interface FloorPlanTable {
  id: string;
  name: string;
  capacity: number;
  minCapacity: number;
  isActive: boolean;
  positionX: number | null;
  positionY: number | null;
  width: number | null;
  height: number | null;
  rotation: number;
  shape: TableShape | null;
  assignedServer?: string | null;
  sectionId?: string | null;
  sectionName?: string | null;
}

export interface FloorPlanSection {
  id: string;
  name: string;
  position: number;
  tables: FloorPlanTable[];
}

export interface FloorPlan {
  id: string;
  name: string | null;
  isDefault: boolean;
  isActive: boolean;
  width: number;
  height: number;
  sections: FloorPlanSection[];
  tables?: FloorPlanTable[];
  walls?: FloorPlanWall[];
}

export interface FloorPlanSummary {
  id: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  tableCount: number;
}

export interface PlanningReservation {
  id: string;
  tableId: string | null;
  tableName: string | null;
  sectionName: string | null;
  startsAt: string;
  endsAt: string;
  partySize: number;
  customerName: string | null;
  state: string;
  seatedAt: string | null;
}

// ─── ReactivationCampaign ───────────────────────────────────────────────

export interface ReactivationCustomer {
  id: string;
  name: string;
  phone: string | null;
  visitCount: number;
  lastSeenAt: string | null;
}

export interface ReactivationCampaign {
  id: string;
  status: 'PENDING' | 'SENT' | 'DISMISSED';
  sentCount: number;
  sentAt: string | null;
  createdAt: string;
  customerCount: number;
  customers: ReactivationCustomer[];
}

// ─── RestaurantExposureSettings (agentic) ───────────────────────────────

export type NoShowPolicy = 'warning' | 'fee' | 'block';

export interface ExposedCreneau {
  day: number;
  from: string;
  to: string;
}

export interface CapacitySpecials {
  terrasse?: number;
  pmr?: number;
  chien?: boolean;
  poussette?: boolean;
  serviceDurationMinutes?: number;
  defaultServiceDurationMinutes?: number;
  waitingListEnabled?: boolean;
  waitingListMaxEntriesPerSlot?: number;
}

export interface RestaurantExposureSettings {
  maxPartySize: number;
  minLeadTimeMinutes: number;
  requireManualValidation: boolean;
  quoteTtlSeconds: number;
  holdTtlSeconds: number;
  noShowPolicy: NoShowPolicy;
  notificationChannels: ('sms' | 'email')[];
  exposedCreneaux: ExposedCreneau[];
  capacitySpecials: CapacitySpecials;
}

// ─── Agentic MCP clients ────────────────────────────────────────────────

export interface McpClient {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  allowedOrigins: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

export interface McpClientListResponse {
  clients: McpClient[];
}

export interface McpClientCreateResponse {
  client: McpClient;
  apiKey: string;
}

export interface OptInStatus {
  mcp: boolean;
  openaiReserve: boolean;
  policyVersion: string;
}

// ─── WaitingList ────────────────────────────────────────────────────────

export type WaitingListStatus = 'PENDING' | 'PROMOTED' | 'CANCELLED' | 'EXPIRED';

export interface WaitingListEntry {
  id: string;
  partySize: number;
  customerFirstName: string;
  customerLastName?: string | null;
  customerPhone: string;
  customerEmail?: string | null;
  source?: string | null;
  slotStart: string;
  slotEnd: string;
  preferredSectionName?: string | null;
  status: WaitingListStatus;
  position: number;
  createdAt: string;
  promotedReservationId?: string | null;
}

// ─── Service Copilot ────────────────────────────────────────────────────

export type ServiceCopilotRecommendationKind =
  | 'reported-delay'
  | 'late-reservation'
  | 'table-soon-free'
  | 'waiting-list-compatible'
  | 'server-rebalance';

export type ServiceCopilotPriority = 'critical' | 'high' | 'medium' | 'low';

export interface ServiceCopilotRecommendation {
  id: string;
  occurrenceKey: string;
  ruleVersion: string;
  telemetryToken?: string;
  kind: ServiceCopilotRecommendationKind;
  priority: ServiceCopilotPriority;
  title: string;
  reason: string;
  action: {
    type: 'link' | 'call' | 'api';
    label: string;
    href?: string;
    method?: 'PATCH' | 'POST' | 'DELETE';
    path?: string;
    body?: Record<string, unknown>;
  };
  entityId?: string;
  expiresAt: string;
  metrics?: {
    minutesLate?: number;
    estimatedFreeAt?: string;
    covers?: number;
    tableName?: string;
    customerName?: string;
    estimatedDurationMinutes?: number;
    predictionConfidence?: 'high' | 'medium' | 'low';
    predictionSource?: 'historical-table' | 'historical-restaurant' | 'scheduled';
    predictionSampleSize?: number;
    fromServer?: string;
    toServer?: string;
    activeTables?: number;
  };
}

export interface ServiceCopilotRecommendationsResponse {
  recommendations: ServiceCopilotRecommendation[];
}

export type ServiceCopilotTelemetryStatus =
  | 'observed'
  | 'opened'
  | 'applied'
  | 'reverted'
  | 'conflicted'
  | 'expired'
  | 'ignored';

export type ServiceCopilotTelemetryTotals = Record<ServiceCopilotTelemetryStatus, number>;

export interface ServiceCopilotTelemetrySummary {
  from: string;
  to: string;
  totals: ServiceCopilotTelemetryTotals;
  byKind: Array<{
    kind: ServiceCopilotRecommendationKind | string;
    totals: ServiceCopilotTelemetryTotals;
  }>;
}

export type ServiceCopilotPulseStatus = 'calm' | 'attention' | 'urgent';

export interface ServiceCopilotPulse {
  date: string;
  generatedAt: string;
  isLiveDate: boolean;
  status: ServiceCopilotPulseStatus;
  headline: string;
  lateArrivals: number;
  arrivalsToSeat: number;
  arrivalsNext30Minutes: number;
  seatedTables: number;
  pendingWaitingList: number;
  confirmedReservations: number;
}

export interface ServiceCopilotDelayImpact {
  feasible: boolean;
  summary: string;
  delayMinutes: number;
  delayedReservation?: {
    id: string;
    customerName: string;
    originalTableName: string;
    originalStartsAt: string;
    proposedStartsAt: string;
    customerFacingProposedStartsAt?: string;
  };
  alternativeTable?: {
    id: string;
    name: string;
    capacity: number;
    sectionId: string | null;
  };
  waitingListEntry?: {
    id: string;
    customerName: string;
    partySize: number;
    requestedStartsAt: string;
    proposedStartsAt: string;
    proposedEndsAt: string;
    isAvailableNow: boolean;
    customerFacingRequestedStartsAt?: string;
  };
  safeguards: string[];
}

export interface ServiceCommunicationDraft {
  recipient: 'delayed-reservation' | 'waiting-list';
  customerName: string;
  message: string;
  delivery: 'review-required';
  eligibleChannel: 'sms' | 'email' | null;
  deliveryBlocker?: 'no-contact' | 'no-transactional-consent';
  reason: string;
  confidence: 'medium';
}

export interface ServiceCommunicationDraftsResponse {
  impact: ServiceCopilotDelayImpact;
  drafts: ServiceCommunicationDraft[];
}

export type ServiceCopilotDelayRecoveryStatus = 'applied' | 'reverted' | 'blocked';

export interface ServiceCopilotDelayRecoveryHistoryItem {
  operationId: string;
  delayedReservationId: string;
  promotedReservationId: string;
  waitingListEntryId: string;
  delayedCustomerName: string;
  waitingCustomerName: string;
  originalTableName: string;
  alternativeTableName: string;
  delayMinutes: number;
  originalStartsAt: string;
  appliedStartsAt: string;
  appliedAt: string;
  revertedAt?: string;
  status: ServiceCopilotDelayRecoveryStatus;
  revertible: boolean;
  blockedReason?: string;
}

export interface ServiceCopilotDelayRecoveryHistoryResponse {
  recoveries: ServiceCopilotDelayRecoveryHistoryItem[];
}

export type SimulationScenarioType = 'direct' | 'change-section' | 'refuse';

export interface SimulationAction {
  type: 'link' | 'api';
  label: string;
  href?: string;
  method?: 'PATCH' | 'POST';
  path?: string;
  body?: Record<string, unknown>;
}

export interface SimulationMetrics {
  coversGained: number;
  conflictsCreated: number;
  estimatedWaitMinutes: number | null;
  tablesImpacted: string[];
  reservationsToMove: {
    id: string;
    customerName?: string;
    fromTableName?: string;
    toTableName?: string;
    newStartsAt?: string;
  }[];
}

export interface SimulationScenario {
  id: string;
  type: SimulationScenarioType;
  feasible: boolean;
  confidence: 'high' | 'medium' | 'low';
  title: string;
  reason: string;
  actions: SimulationAction[];
  metrics: SimulationMetrics;
  table?: {
    id: string;
    name: string;
    capacity: number;
    sectionId: string | null;
    sectionName?: string | null;
    floorPlanName?: string | null;
  };
  nextAvailableAt?: string;
  nextAvailableSectionId?: string;
}

export interface SimulationResult {
  query: { partySize: number; startsAt: string; endsAt: string };
  feasible: boolean;
  scenarios: SimulationScenario[];
  bestScenarioId?: string;
  explanation: string;
}

// ─── Utilitaire : extraction de message d'erreur ────────────────────────

/**
 * Extrait un message lisible d'une erreur catchée (catch (err: unknown)).
 * Préférez cette fonction à `err.message` direct pour respecter le narrowing.
 */
export function getErrorMessage(err: unknown, fallback = 'Une erreur est survenue'): string {
  if (err instanceof Error) return err.message || fallback;
  if (typeof err === 'string') return err;
  return fallback;
}
