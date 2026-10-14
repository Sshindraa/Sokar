import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OnboardingPlan } from './onboarding-plan';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({ useApi: () => mocks }));

const assign = vi.fn();
const originalLocation = window.location;

function setSearch(search: string) {
  window.history.replaceState(null, '', `/onboarding${search}`);
}

function renderPlan(onContinue = vi.fn()) {
  render(<OnboardingPlan restaurantId="restaurant-1" onContinue={onContinue} />);
  return onContinue;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  setSearch('');
  mocks.get.mockResolvedValue({ plan: 'essential', subscriptionStatus: null });
  mocks.post.mockResolvedValue({ url: 'https://checkout.stripe.test/cs_1' });
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      // `search` suit l'adresse réelle, que les tests changent avec `history.replaceState`.
      get search() {
        return originalLocation.search;
      },
      assign,
    },
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

const radio = (name: RegExp) => screen.getByRole('radio', { name });

it('propose les trois formules, Pro sélectionnée par défaut, facturation annuelle', async () => {
  renderPlan();

  expect(await screen.findByRole('radiogroup', { name: 'Formule' })).toBeInTheDocument();
  expect(radio(/^Essential/)).toHaveAttribute('aria-checked', 'false');
  expect(radio(/^Pro/)).toHaveAttribute('aria-checked', 'true');
  expect(radio(/^Multi-site/)).toHaveAttribute('aria-checked', 'false');
  expect(screen.getByRole('button', { name: /Annuel/ })).toHaveAttribute('aria-pressed', 'true');
});

it('reprend la formule choisie sur la page Tarifs, dans l’adresse', async () => {
  setSearch('?subscribe_plan=essential&billing=monthly');
  renderPlan();

  await screen.findByRole('radiogroup', { name: 'Formule' });
  expect(radio(/^Essential/)).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('button', { name: 'Mensuel' })).toHaveAttribute('aria-pressed', 'true');
});

it('reprend le choix gardé par le navigateur quand l’adresse ne l’a plus', async () => {
  window.localStorage.setItem(
    'sokar:onboarding:plan-choice',
    JSON.stringify({ plan: 'multi-site', billing: 'annual', siteCount: 4 }),
  );
  renderPlan();

  await screen.findByRole('radiogroup', { name: 'Formule' });
  expect(radio(/^Multi-site/)).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByLabelText('Nombre d’établissements')).toHaveValue(4);
});

it('envoie le choix à Stripe en demandant le retour vers l’inscription', async () => {
  setSearch('?subscribe_plan=essential&billing=monthly');
  renderPlan();
  await screen.findByRole('radiogroup', { name: 'Formule' });

  fireEvent.click(screen.getByRole('button', { name: /Payer et continuer/ }));

  await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.test/cs_1'));
  expect(mocks.post).toHaveBeenCalledWith('billing/checkout-session', {
    plan: 'essential',
    billing: 'monthly',
    returnTo: 'onboarding',
  });
});

it('transmet le nombre d’établissements du Multi-site, borné entre 2 et 100', async () => {
  renderPlan();
  await screen.findByRole('radiogroup', { name: 'Formule' });
  fireEvent.click(radio(/^Multi-site/));
  const input = screen.getByLabelText('Nombre d’établissements');
  fireEvent.change(input, { target: { value: '1' } });
  expect(input).toHaveValue(2);
  fireEvent.change(input, { target: { value: '500' } });
  expect(input).toHaveValue(100);
  fireEvent.change(input, { target: { value: '6' } });

  fireEvent.click(screen.getByRole('button', { name: /Payer et continuer/ }));

  await waitFor(() => expect(mocks.post).toHaveBeenCalled());
  expect(mocks.post).toHaveBeenCalledWith(
    'billing/checkout-session',
    expect.objectContaining({ plan: 'multi-site', siteCount: 6 }),
  );
});

it('affiche l’erreur du paiement et laisse continuer sans payer', async () => {
  mocks.post.mockRejectedValue(new Error('La souscription en ligne sera bientôt disponible.'));
  const onContinue = renderPlan();
  await screen.findByRole('radiogroup', { name: 'Formule' });

  fireEvent.click(screen.getByRole('button', { name: /Payer et continuer/ }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'La souscription en ligne sera bientôt disponible.',
  );
  expect(assign).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /Payer et continuer/ })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Plus tard' }));
  expect(onContinue).toHaveBeenCalledTimes(1);
});

it('« Plus tard » continue et retient le choix pour ne pas reproposer l’écran', async () => {
  const onContinue = renderPlan();
  await screen.findByRole('radiogroup', { name: 'Formule' });

  fireEvent.click(screen.getByRole('button', { name: 'Plus tard' }));

  expect(onContinue).toHaveBeenCalledTimes(1);
  expect(window.localStorage.getItem('sokar:onboarding:plan-dismissed:restaurant-1')).toBe('1');
  expect(mocks.post).not.toHaveBeenCalled();
});

it('annonce qu’un abonnement actif est déjà en place, sans proposer de repayer', async () => {
  mocks.get.mockResolvedValue({ plan: 'pro', subscriptionStatus: 'active' });
  const onContinue = renderPlan();

  expect(await screen.findByText('Votre formule est active.')).toBeInTheDocument();
  expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Continuer/ }));
  expect(onContinue).toHaveBeenCalledTimes(1);
});

it('propose quand même le choix si le statut de facturation est illisible', async () => {
  mocks.get.mockRejectedValue(new Error('indisponible'));
  renderPlan();

  expect(await screen.findByRole('radiogroup', { name: 'Formule' })).toBeInTheDocument();
});

it('rassure après un paiement annulé chez Stripe', async () => {
  setSearch('?step=formule&billing=cancelled');
  renderPlan();

  expect(await screen.findByText(/rien n’a été débité/)).toBeInTheDocument();
});

it('indique le chargement pendant la vérification de la formule', () => {
  mocks.get.mockReturnValue(new Promise(() => undefined));
  renderPlan();

  expect(screen.getByRole('status')).toHaveTextContent('Vérification de votre formule');
});
