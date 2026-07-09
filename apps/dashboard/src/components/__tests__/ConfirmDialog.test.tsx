import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from '../ConfirmDialog';

describe('ConfirmDialog', () => {
  it("ne s'affiche pas quand open={false}", () => {
    render(
      <ConfirmDialog
        open={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        title="Confirmer ?"
        description="Êtes-vous sûr ?"
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Confirmer ?')).not.toBeInTheDocument();
  });

  it("s'affiche quand open={true} avec title + description", () => {
    render(
      <ConfirmDialog
        open={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        title="Confirmer ?"
        description="Êtes-vous sûr ?"
      />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Confirmer ?')).toBeInTheDocument();
    expect(screen.getByText('Êtes-vous sûr ?')).toBeInTheDocument();
  });

  it('clic sur bouton confirm appelle onConfirm', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open={true}
        onConfirm={onConfirm}
        onCancel={onCancel}
        title="Confirmer ?"
        description="Êtes-vous sûr ?"
        confirmLabel="Confirmer"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('clic sur bouton cancel appelle onCancel', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open={true}
        onConfirm={onConfirm}
        onCancel={onCancel}
        title="Confirmer ?"
        description="Êtes-vous sûr ?"
        cancelLabel="Annuler"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('variant destructive : bouton confirm a la classe destructive', () => {
    render(
      <ConfirmDialog
        open={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        title="Supprimer ?"
        description="Cette action est irréversible."
        confirmLabel="Supprimer"
        variant="destructive"
      />,
    );
    const confirmBtn = screen.getByRole('button', { name: 'Supprimer' });
    expect(confirmBtn.className).toMatch(/destructive/);
  });

  it("variant default : bouton confirm n'a pas la classe destructive", () => {
    render(
      <ConfirmDialog
        open={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        title="Confirmer ?"
        description="Êtes-vous sûr ?"
        confirmLabel="Confirmer"
        variant="default"
      />,
    );
    const confirmBtn = screen.getByRole('button', { name: 'Confirmer' });
    expect(confirmBtn.className).not.toMatch(/destructive/);
  });

  it('accessibilité : dialog a role="dialog"', () => {
    render(
      <ConfirmDialog
        open={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        title="Confirmer ?"
        description="Êtes-vous sûr ?"
      />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
