import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MarketingPage from './page';

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  orgId: 'org_test_123' as string | undefined,
}));

vi.mock('@/lib/api', () => ({
  useApi: () => ({
    orgId: apiMocks.orgId,
    get: apiMocks.get,
    put: apiMocks.put,
    post: apiMocks.post,
  }),
}));

const automation = {
  id: 'automation-1',
  type: 'AFTER_FIRST_HONORED',
  channel: 'SMS',
  config: {
    bodyTemplate: 'Merci {{customer.firstName}} {{unsubscribeUrl}}',
    subject: null,
    timezone: 'Europe/Paris',
    delayHours: 24,
  },
  version: 2,
  enabled: true,
  lastEvaluatedAt: null,
};

const campaign = {
  id: 'campaign-1',
  name: 'Merci première visite',
  objective: 'retention',
  channel: 'SMS',
  status: 'SENT',
  audienceCount: 12,
  acceptedCount: 12,
  deliveredCount: 11,
  failedCount: 1,
  conversionCount: 2,
  scheduledAt: null,
  completedAt: new Date().toISOString(),
  lastErrorCode: null,
  updatedAt: new Date().toISOString(),
};

describe('MarketingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.orgId = 'org_test_123';
    apiMocks.get.mockImplementation((path: string) => {
      if (path.startsWith('marketing/automations')) return Promise.resolve({ data: [automation] });
      if (path.startsWith('marketing/providers/readiness')) {
        return Promise.resolve({
          data: {
            sendsEnabled: false,
            sendGate: { enabled: false, missing: ['MARKETING_SENDS_ENABLED'] },
            sms: { configured: true, callbackConfigured: true, missing: [], callbackMissing: [] },
            email: {
              configured: true,
              callbackConfigured: false,
              missing: [],
              callbackMissing: ['RESEND_WEBHOOK_SECRET'],
            },
            whatsapp: {
              configured: false,
              callbackConfigured: true,
              missing: ['MARKETING_WHATSAPP_ENABLED'],
              callbackMissing: [],
            },
          },
        });
      }
      if (path.startsWith('marketing/campaigns/')) return Promise.resolve({ data: campaign });
      return Promise.resolve({ data: [campaign] });
    });
    apiMocks.put.mockResolvedValue({ data: automation });
    apiMocks.post.mockResolvedValue({ data: campaign });
  });

  it('affiche les trois cartes et une campagne après chargement', async () => {
    render(<MarketingPage />);

    expect(await screen.findByRole('heading', { name: 'Marketing Pro' })).toBeInTheDocument();
    expect(screen.getByText('Après la première visite')).toBeInTheDocument();
    expect(screen.getByText('Client dormant')).toBeInTheDocument();
    expect(screen.getByText('Anniversaire')).toBeInTheDocument();
    expect(screen.getByText('Merci première visite')).toBeInTheDocument();
    expect(screen.getByText('Envoyée')).toBeInTheDocument();
    expect(screen.getByText('Readiness des canaux')).toBeInTheDocument();
    expect(screen.getByText('Envois verrouillés')).toBeInTheDocument();
    expect(screen.getByText(/Porte globale à renseigner/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /CSV/ })).toHaveAttribute(
      'href',
      '/api/proxy/marketing/campaigns/campaign-1/report.csv?siteId=org_test_123',
    );
  });

  it('enregistre une automation avec son template et ses bornes', async () => {
    render(<MarketingPage />);
    await screen.findByRole('heading', { name: 'Marketing Pro' });

    const textareas = screen.getAllByRole('textbox');
    fireEvent.change(textareas[0], { target: { value: 'Merci {{unsubscribeUrl}}' } });
    const saveButtons = screen.getAllByRole('button', { name: 'Enregistrer' });
    fireEvent.click(saveButtons[0]);

    await waitFor(() =>
      expect(apiMocks.put).toHaveBeenCalledWith(
        'marketing/automations/AFTER_FIRST_HONORED',
        expect.objectContaining({
          enabled: true,
          channel: 'SMS',
          config: expect.objectContaining({
            bodyTemplate: 'Merci {{unsubscribeUrl}}',
            delayHours: 24,
            timezone: 'Europe/Paris',
          }),
        }),
      ),
    );
    expect(await screen.findByText('Après la première visite enregistré.')).toBeInTheDocument();
  });

  it('affiche une erreur explicite lorsque le compte n’a pas accès au marketing Pro', async () => {
    apiMocks.get.mockRejectedValueOnce(new Error('CAPABILITY_NOT_INCLUDED'));
    render(<MarketingPage />);

    expect(await screen.findByText('CAPABILITY_NOT_INCLUDED')).toBeInTheDocument();
  });
});
