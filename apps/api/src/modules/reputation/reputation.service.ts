import { randomBytes, createHash } from 'node:crypto';
import {
  Prisma,
  ReputationFeedbackChannel,
  ReputationFeedbackRequestStatus,
  ReputationRecoveryPriority,
  ReputationRecoveryTaskStatus,
  ReservationState,
} from '@prisma/client';
import { db } from '../../shared/db/client';

export const REPUTATION_FEEDBACK_CHANNELS = ['SMS', 'EMAIL', 'WHATSAPP'] as const;
export type ReputationFeedbackChannelCode = (typeof REPUTATION_FEEDBACK_CHANNELS)[number];

export const REPUTATION_RECOVERY_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'RESOLVED',
  'DISMISSED',
] as const;
export type ReputationRecoveryTaskStatusCode = (typeof REPUTATION_RECOVERY_STATUSES)[number];

const DEFAULT_FEEDBACK_TTL_HOURS = 168;
const MAX_FEEDBACK_TTL_HOURS = 720;
const MAX_FEEDBACK_COMMENT_LENGTH = 2_000;
const MAX_LIST_LIMIT = 100;
const HASH_PREFIX = 'sokar:reputation-feedback:';

const REQUEST_SELECT = {
  id: true,
  restaurantId: true,
  reservationId: true,
  customerId: true,
  channel: true,
  status: true,
  expiresAt: true,
  requestedAt: true,
  sentAt: true,
  submittedAt: true,
  createdAt: true,
  updatedAt: true,
  feedback: {
    select: { id: true, score: true, comment: true, submittedAt: true },
  },
} as const;

const FEEDBACK_SELECT = {
  id: true,
  requestId: true,
  restaurantId: true,
  reservationId: true,
  customerId: true,
  score: true,
  comment: true,
  submittedAt: true,
  createdAt: true,
} as const;

const RECOVERY_SELECT = {
  id: true,
  feedbackId: true,
  restaurantId: true,
  reservationId: true,
  customerId: true,
  status: true,
  priority: true,
  assignedToHash: true,
  resolutionCode: true,
  resolutionNote: true,
  resolvedAt: true,
  createdAt: true,
  updatedAt: true,
  feedback: {
    select: { id: true, score: true, comment: true, submittedAt: true },
  },
} as const;

type RequestRow = Prisma.ReputationFeedbackRequestGetPayload<{ select: typeof REQUEST_SELECT }>;
type FeedbackRow = Prisma.ReputationFeedbackGetPayload<{ select: typeof FEEDBACK_SELECT }>;
type RecoveryRow = Prisma.ReputationRecoveryTaskGetPayload<{ select: typeof RECOVERY_SELECT }>;

export class ReputationInputError extends Error {
  constructor(
    readonly code:
      | 'REPUTATION_CHANNEL_INVALID'
      | 'REPUTATION_TTL_INVALID'
      | 'REPUTATION_SCORE_INVALID'
      | 'REPUTATION_COMMENT_INVALID'
      | 'REPUTATION_TOKEN_INVALID'
      | 'REPUTATION_STATUS_INVALID'
      | 'REPUTATION_RESOLUTION_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'ReputationInputError';
  }
}

export class ReputationSiteUnavailableError extends Error {
  readonly code = 'REPUTATION_SITE_UNAVAILABLE';

  constructor() {
    super('The restaurant is not available for reputation feedback');
    this.name = 'ReputationSiteUnavailableError';
  }
}

export class ReputationReservationNotFoundError extends Error {
  readonly code = 'REPUTATION_RESERVATION_NOT_FOUND';

  constructor() {
    super('The honoured reservation could not be found');
    this.name = 'ReputationReservationNotFoundError';
  }
}

export class ReputationCustomerNotFoundError extends Error {
  readonly code = 'REPUTATION_CUSTOMER_NOT_FOUND';

  constructor() {
    super('The reservation has no active customer');
    this.name = 'ReputationCustomerNotFoundError';
  }
}

export class ReputationFeedbackRequestNotFoundError extends Error {
  readonly code = 'REPUTATION_FEEDBACK_REQUEST_NOT_FOUND';

