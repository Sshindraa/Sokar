'use client';

import { useState, useEffect } from 'react';

/**
 * SSR-safe, hydration-safe media query hook.
 * Returns `false` during SSR and first render to avoid hydration mismatch.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);

    setMatches(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

/**
 * Convenience hook: returns true when viewport is < 768px (md breakpoint).
 */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 767px)');
}
