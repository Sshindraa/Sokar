import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import DemoSection from './DemoSection';

beforeAll(() => {
  // jsdom n'implémente pas scrollTo sur les éléments ; la console défile à chaque message simulé.
  Element.prototype.scrollTo = vi.fn();
});

describe('DemoSection', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('joue le scénario complet et les réglages sans requête ni média', () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<DemoSection />);
    fireEvent.change(screen.getByRole('slider', { name: 'Rapidité de parole' }), {
      target: { value: '2' },
    });
    expect(screen.getByText('Dynamique')).toBeInTheDocument();
    for (let i = 0; i < 25; i++) act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText(/Réservation simulée, aucun SMS envoyé/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector('audio, video, iframe, form, a[href^="tel:"]')).toBeNull();
  });
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
