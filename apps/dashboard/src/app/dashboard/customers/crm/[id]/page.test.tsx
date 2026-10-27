import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toApiError } from '@/lib/api-error';
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
    expect(screen.getByText('Caisse · C-42')).toBeInTheDocument();
    expect(screen.getByText('Visite honorée')).toBeInTheDocument();
    expect(screen.queryByText('reservation.honored')).not.toBeInTheDocument();
    expect(screen.queryByText('Table calme')).not.toBeInTheDocument();
    expect(apiMocks.get).toHaveBeenCalledWith('crm/customers/customer-1');
    expect(await screen.findByText('Consentement marketing')).toBeInTheDocument();
    expect(apiMocks.get).toHaveBeenCalledWith('crm/customers/customer-1/marketing-permissions');
  });

  it('montre l’offre CRM Pro, pas une erreur, quand la formule ne l’inclut pas', async () => {
    apiMocks.get.mockRejectedValue(toApiError(403, { error: 'CAPABILITY_NOT_INCLUDED' }));

    render(<CrmCustomerPage />);

    expect(await screen.findByRole('region', { name: 'CRM Pro' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Réessayer/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Retour aux clients/ })).toHaveAttribute(
      'href',
      '/dashboard/customers',
    );
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
    fireEvent.click(screen.getByRole('button', { name: 'Recalculer les chiffres' }));

    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith(
        'crm/customers/customer-1/projection-repair',
        undefined,
        { headers: { 'Idempotency-Key': expect.any(String) } },
      ),
    );
    expect(
      await screen.findByText('Chiffres recalculés depuis les réservations.'),
    ).toBeInTheDocument();
  });

  it('modifie et supprime une préférence via les routes CRM', async () => {
    render(<CrmCustomerPage />);

    await screen.findByRole('heading', { name: 'Alice Martin' });
    fireEvent.click(screen.getByRole('button', { name: 'Modifier' }));
    fireEvent.change(screen.getByLabelText('Valeur de la préférence'), {
      target: { value: 'en' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() =>
      expect(apiMocks.put).toHaveBeenCalledWith(
        'crm/customers/customer-1/preferences/preferred_language',
        expect.objectContaining({ value: 'en', source: 'MANUAL', confidence: 1 }),
      ),
    );
    expect(await screen.findByText('Préférence enregistrée.')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Supprimer la préférence Langue préférée' }),
    );
    await waitFor(() =>
      expect(apiMocks.del).toHaveBeenCalledWith(
        'crm/customers/customer-1/preferences/preferred_language',
      ),
    );
  });

  it('confirme ou écarte une préférence entendue au téléphone', async () => {
    const suggestion = {
      id: 'preference-2',
      key: 'dietary_restrictions',
      value: 'sans gluten',
      source: 'VOICE_SUGGESTION',
      confidence: 0.6,
      confirmedAt: null,
      expiresAt: '2099-01-01T00:00:00.000Z',
      updatedAt: '2026-10-21T12:00:00.000Z',
    };
    const expired = {
      ...suggestion,
      id: 'preference-3',
      key: 'preferred_section',
      value: 'terrasse',
      expiresAt: '2020-01-01T00:00:00.000Z',
    };
    apiMocks.get.mockResolvedValueOnce({
      data: {
        id: 'customer-1',
        name: 'Alice Martin',
        phone: '+33612345678',
        isVip: false,
        notes: null,
        identities: [],
        metricSnapshot: null,
        preferences: [suggestion, expired],
        tags: [],
        tagAssignments: [],
        timeline: [],
      },
    });
    apiMocks.put.mockResolvedValueOnce({
      data: {
        ...suggestion,
        confidence: 1,
        confirmedAt: '2026-10-21T12:05:00.000Z',
        expiresAt: null,
      },
    });
    render(<CrmCustomerPage />);

    await screen.findByRole('heading', { name: 'Alice Martin' });
    expect(screen.getByText('Entendu au téléphone, à confirmer')).toBeInTheDocument();
    expect(screen.queryByText('terrasse')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    await waitFor(() =>
      expect(apiMocks.put).toHaveBeenCalledWith(
        'crm/customers/customer-1/preferences/dietary_restrictions',
        expect.objectContaining({
          value: 'sans gluten',
          source: 'VOICE_SUGGESTION',
          confidence: 1,
          expiresAt: null,
          confirmedAt: expect.any(String),
        }),
      ),
    );
    expect(await screen.findByText('Préférence confirmée.')).toBeInTheDocument();
    expect(screen.queryByText('Entendu au téléphone, à confirmer')).not.toBeInTheDocument();
  });

  it('écarte une préférence entendue au téléphone', async () => {
    apiMocks.get.mockResolvedValueOnce({
      data: {
        id: 'customer-1',
        name: 'Alice Martin',
        phone: '+33612345678',
        isVip: false,
        notes: null,
        identities: [],
        metricSnapshot: null,
        preferences: [
          {
            id: 'preference-2',
            key: 'dietary_restrictions',
            value: 'sans gluten',
            source: 'VOICE_SUGGESTION',
            confidence: 0.6,
            confirmedAt: null,
            expiresAt: null,
            updatedAt: '2026-10-21T12:00:00.000Z',
          },
        ],
        tags: [],
        tagAssignments: [],
        timeline: [],
      },
    });
    render(<CrmCustomerPage />);

    await screen.findByRole('heading', { name: 'Alice Martin' });
    fireEvent.click(
      screen.getByRole('button', { name: 'Écarter la suggestion Régimes alimentaires' }),
    );
    await waitFor(() =>
      expect(apiMocks.del).toHaveBeenCalledWith(
        'crm/customers/customer-1/preferences/dietary_restrictions',
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
    fireEvent.change(screen.getByLabelText('Nom du tag'), { target: { value: 'Terrasse' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Ajouter' })[0]);

    expect(await screen.findByText('Terrasse')).toBeInTheDocument();
    // La clé technique est déduite du nom, jamais saisie par le restaurateur.
    expect(apiMocks.post).toHaveBeenCalledWith(
      'crm/customers/customer-1/tags',
      expect.objectContaining({ key: 'terrasse', label: 'Terrasse' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retirer le tag Terrasse' }));
    await waitFor(() =>
      expect(apiMocks.del).toHaveBeenCalledWith('crm/customers/customer-1/tags/tag-2'),
    );
  });

  it('dit que le client n’existe plus, sans « Réessayer »', async () => {
    apiMocks.get.mockRejectedValue(toApiError(404, { error: 'CUSTOMER_NOT_FOUND' }));
    render(<CrmCustomerPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ce client n’existe plus ou a été fusionné avec un autre profil.',
    );
    expect(screen.queryByText('CUSTOMER_NOT_FOUND')).toBeNull();
    expect(screen.queryByRole('button', { name: /réessayer/i })).toBeNull();
    expect(screen.getByRole('link', { name: /Retour aux clients/ })).toBeInTheDocument();
  });

  it('propose de réessayer pour une vraie panne', async () => {
    apiMocks.get.mockRejectedValueOnce(toApiError(503, {}));
    render(<CrmCustomerPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('momentanément indisponible');
    expect(screen.getByRole('button', { name: /réessayer/i })).toBeInTheDocument();
  });

  it('recharge la fiche au lieu d’afficher une erreur quand le tag est déjà retiré', async () => {
    apiMocks.del.mockRejectedValue(toApiError(404, { error: 'TAG_ASSIGNMENT_NOT_FOUND' }));
    render(<CrmCustomerPage />);

    await screen.findByRole('heading', { name: 'Alice Martin' });
    const loadsBefore = apiMocks.get.mock.calls.filter(
      ([path]) => path === 'crm/customers/customer-1',
    ).length;
    fireEvent.click(screen.getByRole('button', { name: 'Retirer le tag VIP' }));

    await waitFor(() =>
      expect(
        apiMocks.get.mock.calls.filter(([path]) => path === 'crm/customers/customer-1').length,
      ).toBe(loadsBefore + 1),
    );
    expect(screen.queryByText(/TAG_ASSIGNMENT_NOT_FOUND/)).toBeNull();
  });

  it('bloque le double clic sur l’export et dit de redemander un code si l’export échoue', async () => {
    let releaseExport: (error: Error) => void = () => undefined;
    apiMocks.post.mockImplementation((path: string) => {
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
        return new Promise((_resolve, reject) => {
          releaseExport = reject;
        });
      }
      return Promise.resolve({});
    });
    render(<CrmCustomerPage />);

    await screen.findByRole('heading', { name: 'Alice Martin' });
    fireEvent.click(screen.getByRole('button', { name: 'Préparer un export' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Envoyer le code SMS' }));
    fireEvent.change(await screen.findByLabelText('Code d’export RGPD'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Télécharger l’export' }));

    const busy = await screen.findByRole('button', { name: /Vérification/ });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(
      apiMocks.post.mock.calls.filter(([path]) => path === 'api/rgpd/confirm-verification'),
    ).toHaveLength(1);

    releaseExport(
      toApiError(401, { code: 'IDENTITY_REQUIRED', error: 'X-Identity-Token header required.' }),
    );
    expect(
      await screen.findByText('La vérification d’identité a expiré. Demandez un nouveau code.'),
    ).toBeInTheDocument();
    // Le code est consommé : retour à l'étape « Envoyer le code ».
    expect(screen.getByRole('button', { name: 'Envoyer le code SMS' })).toBeInTheDocument();
  });

  it('traduit un code de vérification refusé et garde le champ pour corriger', async () => {
    apiMocks.post.mockImplementation((path: string) => {
      if (path === 'api/rgpd/request-verification') {
        return Promise.resolve({
          channel: 'sms',
          expiresAt: '2026-09-14T10:10:00.000Z',
          rateLimitRemaining: 4,
          captchaRequired: false,
        });
      }
      if (path === 'api/rgpd/confirm-verification') {
        return Promise.reject(toApiError(400, { code: 'INVALID_CODE', error: 'Invalid code' }));
      }
      return Promise.resolve({});
    });
    render(<CrmCustomerPage />);

    await screen.findByRole('heading', { name: 'Alice Martin' });
    fireEvent.click(screen.getByRole('button', { name: 'Préparer un export' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Envoyer le code SMS' }));
    fireEvent.change(await screen.findByLabelText('Code d’export RGPD'), {
      target: { value: '000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Télécharger l’export' }));

    expect(await screen.findByText('Le code saisi est incorrect.')).toBeInTheDocument();
    expect(screen.getByLabelText('Code d’export RGPD')).toBeInTheDocument();
  });
});
