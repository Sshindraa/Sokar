import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Providers from './providers';

const route = vi.hoisted(() => ({ pathname: '/admin/provisioning' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
vi.mock('@clerk/nextjs', () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="clerk-session">{children}</div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('sessions opérateur dans le preview staging', () => {
  it.each([
    ['/admin/provisioning', true],
    ['/login', true],
    ['/dashboard', false],
    ['/', false],
  ])('monte la session réelle uniquement pour %s : %s', (pathname, sessionExpected) => {
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'configured-for-test');
    vi.stubEnv('NEXT_PUBLIC_DEMO_RESTAURANT_ID', 'demo-restaurant');
    vi.stubEnv('NEXT_PUBLIC_DEMO_STAGING', '1');
    route.pathname = pathname;
    render(
      <Providers>
        <span>Contenu</span>
      </Providers>,
    );
    expect(Boolean(screen.queryByTestId('clerk-session'))).toBe(sessionExpected);
    expect(screen.getByText('Contenu')).toBeTruthy();
  });
});