  constructor() {
    super('Feedback request not found');
    this.name = 'ReputationFeedbackRequestNotFoundError';
  }
}

export class ReputationFeedbackNotFoundError extends Error {
  readonly code = 'REPUTATION_FEEDBACK_NOT_FOUND';

  constructor() {
    super('Feedback not found');
    this.name = 'ReputationFeedbackNotFoundError';
  }
}

export class ReputationRecoveryTaskNotFoundError extends Error {
  readonly code = 'REPUTATION_RECOVERY_TASK_NOT_FOUND';

  constructor() {
    super('Recovery task not found');
    this.name = 'ReputationRecoveryTaskNotFoundError';
  }
}

export class ReputationFeedbackStateError extends Error {
  constructor(
    readonly code:
      | 'REPUTATION_FEEDBACK_ALREADY_SUBMITTED'
      | 'REPUTATION_FEEDBACK_EXPIRED'
      | 'REPUTATION_FEEDBACK_CANCELLED'
      | 'REPUTATION_RECOVERY_TRANSITION_INVALID',
  ) {
    super(
      code === 'REPUTATION_FEEDBACK_ALREADY_SUBMITTED'
        ? 'Feedback has already been submitted'
        : code === 'REPUTATION_FEEDBACK_EXPIRED'
          ? 'Feedback request has expired'
          : code === 'REPUTATION_FEEDBACK_CANCELLED'
            ? 'Feedback request has been cancelled'
            : 'Recovery task transition is not allowed',
    );
    this.name = 'ReputationFeedbackStateError';
  }
}

export interface ReputationFeedbackRequestView {
  id: string;
  restaurantId: string;
  reservationId: string;
  customerId: string;
  channel: ReputationFeedbackChannel;
  status: ReputationFeedbackRequestStatus;
  expiresAt: Date;
  requestedAt: Date;
  sentAt: Date | null;
  submittedAt: Date | null;
  feedbackSubmitted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReputationFeedbackRequestCreateResult extends ReputationFeedbackRequestView {
  token: string | null;
  providerContacted: false;
  dryRun: true;
  replayed: boolean;
}

export interface ReputationFeedbackView {
  id: string;
  requestId: string;
  restaurantId: string;
  reservationId: string;
  customerId: string;
  score: number;
  comment: string | null;
  submittedAt: Date;
  createdAt: Date;
}

export interface ReputationRecoveryTaskView {
  id: string;
  feedbackId: string;
  restaurantId: string;
  reservationId: string;
  customerId: string;
  status: ReputationRecoveryTaskStatus;
  priority: ReputationRecoveryPriority;
  assigned: boolean;
  resolutionCode: string | null;
  resolutionNote: string | null;
  resolvedAt: Date | null;
  score: number;
  comment: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReputationFeedbackSubmissionResult {
  feedback: ReputationFeedbackView;
  recoveryTask: ReputationRecoveryTaskView | null;
  replayed: boolean;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function normalizeChannel(value: ReputationFeedbackChannelCode): ReputationFeedbackChannel {
  if (!(REPUTATION_FEEDBACK_CHANNELS as readonly string[]).includes(value)) {
    throw new ReputationInputError(
      'REPUTATION_CHANNEL_INVALID',
      'Le canal de retour doit être SMS, email ou WhatsApp.',
    );
  }
  return value as ReputationFeedbackChannel;
}

function normalizeTtlHours(value: number | undefined): number {
  const hours = value ?? DEFAULT_FEEDBACK_TTL_HOURS;
  if (!Number.isInteger(hours) || hours < 1 || hours > MAX_FEEDBACK_TTL_HOURS) {
    throw new ReputationInputError(
      'REPUTATION_TTL_INVALID',
      `La durée de validité doit être comprise entre 1 et ${MAX_FEEDBACK_TTL_HOURS} heures.`,
    );
  }
  return hours;
}

function normalizeScore(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new ReputationInputError(
      'REPUTATION_SCORE_INVALID',
      'La note doit être un entier compris entre 1 et 5.',
    );
  }
  return value;
}

function normalizeComment(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const comment = value.trim();
  if (
    comment.length > MAX_FEEDBACK_COMMENT_LENGTH ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(comment)
  ) {
    throw new ReputationInputError(
      'REPUTATION_COMMENT_INVALID',
      `Le commentaire doit contenir au plus ${MAX_FEEDBACK_COMMENT_LENGTH} caractères sans caractères de contrôle.`,
    );
  }
  return comment || null;
}

function normalizeToken(value: string): string {
  const token = value.trim();
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(token)) {
    throw new ReputationInputError(
      'REPUTATION_TOKEN_INVALID',
      'Le lien de retour est invalide ou expiré.',
    );
  }
  return token;
}

function normalizeStatus(value: ReputationRecoveryTaskStatusCode): ReputationRecoveryTaskStatus {
  if (!(REPUTATION_RECOVERY_STATUSES as readonly string[]).includes(value)) {
    throw new ReputationInputError(
      'REPUTATION_STATUS_INVALID',
      'Le statut de récupération est invalide.',
    );
  }
  return value as ReputationRecoveryTaskStatus;
}

function normalizeResolutionCode(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.trim() === '') return null;
  const code = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_.-]{1,31}$/.test(code)) {
    throw new ReputationInputError(
      'REPUTATION_RESOLUTION_INVALID',
      'Le code de résolution est invalide.',
    );
  }
  return code;
}

