/**
 * Tests for the gift card email service.
 *
 * Chaque fonction :
 *  - skip si l'email du destinataire est manquant (no-op + warn)
 *  - appelle sendEmail avec to + subject + html
 *
 * Le HTML doit contenir les variables interpolées (montant, code,
 * restaurant, etc.) — on assert sur la présence de marqueurs clés.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// setup.ts mocke le service complet avec des no-ops. On le démocke
// pour exécuter la vraie implémentation.
vi.mock('../gift-card-email.service', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    sendSenderReceipt: actual.sendSenderReceipt,
    sendRecipientGiftCard: actual.sendRecipientGiftCard,
    sendRestaurantSaleNotification: actual.sendRestaurantSaleNotification,
    sendContributionConfirmation: actual.sendContributionConfirmation,
    sendCrowdfundingContributionNotification: actual.sendCrowdfundingContributionNotification,
    sendCrowdfundingClosed: actual.sendCrowdfundingClosed,
  };
});

vi.mock('../../../shared/email', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

import { sendEmail } from '../../../shared/email';

type EmailService = typeof import('../gift-card-email.service');
let sendSenderReceipt: EmailService['sendSenderReceipt'];
let sendRecipientGiftCard: EmailService['sendRecipientGiftCard'];
let sendRestaurantSaleNotification: EmailService['sendRestaurantSaleNotification'];
let sendContributionConfirmation: EmailService['sendContributionConfirmation'];
let sendCrowdfundingContributionNotification: EmailService['sendCrowdfundingContributionNotification'];
let sendCrowdfundingClosed: EmailService['sendCrowdfundingClosed'];

beforeAll(async () => {
  const mod = await import('../gift-card-email.service');
  sendSenderReceipt = mod.sendSenderReceipt;
  sendRecipientGiftCard = mod.sendRecipientGiftCard;
  sendRestaurantSaleNotification = mod.sendRestaurantSaleNotification;
  sendContributionConfirmation = mod.sendContributionConfirmation;
  sendCrowdfundingContributionNotification = mod.sendCrowdfundingContributionNotification;
  sendCrowdfundingClosed = mod.sendCrowdfundingClosed;
});

const mockSendEmail = vi.mocked(sendEmail);

const BASE_DATA = {
  giftCardId: 'gc-1',
  code: 'gc_full_long_id_123',
  shortCode: 'SKR-TEST-01',
  amount: 100,
  restaurantName: 'Chez Sokar',
  senderName: 'Alice',
  senderEmail: 'alice@example.com',
  recipientName: 'Bob',
  recipientEmail: 'bob@example.com',
  message: 'Bon anniversaire !',
  occasion: 'Anniversaire',
  pdfUrl: 'https://cdn.example.com/gc-1.pdf',
};

describe('gift-card-email.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendEmail.mockResolvedValue(undefined);
  });

  describe('sendSenderReceipt', () => {
    it('envoie le reçu à senderEmail avec le sujet et le montant', async () => {
      await sendSenderReceipt(BASE_DATA);
      expect(mockSendEmail).toHaveBeenCalledTimes(1);
      const call = mockSendEmail.mock.calls[0]?.[0] as {
        to: string;
        subject: string;
        html: string;
      };
      expect(call.to).toBe('alice@example.com');
      expect(call.subject).toBe('Reçu de votre carte cadeau — Chez Sokar');
      expect(call.html).toContain('100€');
      expect(call.html).toContain('Bob');
      expect(call.html).toContain('Anniversaire');
      expect(call.html).toContain('Bon anniversaire');
    });

    it("n'envoie rien si senderEmail est null (skip + warn)", async () => {
      await sendSenderReceipt({ ...BASE_DATA, senderEmail: null });
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it('omet les lignes occasion et message si elles sont null', async () => {
      await sendSenderReceipt({
        ...BASE_DATA,
        message: null,
        occasion: null,
      });
      const call = mockSendEmail.mock.calls[0]?.[0] as { html: string };
      expect(call.html).not.toContain('Occasion');
      expect(call.html).not.toContain('Message :');
    });
  });

  describe('sendRecipientGiftCard', () => {
    it('envoie la carte cadeau au destinataire avec le shortCode', async () => {
      await sendRecipientGiftCard(BASE_DATA);
      const call = mockSendEmail.mock.calls[0]?.[0] as {
        to: string;
        subject: string;
        html: string;
      };
      expect(call.to).toBe('bob@example.com');
      expect(call.subject).toBe('Vous avez reçu une carte cadeau de 100€ — Chez Sokar');
      expect(call.html).toContain('SKR-TEST-01');
      expect(call.html).toContain('gc_full_long_id_123'); // Référence complète
      expect(call.html).toContain('100€');
      expect(call.html).toContain('Alice');
    });

    it("n'envoie rien si recipientEmail est null", async () => {
      await sendRecipientGiftCard({ ...BASE_DATA, recipientEmail: null });
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it('utilise le code long en fallback si shortCode est null', async () => {
      await sendRecipientGiftCard({ ...BASE_DATA, shortCode: null });
      const call = mockSendEmail.mock.calls[0]?.[0] as { html: string };
      // Le code long apparaît, mais pas de ligne "Référence : <short>"
      expect(call.html).toContain('gc_full_long_id_123');
      expect(call.html).not.toContain('Référence :');
    });

    it('omet le lien PDF si pdfUrl est null', async () => {
      await sendRecipientGiftCard({ ...BASE_DATA, pdfUrl: null });
      const call = mockSendEmail.mock.calls[0]?.[0] as { html: string };
      expect(call.html).not.toContain('Télécharger la carte cadeau');
    });
  });

  describe('sendRestaurantSaleNotification', () => {
    it('envoie la notification au restaurateur avec commission + net', async () => {
      await sendRestaurantSaleNotification({
        restaurantName: 'Chez Sokar',
        restaurantEmail: 'manager@chezsokar.fr',
        amount: 100,
        commissionAmount: 5,
        senderName: 'Alice',
        recipientName: 'Bob',
        giftCardId: 'gc-1',
      });
      const call = mockSendEmail.mock.calls[0]?.[0] as {
        to: string;
        subject: string;
        html: string;
      };
      expect(call.to).toBe('manager@chezsokar.fr');
      expect(call.subject).toBe('Nouvelle vente de carte cadeau — 100€');
      expect(call.html).toContain('100€');
      expect(call.html).toContain('5€'); // commission
      expect(call.html).toContain('95€'); // net
    });

    it("n'envoie rien si restaurantEmail est null", async () => {
      await sendRestaurantSaleNotification({
        restaurantName: 'Chez Sokar',
        restaurantEmail: null,
        amount: 100,
        commissionAmount: 5,
        senderName: null,
        recipientName: null,
        giftCardId: 'gc-1',
      });
      expect(mockSendEmail).not.toHaveBeenCalled();
    });
  });

  describe('sendContributionConfirmation', () => {
    it('envoie la confirmation au contributeur', async () => {
      await sendContributionConfirmation({
        to: 'contrib@example.com',
        contributorName: 'Charlie',
        amount: 25,
        title: 'Cagnotte Bob',
        recipientName: 'Bob',
        restaurantName: 'Chez Sokar',
        code: 'cg-1',
      });
      const call = mockSendEmail.mock.calls[0]?.[0] as {
        to: string;
        subject: string;
        html: string;
      };
      expect(call.to).toBe('contrib@example.com');
      expect(call.subject).toBe('Confirmation de votre contribution — Cagnotte Bob');
      expect(call.html).toContain('25€');
      expect(call.html).toContain('Charlie');
      expect(call.html).toContain('Cagnotte Bob');
    });

    it("skip si l'email est vide", async () => {
      await sendContributionConfirmation({
        to: '',
        contributorName: 'X',
        amount: 10,
        title: 'T',
        recipientName: 'R',
        restaurantName: 'Resto',
        code: 'c',
      });
      expect(mockSendEmail).not.toHaveBeenCalled();
    });
  });

  describe('sendCrowdfundingContributionNotification', () => {
    it('envoie la notif au créateur de la cagnotte', async () => {
      await sendCrowdfundingContributionNotification({
        to: 'creator@example.com',
        creatorName: 'Bob',
        contributorName: 'Alice',
        amount: 30,
        title: 'Cagnotte Bob',
        recipientName: 'Bob',
        restaurantName: 'Chez Sokar',
        code: 'cg-1',
      });
      const call = mockSendEmail.mock.calls[0]?.[0] as {
        to: string;
        subject: string;
        html: string;
      };
      expect(call.to).toBe('creator@example.com');
      expect(call.subject).toBe('Nouvelle contribution — Cagnotte Bob (+30€)');
      expect(call.html).toContain('Alice');
      expect(call.html).toContain('30€');
    });
  });

  describe('sendCrowdfundingClosed', () => {
    it('envoie la carte finale au destinataire avec total + commission + final', async () => {
      await sendCrowdfundingClosed({
        to: 'bob@example.com',
        recipientName: 'Bob',
        title: 'Cagnotte Bob',
        totalCollected: 120,
        commissionAmount: 6,
        finalAmount: 114,
        code: 'cg-full',
        shortCode: 'SKR-TEST-02',
        restaurantName: 'Chez Sokar',
        pdfUrl: 'https://cdn.example.com/cg.pdf',
      });
      const call = mockSendEmail.mock.calls[0]?.[0] as {
        to: string;
        subject: string;
        html: string;
      };
      expect(call.to).toBe('bob@example.com');
      expect(call.subject).toBe('Votre cagnotte est prête — 114€ chez Chez Sokar');
      expect(call.html).toContain('120€'); // total
      expect(call.html).toContain('6€'); // commission
      expect(call.html).toContain('114€'); // final
      expect(call.html).toContain('SKR-TEST-02');
    });
  });
});
