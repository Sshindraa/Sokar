'use client';

import type { CSSProperties } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

// Le Toaster est monté à la racine, hors du DashboardThemeProvider : ses couleurs passent par
// les variables de sonner branchées sur nos tokens, qui suivent la classe light/dark de l'app.
// Des classes Tailwind ne suffiraient pas : les styles de sonner sont plus spécifiques.
const Toaster = (props: ToasterProps) => (
  <Sonner
    position="bottom-right"
    style={
      {
        '--normal-bg': 'hsl(var(--popover))',
        '--normal-text': 'hsl(var(--popover-foreground))',
        '--normal-border': 'hsl(var(--border))',
      } as CSSProperties
    }
    {...props}
  />
);

export { Toaster };
