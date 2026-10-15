import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PlanComparison from './PlanComparison';
import { CATALOG_FEATURES } from './pricing-catalog';

function rowFor(label: string): HTMLElement {
  const table = screen.getByRole('table');
  const row = within(table).getByRole('rowheader', { name: label }).closest('tr');
  if (!row) throw new Error(`Ligne introuvable : ${label}`);
  return row;
}

describe('PlanComparison', () => {
  it('présente les trois formules et chaque fonctionnalité du catalogue', () => {
    render(<PlanComparison />);
    const table = screen.getByRole('table');

    for (const name of ['Essential', 'Pro', 'Multi-site']) {
      expect(within(table).getByRole('columnheader', { name })).toBeInTheDocument();
    }
    for (const feature of CATALOG_FEATURES) {
      expect(within(table).getByRole('rowheader', { name: feature.label })).toBeInTheDocument();
    }
  });

  it('marque prévue une intégration non livrée, incluse seulement à partir de Pro', () => {
    render(<PlanComparison />);
    const row = rowFor('Synchronisation ZenChef, TheFork ou Lightspeed');

    expect(within(row).getAllByText('Prévu')).toHaveLength(2);
    expect(within(row).getByText('Non inclus')).toBeInTheDocument();
    expect(within(row).queryByText('Disponible')).not.toBeInTheDocument();
  });

  it('marque disponible une fonctionnalité livrée, incluse dans les trois formules', () => {
    render(<PlanComparison />);
    const row = rowFor('Rapport quotidien de vos appels');

    expect(within(row).getAllByText('Disponible')).toHaveLength(3);
    expect(within(row).queryByText('Non inclus')).not.toBeInTheDocument();
    expect(within(row).queryByText('Prévu')).not.toBeInTheDocument();
  });

  it('réserve les fonctionnalités Multi-site à la formule Multi-site', () => {
    render(<PlanComparison />);
    const row = rowFor('Une facturation réunie au niveau du groupe');

    expect(within(row).getAllByText('Non inclus')).toHaveLength(2);
    expect(within(row).getByText('Disponible')).toBeInTheDocument();
  });
});
