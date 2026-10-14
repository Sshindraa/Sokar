import type { ReactNode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminLayoutClient from './_layout-client';

const session = vi.hoisted(() => ({
  isSignedIn: undefined as boolean | undefined,
  get: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/demo-requests',
  useRouter: () => ({ replace: session.replace }),
}));

vi.mock('@/lib/api', () => ({
  useApi: () => ({ isSignedIn: session.isSignedIn, get: session.get }),
}));

vi.mock('@/components/AccountMenu', () => ({ AccountMenu: () => null }));
vi.mock('@/features/theme/dashboard-theme', () => ({
  DashboardThemeProvider: ({ children }: { children: ReactNode }) => children,
  useDashboardTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}));

function content() {
  return (
    <AdminLayoutClient>
      <p>Demandes opérateur</p>
    </AdminLayoutClient>
  );
}

describe('AdminAccessGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.isSignedIn = undefined;
    session.get.mockResolvedValue({ allowed: true });
  });

  it('attend la session avant de vérifier les droits, sans redirection prématurée', async () => {
    const view = render(content());

    expect(screen.getByText('Vérification de l’accès administrateur…')).toBeInTheDocument();
    expect(screen.queryByText('Demandes opérateur')).not.toBeInTheDocument();
    expect(session.get).not.toHaveBeenCalled();
    expect(session.replace).not.toHaveBeenCalled();

    session.isSignedIn = true;
    view.rerender(content());

    expect(await screen.findByText('Demandes opérateur')).toBeInTheDocument();
    expect(session.get).toHaveBeenCalledWith('admin/access');
    expect(session.replace).not.toHaveBeenCalled();
  });

  it('redirige vers la connexion seulement après confirmation de l’absence de session', () => {
    const view = render(content());
    expect(session.replace).not.toHaveBeenCalled();

    session.isSignedIn = false;
    view.rerender(content());

    expect(session.replace).toHaveBeenCalledWith('/login?redirect_url=%2Fadmin%2Fdemo-requests');
    expect(session.get).not.toHaveBeenCalled();
    expect(screen.queryByText('Demandes opérateur')).not.toBeInTheDocument();
  });

  it('continue de refuser un compte connecté qui échoue au contrôle serveur', async () => {
    session.isSignedIn = true;
    session.get.mockRejectedValue(new Error('Sokar operator access required'));
    render(content());

    await waitFor(() => expect(session.replace).toHaveBeenCalledWith('/dashboard'));
    expect(screen.queryByText('Demandes opérateur')).not.toBeInTheDocument();
  });

  it('ignore une autorisation tardive après la déconnexion', async () => {
    let resolveAccess!: (value: { allowed: boolean }) => void;
    session.isSignedIn = true;
    session.get.mockReturnValue(
      new Promise((resolve) => {
        resolveAccess = resolve;
      }),
    );
    const view = render(content());

    session.isSignedIn = false;
    view.rerender(content());
    await act(async () => resolveAccess({ allowed: true }));

    expect(screen.queryByText('Demandes opérateur')).not.toBeInTheDocument();
    expect(session.replace).toHaveBeenCalledWith('/login?redirect_url=%2Fadmin%2Fdemo-requests');
  });
});
