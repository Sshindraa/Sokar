/**
 * Gift card PDF service — génère un PDF de la carte cadeau.
 *
 * Utilise pdfkit pour générer un PDF avec :
 *   - Nom du restaurant
 *   - Montant
 *   - Code cadeau
 *   - Template/image de personnalisation (optionnel)
 *
 * Le QR code est optionnel en P2 (non implémenté ici).
 */
import PDFDocument from 'pdfkit';
import type { GiftCard } from '@prisma/client';

type GiftCardWithRelations = GiftCard & {
  restaurant?: { name: string } | null;
  pack?: { name: string } | null;
};

/**
 * Génère un PDF de la carte cadeau et retourne le buffer.
 */
export async function generateGiftCardPdf(card: GiftCardWithRelations): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A6', margin: 40 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const restaurantName = card.restaurant?.name ?? 'Restaurant';
    const amount = card.amount.toNumber();
    const code = card.code;

    // Fond
    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#f8fafc');

    // Bordure
    doc
      .rect(20, 20, doc.page.width - 40, doc.page.height - 40)
      .lineWidth(2)
      .strokeColor('#EA580C')
      .stroke();

    // Nom du restaurant
    doc
      .fontSize(16)
      .fillColor('#0F172A')
      .font('Helvetica-Bold')
      .text(restaurantName, { align: 'center' });

    // Montant
    doc.moveDown(1.5);
    doc
      .fontSize(36)
      .fillColor('#EA580C')
      .font('Helvetica-Bold')
      .text(`${amount}€`, { align: 'center' });

    doc.moveDown(0.5);
    doc.fontSize(12).fillColor('#64748b').font('Helvetica').text('Carte cadeau', {
      align: 'center',
    });

    // Code cadeau
    doc.moveDown(2);
    doc
      .fontSize(10)
      .fillColor('#64748b')
      .font('Helvetica')
      .text('Code cadeau', { align: 'center' });
    doc.fontSize(14).fillColor('#0F172A').font('Courier-Bold').text(code, { align: 'center' });

    // Message personnalisé
    if (card.message) {
      doc.moveDown(1.5);
      doc
        .fontSize(9)
        .fillColor('#64748b')
        .font('Helvetica-Oblique')
        .text(`« ${card.message} »`, { align: 'center' });
    }

    // Occasion
    if (card.occasion) {
      doc.moveDown(0.5);
      doc
        .fontSize(9)
        .fillColor('#94a3b8')
        .font('Helvetica')
        .text(card.occasion, { align: 'center' });
    }

    // Expéditeur / Destinataire
    doc.moveDown(1.5);
    if (card.senderName || card.recipientName) {
      const fromText = card.senderName ? `De : ${card.senderName}` : '';
      const toText = card.recipientName ? `Pour : ${card.recipientName}` : '';
      doc
        .fontSize(9)
        .fillColor('#64748b')
        .font('Helvetica')
        .text([fromText, toText].filter(Boolean).join('  •  '), { align: 'center' });
    }

    // Validité
    doc.moveDown(1);
    const expiryText = card.expiresAt
      ? `Valable jusqu'au ${new Date(card.expiresAt).toLocaleDateString('fr-FR')}`
      : `Valable ${card.validityMonths} mois`;
    doc.fontSize(8).fillColor('#94a3b8').font('Helvetica').text(expiryText, { align: 'center' });

    // Image personnalisée (optionnel)
    if (card.customImageUrl) {
      // En P2, on ne télécharge pas l'image distante dans le PDF —
      // l'URL est stockée et peut être affichée dans le widget.
      // L'intégration d'image distante nécessiterait un fetch + buffer.
    }

    doc.end();
  });
}
