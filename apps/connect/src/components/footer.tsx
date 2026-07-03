'use client';

/**
 * Sokar Connect — Footer client.
 *
 * Masqué sur les pages /widget/* car l'iframe embarqué ne doit pas
 * afficher le pied de page global (spécification widget embed).
 */

import { usePathname } from 'next/navigation';

export function Footer() {
  const pathname = usePathname();
  if (pathname?.startsWith('/widget/')) return null;

  return (
    <footer className="border-t border-border bg-background px-6 py-8 text-center text-sm text-muted-foreground">
      <p>
        Sokar — Réservation en ligne pour restaurants ·{' '}
        <a
          href="/privacy"
          className="text-foreground underline transition-all duration-200 hover:text-ember"
        >
          Politique de confidentialité
        </a>
      </p>
    </footer>
  );
}
