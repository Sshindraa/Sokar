import { DemoRequestStatus, Prisma, type DemoRequest } from '@prisma/client';
import { db } from '../../shared/db/client';
import { sendEmail } from '../../shared/email';

export interface DemoRequestInput {
  idempotencyKey: string;
  establishmentName: string;
  contactEmail: string;
  contactPhone?: string;
  currentTool?: string;
  mainProblem?: string;
  pageVersion: string;
}

export interface CreateDemoRequestResult {
  record: DemoRequest;
  replayed: boolean;
}

function isIdempotencyConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Persiste la demande avant toute notification : un échec d'envoi ne doit jamais faire perdre un
 * prospect. Une même clé d'idempotence renvoie la demande existante (double clic, nouvel essai).
 */
export async function createDemoRequest(input: DemoRequestInput): Promise<CreateDemoRequestResult> {
  try {
    const record = await db.demoRequest.create({ data: input });
    return { record, replayed: false };
  } catch (error) {
    if (isIdempotencyConflict(error)) {
      const existing = await db.demoRequest.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) return { record: existing, replayed: true };
    }
    throw error;
  }
}

function parseRecipients(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((recipient) => recipient.trim())
    .filter(Boolean);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[char] ?? char;
  });
}

/**
 * Notifie l'équipe commerciale via DEMO_REQUEST_NOTIFY_TO. Sans destinataire configuré, rien n'est
 * envoyé et la fonction retourne false. Chaque destinataire est tenté, même si le précédent a échoué.
 * Retourne true seulement si chaque envoi a été accepté explicitement (`outcome` = 'success') : un refus
 * (liste de destinataires de test), un échec, un résultat inconnu ou une exception ne sont pas une notification.
 */
export async function notifyDemoRequest(
  record: Pick<DemoRequest, 'id' | 'establishmentName' | 'contactEmail' | 'contactPhone'>,
): Promise<boolean> {
  const recipients = parseRecipients(process.env.DEMO_REQUEST_NOTIFY_TO);
  if (recipients.length === 0) return false;

  const html = [
    `<p>Nouvelle demande de démonstration (réf. ${escapeHtml(record.id)}).</p>`,
    `<p>Établissement : ${escapeHtml(record.establishmentName)}</p>`,
    `<p>E-mail : ${escapeHtml(record.contactEmail)}</p>`,
    `<p>Téléphone : ${escapeHtml(record.contactPhone ?? 'non renseigné')}</p>`,
  ].join('');

  let allAccepted = true;
  for (const to of recipients) {
    try {
      const result = await sendEmail({
        to,
        subject: 'Nouvelle demande de démonstration Sokar',
        html,
      });
      // Un retour vide ou sans `success` n'est pas une acceptation : on ne renseigne jamais notifiedAt sans preuve.
      if (result?.outcome !== 'success') allAccepted = false;
    } catch {
      allAccepted = false;
    }
  }
  return allAccepted;
}

export async function markDemoRequestNotified(id: string): Promise<void> {
  await db.demoRequest.update({ where: { id }, data: { notifiedAt: new Date() } });
}

export async function listDemoRequests(filter: {
  status?: DemoRequestStatus;
  limit: number;
}): Promise<DemoRequest[]> {
  return db.demoRequest.findMany({
    where: filter.status ? { status: filter.status } : {},
    orderBy: { createdAt: 'desc' },
    take: filter.limit,
  });
}

/** Le premier passage à CONTACTED ou DEMO_DONE horodate l'étape ; les passages suivants la conservent. */
export async function updateDemoRequestStatus(
  id: string,
  status: DemoRequestStatus,
): Promise<DemoRequest | null> {
  const current = await db.demoRequest.findUnique({ where: { id } });
  if (!current) return null;

  const now = new Date();
  const timestamps: { contactedAt?: Date; demoDoneAt?: Date } = {};
  if (status === 'CONTACTED' && !current.contactedAt) timestamps.contactedAt = now;
  if (status === 'DEMO_DONE' && !current.demoDoneAt) timestamps.demoDoneAt = now;

  return db.demoRequest.update({ where: { id }, data: { status, ...timestamps } });
}
