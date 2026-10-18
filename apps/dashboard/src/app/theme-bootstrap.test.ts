import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { THEME_BOOTSTRAP } from './theme-bootstrap';

// Exécute le script réel dans un contexte isolé, avec un document et un stockage minimaux, puis
// renvoie les classes posées sur la racine du document.
function themeClassesAt(pathname: string, storedTheme: string | null): string[] {
  const classes = new Set<string>();
  runInNewContext(THEME_BOOTSTRAP, {
    document: {
      documentElement: {
        classList: {
          add: (...names: string[]) => names.forEach((name) => classes.add(name)),
          remove: (...names: string[]) => names.forEach((name) => classes.delete(name)),
        },
      },
    },
    window: {
      location: { pathname },
      localStorage: {
        getItem: (key: string) => (key === 'sokar-dashboard-theme' ? storedTheme : null),
      },
    },
  });
  return [...classes];
}

describe('thème initial', () => {
  it('applique le thème clair choisi dans l’application', () => {
    expect(themeClassesAt('/dashboard', 'light')).toContain('light');
  });

  it('garde la vitrine sombre quel que soit le thème stocké', () => {
    expect(themeClassesAt('/', 'light')).not.toContain('light');
  });

  it('garde la page tarifs sombre : son texte n’est dessiné que pour le fond sombre', () => {
    expect(themeClassesAt('/pricing', 'light')).not.toContain('light');
  });
});
