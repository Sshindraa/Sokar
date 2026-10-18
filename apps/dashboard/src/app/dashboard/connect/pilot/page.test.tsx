import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { toApiError } from '@/lib/api-error';
import ConnectPilotPage from './page';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ useApi: () => mocks }));

describe('ConnectPilotPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dit calmement que la page est réservée à l’équipe, sans « Réessayer » ni requête répétée', async () => {
    mocks.get.mockRejectedValue(toApiError(403, { error: 'Sokar operator access required' }));

    render(<ConnectPilotPage />);

    expect(await screen.findByText('Page réservée à l’équipe Sokar')).toBeInTheDocument();
    expect(screen.queryByText(/operator access/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /réessayer/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Aller au Pilotage' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it('propose de réessayer pour une vraie panne', async () => {
    mocks.get.mockRejectedValue(toApiError(503, {}));
    render(<ConnectPilotPage />);

    expect(await screen.findByText('KPIs indisponibles')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /réessayer/i })).toBeInTheDocument();
  });
});
