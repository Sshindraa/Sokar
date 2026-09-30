import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { exportGiftCardLedger, giftCardCsvCell } from '../gift-card-export.service';
describe('gift card operational export', () => {
  it('neutralizes formulas and escapes quotes and separators in ticket references', () => {
    expect(giftCardCsvCell(' =HYPERLINK("example")')).toBe('"\' =HYPERLINK(""example"")"');
    expect(giftCardCsvCell('\t=1+1')).toBe('"\'\t=1+1"');
    expect(giftCardCsvCell('Ticket;"42"')).toBe('"Ticket;""42"""');
  });
  it('refuses to present an incomplete export as a full ledger', async () => {
    const prisma = {
      giftCardPaymentEntry: { findMany: vi.fn().mockResolvedValue(Array(5001).fill({})) },
      giftCardRedemption: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;
    expect(
      await exportGiftCardLedger(
        prisma,
        'restaurant',
        new Date('2026-09-01'),
        new Date('2026-10-01'),
      ),
    ).toEqual({ tooLarge: true });
  });
});
