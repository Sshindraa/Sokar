import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';

export function giftCardAmountCents(amount: number): number {
  const decimal = new Prisma.Decimal(amount);
  const cents = decimal.mul(100);
  if (!decimal.isFinite() || !cents.isInteger() || cents.lte(0) || cents.gt(99_999_999)) {
    throw new Error(
      'Le montant doit être positif, inférieur à 1 000 000 € et avoir deux décimales au maximum.',
    );
  }
  return cents.toNumber();
}

export function giftCardHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function lockGiftCardPayment(tx: Prisma.TransactionClient, paymentIntentId: string) {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`gift-card-payment:${paymentIntentId}`}, 0))`,
  );
}

export async function lockGiftCard(tx: Prisma.TransactionClient, giftCardId: string) {
  await tx.$executeRaw(Prisma.sql`SELECT id FROM gift_cards WHERE id = ${giftCardId} FOR UPDATE`);
}
