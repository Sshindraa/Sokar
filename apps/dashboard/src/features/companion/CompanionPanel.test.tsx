import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../messages/fr.json';
import { ApiError } from '@/lib/api-error';
import { CompanionPanel } from './CompanionPanel';

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  siteId: 'site_1' as string | undefined,
}));
vi.mock('@/lib/api', () => ({
  useApi: () => ({ post: mocks.post, siteId: mocks.siteId }),
}));

const WEEK_QUESTION = 'Comment se présentent les 7 prochains jours ?';
const RESPONSE_ID = '3f2b8c1e-5d4a-4b7e-9c1f-2a6d8e0b7c45';

function renderPanel() {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <CompanionPanel />
    </NextIntlClientProvider>,
  );
}

function typeInDraft(text: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.siteId = 'site_1';
  window.sessionStorage.clear();
});

afterEach(() => {
  window.sessionStorage.clear();
});

describe('CompanionPanel', () => {
  it('envoie la suggestion comme question et affiche la réponse avec un seul lien par écran', async () => {
    mocks.post.mockResolvedValue({
      reply: 'Vous avez 12 couverts prévus.',
      sources: [
        { tool: 'upcoming_days', href: '/dashboard' },
        { tool: 'reservation_stats', href: '/dashboard' },
      ],
    });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: WEEK_QUESTION }));

    expect(mocks.post).toHaveBeenCalledWith('companion/chat', {
      messages: [{ role: 'user', content: WEEK_QUESTION }],
    });
    expect(await screen.findByText('Vous avez 12 couverts prévus.')).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: 'Voir dans le tableau de bord' });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/dashboard');
  });

  it('affiche la mention permanente et envoie avec Entrée, sans Maj+Entrée', () => {
    mocks.post.mockResolvedValue({ reply: 'OK.', sources: [] });
    renderPanel();

    expect(
      screen.getByText(
        'Réponses générées par IA, à vérifier. Ne saisissez pas de coordonnées client.',
      ),
    ).toBeInTheDocument();

    typeInDraft('Combien de no-shows ?');
    const field = screen.getByRole('textbox');
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    expect(mocks.post).not.toHaveBeenCalled();

    fireEvent.keyDown(field, { key: 'Enter' });
    expect(mocks.post).toHaveBeenCalledWith('companion/chat', {
      messages: [{ role: 'user', content: 'Combien de no-shows ?' }],
    });
  });

  it('affiche le message d’erreur de l’API, puis Réessayer renvoie la même question', async () => {
    mocks.post.mockRejectedValueOnce(
      new ApiError(
        'Vous avez atteint la limite de 100 messages pour aujourd’hui. Réessayez demain.',
        429,
        'COMPANION_DAILY_LIMIT',
      ),
    );
    mocks.post.mockResolvedValueOnce({ reply: 'Réponse après réessai.', sources: [] });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: WEEK_QUESTION }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Vous avez atteint la limite de 100 messages pour aujourd’hui.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    expect(mocks.post).toHaveBeenLastCalledWith('companion/chat', {
      messages: [{ role: 'user', content: WEEK_QUESTION }],
    });
    expect(await screen.findByText('Réponse après réessai.')).toBeInTheDocument();
  });

  it('restaure l’historique du site depuis sessionStorage et le sépare par site', () => {
    window.sessionStorage.setItem(
      'sokar.companion.site_1',
      JSON.stringify([
        { role: 'user', content: 'Question ancienne' },
        { role: 'assistant', content: 'Réponse ancienne', sources: [] },
      ]),
    );
    const first = renderPanel();
    expect(screen.getByText('Réponse ancienne')).toBeInTheDocument();
    first.unmount();

    mocks.siteId = 'site_2';
    renderPanel();
    expect(screen.queryByText('Réponse ancienne')).not.toBeInTheDocument();
    expect(screen.getByText(/Je suis l'assistant IA de Sokar/)).toBeInTheDocument();
  });

  it('lit une entrée ancienne qui contient toolRuns sans ce champ', async () => {
    window.sessionStorage.setItem(
      'sokar.companion.site_1',
      JSON.stringify([
        { role: 'user', content: 'Question ancienne' },
        {
          role: 'assistant',
          content: 'Réponse ancienne',
          sources: [],
          toolRuns: [{ name: 'upcoming_days', arguments: '{}', result: '{}' }],
        },
      ]),
    );
    mocks.post.mockResolvedValue({ reply: 'Suite.', sources: [] });
    renderPanel();

    expect(screen.getByText('Réponse ancienne')).toBeInTheDocument();
    typeInDraft('Et la suite ?');
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });

    expect(await screen.findByText('Suite.')).toBeInTheDocument();
    expect(mocks.post).toHaveBeenLastCalledWith('companion/chat', {
      messages: [
        { role: 'user', content: 'Question ancienne' },
        { role: 'assistant', content: 'Réponse ancienne' },
        { role: 'user', content: 'Et la suite ?' },
      ],
    });
  });

  it('pouce bas : envoie l’avis avec le responseId, puis verrouille les boutons', async () => {
    mocks.post.mockResolvedValueOnce({
      reply: 'Sept jours.',
      sources: [],
      responseId: RESPONSE_ID,
    });
    mocks.post.mockResolvedValueOnce(undefined);
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: WEEK_QUESTION }));
    await screen.findByText('Sept jours.');
    fireEvent.click(screen.getByRole('button', { name: 'Réponse peu utile' }));

    expect(mocks.post).toHaveBeenLastCalledWith('companion/feedback', {
      responseId: RESPONSE_ID,
      rating: 'down',
    });
    expect(screen.getByRole('button', { name: 'Réponse peu utile' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Réponse peu utile' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Réponse utile' })).toBeDisabled();
  });

  it('échec de l’avis : silencieux, les boutons redeviennent disponibles', async () => {
    mocks.post.mockResolvedValueOnce({
      reply: 'Sept jours.',
      sources: [],
      responseId: RESPONSE_ID,
    });
    mocks.post.mockRejectedValueOnce(new ApiError('Erreur réseau', 500, null));
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: WEEK_QUESTION }));
    await screen.findByText('Sept jours.');
    fireEvent.click(screen.getByRole('button', { name: 'Réponse utile' }));

    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Réponse utile' })).toBeEnabled(),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('une entrée sans responseId n’affiche pas de boutons d’avis', () => {
    window.sessionStorage.setItem(
      'sokar.companion.site_1',
      JSON.stringify([
        { role: 'user', content: 'Question ancienne' },
        { role: 'assistant', content: 'Réponse ancienne', sources: [] },
      ]),
    );
    renderPanel();

    expect(screen.getByText('Réponse ancienne')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Réponse utile' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Réponse peu utile' })).not.toBeInTheDocument();
  });

  it('Nouvelle conversation vide l’historique du site', () => {
    window.sessionStorage.setItem(
      'sokar.companion.site_1',
      JSON.stringify([{ role: 'user', content: 'Question ancienne' }]),
    );
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Nouvelle conversation' }));

    expect(window.sessionStorage.getItem('sokar.companion.site_1')).toBeNull();
    expect(screen.queryByText('Question ancienne')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: WEEK_QUESTION })).toBeInTheDocument();
  });
});
