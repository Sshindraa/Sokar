import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CallsPage from './page';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  orgId: 'org_test',
  siteId: undefined as string | undefined,
}));

vi.mock('@/lib/api', () => ({
  useApi: () => mocks,
}));

const media = vi.hoisted(() => ({ compact: false }));

vi.mock('@/lib/useMediaQuery', () => ({
  useMediaQuery: () => media.compact,
  useIsMobile: () => media.compact,
}));

function makeCall(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `call-${index}`,
    callSid: `sid-${index}`,
    callerPhone: '+33612345678',
    durationSec: 60,
    transcript: `Bonjour, je voudrais réserver une table pour ${index} personnes ce soir.`,
    intent: 'RESERVATION',
    outcome: 'RESERVED',
    carrier: 'telnyx',
    recordingStatus: 'NOT_REQUESTED',
    recordingStartedAt: null,
    recordingEndedAt: null,
    recordingExpiresAt: null,
    createdAt: '2026-10-16T18:30:00.000Z',
    ...overrides,
  };
}

describe('CallsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    media.compact = false;
  });

  it('propose un nouvel essai sans afficher une liste vide après une panne API', async () => {
    mocks.get
      .mockRejectedValueOnce(new Error('Impossible de joindre le serveur API'))
      .mockResolvedValueOnce({ data: [], total: 0 });

    render(<CallsPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Impossible de joindre le serveur API');
    expect(screen.queryByText('Aucun appel.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    await waitFor(() => {
      expect(screen.getByText('Aucun appel.')).toBeInTheDocument();
    });
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it("n'affiche pas « 0 appel » au-dessus du message d'erreur", async () => {
    mocks.get.mockRejectedValueOnce(new Error('Panne'));
    render(<CallsPage />);
    await screen.findByRole('alert');
    expect(screen.queryByText(/\d+ appels?$/)).not.toBeInTheDocument();
  });

  it('charge les appels suivants quand le total dépasse la page affichée, sans doublon', async () => {
    mocks.get
      .mockResolvedValueOnce({ data: [makeCall(1), makeCall(2)], total: 3 })
      .mockResolvedValueOnce({ data: [makeCall(2), makeCall(3)], total: 3 });

    render(<CallsPage />);

    expect(await screen.findByText('3 appels')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /afficher plus d'appels \(2 sur 3\)/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/Bonjour, je voudrais réserver/)).toHaveLength(3);
    });
    expect(mocks.get).toHaveBeenLastCalledWith('calls?restaurantId=org_test&limit=100&offset=2');
    expect(screen.queryByRole('button', { name: /afficher plus/i })).not.toBeInTheDocument();
  });

  it('ouvre la transcription complète au clic', async () => {
    const long = `${'Bonjour. '.repeat(20)}Fin de l'appel.`;
    mocks.get.mockResolvedValueOnce({ data: [makeCall(1, { transcript: long })], total: 1 });

    render(<CallsPage />);

    fireEvent.click(await screen.findByText('+33 6 12 34 56 78'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent("Fin de l'appel.");
    expect(dialog).toHaveTextContent('Appel');
  });

  it("n'affiche plus l'opérateur télécom, et dit « Transcription » en français", async () => {
    mocks.get.mockResolvedValueOnce({ data: [makeCall(1)], total: 1 });
    render(<CallsPage />);
    await screen.findByText('1 appel');
    expect(screen.queryByText('telnyx')).not.toBeInTheDocument();
    expect(screen.queryByText('Opérateur')).not.toBeInTheDocument();
    expect(screen.queryByText('Transcript')).not.toBeInTheDocument();
    expect(screen.getByText('Transcription')).toBeInTheDocument();
  });

  it('passe en cartes sous 1024 px, iPad compris', async () => {
    media.compact = true;
    mocks.get.mockResolvedValueOnce({ data: [makeCall(1)], total: 1 });
    render(<CallsPage />);
    await screen.findByText('1 appel');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('+33 6 12 34 56 78'));
    expect(await screen.findByRole('dialog', { name: 'Appel' })).toBeInTheDocument();
  });
});
