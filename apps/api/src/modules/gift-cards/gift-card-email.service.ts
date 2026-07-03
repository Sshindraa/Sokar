/**
 * Gift card email service — envoi des emails liés à l'achat d'une carte cadeau.
 *
 *   - sendSenderReceipt : reçu de paiement à l'expéditeur
 *   - sendRecipientGiftCard : carte cadeau au destinataire (code + lien PDF)
 *   - sendRestaurantSaleNotification : notification de vente au restaurateur
 *
 * Utilise nodemailer via shared/email.
 */
import { sendEmail } from '../../shared/email';
import { logger } from '../../shared/logger/pino';

type GiftCardEmailData = {
  giftCardId: string;
  code: string;
  amount: number;
  restaurantName: string;
  senderName: string | null;
  senderEmail: string | null;
  recipientName: string | null;
  recipientEmail: string | null;
  message: string | null;
  occasion: string | null;
  pdfUrl: string | null;
};

/**
 * Reçu de paiement envoyé à l'expéditeur.
 */
export async function sendSenderReceipt(data: GiftCardEmailData): Promise<void> {
  if (!data.senderEmail) {
    logger.warn(
      { giftCardId: data.giftCardId },
      '[gift-card-email] sendSenderReceipt: no sender email, skipping',
    );
    return;
  }

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #0F172A;">Reçu de votre achat</h1>
      <p>Bonjour ${data.senderName ?? ''},</p>
      <p>Nous confirmons l'achat de votre carte cadeau chez <strong>${data.restaurantName}</strong>.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">Montant</td>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;"><strong>${data.amount}€</strong></td>
        </tr>
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">Destinataire</td>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;">${data.recipientName ?? ''}</td>
        </tr>
        ${data.occasion ? `<tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">Occasion</td><td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;">${data.occasion}</td></tr>` : ''}
      </table>
      ${data.message ? `<p><em>Message : « ${data.message} »</em></p>` : ''}
      <p>Merci pour votre achat.</p>
      <p style="color: #64748b; font-size: 12px;">Sokar — Plateforme de réservation pour restaurants</p>
    </div>
  `;

  await sendEmail({
    to: data.senderEmail,
    subject: `Reçu de votre carte cadeau — ${data.restaurantName}`,
    html,
  });
}

/**
 * Carte cadeau envoyée au destinataire (code + lien PDF).
 */
export async function sendRecipientGiftCard(data: GiftCardEmailData): Promise<void> {
  if (!data.recipientEmail) {
    logger.warn(
      { giftCardId: data.giftCardId },
      '[gift-card-email] sendRecipientGiftCard: no recipient email, skipping',
    );
    return;
  }

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #0F172A;">Vous avez reçu une carte cadeau ! 🎁</h1>
      <p>Bonjour ${data.recipientName ?? ''},</p>
      <p>${data.senderName ?? "Quelqu'un"} vous offre une carte cadeau de <strong>${data.amount}€</strong> chez <strong>${data.restaurantName}</strong>.</p>
      ${data.message ? `<p><em>« ${data.message} »</em></p>` : ''}
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
        <p style="margin: 0; color: #64748b; font-size: 14px;">Votre code cadeau</p>
        <p style="margin: 8px 0; font-size: 24px; font-weight: bold; letter-spacing: 2px; color: #0F172A;">${data.code}</p>
      </div>
      ${data.pdfUrl ? `<p><a href="${data.pdfUrl}" style="color: #EA580C;">Télécharger la carte cadeau (PDF)</a></p>` : ''}
      <p>Utilisez ce code lors de votre réservation sur le site de ${data.restaurantName}.</p>
      <p style="color: #64748b; font-size: 12px;">Sokar — Plateforme de réservation pour restaurants</p>
    </div>
  `;

  await sendEmail({
    to: data.recipientEmail,
    subject: `Vous avez reçu une carte cadeau de ${data.amount}€ — ${data.restaurantName}`,
    html,
  });
}

/**
 * Notification de vente envoyée au restaurateur (email + SMS via le managerPhone).
 */
