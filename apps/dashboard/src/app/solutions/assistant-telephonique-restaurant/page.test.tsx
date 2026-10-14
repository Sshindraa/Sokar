import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import VoiceSolutionPage, { metadata } from './page';

describe('landing assistant téléphonique (brouillon)', () => {
  it('reste non indexable tant que la preuve vocale n’est pas qualifiée', () => {
    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(metadata.alternates?.canonical).toBe('/solutions/assistant-telephonique-restaurant');
  });

  it('présente la promesse en un titre de niveau 1 et renvoie vers la démonstration', () => {
    render(<VoiceSolutionPage />);

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Un assistant téléphonique pour votre restaurant',
      }),
    ).toBeInTheDocument();
    const demoLinks = screen.getAllByRole('link', { name: /Demander une démonstration/ });
    expect(demoLinks.length).toBeGreaterThan(0);
    demoLinks.forEach((link) =>
      expect(link).toHaveAttribute('href', '/demo?source=assistant-telephonique'),
    );
  });

  it('renvoie vers le catalogue sans dupliquer les montants', () => {
    render(<VoiceSolutionPage />);
    expect(screen.getByRole('link', { name: 'Voir toutes les offres' })).toHaveAttribute(
      'href',
      '/pricing',
    );
  });

  it('répond aux questions pratiques sans promesse de disponibilité', () => {
    render(<VoiceSolutionPage />);

    expect(screen.getByText('Le numéro de mon restaurant change-t-il ?')).toBeInTheDocument();
    expect(screen.getByText('Puis-je reprendre la main ?')).toBeInTheDocument();
  });

  it('qualifie la simulation sans emplacement vide ni appel inventé', () => {
    render(<VoiceSolutionPage />);
    expect(screen.getByText(/simulation visuelle/)).toBeInTheDocument();
    expect(screen.queryByTestId('voice-proof-slot')).not.toBeInTheDocument();
  });
});
