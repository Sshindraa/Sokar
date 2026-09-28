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

    expect(screen.getByText('159')).toBeInTheDocument();
    expect(screen.getByText('239')).toBeInTheDocument();
    expect(screen.getByText('199')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Souscrire Essential' })).toHaveAttribute(
      'href',
      '/register?plan=essential&billing=annual',
    );
    expect(screen.getByRole('link', { name: 'Souscrire Pro' })).toHaveAttribute(
      'href',
      '/register?plan=pro&billing=annual',
    );
    expect(screen.getByRole('link', { name: 'Souscrire Multi-site' })).toHaveAttribute(
      'href',
      '/register?plan=multi-site&billing=annual&sites=2',
    );
  });

  it('met à jour la cadence transmise quand le visiteur passe au mensuel', () => {
    render(<PricingSection />);

    fireEvent.click(screen.getByRole('switch'));

    expect(screen.getByRole('link', { name: 'Souscrire Pro' })).toHaveAttribute(
      'href',
      '/register?plan=pro&billing=monthly',
    );
  });

  it('affiche les montants avec une espace insécable et le prix par site du Multi-site', () => {
    const { container } = render(<PricingSection />);
    const text = container.textContent ?? '';

    expect(text).toContain('249\u00a0€/mois + 99\u00a0€/site');
    expect(text).toContain('+ 79\u00a0€/site');
    expect(text).not.toContain('Économisez');
  });

  it('masque le prix barré et les économies en mensuel', () => {
    const { container } = render(<PricingSection />);

    fireEvent.click(screen.getByRole('switch'));

    const text = container.textContent ?? '';
    expect(screen.getByText('299')).toBeInTheDocument();
    expect(text).toContain('+ 99\u00a0€/site');
    expect(text).not.toContain('Économisez');
    expect(text).not.toContain('-20% annuel');
  });
});
