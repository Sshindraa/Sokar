import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FeatureLockCard } from './FeatureLockCard';

describe('FeatureLockCard', () => {
  it('propose les formules quand la fonction n’est pas incluse', () => {
    render(
      <FeatureLockCard
        feature="Avis clients"
        lock={{
          kind: 'not-included',
          message: 'Cette fonctionnalité n’est pas incluse dans votre formule.',
        }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Avis clients' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voir les formules' })).toHaveAttribute(
      'href',
      '/pricing',
    );
    expect(screen.queryByRole('button', { name: /réessayer/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renvoie vers le contact quand la fonction n’est pas encore ouverte, sans « Réessayer »', () => {
    render(
      <FeatureLockCard
        feature="CRM avancé"
        lock={{
          kind: 'not-ready',
          message: 'Cette fonctionnalité n’est pas encore ouverte sur votre compte.',
        }}
      />,
    );
    expect(screen.getByRole('link', { name: 'hello@sokar.tech' })).toHaveAttribute(
      'href',
      'mailto:hello@sokar.tech',
    );
    expect(screen.queryByRole('link', { name: 'Voir les formules' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
