import { describe, expect, it } from 'vitest';
import { mcpDocumentationUrl } from '../oauth';

describe('mcpDocumentationUrl', () => {
  it('pointe vers le site public de l’environnement', () => {
    expect(mcpDocumentationUrl('https://api.sokar.tech', {})).toBe(
      'https://sokar.tech/assistants-ia',
    );
    expect(mcpDocumentationUrl('https://api-staging.sokar.tech', {})).toBe(
      'https://staging.sokar.tech/assistants-ia',
    );
  });

  it('respecte une adresse configurée', () => {
    expect(
      mcpDocumentationUrl('https://api.sokar.tech', {
        MCP_DOCUMENTATION_URL: 'https://docs.example.test/sokar',
      }),
    ).toBe('https://docs.example.test/sokar');
  });
});
