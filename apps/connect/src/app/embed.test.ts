/**
 * Vérifie que le snippet JS embarquable est bien présent et structuré.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const embedPath = resolve(__dirname, '../../public/embed.js');

describe('/embed.js', () => {
  it('exists and contains the required data attributes', () => {
    const code = readFileSync(embedPath, 'utf-8');
    expect(code).toContain('data-slug');
    expect(code).toContain('data-host');
    expect(code).toContain('data-primary');
    expect(code).toContain('data-accent');
    expect(code).toContain('sokar-widget-resize');
    expect(code).toContain('/widget/');
  });
});
