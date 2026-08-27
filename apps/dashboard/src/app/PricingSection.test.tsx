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
});
