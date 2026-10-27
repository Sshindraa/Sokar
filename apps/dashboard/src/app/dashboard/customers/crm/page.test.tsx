import { describe, expect, it, vi } from 'vitest';
import CrmListRedirectPage from './page';

const redirect = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ redirect }));

describe('CrmListRedirectPage', () => {
  it('renvoie l’ancienne liste CRM Pro vers l’écran Clients', () => {
    CrmListRedirectPage();
    expect(redirect).toHaveBeenCalledWith('/dashboard/customers');
  });
});
