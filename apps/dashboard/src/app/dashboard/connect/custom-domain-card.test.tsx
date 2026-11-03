import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CustomDomainCard, normalizeDomainInput } from './custom-domain-card';
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

vi.mock('@/lib/api', () => ({ useApi: () => ({ siteId: 'site_1' }) }));

describe('normalizeDomainInput', () => {
  it.each([
    ['https://Reserve.MonResto.fr/', 'reserve.monresto.fr'],
    ['  http://reserve.monresto.fr/carte?x=1#haut ', 'reserve.monresto.fr'],
    ['reserve.monresto.fr.', 'reserve.monresto.fr'],
    ['reserve.monresto.fr', 'reserve.monresto.fr'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeDomainInput(input)).toBe(expected);
  });
});

describe('CustomDomainCard', () => {
  const fetchMock = vi.fn();
  const reload = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload },
      writable: true,
    });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepte une adresse collée depuis le navigateur et envoie le nom de domaine seul', async () => {
    render(<CustomDomainCard restaurantId="r1" customDomain={null} customDomainStatus={null} />);

    fireEvent.change(screen.getByLabelText('Domaine'), {
      target: { value: 'https://Reserve.MonResto.fr/' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Configurer le domaine' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      customDomain: 'reserve.monresto.fr',
    });
  });

  it('refuse un texte qui n’est pas un domaine, en français, sans appeler l’API', async () => {
    render(<CustomDomainCard restaurantId="r1" customDomain={null} customDomainStatus={null} />);

    fireEvent.change(screen.getByLabelText('Domaine'), {
      target: { value: 'pas un domaine' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Configurer le domaine' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('Saisissez le nom de domaine seul'),
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('demande confirmation avant de retirer un domaine en service', async () => {
    render(
      <CustomDomainCard
        restaurantId="r1"
        customDomain="reserve.monresto.fr"
        customDomainStatus="active"
      />,
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'Actions du domaine' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Retirer le domaine' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Retirer le domaine personnalisé ?');
    expect(dialog).toHaveTextContent('reserve.monresto.fr');
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Retirer le domaine' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ customDomain: null });
  });

  it('traduit une réponse d’erreur de l’API', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Validation Error', details: [{ path: 'customDomain' }] }),
    });
    render(<CustomDomainCard restaurantId="r1" customDomain={null} customDomainStatus={null} />);

    fireEvent.change(screen.getByLabelText('Domaine'), {
      target: { value: 'reserve.monresto.fr' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Configurer le domaine' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/Certains champs ne sont pas valides/),
      ),
    );
    expect(screen.queryByText('Validation Error')).not.toBeInTheDocument();
  });
});
