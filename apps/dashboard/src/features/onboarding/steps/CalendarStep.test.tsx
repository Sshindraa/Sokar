import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CalendarStep } from './CalendarStep';
const mocks = vi.hoisted(() => ({ updateTask: vi.fn() }));
vi.mock('../onboarding-provider', () => ({
  useOnboarding: () => ({
    state: { restaurant: { googleConnected: false } },
    updateTask: mocks.updateTask,
  }),
}));
beforeEach(() => {
  vi.clearAllMocks();
});
it('valide le choix du planning Sokar plutôt que de reporter l’étape', async () => {
  mocks.updateTask.mockResolvedValue({});
  const next = vi.fn();
  render(<CalendarStep onComplete={next} />);
  fireEvent.click(screen.getByRole('button', { name: 'Utiliser le planning manuel (Sokar OS)' }));
  await waitFor(() => expect(next).toHaveBeenCalledWith('phone'));
  expect(mocks.updateTask).toHaveBeenCalledWith('complete', 'calendar', {
    metadata: { planningMode: 'sokar' },
  });
});
it('ne poursuit pas le parcours si la validation échoue', async () => {
  mocks.updateTask.mockResolvedValue(null);
  const next = vi.fn();
  render(<CalendarStep onComplete={next} />);
  fireEvent.click(screen.getByRole('button', { name: 'Utiliser le planning manuel (Sokar OS)' }));
  await waitFor(() => expect(mocks.updateTask).toHaveBeenCalled());
  expect(next).not.toHaveBeenCalled();
});
