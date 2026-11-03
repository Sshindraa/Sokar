import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toApiError } from '@/lib/api-error';
import ReactivationPage from './page';
import { Toaster } from '@/components/ui/sonner';

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  orgId: 'org_test_123' as string | undefined,
}));

vi.mock('../../../lib/api', () => ({
  useApi: () => ({ get: apiMocks.get, post: apiMocks.post, orgId: apiMocks.orgId }),
}));
vi.mock('@/lib/useMediaQuery', () => ({ useIsMobile: () => false }));

const pending = {
  id: 'react-1',
  status: 'PENDING',
  sentCount: 0,
  sentAt: null,
  createdAt: '2026-10-12T08:00:00.000Z',
  customerCount: 12,
  customers: [
    {
      id: 'customer-1',
      name: 'Alice Martin',
      phone: '+33612345678',
      visitCount: 6,
      lastSeenAt: '2026-06-01T10:00:00.000Z',
    },
  ],
};

function mockLoad(options: { sendsEnabled?: boolean | null } = {}) {
  apiMocks.get.mockImplementation((path: string) => {
    if (path === 'dashboard/reactivation') return Promise.resolve([pending]);
    if (path === 'marketing/providers/readiness') {
      return options.sendsEnabled === null
        ? Promise.reject(toApiError(403, { error: 'CAPABILITY_NOT_INCLUDED' }))
        : Promise.resolve({ data: { sendsEnabled: options.sendsEnabled ?? true } });
    }
    return Promise.resolve({});
  });
}

describe('ReactivationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.orgId = 'org_test_123';
    mockLoad();
    apiMocks.post.mockResolvedValue({
      campaignId: 'marketing-1',
      audienceCount: 9,
      droppedCustomerCount: 1,
    });
  });

  it('demande confirmation avant d’envoyer, puis confirme l’envoi sans promettre un nombre de SMS', async () => {
    render(<ReactivationPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Envoyer la campagne' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Envoyer la campagne de réactivation ?');
    expect(dialog).toHaveTextContent('irréversible');
    expect(apiMocks.post).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmer l’envoi' }));
    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith('dashboard/reactivation/react-1/send'),
    );
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Envoi lancé pour 9 clients');
    expect(status).toHaveTextContent('1 client archivé ou fusionné retiré');
  });

  it('garde le bouton fermé et l’explique tant que les envois ne sont pas ouverts', async () => {
    mockLoad({ sendsEnabled: false });
    render(<ReactivationPage />);

    expect(await screen.findByRole('button', { name: 'Envoyer la campagne' })).toBeDisabled();
    expect(screen.getByText(/ne sont pas encore ouverts sur votre compte/)).toBeInTheDocument();
  });

  it('traduit le refus de l’API au lieu d’afficher un code', async () => {
    apiMocks.post.mockRejectedValue(toApiError(409, { error: 'REACTIVATION_AUTOMATION_ACTIVE' }));
    render(
      <>
        <ReactivationPage />
        <Toaster />
      </>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Envoyer la campagne' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirmer l’envoi' }),
    );

    expect(await screen.findByText(/déjà active dans Marketing/)).toBeInTheDocument();
    expect(screen.queryByText(/REACTIVATION_AUTOMATION_ACTIVE/)).toBeNull();
  });

  it('n’affiche pas « aucune campagne » quand le chargement échoue, et propose de réessayer', async () => {
    apiMocks.get.mockRejectedValueOnce(toApiError(503, {}));
    render(<ReactivationPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('momentanément indisponible');
    expect(screen.queryByText(/Aucune campagne de réactivation/)).toBeNull();
    expect(screen.queryByText(/scanne vos VIPs/)).toBeNull();

    mockLoad();
    fireEvent.click(screen.getByRole('button', { name: /réessayer/i }));
    expect(await screen.findByText(/clients? VIP inactifs?/)).toBeInTheDocument();
  });

  it('dit calmement que la réactivation n’est pas dans la formule', async () => {
    apiMocks.get.mockRejectedValueOnce(toApiError(403, { error: 'CAPABILITY_NOT_INCLUDED' }));
    render(<ReactivationPage />);

    expect(
      await screen.findByText('Cette fonctionnalité n’est pas incluse dans votre formule.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /réessayer/i })).toBeNull();
  });
});
