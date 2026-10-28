import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toApiError } from '@/lib/api-error';
import NewMarketingCampaignPage from './page';

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  orgId: 'org_test_123' as string | undefined,
}));

vi.mock('@/lib/api', () => ({
  useApi: () => ({
    orgId: apiMocks.orgId,
    get: apiMocks.get,
    post: apiMocks.post,
  }),
}));

const segment = {
  id: 'segment-1',
  name: 'Habitués',
  definitionVersion: 1,
  isSystem: false,
  lastCount: 12,
};

const audience = {
  channel: 'SMS',
  audienceVersion: 1,
  candidateCount: 14,
  eligibleCount: 12,
  excludedByReason: { NO_CONSENT: 2 },
  sample: [{ id: 'customer-1', name: 'Alice', isVip: false, inclusionReason: 'CHANNEL_OPT_IN' }],
};

const campaignPreview = {
  campaign: {
    id: 'campaign-1',
    name: 'Relance midi',
    objective: 'Remplir le service',
    channel: 'SMS',
    status: 'DRAFT',
    subject: null,
    bodyTemplate: 'Bonjour {{customer.firstName}} {{unsubscribeUrl}}',
    scheduledAt: null,
    timezone: 'Europe/Paris',
  },
  audience: { captured: 12, eligible: 12, sampleCustomer: 'Alice' },
  render: {
    subject: null,
    body: 'Bonjour Alice https://sokar.tech/marketing/unsubscribe?token=preview',
    usedFallbackCustomer: false,
  },
  usage: {
    category: 'SMS_SEGMENTS',
    unitsPerMessage: 1,
    totalUnits: 12,
    encoding: 'gsm7',
  },
  costEstimate: {
    amount: null,
    currency: 'EUR',
    status: 'NOT_AVAILABLE',
    reason: 'PROVIDER_TARIFF_NOT_RECONCILED',
  },
};

