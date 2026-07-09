import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import GaugeDial from '../GaugeDial';

// Helper : récupère la valeur numérique affichée (le span parent contient
// "{value}{suffix}", on extrait juste le nœud texte de la valeur)
function getValueText(container: HTMLElement): string | null {
  const valueSpan = container.querySelector('.text-3xl');
  if (!valueSpan) return null;
  // Le premier child est un Text node avec la valeur
  const firstChild = valueSpan.firstChild;
  return firstChild?.textContent?.trim() ?? null;
}

describe('GaugeDial', () => {
  it('rendu avec value=0', () => {
    const { container } = render(<GaugeDial value={0} label="Occupation" />);
    expect(getValueText(container)).toBe('0');
    expect(screen.getByText('Occupation')).toBeInTheDocument();
  });

  it('rendu avec value=50', () => {
    const { container } = render(<GaugeDial value={50} label="Taux" />);
    expect(getValueText(container)).toBe('50');
  });

  it('rendu avec value=100', () => {
    const { container } = render(<GaugeDial value={100} label="Max" />);
    expect(getValueText(container)).toBe('100');
  });

  it('rendu avec value hors range (clamp) — value négative clampée à 0', () => {
    const { container } = render(<GaugeDial value={-20} label="Neg" />);
    expect(getValueText(container)).toBe('0');
  });

  it('rendu avec value hors range (clamp) — value > 100 clampée à 100', () => {
    const { container } = render(<GaugeDial value={150} label="Over" />);
    expect(getValueText(container)).toBe('100');
  });

  it('rendu avec suffix personnalisé', () => {
    const { container } = render(<GaugeDial value={42} label="Score" suffix="pts" />);
    expect(getValueText(container)).toBe('42');
    expect(screen.getByText('pts')).toBeInTheDocument();
  });

  it('rendu avec sublabel', () => {
    render(<GaugeDial value={42} label="Score" sublabel="cette semaine" />);
    expect(screen.getByText('cette semaine')).toBeInTheDocument();
  });

  it('rend deux paths SVG (track + value)', () => {
    const { container } = render(<GaugeDial value={50} label="Taux" />);
    const paths = container.querySelectorAll('svg path');
    expect(paths.length).toBe(2);
  });
});
