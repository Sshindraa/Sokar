import { describe, expect, it } from 'vitest';
import { DEFAULT_PUBLIC_API_URL, publicApiUrl } from '../public-api-url';

describe('publicApiUrl', () => {
  it('ne publie jamais l’adresse interne API_URL', () => {
    expect(publicApiUrl({ API_URL: 'http://127.0.0.1:4000' })).toBe(DEFAULT_PUBLIC_API_URL);
  });

  it('utilise PUBLIC_API_URL sans barre finale', () => {
    expect(publicApiUrl({ PUBLIC_API_URL: 'https://api-staging.sokar.tech/' })).toBe(
      'https://api-staging.sokar.tech',
    );
  });
});
