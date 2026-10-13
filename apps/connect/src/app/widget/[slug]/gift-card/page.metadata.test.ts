import { describe, expect, it } from 'vitest';
import { metadata } from './page';

describe('widget carte cadeau', () => {
  it('demande aux moteurs de ne pas indexer le formulaire d’achat', () => {
    expect(metadata.robots).toMatchObject({ index: false });
  });
});
