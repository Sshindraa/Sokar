import { describe, expect, it } from 'vitest';
import { metadata as loginMetadata } from './login/layout';
import { metadata as registerMetadata } from './register/layout';
import { metadata as widgetMetadata } from './widget/[restaurantId]/layout';

// Pages d'authentification et de réservation : utiles aux personnes concernées, sans intérêt en
// recherche. Le noindex est posé sans Disallow dans robots.txt, pour que les robots puissent lire la
// directive.
describe('pages transactionnelles hors index', () => {
  it.each([
    ['connexion', loginMetadata],
    ['inscription', registerMetadata],
    ['widget de réservation', widgetMetadata],
  ])('demande aux moteurs de ne pas indexer la page de %s', (_label, metadata) => {
    expect(metadata.robots).toMatchObject({ index: false });
  });
});
