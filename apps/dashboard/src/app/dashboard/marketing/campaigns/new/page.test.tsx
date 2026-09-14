import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

    expect(await screen.findByText('Profils candidats')).toBeInTheDocument();
    expect(screen.getByText('12', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('NO_CONSENT')).toBeInTheDocument();
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
    expect(screen.getByText(/PROVIDER_TARIFF_NOT_RECONCILED/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Tester le rendu gérant' }));
    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith('marketing/campaigns/campaign-1/test'),
    );
  });

  it('affiche le refus de capability Pro', async () => {
    apiMocks.get.mockRejectedValueOnce(new Error('CAPABILITY_NOT_INCLUDED'));
    render(<NewMarketingCampaignPage />);

    expect(await screen.findByText('CAPABILITY_NOT_INCLUDED')).toBeInTheDocument();
    expect(screen.getByText(/inclus dans la formule Pro/)).toBeInTheDocument();
  });
});
