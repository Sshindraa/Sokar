import { describe, expect, it } from 'vitest';
import { buildCustomersCsv } from '../customer-export';

const base = { phone: '+33612345678', isVip: false, emailNormalized: null, visitSummary: null };

describe('buildCustomersCsv', () => {
  it('écrit un en-tête français, un BOM et les visites', () => {
    const csv = buildCustomersCsv([
      {
        ...base,
        name: 'Alice Martin',
        isVip: true,
        visitSummary: { visits: 5, visits365d: 3, lastVisitAt: '2026-09-10T19:30:00.000Z' },
      },
    ]);
    expect(csv.startsWith('﻿Nom;Téléphone;Email;VIP;Visites;Visites 365 j;Dernière visite')).toBe(
      true,
    );
    expect(csv).toContain('Alice Martin;+33612345678;;oui;5;3;2026-09-10\r\n');
  });

  it('neutralise les formules et protège les séparateurs sans abîmer le téléphone', () => {
    const csv = buildCustomersCsv([
      { ...base, name: '=HYPERLINK("http://x")', emailNormalized: 'a;b@x.fr' },
      { ...base, name: 'Dupont; "Jo"' },
    ]);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")";+33612345678;"a;b@x.fr"`);
    expect(csv).toContain('"Dupont; ""Jo""";+33612345678');
  });
});
