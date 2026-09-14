import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CrmCustomerPage from './page';

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  orgId: 'org_test_123' as string | undefined,
}));
const rgpdVerificationToken = ['verification', 'token'].join('-');

vi.mock('@/lib/api', () => ({
  useApi: () => ({
    get: apiMocks.get,
    post: apiMocks.post,
    put: apiMocks.put,
    del: apiMocks.del,
    orgId: apiMocks.orgId,
  }),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'customer-1' }),
}));

describe('CrmCustomerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.put.mockResolvedValue({
      data: {
        id: 'preference-1',
        key: 'preferred_language',
        value: 'en',
        source: 'MANUAL',
        confidence: 1,
        updatedAt: '2026-09-14T10:00:00.000Z',
      },
    });
    apiMocks.del.mockResolvedValue({ data: { removed: true } });
    apiMocks.get.mockResolvedValue({
      data: {
        id: 'customer-1',
        name: 'Alice Martin',
        phone: '+33612345678',
        emailNormalized: 'alice@example.com',
        visitCount: 8,
        isVip: true,
        notes: 'Table calme',
        identities: [{ id: 'identity-1', type: 'POS', value: 'C-42' }],
        metricSnapshot: null,
        metrics: {
          honored365d: 6,
          covers365d: 12,
          noShow365d: 0,
          actualLifetimeSpend: null,
          lastHonoredAt: '2026-09-10T19:30:00.000Z',
        },
        preferences: [
          {
            id: 'preference-1',
            key: 'preferred_language',
            value: 'fr',
            source: 'MANUAL',
            confidence: 1,
            updatedAt: '2026-09-10T19:30:00.000Z',
          },
        ],
        tags: [{ id: 'tag-1', key: 'vip', label: 'VIP' }],
        tagAssignments: [],
        timeline: [
          {
            id: 'timeline-1',
            summaryCode: 'reservation.honored',
            eventType: 'RESERVATION_HONORED',
            occurredAt: '2026-09-10T19:30:00.000Z',
          },
        ],
      },
    });
    apiMocks.post.mockImplementation((path: string) => {
      if (path === 'crm/customers/customer-1/projection-repair') {
        return Promise.resolve({
          data: {
            customerId: 'customer-1',
            restaurantId: 'org_test_123',
            calculatedAt: '2026-09-14T10:00:00.000Z',
            reservationCount: 2,
            changed: false,
            current: { honored365d: 2 },
            expected: { honored365d: 2 },
            projectionVersion: 4,
            repaired: true,
            replayed: false,
          },
        });
      }
      if (path === 'api/rgpd/request-verification') {
        return Promise.resolve({
          channel: 'sms',
          expiresAt: '2026-09-14T10:10:00.000Z',
          rateLimitRemaining: 4,
          captchaRequired: false,
        });
      }
      if (path === 'api/rgpd/confirm-verification') {
        return Promise.resolve({ verificationToken: rgpdVerificationToken });
      }
      if (path === 'api/rgpd/export') {
        return Promise.resolve({
          exportedAt: '2026-09-14T10:00:00.000Z',
          privacyPolicyVersion: '2026-01-01',
          reservations: [],
          crmProfiles: [],
          crmMergeAudits: [],
          marketingPermissions: [],
        });
      }
      return Promise.resolve({});
    });
  });

  it('affiche la fiche, les métriques et la chronologie sans exposer la note libre', async () => {
    render(<CrmCustomerPage />);

    expect(await screen.findByRole('heading', { name: 'Alice Martin' })).toBeInTheDocument();
    expect(screen.getByText('+33612345678')).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('POS · C-42')).toBeInTheDocument();
    expect(screen.getByText('reservation.honored')).toBeInTheDocument();
    expect(screen.queryByText('Table calme')).not.toBeInTheDocument();
    expect(apiMocks.get).toHaveBeenCalledWith('crm/customers/customer-1');
  });

  it('protège et télécharge l’export CRM après code SMS', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:crm-export');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    render(<CrmCustomerPage />);

    await screen.findByRole('heading', { name: 'Alice Martin' });
    fireEvent.click(screen.getByRole('button', { name: 'Préparer un export' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Envoyer le code SMS' }));
    expect(await screen.findByText(/Code envoyé par SMS/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Code d’export RGPD'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Télécharger l’export' }));

    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenNthCalledWith(
        3,
        'api/rgpd/export',
        { subject: '+33612345678' },
        { headers: { 'X-Identity-Token': rgpdVerificationToken } },
      ),
    );
    expect(await screen.findByText('Export téléchargé.')).toBeInTheDocument();
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:crm-export');
    createObjectUrl.mockRestore();
    revokeObjectUrl.mockRestore();
  });

  it('permet de vérifier puis réparer la projection avec le contrôle propriétaire du serveur', async () => {
    const initialGet = apiMocks.get.getMockImplementation();
    apiMocks.get.mockImplementation((path: string) => {
      if (path.includes('projection-repair-preview')) {
        return Promise.resolve({
          data: {
            customerId: 'customer-1',
            restaurantId: 'org_test_123',
            calculatedAt: '2026-09-14T10:00:00.000Z',
            reservationCount: 2,
            changed: true,
            current: { honored365d: 1 },
            expected: { honored365d: 2 },
          },
        });
      }
      return initialGet?.(path);
    });
    render(<CrmCustomerPage />);

    await screen.findByRole('heading', { name: 'Alice Martin' });
    fireEvent.click(screen.getByRole('button', { name: 'Vérifier' }));
    expect(await screen.findByText(/Écart détecté sur 2 réservation/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Recalculer la projection' }));

    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith(
        'crm/customers/customer-1/projection-repair',
        undefined,
        { headers: { 'Idempotency-Key': expect.any(String) } },
      ),
    );
    expect(
      await screen.findByText('Projection CRM recalculée depuis les réservations.'),
    ).toBeInTheDocument();
  });

  it('modifie et supprime une préférence via les routes CRM', async () => {
    render(<CrmCustomerPage />);

    await screen.findByRole('heading', { name: 'Alice Martin' });
    fireEvent.click(screen.getByRole('button', { name: 'Modifier' }));
    fireEvent.change(screen.getByLabelText('Valeur JSON de préférence'), {
      target: { value: '"en"' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() =>
      expect(apiMocks.put).toHaveBeenCalledWith(
        'crm/customers/customer-1/preferences/preferred_language',
        expect.objectContaining({ value: 'en', source: 'MANUAL', confidence: 1 }),
      ),
    );
    expect(await screen.findByText('Préférence enregistrée dans le CRM.')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Supprimer la préférence preferred_language' }),
    );
    await waitFor(() =>
      expect(apiMocks.del).toHaveBeenCalledWith(
        'crm/customers/customer-1/preferences/preferred_language',
      ),
    );
  });

  it('ajoute et retire un tag depuis la fiche CRM', async () => {
    apiMocks.post.mockImplementation((path: string) => {
      if (path === 'crm/customers/customer-1/tags') {
        return Promise.resolve({
          data: {
            tag: { id: 'tag-2', key: 'terrasse', label: 'Terrasse' },
            assignment: {
              tag: { id: 'tag-2', key: 'terrasse', label: 'Terrasse' },
              source: 'MANUAL',
              assignedAt: '2026-09-14T10:00:00.000Z',
            },
          },
        });
      }
      return Promise.resolve({});
    });
    render(<CrmCustomerPage />);

    await screen.findByRole('heading', { name: 'Alice Martin' });
    fireEvent.change(screen.getByLabelText('Clé du tag'), { target: { value: 'terrasse' } });
    fireEvent.change(screen.getByLabelText('Libellé du tag'), { target: { value: 'Terrasse' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Ajouter' })[0]);

    expect(await screen.findByText('Terrasse')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retirer le tag Terrasse' }));
    await waitFor(() =>
      expect(apiMocks.del).toHaveBeenCalledWith('crm/customers/customer-1/tags/tag-2'),
    );
  });
});
