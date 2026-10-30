import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge, type StatusLevel } from '../StatusBadge';

const FILL: Record<StatusLevel, string> = {
  action: 'bg-warning',
  progress: 'border-foreground',
  done: 'bg-foreground',
  neutral: 'bg-secondary',
  error: 'bg-destructive',
};

describe('StatusBadge', () => {
  it.each(Object.keys(FILL) as StatusLevel[])('applique le remplissage du niveau %s', (level) => {
    render(<StatusBadge level={level}>Libellé</StatusBadge>);

    const badge = screen.getByText('Libellé');
    expect(badge).toHaveAttribute('data-status-level', level);
    expect(badge.className).toContain(FILL[level]);
  });

  it("n'applique aucun aplat au niveau en cours : le contour seul porte le statut", () => {
    render(<StatusBadge level="progress">En cours</StatusBadge>);

    const badge = screen.getByText('En cours');
    expect(badge.className).toContain('bg-transparent');
    expect(badge.className).not.toContain('bg-foreground');
  });
});
