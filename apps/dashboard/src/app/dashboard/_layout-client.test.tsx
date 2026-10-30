import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../messages/fr.json';
import { DashboardModeSwitcher } from './_layout-client';

const mocks = vi.hoisted(() => ({ role: 'OWNER' as string | undefined }));
vi.mock('@/features/sites/site-context', () => ({
  useSiteSelection: () => ({ activeSite: { role: mocks.role } }),
}));
vi.mock('@/features/companion/CompanionPanel', () => ({
  CompanionPanel: () => <p>Panneau du Companion</p>,
}));

function renderSwitcher() {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <DashboardModeSwitcher salleMode={false} />
    </NextIntlClientProvider>,
  );
}

describe('DashboardModeSwitcher : Companion', () => {
  it.each(['STAFF', 'READ_ONLY'])('masque le bouton Companion pour le rôle %s', (role) => {
    mocks.role = role;
    renderSwitcher();

    expect(screen.queryByRole('button', { name: 'Companion' })).not.toBeInTheDocument();
  });

  it('ouvre le panneau Companion pour un responsable, et Échap le ferme', () => {
    mocks.role = 'OWNER';
    renderSwitcher();

    fireEvent.click(screen.getByRole('button', { name: 'Companion' }));
    expect(screen.getByRole('dialog', { name: 'Companion' })).toBeInTheDocument();
    expect(screen.getByText('Panneau du Companion')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Companion' })).not.toBeInTheDocument();
    // Fermé mais monté : une requête en cours n'est pas perdue.
    expect(screen.getByText('Panneau du Companion')).not.toBeVisible();
  });
});
