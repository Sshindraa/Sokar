import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import RegisterPage from './page';

vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ isLoaded: false, isSignedIn: false }),
  SignUp: () => null,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('next/image', () => ({ default: () => null }));

beforeAll(() => {
  HTMLElement.prototype.scrollTo = vi.fn();
});

describe('récapitulatif avant paiement', () => {
  it.each([
    [1, '3 229,20'],
    [2, '4 298,40'],
    [3, '5 367,60'],
  ])('conserve %i établissements et le montant annuel exact', (count, amount) => {
    window.history.replaceState({}, '', `/register?plan=multi-site&billing=annual&sites=${count}`);
    render(<RegisterPage />);
    expect(screen.getByLabelText('Nombre d’établissements')).toHaveValue(count);
    expect(
      screen.getByLabelText('Récapitulatif de facturation').textContent?.replace(/\s/g, ' '),
    ).toContain(`${amount} € facturés par an, engagement de 12 mois.`);
  });
  it('recalcule le montant mensuel exact après un changement de nombre', () => {
    window.history.replaceState({}, '', '/register?plan=multi-site&billing=monthly&sites=1');
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText('Nombre d’établissements'), { target: { value: '3' } });
    expect(screen.getByLabelText('Récapitulatif de facturation')).toHaveTextContent(
      '497 € facturés chaque mois.',
    );
  });
});