function normalizeResolutionNote(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const note = value.trim();
  if (
    note.length > MAX_FEEDBACK_COMMENT_LENGTH ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(note)
  ) {
    throw new ReputationInputError(
      'REPUTATION_RESOLUTION_INVALID',
      `La note de résolution doit contenir au plus ${MAX_FEEDBACK_COMMENT_LENGTH} caractères sûrs.`,
    );
  }
  return note || null;
}

function hashToken(token: string): string {
  return createHash('sha256').update(`${HASH_PREFIX}${token}`).digest('hex');
}

function createToken(): string {
  return randomBytes(32).toString('base64url');
}

function validDate(value: Date | undefined, field: string): Date {
  const date = value ?? new Date();
  if (Number.isNaN(date.getTime()))
    throw new ReputationInputError('REPUTATION_TTL_INVALID', `${field} est invalide.`);
  return date;
}

async function assertActiveRestaurant(restaurantId: string): Promise<void> {
  const restaurant = await db.restaurant.findUnique({
    where: { id: restaurantId },
    select: { id: true, siteStatus: true },
  });
  if (
    !restaurant ||
    restaurant.siteStatus === 'ARCHIVED' ||
    restaurant.siteStatus === 'SUSPENDED'
  ) {
    throw new ReputationSiteUnavailableError();
  }
}

