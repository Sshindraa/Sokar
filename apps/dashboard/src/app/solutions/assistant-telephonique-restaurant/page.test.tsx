import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import VoiceSolutionPage, { metadata } from './page';

describe('landing assistant téléphonique (brouillon)', () => {
  it('reste non indexable tant que la preuve vocale n’est pas qualifiée', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
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
    demoLinks.forEach((link) => expect(link).toHaveAttribute('href', '/demo'));
  });

  it('affiche les prix HT issus du catalogue, annuel compris', () => {
    render(<VoiceSolutionPage />);

    expect(screen.getByText(/199\s€\sHT\/mois/)).toBeInTheDocument();
    expect(screen.getByText(/159,20\s€\sHT\/mois/)).toBeInTheDocument();
  });

  it('répond aux questions pratiques sans promesse de disponibilité', () => {
    render(<VoiceSolutionPage />);

    expect(screen.getByText('Le numéro de mon restaurant change-t-il ?')).toBeInTheDocument();
    expect(screen.getByText('Puis-je reprendre la main ?')).toBeInTheDocument();
  });

  it('réserve l’emplacement de la preuve vocale, sans exemple inventé', () => {
    render(<VoiceSolutionPage />);

    expect(screen.getByTestId('voice-proof-slot')).toHaveTextContent(
      /qualification de la démonstration vocale/,
    );
  });
});
