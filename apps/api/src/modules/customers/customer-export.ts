export interface CustomerExportRow {
  name: string | null;
  phone: string;
  emailNormalized: string | null;
  isVip: boolean;
  visitSummary: { visits: number; visits365d: number; lastVisitAt?: Date | string | null } | null;
}

const HEADER = ['Nom', 'Téléphone', 'Email', 'VIP', 'Visites', 'Visites 365 j', 'Dernière visite'];

/** Excel would run a cell starting with one of these as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

function text(value: string | null | undefined): string {
  const safe = value && FORMULA_START.test(value) ? `'${value}` : (value ?? '');
  return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Customer file as CSV for French Excel: `;` separator and a BOM for UTF-8. Notes are left out on
 * purpose (sensitive, role-dependent); phones are generated E.164, so only free text is neutralised.
 */
export function buildCustomersCsv(rows: CustomerExportRow[]): string {
  const lines = rows.map((row) => {
    const last = row.visitSummary?.lastVisitAt;
    return [
      text(row.name),
      row.phone,
      text(row.emailNormalized),
      row.isVip ? 'oui' : 'non',
      String(row.visitSummary?.visits ?? 0),
      String(row.visitSummary?.visits365d ?? 0),
      last ? new Date(last).toISOString().slice(0, 10) : '',
    ].join(';');
  });
  return `﻿${[HEADER.join(';'), ...lines].join('\r\n')}\r\n`;
}
