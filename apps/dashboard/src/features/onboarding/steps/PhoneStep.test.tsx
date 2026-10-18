import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhoneStep } from './PhoneStep';

const apiMocks = vi.hoisted(() => ({ post: vi.fn(), patch: vi.fn() }));
const onboardingMocks = vi.hoisted(() => ({
  state: null as Record<string, unknown> | null,
  updateTask: vi.fn(),
  setRestaurantDraft: vi.fn(),
  placeImportDraft: null as { phoneE164: string } | null,
}));

vi.mock('@/lib/api', () => ({
  useApi: () => ({ post: apiMocks.post, patch: apiMocks.patch, orgId: 'org-1' }),
}));

vi.mock('../onboarding-provider', () => ({
  useOnboarding: () => onboardingMocks,
}));

describe('PhoneStep', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    apiMocks.post.mockReset();
    apiMocks.patch.mockReset();
    onboardingMocks.setRestaurantDraft.mockReset();
    onboardingMocks.placeImportDraft = null;
    onboardingMocks.updateTask.mockReset();
    onboardingMocks.updateTask.mockResolvedValue({});
    onboardingMocks.state = {
      restaurant: {
        phoneNumber: '+33123456789',
        phoneAssigned: true,
        phoneE164: '+33612345678',
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
    fireEvent.click(screen.getByRole('button', { name: 'J’ai composé le code' }));
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
    expect(screen.getByRole('button', { name: 'Copier le numéro' })).toBeInTheDocument();
  });

  it('adapte le bouton au type de ligne, sans case à cocher', () => {
    render(<PhoneStep onComplete={vi.fn()} />);

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'J’ai composé le code' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Box internet' }));
    expect(screen.getByRole('button', { name: 'J’ai activé le renvoi' })).toBeEnabled();
  });

  it('fait saisir le numéro du restaurant sur place quand il manque', async () => {
    (onboardingMocks.state!.restaurant as Record<string, unknown>).phoneE164 = '';
    apiMocks.patch.mockResolvedValue({});
    render(<PhoneStep onComplete={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'J’ai composé le code' })).toBeDisabled();
    expect(screen.getByText('Renseignez d’abord le numéro du restaurant.')).toBeInTheDocument();

    const field = screen.getByLabelText('Numéro du restaurant');
    fireEvent.change(field, { target: { value: '01 00 00 00 00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Saisissez un numéro valide');
    expect(apiMocks.patch).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: '04 91 12 34 56' } });
    fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
    await waitFor(() => {
      expect(apiMocks.patch).toHaveBeenCalledWith('restaurants/org-1', {
        phoneE164: '+33491123456',
      });
    });
    expect(onboardingMocks.setRestaurantDraft).toHaveBeenCalledWith({ phoneE164: '+33491123456' });
    expect(apiMocks.post).not.toHaveBeenCalled();
  });

  it('préremplit le numéro avec la fiche Google choisie à l’étape 1', async () => {
    (onboardingMocks.state!.restaurant as Record<string, unknown>).phoneE164 = '';
    onboardingMocks.placeImportDraft = { phoneE164: '+33491123456' };
    apiMocks.patch.mockResolvedValue({});
    render(<PhoneStep onComplete={vi.fn()} />);

    expect(screen.getByLabelText('Numéro du restaurant')).toHaveValue('04 91 12 34 56');
    fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
    await waitFor(() => {
      expect(apiMocks.patch).toHaveBeenCalledWith('restaurants/org-1', {
        phoneE164: '+33491123456',
      });
    });
  });

  it('présélectionne le type de ligne d’après le numéro du restaurant', () => {
    const restaurant = onboardingMocks.state!.restaurant as Record<string, unknown>;
    restaurant.phoneE164 = '+33612345678';
    const { unmount } = render(<PhoneStep onComplete={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Mobile' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Déduit de votre numéro/)).toHaveTextContent(
      'Déduit de votre numéro 06 12 34 56 78.',
    );
    unmount();

    restaurant.phoneE164 = '+33912345678';
    const box = render(<PhoneStep onComplete={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Box internet' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'J’ai activé le renvoi' })).toBeInTheDocument();
    box.unmount();

    restaurant.phoneE164 = '+33491123456';
    render(<PhoneStep onComplete={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Ligne fixe' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('*21*0123456789#')).toBeInTheDocument();
    expect(screen.getByText(/Choisissez Box internet/)).toBeInTheDocument();
  });

  it('suit le numéro saisi tant que l’utilisateur n’a pas choisi lui-même', () => {
    (onboardingMocks.state!.restaurant as Record<string, unknown>).phoneE164 = '';
    render(<PhoneStep onComplete={vi.fn()} />);
    const field = screen.getByLabelText('Numéro du restaurant');

    fireEvent.change(field, { target: { value: '09 12 34 56 78' } });
    expect(screen.getByRole('button', { name: 'Box internet' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mobile' }));
    fireEvent.change(field, { target: { value: '04 91 12 34 56' } });
    expect(screen.getByRole('button', { name: 'Mobile' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(/Déduit de votre numéro/)).not.toBeInTheDocument();
  });

  it('garde Mobile par défaut sans numéro français exploitable', () => {
    (onboardingMocks.state!.restaurant as Record<string, unknown>).phoneE164 = '+41221234567';
    render(<PhoneStep onComplete={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Mobile' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(/Déduit de votre numéro/)).not.toBeInTheDocument();
  });

  it('permet de modifier un numéro déjà connu depuis le bandeau', async () => {
    (onboardingMocks.state!.restaurant as Record<string, unknown>).phoneE164 = '+33491123456';
    apiMocks.patch.mockResolvedValue({});
    render(<PhoneStep onComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Modifier le numéro du restaurant' }));
    const field = screen.getByLabelText('Numéro du restaurant');
    expect(field).toHaveValue('04 91 12 34 56');
    expect(field).toHaveFocus();
    expect(screen.getByRole('button', { name: 'J’ai composé le code' })).toBeDisabled();

    fireEvent.change(field, { target: { value: '06 12 34 56 78' } });
    expect(screen.getByRole('button', { name: 'Mobile' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
    await waitFor(() => {
      expect(apiMocks.patch).toHaveBeenCalledWith('restaurants/org-1', {
        phoneE164: '+33612345678',
      });
    });
    expect(onboardingMocks.setRestaurantDraft).toHaveBeenCalledWith({ phoneE164: '+33612345678' });
    await waitFor(() => {
      expect(screen.queryByLabelText('Numéro du restaurant')).not.toBeInTheDocument();
    });
  });

  it('annule la modification sans rien enregistrer', () => {
    (onboardingMocks.state!.restaurant as Record<string, unknown>).phoneE164 = '+33491123456';
    render(<PhoneStep onComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Modifier le numéro du restaurant' }));
    fireEvent.change(screen.getByLabelText('Numéro du restaurant'), {
      target: { value: '06 12 34 56 78' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Annuler la modification' }));
    expect(screen.queryByLabelText('Numéro du restaurant')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ligne fixe' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Modifier le numéro du restaurant' }));
    fireEvent.keyDown(screen.getByLabelText('Numéro du restaurant'), { key: 'Escape' });
    expect(screen.queryByLabelText('Numéro du restaurant')).not.toBeInTheDocument();
    expect(apiMocks.patch).not.toHaveBeenCalled();
  });

  it('ne montre pas le champ quand le numéro du restaurant est connu', () => {
    (onboardingMocks.state!.restaurant as Record<string, unknown>).phoneE164 = '+33491123456';
    render(<PhoneStep onComplete={vi.fn()} />);
    expect(screen.queryByLabelText('Numéro du restaurant')).not.toBeInTheDocument();
    const banner = screen.getByRole('region', { name: 'Le parcours de vos appels' });
    expect(within(banner).getByText('04 91 12 34 56')).toBeInTheDocument();
  });

  it('explique l’attente d’attribution sans afficher de code incomplet', () => {
    (onboardingMocks.state!.restaurant as Record<string, unknown>).phoneAssigned = false;
    render(<PhoneStep onComplete={vi.fn()} />);
    expect(screen.getByText('Votre numéro Sokar est en préparation')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copier le code' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'J’ai composé le code' })).toBeDisabled();
  });

  it('permet de revoir le renvoi sans perdre l’appel en attente de confirmation', async () => {
    apiMocks.post.mockResolvedValue({ ok: true, callControlId: 'pending-call' });
    render(<PhoneStep onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'J’ai composé le code' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lancer un appel test' }));
    await screen.findByRole('button', { name: "J'ai reçu l'appel" });
    fireEvent.click(screen.getByRole('button', { name: 'Revoir les instructions de renvoi' }));
    fireEvent.click(screen.getByRole('button', { name: 'J’ai composé le code' }));
    expect(screen.getByRole('button', { name: "J'ai reçu l'appel" })).toBeInTheDocument();
    expect(onboardingMocks.updateTask).not.toHaveBeenCalled();
  });

  it('copie le code exact et rend un échec de copie compréhensible', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<PhoneStep onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copier le code' }));
    expect(await screen.findByRole('button', { name: 'Copié' })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith('**21*+33123456789#');
    fireEvent.click(screen.getByRole('button', { name: 'Box internet' }));
    writeText.mockRejectedValueOnce(new Error('Clipboard unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Copier le numéro' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La copie n’a pas fonctionné');
  });
});
