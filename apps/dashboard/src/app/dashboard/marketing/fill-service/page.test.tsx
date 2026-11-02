import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../messages/fr.json';
import { CAMPAIGN_DRAFT_KEY } from '@/features/companion/campaign-draft';
import FillServicePage from './page';

const apiMocks = vi.hoisted(() => ({
  post: vi.fn(),
  orgId: 'org_test_123' as string | undefined,
  push: vi.fn(),
  search: 'date=2026-11-04&service=midi',
}));

vi.mock('@/lib/api', () => ({
  useApi: () => ({ orgId: apiMocks.orgId, post: apiMocks.post }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: apiMocks.push }),
  useSearchParams: () => new URLSearchParams(apiMocks.search),
}));

const plannedPreview = {
  date: '2026-11-04',
  service: 'midi',
  channel: 'SMS',
  status: 'PLANNED',
  full: false,
  capacityKnown: true,
  freePlaces: 116,
  emptyPlaces: 62,
  forecastSource: 'historique',
  candidateCount: 108,
  excludedSameDay: 0,
  excludedNearby: 0,
  tiers: { CRENEAU: 9, REGULIER: 12 },
  budgetExhausted: false,
  excludedByReason: { NO_CONSENT: 4 },
  audience: 108,
  holdout: 11,
  sends: 97,
  costEstimate: { amount: 4.5, status: 'PRICED' },
  template: {
    subject: null,
    bodyTemplate:
      'Bonjour {{customer.firstName}}, une table est disponible. {{reservationLink}} {{unsubscribeUrl}}',
  },
};

function renderPage() {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <FillServicePage />
    </NextIntlClientProvider>,
  );
}

