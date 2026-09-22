import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AdminHomePage from './page';

describe('AdminHomePage', () => {
  it('présente les espaces opérateur sans contenu restaurant', () => {
    render(<AdminHomePage />);

    expect(
      screen.getByRole('heading', { name: 'Piloter Sokar sans entrer dans un restaurant' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Coûts opérationnels/ })).toHaveAttribute(
      'href',
      '/admin/margin',
    );
    expect(screen.getByRole('link', { name: /Santé des restaurants/ })).toHaveAttribute(
      'href',
      '/admin/health',
    );
    expect(screen.getByRole('link', { name: /Provisioning/ })).toHaveAttribute(
      'href',
      '/admin/provisioning',
    );
    expect(screen.getByRole('link', { name: /Onboarding — cohorte/ })).toHaveAttribute(
      'href',
      '/admin/onboarding',
    );
    expect(screen.queryByText(/Chez Sokar HQ/)).not.toBeInTheDocument();
  });
});
