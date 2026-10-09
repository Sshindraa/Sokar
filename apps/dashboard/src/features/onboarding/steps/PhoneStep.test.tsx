import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhoneStep } from './PhoneStep';

const apiMocks = vi.hoisted(() => ({ post: vi.fn() }));
const onboardingMocks = vi.hoisted(() => ({
  state: null as Record<string, unknown> | null,
  updateTask: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  useApi: () => ({ post: apiMocks.post }),
}));

vi.mock('../onboarding-provider', () => ({
  useOnboarding: () => onboardingMocks,
}));

describe('PhoneStep', () => {
  beforeEach(() => {
    apiMocks.post.mockReset();
    onboardingMocks.updateTask.mockReset();
    onboardingMocks.updateTask.mockResolvedValue({});
    onboardingMocks.state = {
      restaurant: {
        phoneNumber: '+33123456789',
        phoneAssigned: true,
        phoneE164: '+33123456789',
        managerPhone: '+33612345678',
      },
      steps: [{ key: 'phone', state: { status: 'current', metadata: {} } }],
    };
  });

  it("n'enregistre pas la validation avant la confirmation de réception", async () => {
    apiMocks.post.mockResolvedValue({
      ok: true,
      callControlId: 'call-control-1',
      message: 'Appel déclenché',
    });

    render(<PhoneStep onComplete={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('J’ai activé le renvoi'));
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    fireEvent.click(await screen.findByRole('button', { name: /lancer un appel test/i }));

    await waitFor(() => {
      expect(apiMocks.post).toHaveBeenCalledWith('restaurant/onboarding/test-call', {});
    });
    expect(await screen.findByRole('button', { name: /j'ai reçu l'appel/i })).toBeInTheDocument();
    expect(onboardingMocks.updateTask).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /j'ai reçu l'appel/i }));
    await waitFor(() => {
      expect(onboardingMocks.updateTask).toHaveBeenNthCalledWith(1, 'first_call', 'phone', {
        metadata: { testCallControlId: 'call-control-1' },
      });
    });
    expect(onboardingMocks.updateTask).toHaveBeenCalledWith('complete', 'phone');
    expect(onboardingMocks.updateTask).toHaveBeenCalledWith('activate');
  });

  it('montre le code de renvoi selon le type de ligne, numéro Sokar déjà rempli', () => {
    render(<PhoneStep onComplete={vi.fn()} />);

    expect(screen.getByText('**21*+33123456789#')).toBeInTheDocument();
    expect(screen.getByText('##21#')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ligne fixe' }));
    expect(screen.getByText('*21*0123456789#')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Box internet' }));
    expect(screen.getByText(/Rubrique « Renvoi d’appel »/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copier le code' })).not.toBeInTheDocument();
  });

  it('ne laisse continuer qu’une fois le renvoi déclaré activé', () => {
    render(<PhoneStep onComplete={vi.fn()} />);

    const next = screen.getByRole('button', { name: 'Continuer' });
    expect(next).toBeDisabled();
    fireEvent.click(screen.getByLabelText('J’ai activé le renvoi'));
    expect(next).toBeEnabled();
  });
});
