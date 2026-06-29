import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Convention guard : le copy user-facing de l'onboarding dashboard doit
 * utiliser le vouvoiement (`vous`), jamais le tutoiement (`tu/ton/ta/tes`).
 *
 * Sokar est un SaaS B2B — le `tu` sent le consumer/developer-tool.
 * La convention est documentée dans AGENTS.md > "Dashboard UI rules".
 *
 * Ce test lit les fichiers .tsx du dossier onboarding du dashboard et
 * vérifie l'absence des pronoms possessifs de la 2e personne du singulier.
 * Le nom commun "ton" (ex. « Donnez le ton ») est autorisé via une
 * exception contextuelle.
 */
const ONBOARDING_DIR = resolve(process.cwd(), '../dashboard/src/features/onboarding');

function listTsxFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => join(dir, f));
}

// Pronoms du tutoiement à interdire dans le copy user-facing.
// On exclut le nom commun "ton" (= tone musical/style) quand il est
// précédé d'un article ou déterminant.
const FORBIDDEN_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  { regex: /\btu\b/gi, label: 'pronom « tu »' },
  { regex: /\bta\b/gi, label: 'possessif « ta »' },
  { regex: /\btes\b/gi, label: 'possessif « tes »' },
];

// "ton" est interdit sauf comme nom commun (le/du/au/ce/mon/son/leur ton)
// "ton" pronom possessif : interdit sauf quand c'est le nom commun
// (précédé d'un article : le/du/au/ce/un/mon/son/leur/votre ton)
// ou en tête de liste (Ton, ambiance...).
// Lookbehind variable-length est supporté par Node 22+.
const TON_PRONOUN = /(?<!\b(?:le|du|au|ce|un|mon|son|leur|votre) )\bton\b(?!,)/gi;

function findViolations(content: string): Array<{ line: number; match: string; label: string }> {
  const lines = content.split('\n');
  const violations: Array<{ line: number; match: string; label: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip code comments (// ...) and import lines
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('import ')) {
      continue;
    }

    for (const { regex, label } of FORBIDDEN_PATTERNS) {
      regex.lastIndex = 0;
      const m = regex.exec(line);
      if (m) {
        violations.push({ line: i + 1, match: m[0], label });
      }
    }

    TON_PRONOUN.lastIndex = 0;
    const tonMatch = TON_PRONOUN.exec(line);
    if (tonMatch) {
      violations.push({ line: i + 1, match: tonMatch[0], label: 'possessif « ton »' });
    }
  }

  return violations;
}

describe('onboarding tone convention (vous, jamais tu)', () => {
  const files = listTsxFiles(ONBOARDING_DIR);

  it('le dossier onboarding contient des fichiers .tsx à vérifier', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const name = file.split('/').pop()!;
    it(`${name} : aucun tutoiement (tu/ton/ta/tes)`, () => {
      const content = readFileSync(file, 'utf-8');
      const violations = findViolations(content);
      if (violations.length > 0) {
        const details = violations
          .map((v) => `  ligne ${v.line}: « ${v.match} » (${v.label})`)
          .join('\n');
        throw new Error(
          `Tutoiement détecté dans ${name} — la convention Sokar impose le vouvoiement.\n` +
            `Voir AGENTS.md > "Dashboard UI rules".\n${details}`,
        );
      }
    });
  }
});
