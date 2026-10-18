'use client';

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react';

export type DashboardTheme = 'dark' | 'light';

const STORAGE_KEY = 'sokar-dashboard-theme';
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface DashboardThemeContextValue {
  theme: DashboardTheme;
  toggleTheme: () => void;
}

const DashboardThemeContext = createContext<DashboardThemeContextValue | null>(null);

export function DashboardThemeProvider({ children }: { children: ReactNode }) {
  // Obsidian dark est le défaut du dashboard. Le mode clair reste disponible
  // via le toggle en haut à droite et persiste par navigateur.
  const [theme, setTheme] = useState<DashboardTheme>('dark');

  // Le script du layout amorce le thème avant l'hydratation sur les chargements
  // directs. Cette synchronisation le réapplique aussi après une navigation SPA
  // depuis la page d'accueil, qui est exclue du thème dashboard.
  useIsomorphicLayoutEffect(() => {
    let storedTheme: string | null = null;
    try {
      storedTheme = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // Le thème sombre reste le défaut si le stockage local est indisponible.
    }

    const next = storedTheme === 'light' ? 'light' : 'dark';
    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(next);
    setTheme(next);
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Le thème reste actif pour cette session si le stockage local est désactivé.
    }
    setTheme(next);
  };

  return (
    <DashboardThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </DashboardThemeContext.Provider>
  );
}

export function useDashboardTheme() {
  const ctx = useContext(DashboardThemeContext);
  if (!ctx) throw new Error('useDashboardTheme must be used within DashboardThemeProvider');
  return ctx;
}