describe('FillServicePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    apiMocks.orgId = 'org_test_123';
    apiMocks.search = 'date=2026-11-04&service=midi';
    apiMocks.post.mockImplementation((path: string) => {
      if (path === 'marketing/fill-service/preview') {
        return Promise.resolve({ data: plannedPreview });
      }
      if (path === 'marketing/fill-service') {
        return Promise.resolve({ data: { id: 'campaign-fill-1' } });
      }
      return Promise.resolve({});
    });
  });

  it('affiche les chiffres de l’aperçu et le texte par défaut, sans nom de client', async () => {
    renderPage();

    expect(await screen.findByText('116')).toBeInTheDocument();
    expect(screen.getByText('Clients candidats')).toBeInTheDocument();
    expect(screen.getAllByText('108', { selector: 'dd' })).toHaveLength(2);
    expect(screen.getByText('Témoin (sans message)')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(
      'Bonjour {{customer.firstName}}, une table est disponible. {{reservationLink}} {{unsubscribeUrl}}',
    );
    expect(apiMocks.post).toHaveBeenCalledWith('marketing/fill-service/preview', {
      date: '2026-11-04',
      service: 'midi',
      channel: 'SMS',
    });
  });

  it('?channel=EMAIL ouvre l’aperçu en e-mail ; sans paramètre, il reste en SMS', async () => {
    renderPage();
    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith('marketing/fill-service/preview', {
        date: '2026-11-04',
        service: 'midi',
        channel: 'SMS',
      }),
    );

    apiMocks.post.mockClear();
    apiMocks.search = 'date=2026-11-04&service=midi&channel=EMAIL';
    renderPage();
    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith('marketing/fill-service/preview', {
        date: '2026-11-04',
        service: 'midi',
        channel: 'EMAIL',
      }),
    );
  });

  it('places vides probables et mention d’estimation affichées', async () => {
    renderPage();

    expect(await screen.findByText('Places vides probables')).toBeInTheDocument();
    expect(screen.getByText('62')).toBeInTheDocument();
    expect(
      screen.getByText('Estimation de départ, pas encore mesurée sur vos campagnes.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Estimation sans historique suffisant')).not.toBeInTheDocument();
  });

  it('composition lisible : « 9 habitués de ce créneau, 12 clients réguliers »', async () => {
    renderPage();

    expect(
      await screen.findByText('9 habitués de ce créneau, 12 clients réguliers'),
    ).toBeInTheDocument();
  });

  it('mention dédiée quand forecastSource vaut simple', async () => {
    apiMocks.post.mockResolvedValueOnce({
      data: { ...plannedPreview, forecastSource: 'simple' },
    });
    renderPage();

    expect(await screen.findByText('Estimation sans historique suffisant')).toBeInTheDocument();
  });

  it('prévision à 0 : message dédié, sans formulaire', async () => {
    apiMocks.post.mockResolvedValueOnce({
      data: { ...plannedPreview, emptyPlaces: 0, audience: 0, sends: 0, holdout: 0 },
    });
    renderPage();

    expect(await screen.findByText(/aucune place vide probable/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Créer la campagne' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument();
  });

  it('budget épuisé : message dédié, sans formulaire', async () => {
    apiMocks.post.mockResolvedValueOnce({
      data: { ...plannedPreview, channel: 'EMAIL', budgetExhausted: true, audience: 0, sends: 0 },
    });
    renderPage();

    expect(await screen.findByText(/budget d’e-mails du jour est épuisé/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Créer la campagne' })).not.toBeInTheDocument();
  });

  it('service plein : le dit et ne propose pas de créer la campagne', async () => {
    apiMocks.post.mockResolvedValueOnce({
      data: { ...plannedPreview, status: 'SERVICE_FULL', full: true },
    });
    renderPage();

    expect(
      await screen.findByText('Ce service est complet : plus aucun créneau pour 2 couverts.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Créer la campagne' })).not.toBeInTheDocument();
  });

  it('service non ouvert : le dit sans parler de service complet', async () => {
    apiMocks.post.mockResolvedValueOnce({
      data: { ...plannedPreview, status: 'SERVICE_CLOSED', full: false },
    });
    renderPage();

    expect(
      await screen.findByText('Le restaurant n’ouvre pas ce service ce jour-là : rien à remplir.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/complet/)).not.toBeInTheDocument();
  });

  it('aucun client joignable : explique pourquoi', async () => {
    apiMocks.post.mockResolvedValueOnce({
      data: { ...plannedPreview, candidateCount: 0, audience: 0, excludedSameDay: 2 },
    });
    renderPage();

    expect(await screen.findByText('Aucun client joignable pour ce service.')).toBeInTheDocument();
    expect(
      screen.getByText(/Sans accord : 4 · Opposés : 0 · Déjà réservés ce jour : 2/),
    ).toBeInTheDocument();
  });

  it('reprend le texte du brouillon Companion, une seule fois', async () => {
    window.sessionStorage.setItem(
      CAMPAIGN_DRAFT_KEY,
      JSON.stringify({
        channel: 'SMS',
        name: 'Relance',
        objective: 'Remplir',
        body: 'Texte rédigé par Companion {{reservationLink}} {{unsubscribeUrl}}',
      }),
    );
    renderPage();

    expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue(
      'Texte rédigé par Companion {{reservationLink}} {{unsubscribeUrl}}',
    );
    expect(window.sessionStorage.getItem(CAMPAIGN_DRAFT_KEY)).toBeNull();
  });

  it('crée la campagne sans envoyer, puis mène à la campagne créée', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Créer la campagne' }));

    await waitFor(() => {
      expect(apiMocks.push).toHaveBeenCalledWith('/dashboard/marketing?campaign=campaign-fill-1');
    });
    expect(apiMocks.post).toHaveBeenCalledWith(
      'marketing/fill-service',
      expect.objectContaining({
        date: '2026-11-04',
        service: 'midi',
        channel: 'SMS',
        subject: null,
        bodyTemplate: plannedPreview.template.bodyTemplate,
      }),
    );
  });

  it('affiche le refus lisible du serveur quand la création échoue', async () => {
    const { ApiError } = await import('@/lib/api-error');
    apiMocks.post.mockImplementation((path: string) => {
      if (path === 'marketing/fill-service') {
        return Promise.reject(
          new ApiError(
            'Ce service est complet : plus aucun créneau pour 2 couverts.',
            409,
            'FILL_SERVICE_FULL',
          ),
        );
      }
      return Promise.resolve({ data: plannedPreview });
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Créer la campagne' }));

    expect(
      await screen.findByText('Ce service est complet : plus aucun créneau pour 2 couverts.'),
    ).toBeInTheDocument();
    expect(apiMocks.push).not.toHaveBeenCalled();
  });
});
