import { describe, expect, it } from 'vitest';
import {
  ApiError,
  classifyApiError,
  describeApiError,
  extractApiCode,
  featureLockFromError,
  isSessionExpired,
  toApiError,
} from './api-error';

describe('extractApiCode', () => {
  it('lit le champ code, ou le champ error quand il a la forme d’un code', () => {
    expect(extractApiCode({ code: 'CONNECT_SLUG_REQUIRED' })).toBe('CONNECT_SLUG_REQUIRED');
    expect(extractApiCode({ error: 'CAPABILITY_NOT_INCLUDED', message: 'x' })).toBe(
      'CAPABILITY_NOT_INCLUDED',
    );
    expect(extractApiCode({ error: 'Authentication required' })).toBeNull();
    expect(extractApiCode({ error: 'no_compatible_table' })).toBeNull();
  });
});

describe('classifyApiError', () => {
  it.each([
    [401, null, 'session'],
    [403, 'CAPABILITY_NOT_INCLUDED', 'not-included'],
    [503, 'LOYALTY_DISABLED', 'not-ready'],
    [503, 'RESEND_WEBHOOK_NOT_CONFIGURED', 'not-ready'],
    [403, null, 'forbidden'],
    [404, null, 'not-found'],
    [409, 'CONNECT_SLUG_REQUIRED', 'conflict'],
    [400, null, 'invalid'],
    [429, null, 'rate-limited'],
    [502, null, 'unavailable'],
  ] as const)('%s %s → %s', (status, code, kind) => {
    expect(classifyApiError(status, code)).toBe(kind);
  });
});

describe('describeApiError', () => {
  const base = { status: 400, code: null, message: null, details: [] };

  it('garde un message français rédigé pour l’utilisateur', () => {
    expect(
      describeApiError({
        ...base,
        status: 403,
        message: 'La modification des notes client est réservée aux responsables.',
      }),
    ).toBe('La modification des notes client est réservée aux responsables.');
  });

  it('traduit les textes techniques anglais', () => {
    expect(describeApiError({ ...base, status: 401, message: 'Authentication required' })).toBe(
      'Votre session a expiré. Reconnectez-vous pour continuer.',
    );
    expect(
      describeApiError({ ...base, status: 403, message: 'Sokar operator access required' }),
    ).toBe('Vous n’avez pas accès à cette fonction avec votre rôle.');
    expect(describeApiError({ ...base, status: 409, message: 'Erreur 409' })).toMatch(
      /n’est plus possible/,
    );
  });

  it('remplace une phrase anglaise de l’API par un message français', () => {
    expect(describeApiError({ ...base, status: 404, message: 'Restaurant not found' })).toMatch(
      /Élément introuvable/,
    );
    expect(describeApiError({ ...base, status: 500, message: 'Failed to load customers' })).toMatch(
      /momentanément indisponible/,
    );
  });

  it('ne montre jamais le jargon « pilote » ou « chantier » d’un module fermé', () => {
    const message = describeApiError({
      status: 503,
      code: 'CRM_ADVANCED_DISABLED',
      message: 'Le CRM avancé reste désactivé jusqu’à la qualification du chantier.',
      details: [],
    });
    expect(message).toBe('Cette fonctionnalité n’est pas encore ouverte sur votre compte.');
  });

  it('dit « pas dans votre formule » pour une fonction non incluse', () => {
    expect(
      describeApiError({
        status: 403,
        code: 'CAPABILITY_NOT_INCLUDED',
        message: 'Cette fonctionnalité n’est pas incluse dans votre formule.',
        details: [],
      }),
    ).toBe('Cette fonctionnalité n’est pas incluse dans votre formule.');
  });

  it('nomme les champs à corriger après une validation refusée', () => {
    expect(
      describeApiError({
        status: 400,
        code: null,
        message: 'Validation Error',
        details: [
          { path: 'managerPhone', message: 'Invalid' },
          { path: 'body.email', message: 'Invalid email' },
          { path: 'inconnu', message: 'x' },
        ],
      }),
    ).toBe(
      'Certains champs ne sont pas valides. Vérifiez votre saisie. À vérifier : numéro de téléphone, adresse e-mail.',
    );
  });

  it('laisse passer un code technique en minuscules que la page sait lire', () => {
    expect(describeApiError({ ...base, status: 409, message: 'no_compatible_table' })).toContain(
      'no_compatible_table',
    );
  });
});

describe('toApiError', () => {
  it('porte le statut, le code et la nature de l’erreur', () => {
    const error = toApiError(403, {
      error: 'CAPABILITY_NOT_INCLUDED',
      message: 'Cette fonctionnalité n’est pas incluse dans votre formule.',
      capability: 'reputation.feedback',
    });
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 403,
      code: 'CAPABILITY_NOT_INCLUDED',
      kind: 'not-included',
    });
    expect(featureLockFromError(error)).toEqual({
      kind: 'not-included',
      message: 'Cette fonctionnalité n’est pas incluse dans votre formule.',
    });
  });

  it('ne signale comme blocage que les fonctions fermées ou hors formule', () => {
    expect(featureLockFromError(toApiError(500, {}))).toBeNull();
    expect(featureLockFromError(new Error('boom'))).toBeNull();
    expect(featureLockFromError(toApiError(503, { error: 'LOYALTY_DISABLED' }))).toMatchObject({
      kind: 'not-ready',
    });
  });

  it('reconnaît une session expirée', () => {
    expect(isSessionExpired(toApiError(401, { error: 'Authentication required' }))).toBe(true);
    expect(isSessionExpired(toApiError(403, {}))).toBe(false);
  });

  it('retombe sur un message par statut quand l’API ne dit rien', () => {
    expect(toApiError(503, {}).message).toBe(
      'Le service est momentanément indisponible. Réessayez dans quelques instants.',
    );
  });
});
