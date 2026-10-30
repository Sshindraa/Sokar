import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toApiError } from '@/lib/api-error';
import DistributionPage from './page';
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const apiMocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/lib/api', () => ({
  useApi: () => ({ get: apiMocks.get, post: apiMocks.post }),
}));

// Le bouton n’apparaît qu’une fois les connexions chargées, et reste désactivé pendant une action :
// on attend qu’il soit actif, sinon React ignore le clic.
async function clickWhenEnabled(name: string | RegExp) {
  await waitFor(() => expect(screen.getByRole('button', { name })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name }));
}

const connection = {
  id: 'connection-1',
  provider: 'GOOGLE_RESERVE',
  externalAccountLast4: '1234',
  credentialReferencePresent: true,
  configHash: 'b'.repeat(64),
  status: 'ACTIVE',
  cursorPresent: true,
  lastSyncAt: '2026-09-14T10:00:00.000Z',
  lastErrorCode: null,
  connectedAt: '2026-09-14T10:00:00.000Z',
  disconnectedAt: null,
  updatedAt: '2026-09-14T10:00:00.000Z',
};

const run = {
  id: 'run-1',
  connectionId: 'connection-1',
  provider: 'GOOGLE_RESERVE',
  direction: 'BIDIRECTIONAL',
  status: 'SUCCEEDED',
  windowStart: null,
  windowEnd: null,
  pushedCount: 2,
  pulledCount: 1,
  failedCount: 0,
  errorCode: null,
  createdAt: '2026-09-14T10:00:00.000Z',
  finishedAt: '2026-09-14T10:01:00.000Z',
};

const availability = {
  id: 'slot-1',
  connectionId: 'connection-1',
  provider: 'GOOGLE_RESERVE',
  slotKey: '2026-09-20T19:00:00Z-2',
  serviceDate: '2026-09-20',
  startsAt: '2026-09-20T19:00:00.000Z',
  endsAt: '2026-09-20T21:00:00.000Z',
  partySize: 2,
  available: 4,
  capacity: 10,
  sourceRevision: 'rev-1',
  observedAt: '2026-09-14T10:00:00.000Z',
};

const link = {
  id: 'link-1',
  connectionId: 'connection-1',
  provider: 'GOOGLE_RESERVE',
  reservationId: 'reservation-1',
  externalIdLast4: 'ABCD',
  status: 'ACTIVE',
  source: 'fixture',
  linkedAt: '2026-09-14T10:00:00.000Z',
};

const webhook = {
  id: 'webhook-1',
  connectionId: 'connection-1',
  provider: 'GOOGLE_RESERVE',
  eventType: 'reservation.updated',
  payloadHash: 'd'.repeat(64),
  status: 'RECEIVED',
  errorCode: null,
  receivedAt: '2026-09-14T10:00:00.000Z',
  processedAt: null,
};

describe('DistributionPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.get.mockImplementation((path: string) => {
      if (path.startsWith('distribution/connections?'))
        return Promise.resolve({ data: [connection] });
      if (path.startsWith('distribution/sync-runs')) return Promise.resolve({ data: [run] });
      if (path.startsWith('distribution/reservation-links'))
        return Promise.resolve({ data: [link] });
      if (path.startsWith('distribution/webhooks')) return Promise.resolve({ data: [webhook] });
      if (path.includes('/availability')) return Promise.resolve({ data: [availability] });
      return Promise.resolve({ data: [] });
    });
    apiMocks.post.mockImplementation((path: string) => {
      if (path === 'distribution/connections') return Promise.resolve({ data: connection });
      return Promise.resolve({ data: connection });
    });
  });

  it('charge les connexions et les traces de qualification', async () => {
    render(<DistributionPage />);
    expect(await screen.findByRole('heading', { name: 'Distribution' })).toBeInTheDocument();
    expect((await screen.findAllByText('Google Reserve')).length).toBeGreaterThan(0);
    expect(await screen.findByText(/Disponibilités reçues/)).toBeInTheDocument();
    expect(await screen.findByText('Réservation modifiée')).toBeInTheDocument();
    expect(await screen.findByText(/Réservation liée/)).toBeInTheDocument();
    // Aucun identifiant interne, hash ni énumération brute côté restaurateur.
    expect(screen.queryByText(/reservation-1|reservation\.updated|BIDIRECTIONAL/)).toBeNull();
    expect(screen.queryByText(/hash|payload|2026-09-20T19:00:00Z-2/i)).toBeNull();
  });

  it('crée une connexion en conservant la référence opaque', async () => {
    render(<DistributionPage />);
    await screen.findByRole('heading', { name: 'Distribution' });
    fireEvent.change(screen.getByLabelText('Identifiant chez le partenaire'), {
      target: { value: 'location-1234' },
    });
    fireEvent.change(screen.getByLabelText('Référence d’accès'), {
      target: { value: 'vault/distribution/google' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la connexion' }));
    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith(
        'distribution/connections',
        expect.objectContaining({
          provider: 'GOOGLE_RESERVE',
          externalAccountId: 'location-1234',
          credentialReference: 'vault/distribution/google',
        }),
      ),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringMatching(/Connexion enregistrée\. Aucun partenaire/),
      ),
    );
  });

  it('met un run local en file avec une clé d’idempotence', async () => {
    render(<DistributionPage />);
    await screen.findByRole('heading', { name: 'Distribution' });
    await clickWhenEnabled(/Lancer une synchronisation/);
    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith(
        'distribution/connections/connection-1/sync-runs',
        { direction: 'BIDIRECTIONAL' },
        { headers: { 'Idempotency-Key': expect.any(String) } },
      ),
    );
  });

  it('explique calmement que le canal n’est pas encore ouvert, sans bandeau d’erreur', async () => {
    apiMocks.get.mockRejectedValue(toApiError(503, { error: 'DISTRIBUTION_DISABLED' }));
    render(<DistributionPage />);

    expect(
      await screen.findByText('Cette fonctionnalité n’est pas encore ouverte sur votre compte.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('DISTRIBUTION_DISABLED')).toBeNull();
    expect(screen.queryByLabelText('Partenaire')).toBeNull();
  });

  it('explique que le canal n’est pas dans la formule', async () => {
    apiMocks.get.mockRejectedValue(toApiError(403, { error: 'CAPABILITY_NOT_INCLUDED' }));
    render(<DistributionPage />);

    expect(
      await screen.findByText('Cette fonctionnalité n’est pas incluse dans votre formule.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /réessayer/i })).toBeNull();
  });

  it('propose de réessayer après une vraie panne, sans formulaire', async () => {
    apiMocks.get.mockRejectedValueOnce(toApiError(503, {}));
    render(<DistributionPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('momentanément indisponible');
    expect(screen.queryByLabelText('Partenaire')).toBeNull();
  });

  it('n’affiche pas « aucune synchronisation » pendant le chargement', async () => {
    apiMocks.get.mockImplementation(() => new Promise(() => undefined));
    render(<DistributionPage />);

    await screen.findByRole('heading', { name: 'Distribution' });
    expect(screen.queryByText(/Aucune synchronisation pour cette connexion/)).toBeNull();
    expect(screen.queryByText(/Aucune notification reçue/)).toBeNull();
    expect(screen.queryByText(/Aucun lien associé/)).toBeNull();
  });
});
