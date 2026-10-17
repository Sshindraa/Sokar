import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { toApiError } from '@/lib/api-error';
import AgenticSettingsPage from './page';

const mocks = vi.hoisted(() => ({
  orgId: 'org_test',
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ useApi: () => mocks }));
vi.mock('@/features/onboarding/onboarding-guard', () => ({ OnboardingLockBanner: () => null }));

// Valeur factice assemblée à l'exécution : un fixture ne doit pas ressembler à une vraie clé.
const createdKeyFixture = ['valeur', 'factice', 'du', 'test'].join('-');

const OPT_IN = { mcp: true, openaiReserve: false, policyVersion: '2026-10' };
const SETTINGS = {
  maxPartySize: 9,
  minLeadTimeMinutes: 45,
  requireManualValidation: true,
  quoteTtlSeconds: 300,
  holdTtlSeconds: 420,
  noShowPolicy: 'warning',
  notificationChannels: ['sms', 'email'],
  exposedCreneaux: [],
  capacitySpecials: {},
};
const CLIENT = {
  id: 'client-1',
  name: 'Claude Desktop',
  keyPrefix: 'sk_sokar_agent_ab',
  scopes: ['mcp:read'],
  allowedOrigins: [],
  lastUsedAt: null,
  createdAt: '2026-10-01T10:00:00.000Z',
};

function loadSucceeds() {
  mocks.get.mockImplementation(async (path: string) => {
    if (path === 'api/agentic/opt-in') return OPT_IN;
    if (path === 'api/agentic/exposure-settings') return SETTINGS;
    return { clients: [CLIENT] };
  });
}

describe('AgenticSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.del.mockResolvedValue(undefined);
  });

  it('n’affiche aucun formulaire quand le chargement échoue, pour ne pas écraser la vraie configuration', async () => {
    mocks.get.mockRejectedValueOnce(new Error('Le service est momentanément indisponible.'));
    mocks.get.mockResolvedValue({});

    render(<AgenticSettingsPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('momentanément indisponible');
    expect(alert).toHaveTextContent('Vos réglages n’ont pas été modifiés');
    expect(screen.queryByRole('button', { name: /enregistrer/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Aucune clé MCP active.')).not.toBeInTheDocument();
    expect(screen.queryByText('Désactivé')).not.toBeInTheDocument();
  });

  it('recharge les réglages avec « Réessayer » puis affiche les vraies valeurs', async () => {
    mocks.get.mockRejectedValueOnce(new Error('Panne'));
    mocks.get.mockResolvedValueOnce(OPT_IN);
    mocks.get.mockResolvedValueOnce(SETTINGS);
    mocks.get.mockResolvedValueOnce({ clients: [CLIENT] });
    // Les deux autres appels du premier essai (Promise.all) ne comptent pas.
    mocks.get.mockImplementation(async (path: string) => {
      if (path === 'api/agentic/opt-in') return OPT_IN;
      if (path === 'api/agentic/exposure-settings') return SETTINGS;
      return { clients: [CLIENT] };
    });

    render(<AgenticSettingsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /réessayer/i }));

    expect(await screen.findByRole('button', { name: /enregistrer/i })).toBeInTheDocument();
    expect(screen.getByText('Claude Desktop')).toBeInTheDocument();
  });

  it('présente calmement une fonction hors formule, sans « Réessayer »', async () => {
    mocks.get.mockRejectedValue(
      toApiError(403, {
        error: 'CAPABILITY_NOT_INCLUDED',
        message: 'Cette fonctionnalité n’est pas incluse dans votre formule.',
      }),
    );

    render(<AgenticSettingsPage />);

    expect(
      await screen.findByText('Cette fonctionnalité n’est pas incluse dans votre formule.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voir les formules' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /réessayer/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('demande confirmation avant de révoquer une clé en service', async () => {
    loadSucceeds();
    render(<AgenticSettingsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Révoquer' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Révoquer cette clé ?');
    expect(dialog).toHaveTextContent('Claude Desktop');
    expect(mocks.del).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Révoquer la clé' }));

    await waitFor(() => {
      expect(mocks.del).toHaveBeenCalledWith('api/agentic/mcp-clients/client-1');
    });
    await waitFor(() => {
      expect(screen.queryByText('Claude Desktop')).not.toBeInTheDocument();
    });
  });

  it('annuler la confirmation ne révoque rien', async () => {
    loadSucceeds();
    render(<AgenticSettingsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Révoquer' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Annuler' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(mocks.del).not.toHaveBeenCalled();
    expect(screen.getByText('Claude Desktop')).toBeInTheDocument();
  });

  it('parle français et vouvoie le restaurateur', async () => {
    loadSucceeds();
    render(<AgenticSettingsPage />);

    expect(await screen.findByText(/Activez les canaux/)).toBeInTheDocument();
    expect(screen.queryByText(/TTL/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PENDING|rollback|pilote/i)).not.toBeInTheDocument();
  });

  it('affiche les permissions des clés en français', async () => {
    loadSucceeds();
    render(<AgenticSettingsPage />);

    // « Lire » apparaît sur la carte de la clé existante (et dans le formulaire de création).
    expect((await screen.findAllByText('Lire')).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('read')).not.toBeInTheDocument();
  });

  it('refuse un nombre vide au lieu de l’envoyer comme zéro', async () => {
    loadSucceeds();
    render(<AgenticSettingsPage />);
    const field = await screen.findByDisplayValue('9');

    fireEvent.change(field, { target: { value: '' } });

    expect(await screen.findByText('Indiquez un nombre entre 1 et 50.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^enregistrer$/i })).toBeDisabled();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('garde au moins un canal de notification', async () => {
    mocks.get.mockImplementation(async (path: string) => {
      if (path === 'api/agentic/opt-in') return OPT_IN;
      if (path === 'api/agentic/exposure-settings') {
        return { ...SETTINGS, notificationChannels: ['sms'] };
      }
      return { clients: [CLIENT] };
    });
    render(<AgenticSettingsPage />);

    expect(await screen.findByRole('checkbox', { name: 'SMS' })).toBeDisabled();
  });

  it('prévient que la clé créée ne sera plus affichée', async () => {
    loadSucceeds();
    mocks.post.mockResolvedValue({
      client: { ...CLIENT, id: 'client-2' },
      apiKey: createdKeyFixture,
    });
    render(<AgenticSettingsPage />);

    fireEvent.change(await screen.findByPlaceholderText('Claude Desktop'), {
      target: { value: 'ChatGPT' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Créer/ }));

    expect(
      await screen.findByText('Copiez cette clé maintenant : elle ne sera plus affichée.'),
    ).toBeInTheDocument();
  });

  it('propose de compléter le profil quand OpenAI Reserve est refusé', async () => {
    loadSucceeds();
    mocks.post.mockRejectedValue(
      toApiError(409, {
        code: 'OPENAI_RESERVE_MISSING_FIELDS',
        error:
          'Pour activer OpenAI Reserve, complétez les informations du restaurant : adresse, téléphone.',
      }),
    );
    render(<AgenticSettingsPage />);

    const buttons = await screen.findAllByRole('button', { name: 'Activer' });
    fireEvent.click(buttons[buttons.length - 1]);

    expect(await screen.findByText(/complétez les informations du restaurant/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Compléter le profil' })).toHaveAttribute(
      'href',
      '/dashboard/settings',
    );
  });
});
