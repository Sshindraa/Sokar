import type { PrismaClient } from '@prisma/client';

// Quote every cell and neutralize spreadsheet formulas in user-entered ticket references.
export function giftCardCsvCell(value: string | number | null): string {
  let text = value === null ? '' : String(value);
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export async function exportGiftCardLedger(
  prisma: PrismaClient,
  restaurantId: string,
  from: Date,
  until: Date,
) {
  const limit = 5000;
  const [payments, redemptions] = await Promise.all([
    prisma.giftCardPaymentEntry.findMany({
      where: { restaurantId, createdAt: { gte: from, lt: until } },
      orderBy: [{ createdAt: 'asc' }, { paymentIntentId: 'asc' }],
      take: limit + 1,
    }),
    prisma.giftCardRedemption.findMany({
      where: { giftCard: { restaurantId }, redeemedAt: { gte: from, lt: until } },
      orderBy: [{ redeemedAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    }),
  ]);
  // Never return a partial export silently: the operator must narrow the date range.
  if (payments.length > limit || redemptions.length > limit) return { tooLarge: true as const };
  const rows: (string | number | null)[][] = [
    [
      'Type',
      'Date UTC',
      'Carte',
      'Référence',
      'Montant EUR',
      'Remboursé EUR à ce jour',
      'Addition EUR',
      'Complément EUR',
      'Solde après EUR',
    ],
  ];
  for (const row of payments)
    rows.push([
      'PAIEMENT',
      row.createdAt.toISOString(),
      row.giftCardId,
      row.paymentIntentId,
      (row.amountCents / 100).toFixed(2),
      (row.refundedAmountCents / 100).toFixed(2),
      null,
      null,
      null,
    ]);
  for (const row of redemptions)
    rows.push([
      'DEBIT',
      row.redeemedAt.toISOString(),
      row.giftCardId,
      row.ticketReference,
      row.amount.toFixed(2),
      null,
      row.billAmount?.toFixed(2) ?? null,
      row.complementAmount?.toFixed(2) ?? null,
      row.balanceAfter?.toFixed(2) ?? null,
    ]);
  return {
    tooLarge: false as const,
    csv: '\uFEFF' + rows.map((row) => row.map(giftCardCsvCell).join(';')).join('\r\n'),
    filename: `cartes-cadeaux-${from.toISOString().slice(0, 10)}-${new Date(until.getTime() - 1).toISOString().slice(0, 10)}.csv`,
    rowCount: rows.length - 1,
  };
}
