import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from './page';

const auth = vi.hoisted(() => ({ isLoaded: true, isSignedIn: false }));
const replace = vi.hoisted(() => vi.fn());
const useAuth = vi.hoisted(() => vi.fn(() => auth));
vi.mock('@clerk/nextjs', () => ({
  useAuth,
  SignIn: () => <div data-testid="clerk-sign-in">Connexion Clerk</div>,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
vi.mock('next/image', () => ({ default: () => null }));

describe('connexion Sokar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('min-width'),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'configured-for-test');
    auth.isLoaded = true;
    auth.isSignedIn = false;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('déroule la réservation fictive et permet de mettre la simulation en pause', () => {
    vi.useFakeTimers();
    render(<LoginPage />);
    expect(screen.getByText('Bonjour, une table pour quatre ce soir ?')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2600));
    expect(screen.getByText(/Avec plaisir/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mettre la simulation en pause' }));
    act(() => vi.advanceTimersByTime(7800));
    expect(screen.getByText(/Avec plaisir/)).toBeInTheDocument();
    expect(screen.queryByText('Réservation confirmée')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reprendre la simulation' }));
    act(() => vi.advanceTimersByTime(7800));
    expect(screen.getByText('Réservation confirmée')).toBeInTheDocument();
    expect(screen.getByText('Exemple fictif · aucun appel réel')).toBeInTheDocument();
  });

  it('conserve Clerk et les liens du parcours de connexion', () => {
    render(<LoginPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Ravis de vous revoir.');
    expect(screen.getByTestId('clerk-sign-in')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Créer votre compte/ })).toHaveAttribute(
      'href',
      '/register',
    );
    expect(screen.getByRole('link', { name: 'Confidentialité' })).toHaveAttribute(
      'href',
      '/privacy',
    );
  });

  it('redirige une session connectée vers le dashboard', () => {
    auth.isSignedIn = true;
    render(<LoginPage />);
    expect(replace).toHaveBeenCalledWith('/dashboard');
    expect(screen.queryByTestId('clerk-sign-in')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Redirection vers votre espace');
  });

  it('annonce le chargement sans afficher un formulaire utilisable', () => {
    auth.isLoaded = false;
    render(<LoginPage />);
    expect(screen.getByRole('status')).toHaveAccessibleName('Chargement de la connexion');
    expect(screen.queryByTestId('clerk-sign-in')).not.toBeInTheDocument();
  });

  it('ne plante pas sans fournisseur Clerk et désactive la connexion', () => {
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', '');
    render(<LoginPage />);
    expect(useAuth).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(
      'connexion est momentanément indisponible',
    );
    expect(screen.getByRole('textbox', { name: 'Adresse e-mail' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Continuer' })).toBeDisabled();
    expect(replace).not.toHaveBeenCalled();
  });
});
