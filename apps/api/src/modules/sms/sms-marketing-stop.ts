import {
  MarketingChannel,
  MarketingMessageStatus,
  MarketingPermissionStatus,
} from '@prisma/client';
import { db } from '../../shared/db/client';
import { logger } from '../../shared/logger/pino';
import { normalizeCustomerPhone } from '../customers/customer-crm.service';
import { registerMarketingOptOut } from '../marketing/marketing-opt-out.service';
import { withdrawMarketingPermission } from '../marketing/marketing-permission.service';

/**
 * STOP reçu par SMS : désinscription marketing uniquement. Ne touche ni aux réservations, ni aux
 * consentements transactionnels, et n'envoie aucun SMS. Le numéro ne dit pas quel restaurant est
 * visé (expéditeur partagé) : on prend celui du dernier SMS marketing accepté à ce numéro.
 */

const STOP_KEYWORDS = new Set(['stop', 'stop sms', 'arret']);

/** Message entier seulement, sans casse, accents ni espaces superflus : « STOP », « ARRÊT »… */
export function isMarketingStopKeyword(text: string): boolean {
  const normalized = text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
  return STOP_KEYWORDS.has(normalized);
}

const ACCEPTED_SMS_STATUSES = [
  MarketingMessageStatus.ACCEPTED,
  MarketingMessageStatus.SENT,
  MarketingMessageStatus.DELIVERED,
];

/**
 * Retire l'accord SMS marketing de ce numéro dans le restaurant du dernier SMS marketing accepté.
 * Retourne false s'il n'y en a aucun : l'appelant garde alors le flux de réponse habituel.
 * Rejouable : une fiche déjà OPTED_OUT n'est plus touchée, et le registre est une écriture idempotente.
 * Lève MARKETING_OPTOUT_REGISTER_UNAVAILABLE si le registre n'a pas pu être écrit.
 */
export async function applyMarketingSmsStop(from: string): Promise<boolean> {
  const phone = normalizeCustomerPhone(from);
  if (!phone) return false;

  const lastMessage = await db.campaignMessage.findFirst({
    where: {
      channel: MarketingChannel.SMS,
      status: { in: ACCEPTED_SMS_STATUSES },
      customer: { phone },
    },
    orderBy: { createdAt: 'desc' },
    select: { campaign: { select: { restaurantId: true } } },
  });
  if (!lastMessage) return false;
  const restaurantId = lastMessage.campaign.restaurantId;

  const customers = await db.customer.findMany({
    where: {
      restaurantId,
      phone,
      archivedAt: null,
      marketingPermissions: {
        none: { channel: MarketingChannel.SMS, status: MarketingPermissionStatus.OPTED_OUT },
      },
    },
    select: { id: true },
  });
  for (const customer of customers) {
    await withdrawMarketingPermission({
      restaurantId,
      customerId: customer.id,
      channel: 'SMS',
      source: 'SMS_STOP',
    });
  }
  // Fiches déjà retirées (rejeu après un échec du registre) : on écrit le registre seul.
  if (customers.length === 0) {
    const outcome = await registerMarketingOptOut({
      restaurantId,
      channel: MarketingChannel.SMS,
      address: phone,
      reason: 'UNSUBSCRIBE',
      source: 'SMS_STOP',
    });
    if (outcome !== 'REGISTERED') throw new Error('MARKETING_OPTOUT_REGISTER_UNAVAILABLE');
  }

  logger.info({ restaurantId, withdrawn: customers.length }, 'marketing sms stop applied');
  return true;
}
