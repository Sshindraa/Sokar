import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import FeaturesMenu from './FeaturesMenu';

describe('FeaturesMenu', () => {
  it('reste fermé, puis liste les quatre fonctions au clic', () => {
    render(<FeaturesMenu />);
    const trigger = screen.getByRole('button', { name: 'Fonctionnalités' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: /Plan de salle/ })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('link')).toHaveLength(4);
    expect(screen.getByRole('link', { name: /Réponse au téléphone/ })).toHaveAttribute(
      'href',
      '/#telephone',
    );
  });

  it('se ferme avec Échap, au clic en dehors et après le choix d’une entrée', () => {
    render(<FeaturesMenu />);
    const trigger = screen.getByRole('button', { name: 'Fonctionnalités' });

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('link', { name: /Fiche client/ }));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
