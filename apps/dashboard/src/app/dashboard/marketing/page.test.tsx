import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toApiError } from '@/lib/api-error';
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
    expect(screen.getByText('État des canaux')).toBeInTheDocument();
    expect(screen.getByText('Envois bientôt disponibles')).toBeInTheDocument();
    // Aucun nom de variable serveur ni jargon d'exploitation côté restaurateur.
    expect(screen.queryByText(/MARKETING_SENDS_ENABLED|RESEND_WEBHOOK_SECRET|Callback/)).toBeNull();
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

  it('dit calmement que le marketing n’est pas dans la formule, sans formulaire ni bouton Enregistrer', async () => {
    apiMocks.get.mockRejectedValueOnce(toApiError(403, { error: 'CAPABILITY_NOT_INCLUDED' }));
    render(<MarketingPage />);

    expect(
      await screen.findByText('Cette fonctionnalité n’est pas incluse dans votre formule.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('CAPABILITY_NOT_INCLUDED')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull();
    expect(screen.queryByText('0/3 automations actives')).toBeNull();
    expect(screen.queryByText('Aucune campagne préparée')).toBeNull();
  });

  it('propose de réessayer après une panne, sans règles par défaut qu’on pourrait enregistrer', async () => {
    apiMocks.get.mockRejectedValueOnce(toApiError(503, {}));
    render(<MarketingPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Vos règles enregistrées');
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull();
    expect(screen.queryByText('Pas encore enregistrée')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /réessayer/i }));
    expect(await screen.findByText('Après la première visite')).toBeInTheDocument();
  });

  it('refuse d’enregistrer un message sans lien de désinscription, avec un texte clair', async () => {
    render(<MarketingPage />);
    await screen.findByRole('heading', { name: 'Marketing Pro' });

    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Merci à vous' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Enregistrer' })[0]);

    expect(
      await screen.findByText(/Le message doit contenir \{\{unsubscribeUrl\}\}/),
    ).toBeInTheDocument();
    expect(apiMocks.put).not.toHaveBeenCalled();
  });

  it('n’envoie jamais un nombre vide comme 0 : il est refusé avec ses bornes', async () => {
    render(<MarketingPage />);
    await screen.findByRole('heading', { name: 'Marketing Pro' });

    fireEvent.change(screen.getByRole('spinbutton', { name: /délai/i }), { target: { value: '' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Enregistrer' })[0]);

    expect(await screen.findByText('Entre 0 et 168 heures.')).toBeInTheDocument();
    expect(apiMocks.put).not.toHaveBeenCalled();
  });

  it('signale les modifications non enregistrées', async () => {
    render(<MarketingPage />);
    await screen.findByRole('heading', { name: 'Marketing Pro' });
    expect(screen.queryByText('Modifications non enregistrées')).toBeNull();

    fireEvent.click(screen.getByLabelText('Activer Client dormant'));

    expect(await screen.findByText('Modifications non enregistrées')).toBeInTheDocument();
  });

  it('demande confirmation avant d’annuler une campagne', async () => {
    apiMocks.get.mockImplementation((path: string) => {
      if (path.startsWith('marketing/automations')) return Promise.resolve({ data: [automation] });
      if (path.startsWith('marketing/providers/readiness')) return Promise.resolve({ data: null });
      return Promise.resolve({ data: [{ ...campaign, status: 'READY' }] });
    });
    render(<MarketingPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Annuler la campagne' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Annuler cette campagne ?');
    expect(apiMocks.post).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Annuler la campagne' }));
    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith('marketing/campaigns/campaign-1/cancel'),
    );
  });

  it('ne propose pas de préparer un brouillon sans destinataire et traduit les incidents', async () => {
    apiMocks.get.mockImplementation((path: string) => {
      if (path.startsWith('marketing/automations')) return Promise.resolve({ data: [automation] });
      if (path.startsWith('marketing/providers/readiness')) return Promise.resolve({ data: null });
      return Promise.resolve({
        data: [
          { ...campaign, id: 'c-draft', status: 'DRAFT', audienceCount: 0 },
          {
            ...campaign,
            id: 'c-failed',
            name: 'Relance échouée',
            status: 'FAILED',
            lastErrorCode: 'MARKETING_QUEUE_ENQUEUE_UNKNOWN',
          },
        ],
      });
    });
    render(<MarketingPage />);

    expect(await screen.findByRole('button', { name: /Préparer/ })).toBeDisabled();
    expect(screen.getByText(/Aucun destinataire consentant pour le moment/)).toBeInTheDocument();
    expect(screen.getByText(/Envoi non démarré, vous pouvez réessayer/)).toBeInTheDocument();
    expect(screen.queryByText(/MARKETING_QUEUE_ENQUEUE_UNKNOWN/)).toBeNull();
  });
});
