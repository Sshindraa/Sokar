import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Affirmations retirées faute de preuve (COPY-01). Témoignage, garantie et statistique sans source
// ne reviennent pas sur les pages publiques sans preuve versée au rapport de qualification.
const UNPROVEN_CLAIMS = [
  'Taux de réponse garanti',
  '98.4%',
  '+18.4%',
  'Appels traités ce mois',
  'Chef Matthieu',
  'Bistrot L’Ardoise',
  'Partenaire Certifié',
  'Sokar gère 100%',
  'Simulation temps réel',
  'sans limite',
  'Vos clients reconnus',
  'client reconnu',
  'Support prioritaire 7j/7',
  'Réservable depuis ChatGPT',
  'Toujours disponible',
  '24h/24',
  'zéro débordement',
  'Sokar est conforme au RGPD',
];

const PUBLIC_COPY_FILES = [
  './constants.ts',
  './solutions/assistant-telephonique-restaurant/page.tsx',
  './page.tsx',
  './ScrollStoryboardSection.tsx',
  './register/[[...slug]]/page.tsx',
  './login/[[...slug]]/page.tsx',
  './mcp/page.tsx',
  './privacy/page.tsx',
];

describe('affirmations publiques', () => {
  it.each(PUBLIC_COPY_FILES)('%s ne reprend aucune affirmation sans preuve', (file) => {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');

    expect(UNPROVEN_CLAIMS.filter((claim) => source.includes(claim))).toEqual([]);
  });
});
