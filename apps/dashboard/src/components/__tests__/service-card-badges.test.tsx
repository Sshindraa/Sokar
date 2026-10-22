import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ServiceCardBadges, useServiceCards } from '@/components/reservation/service-card-badges';

const mocks = vi.hoisted(() => ({ orgId: 'org_test', get: vi.fn() }));
vi.mock('@/lib/api', () => ({ useApi: () => mocks }));

function Harness({ ids }: { ids: string[] }) {
  const state = useServiceCards(ids);
  return (
    <div>
      {ids.map((id) => (
        <div key={id} data-testid={`row-${id}`}>
          <ServiceCardBadges reservationId={id} state={state} />
        </div>
      ))}
    </div>
  );
}

describe('ServiceCardBadges', () => {
  beforeEach(() => vi.clearAllMocks());

  it('charge toute la liste en une requête et affiche les badges de chaque réservation', async () => {
    mocks.get.mockResolvedValue({
      data: [
        {
          reservationId: 'r1',
          customerId: 'c1',
          lifecycle: { status: 'regular', reason: '4 visites en 90 jours' },
          badges: [
            { kind: 'regular', label: 'Habitué', detail: '4 visites en 90 jours' },
            { kind: 'allergy', label: 'Allergie', detail: 'Arachides' },
          ],
        },
        { reservationId: 'r2', customerId: null, lifecycle: null, badges: [] },
      ],
    });

    render(<Harness ids={['r1', 'r2']} />);

    expect(await screen.findByText('Habitué')).toBeInTheDocument();
    expect(screen.getByText('Allergie').closest('li')).toHaveAttribute('title', 'Arachides');
    expect(screen.getByTestId('row-r2')).toBeEmptyDOMElement();
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get.mock.calls[0][0]).toBe('customers/service-cards?reservationIds=r1,r2');
  });

  it('signale une fiche indisponible sans bloquer la liste', async () => {
    mocks.get.mockRejectedValue(new Error('boom'));
    render(<Harness ids={['r1']} />);
    expect(await screen.findByText('Fiche indisponible')).toBeInTheDocument();
  });

  it('ne lance aucune requête sans réservation', async () => {
    render(<Harness ids={[]} />);
    await waitFor(() => expect(mocks.get).not.toHaveBeenCalled());
  });
});