function toRequestView(row: RequestRow): ReputationFeedbackRequestView {
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    reservationId: row.reservationId,
    customerId: row.customerId,
    channel: row.channel,
    status: row.status,
    expiresAt: row.expiresAt,
    requestedAt: row.requestedAt,
    sentAt: row.sentAt,
    submittedAt: row.submittedAt,
    feedbackSubmitted: Boolean(row.feedback),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toFeedbackView(row: FeedbackRow): ReputationFeedbackView {
  return {
    id: row.id,
    requestId: row.requestId,
    restaurantId: row.restaurantId,
    reservationId: row.reservationId,
    customerId: row.customerId,
    score: row.score,
    comment: row.comment,
    submittedAt: row.submittedAt,
    createdAt: row.createdAt,
  };
}

function toRecoveryView(row: RecoveryRow): ReputationRecoveryTaskView {
  return {
    id: row.id,
    feedbackId: row.feedbackId,
    restaurantId: row.restaurantId,
    reservationId: row.reservationId,
    customerId: row.customerId,
    status: row.status,
    priority: row.priority,
    assigned: Boolean(row.assignedToHash),
    resolutionCode: row.resolutionCode,
    resolutionNote: row.resolutionNote,
    resolvedAt: row.resolvedAt,
    score: row.feedback.score,
    comment: row.feedback.comment,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createReputationFeedbackRequest(args: {
  restaurantId: string;
  reservationId: string;
  channel: ReputationFeedbackChannelCode;
  expiresInHours?: number;
  now?: Date;
}): Promise<ReputationFeedbackRequestCreateResult> {
  await assertActiveRestaurant(args.restaurantId);
  const now = validDate(args.now, 'now');
  const channel = normalizeChannel(args.channel);
  const ttlHours = normalizeTtlHours(args.expiresInHours);

  const reservation = await db.reservation.findFirst({
    where: { id: args.reservationId, restaurantId: args.restaurantId },
    select: { id: true, state: true, customerId: true },
  });
  if (!reservation) throw new ReputationReservationNotFoundError();
  if (reservation.state !== ReservationState.HONORED) {
    throw new ReputationReservationNotFoundError();
  }
  if (!reservation.customerId) throw new ReputationCustomerNotFoundError();

  const customer = await db.customer.findFirst({
    where: { id: reservation.customerId, restaurantId: args.restaurantId, archivedAt: null },
    select: { id: true },
  });
  if (!customer) throw new ReputationCustomerNotFoundError();

  const existing = await db.reputationFeedbackRequest.findUnique({
    where: { reservationId: args.reservationId },
    select: REQUEST_SELECT,
  });
  if (existing) {
    if (existing.restaurantId !== args.restaurantId)
      throw new ReputationFeedbackRequestNotFoundError();
    return {
      ...toRequestView(existing),
      token: null,
      providerContacted: false,
      dryRun: true,
      replayed: true,
    };
  }

  const token = createToken();
  const expiresAt = new Date(now.getTime() + ttlHours * 3_600_000);
  try {
    const created = await db.reputationFeedbackRequest.create({
      data: {
        restaurantId: args.restaurantId,
        reservationId: args.reservationId,
        customerId: customer.id,
        channel,
        status: ReputationFeedbackRequestStatus.PENDING,
        tokenHash: hashToken(token),
        expiresAt,
        requestedAt: now,
      },
      select: REQUEST_SELECT,
    });
    return {
      ...toRequestView(created),
      token,
      providerContacted: false,
      dryRun: true,
      replayed: false,
    };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await db.reputationFeedbackRequest.findUnique({
      where: { reservationId: args.reservationId },
      select: REQUEST_SELECT,
    });
    if (!raced || raced.restaurantId !== args.restaurantId) {
      throw new ReputationFeedbackRequestNotFoundError();
    }
    return {
      ...toRequestView(raced),
      token: null,
      providerContacted: false,
      dryRun: true,
      replayed: true,
    };
  }
}

export async function getReputationFeedbackRequest(args: {
  restaurantId: string;
  requestId: string;
}): Promise<ReputationFeedbackRequestView> {
  await assertActiveRestaurant(args.restaurantId);
  const row = await db.reputationFeedbackRequest.findFirst({
    where: { id: args.requestId, restaurantId: args.restaurantId },
    select: REQUEST_SELECT,
  });
  if (!row) throw new ReputationFeedbackRequestNotFoundError();
  return toRequestView(row);
}

export async function listReputationFeedbackRequests(args: {
  restaurantId: string;
  status?: ReputationFeedbackRequestStatus;
  limit?: number;
}): Promise<ReputationFeedbackRequestView[]> {
  await assertActiveRestaurant(args.restaurantId);
  const limit = Math.min(Math.max(args.limit ?? 50, 1), MAX_LIST_LIMIT);
  const rows = await db.reputationFeedbackRequest.findMany({
    where: { restaurantId: args.restaurantId, ...(args.status ? { status: args.status } : {}) },
    orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
    take: limit,
    select: REQUEST_SELECT,
  });
  return rows.map(toRequestView);
}

export async function markReputationFeedbackRequestSent(args: {
  restaurantId: string;
  requestId: string;
  sentAt?: Date;
}): Promise<ReputationFeedbackRequestView> {
  const sentAt = validDate(args.sentAt, 'sentAt');
  const existing = await db.reputationFeedbackRequest.findFirst({
    where: { id: args.requestId, restaurantId: args.restaurantId },
    select: REQUEST_SELECT,
  });
  if (!existing) throw new ReputationFeedbackRequestNotFoundError();
  if (existing.status === ReputationFeedbackRequestStatus.SUBMITTED) return toRequestView(existing);
  if (
    existing.status === ReputationFeedbackRequestStatus.EXPIRED ||
    existing.status === ReputationFeedbackRequestStatus.CANCELLED
  ) {
    throw new ReputationFeedbackStateError(
      existing.status === ReputationFeedbackRequestStatus.EXPIRED
        ? 'REPUTATION_FEEDBACK_EXPIRED'
        : 'REPUTATION_FEEDBACK_CANCELLED',
    );
  }
  const updated = await db.reputationFeedbackRequest.update({
    where: { id: existing.id },
    data: { status: ReputationFeedbackRequestStatus.SENT, sentAt },
    select: REQUEST_SELECT,
  });
  return toRequestView(updated);
}

export async function submitReputationFeedback(args: {
  token: string;
  score: number;
  comment?: string | null;
  now?: Date;
}): Promise<ReputationFeedbackSubmissionResult> {
  const token = normalizeToken(args.token);
  const score = normalizeScore(args.score);
  const comment = normalizeComment(args.comment);
  const now = validDate(args.now, 'now');
  const tokenHash = hashToken(token);

  const request = await db.reputationFeedbackRequest.findUnique({
    where: { tokenHash },
    select: REQUEST_SELECT,
  });
  if (!request) throw new ReputationFeedbackRequestNotFoundError();
  if (request.status === ReputationFeedbackRequestStatus.SUBMITTED && request.feedback) {
    const feedback = await db.reputationFeedback.findUnique({
      where: { id: request.feedback.id },
      select: FEEDBACK_SELECT,
    });
    if (!feedback) throw new ReputationFeedbackNotFoundError();
    const recovery = await db.reputationRecoveryTask.findUnique({
      where: { feedbackId: feedback.id },
      select: RECOVERY_SELECT,
    });
    return {
      feedback: toFeedbackView(feedback),
      recoveryTask: recovery ? toRecoveryView(recovery) : null,
      replayed: true,
    };
  }
  if (request.status === ReputationFeedbackRequestStatus.CANCELLED) {
    throw new ReputationFeedbackStateError('REPUTATION_FEEDBACK_CANCELLED');
  }
  if (request.status === ReputationFeedbackRequestStatus.EXPIRED || request.expiresAt <= now) {
    if (request.status !== ReputationFeedbackRequestStatus.EXPIRED) {
      await db.reputationFeedbackRequest.updateMany({
        where: {
          id: request.id,
          status: {
            in: [ReputationFeedbackRequestStatus.PENDING, ReputationFeedbackRequestStatus.SENT],
          },
        },
        data: { status: ReputationFeedbackRequestStatus.EXPIRED },
      });
    }
    throw new ReputationFeedbackStateError('REPUTATION_FEEDBACK_EXPIRED');
  }

  try {
    return await db.$transaction(async (tx) => {
      const current = await tx.reputationFeedbackRequest.findUnique({
        where: { id: request.id },
        select: REQUEST_SELECT,
      });
      if (!current) throw new ReputationFeedbackRequestNotFoundError();
      if (current.status === ReputationFeedbackRequestStatus.SUBMITTED && current.feedback) {
        const replayed = await tx.reputationFeedback.findUnique({
          where: { id: current.feedback.id },
          select: FEEDBACK_SELECT,
        });
        if (!replayed) throw new ReputationFeedbackNotFoundError();
        const recovery = await tx.reputationRecoveryTask.findUnique({
          where: { feedbackId: replayed.id },
          select: RECOVERY_SELECT,
        });
        return {
          feedback: toFeedbackView(replayed),
          recoveryTask: recovery ? toRecoveryView(recovery) : null,
          replayed: true,
        };
      }
      if (current.status === ReputationFeedbackRequestStatus.CANCELLED) {
        throw new ReputationFeedbackStateError('REPUTATION_FEEDBACK_CANCELLED');
      }
      if (current.status === ReputationFeedbackRequestStatus.EXPIRED || current.expiresAt <= now) {
        throw new ReputationFeedbackStateError('REPUTATION_FEEDBACK_EXPIRED');
      }

      const feedback = await tx.reputationFeedback.create({
        data: {
          requestId: current.id,
          restaurantId: current.restaurantId,
          reservationId: current.reservationId,
          customerId: current.customerId,
          score,
          comment,
          submittedAt: now,
        },
        select: FEEDBACK_SELECT,
      });
      await tx.reputationFeedbackRequest.update({
        where: { id: current.id },
        data: { status: ReputationFeedbackRequestStatus.SUBMITTED, submittedAt: now },
      });

      let recoveryTask: ReputationRecoveryTaskView | null = null;
      if (score <= 2) {
        const recovery = await tx.reputationRecoveryTask.create({
          data: {
            feedbackId: feedback.id,
            restaurantId: feedback.restaurantId,
            reservationId: feedback.reservationId,
            customerId: feedback.customerId,
            priority:
              score === 1 ? ReputationRecoveryPriority.HIGH : ReputationRecoveryPriority.NORMAL,
            status: ReputationRecoveryTaskStatus.OPEN,
          },
          select: RECOVERY_SELECT,
        });
        recoveryTask = toRecoveryView(recovery);
      }
      return { feedback: toFeedbackView(feedback), recoveryTask, replayed: false };
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const replayed = await db.reputationFeedbackRequest.findUnique({
      where: { tokenHash },
      select: REQUEST_SELECT,
    });
    if (!replayed?.feedback) throw new ReputationFeedbackNotFoundError();
    const feedback = await db.reputationFeedback.findUnique({
      where: { id: replayed.feedback.id },
      select: FEEDBACK_SELECT,
    });
    if (!feedback) throw new ReputationFeedbackNotFoundError();
    const recovery = await db.reputationRecoveryTask.findUnique({
      where: { feedbackId: feedback.id },
      select: RECOVERY_SELECT,
    });
    return {
      feedback: toFeedbackView(feedback),
      recoveryTask: recovery ? toRecoveryView(recovery) : null,
      replayed: true,
    };
  }
}

export async function listReputationFeedback(args: {
  restaurantId: string;
  minScore?: number;
  limit?: number;
}): Promise<ReputationFeedbackView[]> {
  await assertActiveRestaurant(args.restaurantId);
  const limit = Math.min(Math.max(args.limit ?? 50, 1), MAX_LIST_LIMIT);
  const rows = await db.reputationFeedback.findMany({
    where: {
      restaurantId: args.restaurantId,
      ...(args.minScore === undefined ? {} : { score: { gte: normalizeScore(args.minScore) } }),
    },
    orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
    take: limit,
    select: FEEDBACK_SELECT,
  });
  return rows.map(toFeedbackView);
}

export async function listReputationRecoveryTasks(args: {
  restaurantId: string;
  status?: ReputationRecoveryTaskStatusCode;
  limit?: number;
}): Promise<ReputationRecoveryTaskView[]> {
  await assertActiveRestaurant(args.restaurantId);
  const limit = Math.min(Math.max(args.limit ?? 50, 1), MAX_LIST_LIMIT);
  const rows = await db.reputationRecoveryTask.findMany({
    where: {
      restaurantId: args.restaurantId,
      ...(args.status ? { status: normalizeStatus(args.status) } : {}),
    },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    take: limit,
    select: RECOVERY_SELECT,
  });
  return rows.map(toRecoveryView);
}

function assertRecoveryTransition(
  current: ReputationRecoveryTaskStatus,
  next: ReputationRecoveryTaskStatus,
): void {
  const allowed: Record<ReputationRecoveryTaskStatus, readonly ReputationRecoveryTaskStatus[]> = {
    [ReputationRecoveryTaskStatus.OPEN]: [
      ReputationRecoveryTaskStatus.IN_PROGRESS,
      ReputationRecoveryTaskStatus.RESOLVED,
      ReputationRecoveryTaskStatus.DISMISSED,
    ],
    [ReputationRecoveryTaskStatus.IN_PROGRESS]: [
      ReputationRecoveryTaskStatus.OPEN,
      ReputationRecoveryTaskStatus.RESOLVED,
      ReputationRecoveryTaskStatus.DISMISSED,
    ],
    [ReputationRecoveryTaskStatus.RESOLVED]: [],
    [ReputationRecoveryTaskStatus.DISMISSED]: [],
  };
  if (current !== next && !allowed[current].includes(next)) {
    throw new ReputationFeedbackStateError('REPUTATION_RECOVERY_TRANSITION_INVALID');
  }
}

export async function updateReputationRecoveryTask(args: {
  restaurantId: string;
  taskId: string;
  status: ReputationRecoveryTaskStatusCode;
  resolutionCode?: string | null;
  resolutionNote?: string | null;
  actor?: string;
  now?: Date;
}): Promise<ReputationRecoveryTaskView> {
  await assertActiveRestaurant(args.restaurantId);
  const status = normalizeStatus(args.status);
  const resolutionCode = normalizeResolutionCode(args.resolutionCode);
  const resolutionNote = normalizeResolutionNote(args.resolutionNote);
  const now = validDate(args.now, 'now');
  if (
    (status === ReputationRecoveryTaskStatus.RESOLVED ||
      status === ReputationRecoveryTaskStatus.DISMISSED) &&
    !resolutionCode
  ) {
    throw new ReputationInputError(
      'REPUTATION_RESOLUTION_INVALID',
      'Un code de résolution est requis pour clôturer une action.',
    );
  }
  const actorHash = args.actor?.trim()
    ? createHash('sha256').update(`sokar:reputation-recovery:${args.actor.trim()}`).digest('hex')
    : null;

  return db.$transaction(async (tx) => {
    const current = await tx.reputationRecoveryTask.findFirst({
      where: { id: args.taskId, restaurantId: args.restaurantId },
      select: RECOVERY_SELECT,
    });
    if (!current) throw new ReputationRecoveryTaskNotFoundError();
    assertRecoveryTransition(current.status, status);
    const updated = await tx.reputationRecoveryTask.update({
      where: { id: current.id },
      data: {
        status,
        ...(status === ReputationRecoveryTaskStatus.IN_PROGRESS && actorHash
          ? { assignedToHash: actorHash }
          : {}),
        ...(resolutionCode !== undefined ? { resolutionCode } : {}),
        ...(resolutionNote !== undefined ? { resolutionNote } : {}),
        resolvedAt:
          status === ReputationRecoveryTaskStatus.RESOLVED ||
          status === ReputationRecoveryTaskStatus.DISMISSED
            ? now
            : null,
      },
      select: RECOVERY_SELECT,
    });
    return toRecoveryView(updated);
  });
}

export async function expireReputationFeedbackRequests(args: {
  now?: Date;
  limit?: number;
}): Promise<number> {
  const now = validDate(args.now, 'now');
  const limit = Math.min(Math.max(args.limit ?? 500, 1), 5_000);
  const rows = await db.reputationFeedbackRequest.findMany({
    where: {
      status: {
        in: [ReputationFeedbackRequestStatus.PENDING, ReputationFeedbackRequestStatus.SENT],
      },
      expiresAt: { lte: now },
    },
    select: { id: true },
    orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
    take: limit,
  });
  if (rows.length === 0) return 0;
  const result = await db.reputationFeedbackRequest.updateMany({
    where: {
      id: { in: rows.map((row) => row.id) },
      status: {
        in: [ReputationFeedbackRequestStatus.PENDING, ReputationFeedbackRequestStatus.SENT],
      },
    },
    data: { status: ReputationFeedbackRequestStatus.EXPIRED },
  });
  return result.count;
}

export const reputationInternals = {
  hashToken,
  normalizeComment,
  normalizeResolutionCode,
  normalizeResolutionNote,
  normalizeToken,
};
