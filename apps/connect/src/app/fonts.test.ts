import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const layoutPath = resolve(__dirname, './layout.tsx');
const fontsDirectory = resolve(__dirname, './fonts');

describe('Connect font loading', () => {
  it('uses bundled fonts without depending on Google Fonts during builds', () => {
    const layout = readFileSync(layoutPath, 'utf8');

    expect(layout).toContain("from 'next/font/local'");
    expect(layout).not.toContain('next/font/google');
    expect(existsSync(resolve(fontsDirectory, 'outfit-latin.woff2'))).toBe(true);
    expect(existsSync(resolve(fontsDirectory, 'plus-jakarta-sans-latin.woff2'))).toBe(true);
  });
});
