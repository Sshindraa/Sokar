import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import DemoSection from './DemoSection';

beforeAll(() => {
  // jsdom n'implémente pas scrollTo sur les éléments ; la console défile à chaque message simulé.
  Element.prototype.scrollTo = vi.fn();
});

describe('DemoSection', () => {
  it('signale visiblement que la vitrine montre une simulation', () => {
    render(<DemoSection />);

    expect(screen.getByText('Exemple illustratif — données simulées')).toBeInTheDocument();
  });

  it('ne présente pas la conversation ni les indicateurs comme une activité réelle', () => {
    render(<DemoSection />);

    expect(screen.queryByText(/temps réel/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Live/)).not.toBeInTheDocument();
    expect(screen.queryByText('Appel client en cours')).not.toBeInTheDocument();
  });

  it("n'affiche pas de revenu récupéré, dont la preuve n'existe pas", () => {
    render(<DemoSection />);

    expect(screen.queryByText('Revenus récupérés')).not.toBeInTheDocument();
    expect(screen.queryByText('5 420 €')).not.toBeInTheDocument();
  });
});
