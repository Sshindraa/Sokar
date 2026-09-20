import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MobileDataCard from '../MobileDataCard';

describe('MobileDataCard', () => {
  it('affiche le titre, sous-titre, détails et badge', () => {
    render(
      <MobileDataCard
        title="Dupont 6p"
        subtitle="19h30 · Terrasse"
        accentClass="border-l-brand"
        badge={<span>Confirmé</span>}
        details={[
          { label: 'Capacité', value: '6' },
          { label: 'Téléphone', value: '06 12 34 56 78' },
        ]}
      />,
    );

    expect(screen.getByText('Dupont 6p')).toBeInTheDocument();
    expect(screen.getByText('19h30 · Terrasse')).toBeInTheDocument();
    expect(screen.getByText('Confirmé')).toBeInTheDocument();

    expect(screen.getByText('Capacité')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('Téléphone')).toBeInTheDocument();
    expect(screen.getByText('06 12 34 56 78')).toBeInTheDocument();
  });

  it('appelle onClick au clic sur le contenu de la carte', () => {
    const handleClick = vi.fn();
    render(<MobileDataCard title="Table 12" subtitle="20h00" onClick={handleClick} />);

    fireEvent.click(screen.getByText('Table 12'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('rend les actions en arrière-plan et les déclenche au clic', () => {
    const handleEdit = vi.fn();
    const handleDelete = vi.fn();

    render(
      <MobileDataCard
        title="Réservation"
        onClick={vi.fn()}
        actions={[
          { label: 'Modifier', onClick: handleEdit, colorClass: 'bg-brand' },
          { label: 'Supprimer', onClick: handleDelete, colorClass: 'bg-destructive' },
        ]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Modifier' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Supprimer' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Modifier' }));
    expect(handleEdit).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
    expect(handleDelete).toHaveBeenCalledTimes(1);
  });

  it('clic sur une action ne déclenche pas onClick de la carte (stopPropagation)', () => {
    const handleCardClick = vi.fn();
    const handleAction = vi.fn();

    render(
      <MobileDataCard
        title="Réservation"
        onClick={handleCardClick}
        actions={[{ label: 'Annuler', onClick: handleAction }]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(handleAction).toHaveBeenCalledTimes(1);
    expect(handleCardClick).not.toHaveBeenCalled();
  });

  it('rend les actions découvrables sans geste de swipe', () => {
    render(
      <MobileDataCard title="Réservation" actions={[{ label: 'Modifier', onClick: vi.fn() }]} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Afficher les actions' }));

    expect(screen.getByRole('button', { name: 'Masquer les actions' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Modifier' })).toHaveLength(2);
  });

  it('ne rend pas de boutons actions si aucune action fournie', () => {
    render(<MobileDataCard title="Sans action" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