describe('NewMarketingCampaignPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.orgId = 'org_test_123';
    apiMocks.get.mockResolvedValue({ data: [segment] });
    apiMocks.post.mockImplementation((path: string) => {
      if (path === 'marketing/campaigns/audience-preview') return Promise.resolve(audience);
      if (path === 'marketing/campaigns') return Promise.resolve({ data: { id: 'campaign-1' } });
      if (path === 'marketing/campaigns/campaign-1/preview') {
        return Promise.resolve({ data: campaignPreview });
      }
      if (path === 'marketing/campaigns/campaign-1/test') {
        return Promise.resolve({
          data: {
            mode: 'DRY_RUN',
            providerContacted: false,
            recipient: 'MANAGER',
            reason: 'PROVIDER_TEST_NOT_WIRED',
            preview: campaignPreview,
          },
        });
      }
      return Promise.resolve({});
    });
  });

  it('charge les segments et contrôle l’audience avec exclusions', async () => {
    render(<NewMarketingCampaignPage />);

    expect(await screen.findByRole('heading', { name: 'Nouvelle campagne' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Prévisualiser l’audience' }));

    expect(await screen.findByText('Clients candidats')).toBeInTheDocument();
    expect(screen.getByText('12', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Consentement non recueilli')).toBeInTheDocument();
    expect(screen.queryByText('NO_CONSENT')).toBeNull();
    expect(apiMocks.post).toHaveBeenCalledWith(
      'marketing/campaigns/audience-preview',
      expect.objectContaining({ channel: 'SMS', segmentId: 'segment-1', sampleLimit: 5 }),
    );
  });

  it('crée le brouillon puis charge le rendu serveur et les unités', async () => {
    render(<NewMarketingCampaignPage />);
    await screen.findByRole('heading', { name: 'Nouvelle campagne' });

    fireEvent.change(screen.getByPlaceholderText('Relance déjeuner de septembre'), {
      target: { value: 'Relance midi' },
    });
    fireEvent.change(screen.getByPlaceholderText('Remplir le service du midi'), {
      target: { value: 'Remplir le service' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Créer et prévisualiser' }));

    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith(
        'marketing/campaigns',
        expect.objectContaining({
          name: 'Relance midi',
          objective: 'Remplir le service',
          segmentId: 'segment-1',
          channel: 'SMS',
        }),
      ),
    );
    expect(await screen.findByText(/Bonjour Alice/)).toBeInTheDocument();
    expect(screen.getByText(/12 segments SMS/)).toBeInTheDocument();
    expect(screen.getByText(/estimation indisponible/)).toBeInTheDocument();
    expect(screen.queryByText(/PROVIDER_TARIFF_NOT_RECONCILED/)).toBeNull();
    expect(screen.queryByText(/campaign-1/)).toBeNull();
    expect(screen.getByText('SMS standard')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Tester l’aperçu' }));
    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith('marketing/campaigns/campaign-1/test'),
    );
    expect(
      await screen.findByText('Test effectué : aucun message n’a été envoyé.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/PROVIDER_TEST_NOT_WIRED/)).toBeNull();
  });

  async function fillRequiredFields() {
    await screen.findByRole('heading', { name: 'Nouvelle campagne' });
    fireEvent.change(screen.getByPlaceholderText('Relance déjeuner de septembre'), {
      target: { value: 'Relance midi' },
    });
    fireEvent.change(screen.getByPlaceholderText('Remplir le service du midi'), {
      target: { value: 'Remplir le service' },
    });
  }

  it('ne crée jamais deux brouillons : le formulaire se fige après la création', async () => {
    render(<NewMarketingCampaignPage />);
    await fillRequiredFields();

    fireEvent.click(screen.getByRole('button', { name: 'Créer et prévisualiser' }));
    await screen.findByText(/Bonjour Alice/);

    expect(screen.getByRole('button', { name: 'Créer et prévisualiser' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Voir dans Marketing' })).toHaveAttribute(
      'href',
      '/dashboard/marketing',
    );
    const creations = apiMocks.post.mock.calls.filter(([path]) => path === 'marketing/campaigns');
    expect(creations).toHaveLength(1);
  });

  it('si l’aperçu échoue après la création, propose de relancer l’aperçu sans recréer', async () => {
    let previewCalls = 0;
    apiMocks.post.mockImplementation((path: string) => {
      if (path === 'marketing/campaigns') return Promise.resolve({ data: { id: 'campaign-1' } });
      if (path === 'marketing/campaigns/campaign-1/preview') {
        previewCalls += 1;
        return previewCalls === 1
          ? Promise.reject(toApiError(503, {}))
          : Promise.resolve({ data: campaignPreview });
      }
      return Promise.resolve({});
    });
    render(<NewMarketingCampaignPage />);
    await fillRequiredFields();

    fireEvent.click(screen.getByRole('button', { name: 'Créer et prévisualiser' }));
    expect(
      await screen.findByText(/Brouillon créé, mais l’aperçu n’a pas pu être généré/),
    ).toBeInTheDocument();
    expect(screen.queryByText('Impossible de créer cette campagne.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Réessayer l’aperçu/ }));
    expect(await screen.findByText(/Bonjour Alice/)).toBeInTheDocument();
    expect(
      apiMocks.post.mock.calls.filter(([path]) => path === 'marketing/campaigns'),
    ).toHaveLength(1);
  });

  it('refuse un message sans lien de désinscription, avec une consigne claire', async () => {
    render(<NewMarketingCampaignPage />);
    await fillRequiredFields();

    fireEvent.change(screen.getByRole('textbox', { name: /Message/ }), {
      target: { value: 'Bonjour à tous' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Créer et prévisualiser' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Gardez {{unsubscribeUrl}}');
    expect(
      apiMocks.post.mock.calls.filter(([path]) => path === 'marketing/campaigns'),
    ).toHaveLength(0);
  });

  it('garde le message rédigé quand on change de canal', async () => {
    render(<NewMarketingCampaignPage />);
    await fillRequiredFields();

    const message = screen.getByRole('textbox', { name: /Message/ });
    fireEvent.change(message, { target: { value: 'Mon texte {{unsubscribeUrl}}' } });
    fireEvent.change(screen.getByLabelText('Canal'), { target: { value: 'WHATSAPP' } });

    expect(screen.getByRole('textbox', { name: /Message/ })).toHaveValue(
      'Mon texte {{unsubscribeUrl}}',
    );
  });

  it('propose de réessayer quand les segments ne se chargent pas', async () => {
    apiMocks.get.mockRejectedValueOnce(toApiError(503, {}));
    render(<NewMarketingCampaignPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('momentanément indisponible');
    expect(screen.getByRole('button', { name: 'Créer et prévisualiser' })).toBeDisabled();

    apiMocks.get.mockResolvedValueOnce({ data: [segment] });
    fireEvent.click(screen.getByRole('button', { name: /réessayer/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Créer et prévisualiser' })).not.toBeDisabled(),
    );
  });

  it('affiche le refus de formule sans code technique', async () => {
    apiMocks.get.mockRejectedValueOnce(toApiError(403, { error: 'CAPABILITY_NOT_INCLUDED' }));
    render(<NewMarketingCampaignPage />);

    expect(
      await screen.findByText('Cette fonctionnalité n’est pas incluse dans votre formule.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('CAPABILITY_NOT_INCLUDED')).toBeNull();
  });
});
