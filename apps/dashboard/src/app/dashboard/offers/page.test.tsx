import { describe, expect, it, vi } from 'vitest';
import { redirect } from 'next/navigation';
import OffersPage from './page';

vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

describe('OffersPage', () => {
  it('redirige l’ancienne page d’orientation vers les expériences', () => {
    OffersPage();
    expect(redirect).toHaveBeenCalledWith('/dashboard/experiences');
  });
});