export async function sendRestaurantSaleNotification(input: {
  restaurantName: string;
  restaurantEmail: string | null;
  amount: number;
  commissionAmount: number;
  senderName: string | null;
  recipientName: string | null;
  giftCardId: string;
}): Promise<void> {
  if (!input.restaurantEmail) {
    logger.warn(
      { giftCardId: input.giftCardId },
      '[gift-card-email] sendRestaurantSaleNotification: no restaurant email, skipping',
    );
    return;
  }

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #0F172A;">Nouvelle vente de carte cadeau</h1>
      <p>Une carte cadeau a été vendue sur votre restaurant <strong>${input.restaurantName}</strong>.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">Montant vendu</td>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;"><strong>${input.amount}€</strong></td>
        </tr>
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">Commission Sokar</td>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;">${input.commissionAmount}€</td>
        </tr>
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">Net restaurateur</td>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;"><strong>${input.amount - input.commissionAmount}€</strong></td>
        </tr>
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">Expéditeur</td>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;">${input.senderName ?? ''}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">Destinataire</td>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;">${input.recipientName ?? ''}</td>
        </tr>
      </table>
    </div>
  `;

  await sendEmail({
    to: input.restaurantEmail,
    subject: `Nouvelle vente de carte cadeau — ${input.amount}€`,
    html,
  });
}

// ─── P3 — Crowdfunding emails ──────────────────────────────────────

/**
 * Email de confirmation envoyé au contributeur après sa contribution.
 */
export async function sendContributionConfirmation(input: {
  to: string;
  contributorName: string;
  amount: number;
  title: string;
  recipientName: string;
  restaurantName: string;
  code: string;
}): Promise<void> {
  if (!input.to) {
    logger.warn('[gift-card-email] sendContributionConfirmation: no email, skipping');
    return;
  }

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #0F172A;">Merci pour votre contribution ! 🎁</h1>
      <p>Bonjour ${input.contributorName},</p>
      <p>Nous confirmons votre contribution de <strong>${input.amount}€</strong> à la cagnotte
      « <strong>${input.title}</strong> » pour ${input.recipientName} chez ${input.restaurantName}.</p>
      <p>Le créateur de la cagnotte décidera quand la clôturer. À ce moment, le montant total
      collecté sera transformé en carte cadeau utilisable par ${input.recipientName}.</p>
      <p style="color: #64748b; font-size: 12px;">Sokar — Plateforme de réservation pour restaurants</p>
    </div>
  `;

  await sendEmail({
    to: input.to,
    subject: `Confirmation de votre contribution — ${input.title}`,
    html,
  });
}

/**
 * Email envoyé au créateur à chaque nouvelle contribution.
 */
export async function sendCrowdfundingContributionNotification(input: {
  to: string;
  creatorName: string;
  contributorName: string;
  amount: number;
  title: string;
  recipientName: string;
  restaurantName: string;
  code: string;
}): Promise<void> {
  if (!input.to) {
    logger.warn('[gift-card-email] sendCrowdfundingContributionNotification: no email, skipping');
    return;
  }

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #0F172A;">Nouvelle contribution à votre cagnotte ! 🎉</h1>
      <p>Bonjour ${input.creatorName},</p>
      <p><strong>${input.contributorName}</strong> vient de contribuer <strong>${input.amount}€</strong>
      à votre cagnotte « <strong>${input.title}</strong> » pour ${input.recipientName}.</p>
      <p>Vous pouvez clôturer la cagnotte à tout moment depuis votre dashboard Sokar.</p>
      <p style="color: #64748b; font-size: 12px;">Sokar — Plateforme de réservation pour restaurants</p>
    </div>
  `;

  await sendEmail({
    to: input.to,
    subject: `Nouvelle contribution — ${input.title} (+${input.amount}€)`,
    html,
  });
}

/**
 * Email envoyé au destinataire quand la cagnotte est clôturée.
 * Contient le code final de la carte cadeau + le lien PDF.
 */
export async function sendCrowdfundingClosed(input: {
  to: string;
  recipientName: string;
  title: string;
  totalCollected: number;
  commissionAmount: number;
  finalAmount: number;
  code: string;
  restaurantName: string;
  pdfUrl: string;
}): Promise<void> {
  if (!input.to) {
    logger.warn('[gift-card-email] sendCrowdfundingClosed: no email, skipping');
    return;
  }

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #0F172A;">Votre cagnotte est prête ! 🎁</h1>
      <p>Bonjour ${input.recipientName},</p>
      <p>La cagnotte « <strong>${input.title}</strong> » a été clôturée.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">Total collecté</td>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;">${input.totalCollected}€</td>
        </tr>
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">Commission Sokar</td>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;">${input.commissionAmount}€</td>
        </tr>
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">Montant de votre carte cadeau</td>
          <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;"><strong>${input.finalAmount}€</strong></td>
        </tr>
      </table>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
        <p style="margin: 0; color: #64748b; font-size: 14px;">Votre code cadeau</p>
        <p style="margin: 8px 0; font-size: 24px; font-weight: bold; letter-spacing: 2px; color: #0F172A;">${input.code}</p>
      </div>
      <p><a href="${input.pdfUrl}" style="color: #EA580C;">Télécharger la carte cadeau (PDF)</a></p>
      <p>Utilisez ce code lors de votre réservation sur le site de ${input.restaurantName}.</p>
      <p style="color: #64748b; font-size: 12px;">Sokar — Plateforme de réservation pour restaurants</p>
    </div>
  `;

  await sendEmail({
    to: input.to,
    subject: `Votre cagnotte est prête — ${input.finalAmount}€ chez ${input.restaurantName}`,
    html,
  });
}
