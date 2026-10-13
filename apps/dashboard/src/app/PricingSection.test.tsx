import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PricingSection from './PricingSection';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('PricingSection', () => {
  it('affiche un CTA pour chaque formule avec la cadence annuelle sélectionnée', () => {
    render(<PricingSection />);

    expect(screen.getByText('179')).toBeInTheDocument();
    expect(screen.getAllByText('269')).toHaveLength(2);

    expect(screen.getByRole('link', { name: 'Choisir Essential' })).toHaveAttribute(
      'href',
      '/register?plan=essential&billing=annual',
    );
    expect(screen.getByRole('link', { name: 'Découvrir Pro' })).toHaveAttribute(
      'href',
      '/demo?plan=pro&billing=annual',
    );
    expect(screen.getByRole('link', { name: 'Découvrir Multi-site' })).toHaveAttribute(
      'href',
      '/demo?plan=multi-site&billing=annual&sites=2',
    );
  });

  it('met à jour la cadence transmise quand le visiteur passe au mensuel', () => {
    render(<PricingSection />);

    fireEvent.click(screen.getByRole('switch'));

    expect(screen.getByRole('link', { name: 'Découvrir Pro' })).toHaveAttribute(
      'href',
      '/demo?plan=pro&billing=monthly',
    );
  });

  it('affiche les montants avec une espace insécable et le prix par site du Multi-site', () => {
    const { container } = render(<PricingSection />);
    const text = container.textContent ?? '';

    expect(text).toContain('299\u00a0€\u00a0HT/mois + 99\u00a0€\u00a0HT/site');
    expect(text).toContain('+ 89\u00a0€\u00a0HT/site');
    expect(text).not.toContain('Économisez');
  });

  it('précise le paiement annuel et distingue le mensuel', () => {
    render(<PricingSection />);
    expect(
      screen.getByText(/Équivalents mensuels arrondis. Facturation annuelle/),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Facturé annuellement.')).toHaveLength(3);
    fireEvent.click(screen.getByRole('switch'));
    expect(screen.queryByText(/engagement de 12 mois/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Facturé chaque mois.')).toHaveLength(3);
  });

  it('calcule le total multi-site et transmet le nombre sélectionné', () => {
    render(<PricingSection />);
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.change(screen.getByLabelText('Nombre d’établissements'), { target: { value: '3' } });
    expect(screen.getByText(/Total pour 3 établissements : 497/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Découvrir Multi-site' })).toHaveAttribute(
      'href',
      '/demo?plan=multi-site&billing=monthly&sites=3',
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(screen.getByText(/Total pour 3 établissements : 447/)).toBeInTheDocument();
    expect(screen.queryByText(/,\d{2}.*€ HT/)).not.toBeInTheDocument();
  });

  it('masque le prix barré et les économies en mensuel', () => {
    const { container } = render(<PricingSection />);

    fireEvent.click(screen.getByRole('switch'));

    const text = container.textContent ?? '';
    expect(screen.getAllByText('299')[0]).toBeInTheDocument();
    expect(text).toContain('+ 99\u00a0€\u00a0HT/site');
    expect(text).not.toContain('Économisez');
    expect(text).not.toContain('-10% annuel');
  });
});
