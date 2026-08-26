import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WidgetIntegrationPage from './page';

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  orgId: 'org_test_123',
}));

vi.mock('@/lib/api', () => ({
  useApi: () => ({
    orgId: apiMocks.orgId,
    get: apiMocks.get,
  }),
}));

vi.mock('@/features/onboarding/onboarding-guard', () => ({
  OnboardingLockBanner: () => <div data-testid="onboarding-lock-banner" />,
}));

const validSettings = {
  restaurantId: 'resto-1',
  slug: 'chez-sokar-demo',
  name: 'Chez Sokar',
  connectPublished: true,
};

describe('WidgetIntegrationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.orgId = 'org_test_123';
  });

  it('affiche un état de chargement initial (skeletons)', () => {
    apiMocks.get.mockReturnValue(new Promise(() => {})); // pending promise
    const { container } = render(<WidgetIntegrationPage />);

    expect(screen.getByRole('heading', { name: 'Widget / Intégration' })).toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('affiche le message invitant à sélectionner un restaurant si orgId est absent', async () => {
    apiMocks.orgId = undefined as unknown as string;
    render(<WidgetIntegrationPage />);

    expect(
      await screen.findByText('Sélectionnez un restaurant pour configurer le widget.'),
    ).toBeInTheDocument();
    expect(apiMocks.get).not.toHaveBeenCalled();
  });

  it('charge et affiche le snippet et l’aperçu du widget avec succès', async () => {
    apiMocks.get.mockResolvedValueOnce(validSettings);
    render(<WidgetIntegrationPage />);

    await waitFor(() => {
      expect(apiMocks.get).toHaveBeenCalledWith('restaurants/org_test_123/connect');
    });

    expect(await screen.findByText('Snippet à intégrer')).toBeInTheDocument();
    expect(screen.getByText('Aperçu')).toBeInTheDocument();

    const snippetInput = screen.getByLabelText('Snippet') as HTMLInputElement;
    expect(snippetInput.value).toContain('data-slug="chez-sokar-demo"');
    expect(snippetInput.value).toContain('/embed.js');

    const iframe = screen.getByTitle('Aperçu du widget Sokar');
    expect(iframe).toHaveAttribute(
      'src',
      expect.stringContaining('/widget/chez-sokar-demo?embedded=1'),
    );
  });

  it('affiche une carte d’erreur explicite avec bouton de relance quand l’API échoue', async () => {
    apiMocks.get.mockRejectedValueOnce(
      new Error('Impossible de joindre le serveur API (service indisponible ou hors ligne)'),
    );
    render(<WidgetIntegrationPage />);

    expect(
      await screen.findByText(
        'Impossible de joindre le serveur API (service indisponible ou hors ligne)',
      ),
    ).toBeInTheDocument();

    const retryButton = screen.getByRole('button', { name: /Réessayer/i });
    expect(retryButton).toBeInTheDocument();
    expect(
      screen.queryByText('Aucune donnée disponible pour ce restaurant.'),
    ).not.toBeInTheDocument();
  });

  it('permet de recharger les données en cliquant sur Réessayer après une erreur', async () => {
    apiMocks.get.mockRejectedValueOnce(new Error('Erreur réseau'));
    render(<WidgetIntegrationPage />);

    expect(await screen.findByText('Erreur réseau')).toBeInTheDocument();

    apiMocks.get.mockResolvedValueOnce(validSettings);
    const retryButton = screen.getByRole('button', { name: /Réessayer/i });
    fireEvent.click(retryButton);

    expect(await screen.findByText('Snippet à intégrer')).toBeInTheDocument();
    expect(screen.queryByText('Erreur réseau')).not.toBeInTheDocument();
  });

  it('permet de copier le snippet dans le presse-papier', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    apiMocks.get.mockResolvedValueOnce(validSettings);
    render(<WidgetIntegrationPage />);

    const copyButton = await screen.findByRole('button', { name: /Copier le snippet/i });
    fireEvent.click(copyButton);

    expect(writeTextMock).toHaveBeenCalledWith(
      expect.stringContaining('data-slug="chez-sokar-demo"'),
    );
    expect(await screen.findByText('Snippet copié')).toBeInTheDocument();
  });

  it('met à jour le snippet et l’iframe lors de la modification des couleurs', async () => {
    apiMocks.get.mockResolvedValueOnce(validSettings);
    render(<WidgetIntegrationPage />);

    await screen.findByText('Snippet à intégrer');

    const primaryInputs = screen.getAllByDisplayValue('#0f172a');
    fireEvent.change(primaryInputs[0], { target: { value: '#123456' } });

    const snippetInput = screen.getByLabelText('Snippet') as HTMLInputElement;
    expect(snippetInput.value).toContain('data-primary="#123456"');

    const iframe = screen.getByTitle('Aperçu du widget Sokar');
    expect(iframe).toHaveAttribute('src', expect.stringContaining('primary=123456'));
  });

  it('affiche l’état vide si les settings sont null sans erreur', async () => {
    apiMocks.get.mockResolvedValueOnce(null);
    render(<WidgetIntegrationPage />);

    expect(
      await screen.findByText('Aucune donnée disponible pour ce restaurant.'),
    ).toBeInTheDocument();
  });
});
