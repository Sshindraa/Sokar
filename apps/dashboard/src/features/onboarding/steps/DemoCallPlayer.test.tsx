import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoCallPlayer } from './DemoCallPlayer';

const mocks = vi.hoisted(() => ({
  supported: vi.fn(),
  onUnavailable: null as null | ((m: string) => void),
}));

vi.mock('@/lib/api', () => ({ useApi: () => ({ siteId: undefined }) }));
vi.mock('../live-call/live-call-session', () => ({
  isLiveCallSupported: mocks.supported,
}));
vi.mock('./LiveCallPanel', () => ({
  LiveCallPanel: ({ onUnavailable }: { onUnavailable: (message: string) => void }) => {
    mocks.onUnavailable = onUnavailable;
    return <button type="button">Appeler Sokar</button>;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.supported.mockReturnValue(true);
});

describe('DemoCallPlayer', () => {
  it('propose l’appel en direct par défaut, sans les scénarios pré-enregistrés', () => {
    render(<DemoCallPlayer />);
    expect(screen.getByRole('button', { name: 'Appeler Sokar' })).toBeInTheDocument();
    expect(screen.queryByText('Essayez une autre conversation')).not.toBeInTheDocument();
  });

  it('permet de passer à l’aperçu pré-enregistré puis de revenir au direct', () => {
    render(<DemoCallPlayer />);

    fireEvent.click(screen.getByRole('button', { name: 'Écouter un exemple pré-enregistré' }));
    expect(screen.getByRole('button', { name: 'Écouter Sokar' })).toBeInTheDocument();
    expect(screen.getByText('Essayez une autre conversation')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Appeler Sokar en direct' }));
    expect(screen.getByRole('button', { name: 'Appeler Sokar' })).toBeInTheDocument();
  });

  it('retombe sur l’aperçu, avec explication, si le navigateur ne gère pas l’appel en direct', () => {
    mocks.supported.mockReturnValue(false);
    render(<DemoCallPlayer />);

    expect(screen.getByRole('button', { name: 'Écouter Sokar' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/pas disponible sur ce navigateur/);
    expect(
      screen.queryByRole('button', { name: 'Appeler Sokar en direct' }),
    ).not.toBeInTheDocument();
  });

  it('retombe sur l’aperçu avec le message du service quand le direct est indisponible', async () => {
    render(<DemoCallPlayer />);

    const { act } = await import('@testing-library/react');
    act(() => mocks.onUnavailable?.('Pas de fournisseur vocal.'));

    expect(screen.getByRole('button', { name: 'Écouter Sokar' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Pas de fournisseur vocal.');
  });
});
