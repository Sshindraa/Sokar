import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DistributionPage from './page';

const apiMocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/lib/api', () => ({
  useApi: () => ({ get: apiMocks.get, post: apiMocks.post }),
}));

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
    expect(await screen.findByRole('heading', { name: 'Canaux partenaires' })).toBeInTheDocument();
    expect((await screen.findAllByText('Google Reserve')).length).toBeGreaterThan(0);
    expect(await screen.findByText(/Snapshots de disponibilité/)).toBeInTheDocument();
    expect(await screen.findByText(/reservation.updated/)).toBeInTheDocument();
    expect(await screen.findByText(/Réservation reservation-1/)).toBeInTheDocument();
  });

  it('crée une connexion en conservant la référence opaque', async () => {
    render(<DistributionPage />);
    await screen.findByRole('heading', { name: 'Canaux partenaires' });
    fireEvent.change(screen.getByLabelText('Identifiant externe'), {
      target: { value: 'location-1234' },
    });
    fireEvent.change(screen.getByLabelText('Référence du secret'), {
      target: { value: 'vault/distribution/google' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer en qualification' }));
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
    expect(
      await screen.findByText(/Connexion enregistrée en qualification locale/),
    ).toBeInTheDocument();
  });

  it('met un run local en file avec une clé d’idempotence', async () => {
    render(<DistributionPage />);
    await screen.findByRole('heading', { name: 'Canaux partenaires' });
    fireEvent.click(screen.getByRole('button', { name: /Mettre un run local en file/ }));
    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith(
        'distribution/connections/connection-1/sync-runs',
        { direction: 'BIDIRECTIONAL' },
        { headers: { 'Idempotency-Key': expect.any(String) } },
      ),
    );
  });

  it('explique le verrouillage quand le flag reste fermé', async () => {
    apiMocks.get.mockRejectedValue(new Error('DISTRIBUTION_DISABLED'));
    render(<DistributionPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('DISTRIBUTION_DISABLED');
    expect(await screen.findByText('Canaux partenaires verrouillés')).toBeInTheDocument();
  });
});
