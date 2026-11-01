import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../messages/fr.json';
import enMessages from '../../../messages/en.json';
import { TonightCard } from './TonightCard';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({
  useApi: () => ({ get: mocks.get, post: vi.fn(), siteId: 'site_1' }),
}));

const CARD = {
  service: 'soir',
  date: '2026-10-31',
  covers: 32,
  usualCovers: 28.5,
  specialRequestsCount: 0,
  waitlistCount: 0,
  watch: [],
  attention: [],
  brief: null,
};
const SUMMARY = 'Ce soir, 32 couverts, contre 28,5 habituellement.';
const COVERS_LINE = '32 couverts · habituellement 28,5 couverts';

function renderCard() {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <TonightCard />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  mocks.get.mockReset();
});

describe('TonightCard : résumé', () => {
  it('affiche le résumé déjà en cache au-dessus de la carte, sans second appel', async () => {
    mocks.get.mockResolvedValue({ ...CARD, brief: SUMMARY });
    renderCard();

    const summary = await screen.findByText(SUMMARY);
    const covers = screen.getByText(COVERS_LINE);

    expect(summary.compareDocumentPosition(covers) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it('demande le résumé après la carte quand il n’est pas en cache, puis l’affiche', async () => {
    mocks.get.mockImplementation(async (path: string) =>
      path === 'companion/tonight?lang=fr' ? CARD : { brief: SUMMARY },
    );
    renderCard();

    expect(await screen.findByText(SUMMARY)).toBeInTheDocument();
    expect(screen.getByText(COVERS_LINE)).toBeInTheDocument();
    expect(mocks.get).toHaveBeenNthCalledWith(1, 'companion/tonight?lang=fr');
    expect(mocks.get).toHaveBeenNthCalledWith(2, 'companion/tonight/brief?lang=fr');
  });

  it('montre un chargement discret pendant que le résumé se prépare, la carte déjà affichée', async () => {
    mocks.get.mockImplementation((path: string) =>
      path === 'companion/tonight?lang=fr' ? Promise.resolve(CARD) : new Promise(() => {}),
    );
    renderCard();

    expect(await screen.findByText('Résumé en préparation…')).toBeInTheDocument();
    expect(screen.getByText(COVERS_LINE)).toBeInTheDocument();
  });

  it('n’affiche rien quand le résumé est absent ou en échec, et garde la carte', async () => {
    mocks.get.mockImplementation((path: string) =>
      path === 'companion/tonight?lang=fr'
        ? Promise.resolve(CARD)
        : Promise.reject(new Error('réseau')),
    );
    renderCard();

    expect(await screen.findByText(COVERS_LINE)).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(screen.queryByText('Résumé en préparation…')).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('n’affiche pas de résumé quand le serveur répond null', async () => {
    mocks.get.mockImplementation((path: string) =>
      path === 'companion/tonight?lang=fr'
        ? Promise.resolve(CARD)
        : Promise.resolve({ brief: null }),
    );
    renderCard();

    expect(await screen.findByText(COVERS_LINE)).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(screen.queryByText('Résumé en préparation…')).not.toBeInTheDocument(),
    );
    expect(screen.queryByText(SUMMARY)).not.toBeInTheDocument();
  });

  it('demande le résumé dans la langue du tableau de bord', async () => {
    mocks.get.mockImplementation(async (path: string) =>
      path.startsWith('companion/tonight?') ? CARD : { brief: SUMMARY },
    );
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <TonightCard />
      </NextIntlClientProvider>,
    );

    expect(await screen.findByText(SUMMARY)).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledWith('companion/tonight?lang=en');
    expect(mocks.get).toHaveBeenCalledWith('companion/tonight/brief?lang=en');
  });
});
