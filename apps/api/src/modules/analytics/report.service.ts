import { THEFORK_COMMISSION_PER_PAX } from '@callyx/config';

export interface ReportData {
  restaurantName:   string;
  totalCalls:       number;
  reserved:         number;
  cancelled:        number;
  estimatedRevenue: number;
  totalCouverts?:   number;
}

export function buildReportEmail(data: ReportData): string {
  const theforkSavings = data.totalCouverts
    ? data.totalCouverts * THEFORK_COMMISSION_PER_PAX
    : 0;

  const savingsBlock = theforkSavings > 0
    ? `
      <div style="background:#eff6ff;border-radius:8px;padding:16px;margin-bottom:24px">
        <div style="font-size:22px;font-weight:700;color:#1d4ed8">
          ${theforkSavings.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
        </div>
        <div style="color:#1e40af;font-size:14px">💡 Économies commissions TheFork évitées</div>
      </div>`
    : '';

  return `
    <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto;">
      <h1 style="color: #16a34a;">Callyx</h1>
      <h2>Rapport du jour — ${data.restaurantName}</h2>
      ${savingsBlock}
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e5e5e5;">
            <strong>Appels reçus</strong>
          </td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e5e5; text-align: right;">
            ${data.totalCalls}
          </td>
        </tr>
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e5e5e5;">
            <strong>Réservations confirmées</strong>
          </td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e5e5; text-align: right;">
            ${data.reserved}
          </td>
        </tr>
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e5e5e5;">
            <strong>Annulations</strong>
          </td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e5e5; text-align: right;">
            ${data.cancelled}
          </td>
        </tr>
        <tr>
          <td style="padding: 12px;">
            <strong>Revenu estimé</strong>
          </td>
          <td style="padding: 12px; text-align: right;">
            ${data.estimatedRevenue.toFixed(2)} €
          </td>
        </tr>
      </table>
      <p style="color: #737373; font-size: 12px; margin-top: 24px;">
        Cet email est envoyé automatiquement par Callyx.
      </p>
    </div>
  `;
}
