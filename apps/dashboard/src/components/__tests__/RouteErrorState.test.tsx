import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouteErrorState } from '../RouteErrorState';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => {
    if (key === 'errorDigest') return `Référence de l'incident : ${values?.digest}`;
    const map: Record<string, string> = {
      errorTitle: 'Une erreur est survenue',
      errorDescription: 'Le tableau de bord a rencontré un problème inattendu.',
      retry: 'Réessayer',
    };
    return map[key] ?? key;
  },
}));

describe('RouteErrorState', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('affiche le message d’erreur et le bouton de reprise', () => {
    render(<RouteErrorState error={new Error('boom')} reset={vi.fn()} scope="dashboard" />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Une erreur est survenue')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Réessayer/ })).toBeInTheDocument();
  });

  it('appelle reset au clic sur Réessayer', async () => {
    const reset = vi.fn();
    const user = userEvent.setup();
    render(<RouteErrorState error={new Error('boom')} reset={reset} scope="admin" />);

    await user.click(screen.getByRole('button', { name: /Réessayer/ }));

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('expose la référence d’incident quand le framework en fournit une', () => {
    const error = Object.assign(new Error('boom'), { digest: 'abc123' });
    render(<RouteErrorState error={error} reset={vi.fn()} scope="onboarding" />);

    expect(screen.getByText(/abc123/)).toBeInTheDocument();
  });

  it('journalise l’erreur avec le segment concerné', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<RouteErrorState error={new Error('boom')} reset={vi.fn()} scope="mcp" />);

    expect(spy).toHaveBeenCalledWith('[mcp] route error boundary:', expect.any(Error));
  });
});
