import { afterEach, expect, it, vi } from 'vitest';
import Page from './page';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not-found');
  },
}));
afterEach(() => vi.unstubAllEnvs());

it('never exposes the fictional preview in a production build', () => {
  vi.stubEnv('NODE_ENV', 'production');
  expect(() => Page()).toThrow('not-found');
});

it('renders the shared view in local development', () => {
  vi.stubEnv('NODE_ENV', 'development');
  expect(Page().props).toEqual({ demo: true });
});
