import { describe, expect, it, vi } from 'vitest';
import { ServiceCopilotCommunicationService } from '../service-copilot-communication.service';

describe('ServiceCopilotCommunicationService', () => {
  it('produit uniquement des brouillons à des heures arrondies', async () => {
    const prisma: any = {
      reservation: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ customerPhone: '+33600000000', customerEmail: null }),
      },
      waitingListEntry: {
        findFirst: vi.fn().mockResolvedValue({ customerPhone: null, customerEmail: null }),
      },
      customerConsent: {
        findFirst: vi.fn().mockResolvedValue({ transactionalSms: true, transactionalEmail: false }),
      },
    };
    const drafts = await new ServiceCopilotCommunicationService(prisma).buildDrafts('rest-1', {
      feasible: true,
      delayMinutes: 20,
      summary: 'ok',
      safeguards: [],
      delayedReservation: {
        id: 'r',
        customerName: 'Camille',
        originalTableName: 'T1',
        originalStartsAt: '2026-07-21T20:00:00.000Z',
        proposedStartsAt: '2026-07-21T20:08:00.000Z',
      },
      waitingListEntry: {
        id: 'w',
        customerName: 'Lina',
        partySize: 2,
        requestedStartsAt: '2026-07-21T21:03:00.000Z',
      },
    });
    expect(drafts.map((draft) => draft.message)).toEqual([
      expect.stringContaining('22:10'),
      expect.stringContaining('23:05'),
    ]);
    expect(drafts.every((draft) => draft.delivery === 'review-required')).toBe(true);
    expect(drafts[0].eligibleChannel).toBe('sms');
    expect(drafts[1].deliveryBlocker).toBe('no-contact');
  });
});
