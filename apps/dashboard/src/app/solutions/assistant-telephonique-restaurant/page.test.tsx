import { describe, expect, it, vi } from 'vitest';
import { permanentRedirect } from 'next/navigation';
import VoiceSolutionPage, { metadata } from './page';

vi.mock('next/navigation', () => ({
  permanentRedirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));

describe('ancienne landing assistant téléphonique', () => {
  it('redirige définitivement les anciens liens vers l’accueil', () => {
    expect(() => VoiceSolutionPage()).toThrow('NEXT_REDIRECT');
    expect(permanentRedirect).toHaveBeenCalledWith('/');
  });

  it('ne présente plus de page commerciale indexable en double', () => {
    expect(metadata.alternates?.canonical).toBe('/');
    expect(metadata.robots).toEqual({ index: false, follow: true });
  });
});
