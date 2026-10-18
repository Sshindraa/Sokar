import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceCopilotAccess } from './ServiceCopilotAccess';
const mocks = vi.hoisted(() => ({ get: vi.fn(), orgId: 'site-a' }));
vi.mock('@/lib/api', () => ({ useApi: () => mocks }));
function Content() {
  return <p>Actions du copilote</p>;
}
const rights = (site: string, allowed: boolean) => ({
  restaurantId: site,
  capabilities: { 'floorPlan.copilot': allowed },
});
describe('ServiceCopilotAccess — droits effectifs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.orgId = 'site-a';
  });
  it('ne monte pas les actions pour un nouvel Essential', async () => {
    mocks.get.mockResolvedValue(rights('site-a', false));
    render(
      <ServiceCopilotAccess>
        <Content />
      </ServiceCopilotAccess>,
    );
    expect(await screen.findByText(/Le copilote de service accompagne/)).toBeInTheDocument();
    expect(screen.queryByText('Actions du copilote')).not.toBeInTheDocument();
  });
  it('respecte les droits effectifs, y compris un droit historique Essential', async () => {
    mocks.get.mockResolvedValue(rights('site-a', true));
    render(
      <ServiceCopilotAccess>
        <Content />
      </ServiceCopilotAccess>,
    );
    expect(await screen.findByText('Actions du copilote')).toBeInTheDocument();
  });
  it('reste fermé en cas d’erreur et permet de réessayer', async () => {
    mocks.get
      .mockRejectedValueOnce(new Error('réseau'))
      .mockResolvedValueOnce(rights('site-a', true));
    render(
      <ServiceCopilotAccess>
        <Content />
      </ServiceCopilotAccess>,
    );
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Actions du copilote')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Actions du copilote')).toBeInTheDocument();
  });
  it('retire immédiatement les actions au changement de restaurant et ignore la réponse précédente', async () => {
    let resolveOld!: (value: ReturnType<typeof rights>) => void;
    mocks.get
      .mockResolvedValueOnce(rights('site-a', true))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce(rights('site-c', false));
    const { rerender } = render(
      <ServiceCopilotAccess>
        <Content />
      </ServiceCopilotAccess>,
    );
    await screen.findByText('Actions du copilote');
    mocks.orgId = 'site-b';
    rerender(
      <ServiceCopilotAccess>
        <Content />
      </ServiceCopilotAccess>,
    );
    expect(screen.queryByText('Actions du copilote')).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    mocks.orgId = 'site-c';
    rerender(
      <ServiceCopilotAccess>
        <Content />
      </ServiceCopilotAccess>,
    );
    await screen.findByText(/Le copilote de service accompagne/);
    await act(async () => resolveOld(rights('site-b', true)));
    expect(screen.queryByText('Actions du copilote')).not.toBeInTheDocument();
  });

  it('ne montre ni vérification ni annonce quand le fallback est vide (écran de service)', async () => {
    mocks.get.mockResolvedValue(rights('site-a', false));
    const { container } = render(
      <ServiceCopilotAccess fallback={null}>
        <Content />
      </ServiceCopilotAccess>,
    );

    expect(screen.queryByText(/Vérification de l’accès/)).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/Le copilote de service accompagne/)).not.toBeInTheDocument();
  });
});
