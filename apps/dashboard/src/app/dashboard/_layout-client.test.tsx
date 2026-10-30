import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../messages/fr.json';
import { DashboardModeSwitcher } from './_layout-client';

const mocks = vi.hoisted(() => ({
  role: 'OWNER' as string | undefined,
  pathname: '/dashboard',
  searchParams: new URLSearchParams(),
}));
vi.mock('@/features/sites/site-context', () => ({
  useSiteSelection: () => ({ activeSite: { role: mocks.role } }),
}));
vi.mock('@/features/companion/CompanionPanel', () => ({
  CompanionPanel: () => <p>Panneau du Companion</p>,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => mocks.searchParams,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

function switcherTree() {
  return (
    <NextIntlClientProvider locale="fr" messages={messages}>
      <DashboardModeSwitcher salleMode={false} />
    </NextIntlClientProvider>
  );
}

function renderSwitcher() {
  return render(switcherTree());
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

  it('ferme le panneau Companion quand la page ou les paramètres changent', () => {
    mocks.role = 'OWNER';
    mocks.pathname = '/dashboard';
    mocks.searchParams = new URLSearchParams();
    const { rerender } = renderSwitcher();

    fireEvent.click(screen.getByRole('button', { name: 'Companion' }));
    expect(screen.getByRole('dialog', { name: 'Companion' })).toBeInTheDocument();

    mocks.pathname = '/dashboard/reservations';
    rerender(switcherTree());
    expect(screen.queryByRole('dialog', { name: 'Companion' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Companion' }));
    expect(screen.getByRole('dialog', { name: 'Companion' })).toBeInTheDocument();

    mocks.searchParams = new URLSearchParams({ date: '2026-10-30', reservation: 'res-1' });
    rerender(switcherTree());
    expect(screen.queryByRole('dialog', { name: 'Companion' })).not.toBeInTheDocument();
  });
});
