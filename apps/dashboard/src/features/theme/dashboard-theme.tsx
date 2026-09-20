'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type DashboardTheme = 'dark' | 'light';

const STORAGE_KEY = 'sokar-dashboard-theme';

interface DashboardThemeContextValue {
  theme: DashboardTheme;
  toggleTheme: () => void;
}

const DashboardThemeContext = createContext<DashboardThemeContextValue | null>(null);

export function DashboardThemeProvider({ children }: { children: ReactNode }) {
  // Obsidian dark est le défaut du dashboard. Le mode clair reste disponible
  // via le toggle en haut à droite et persiste par navigateur.
  const [theme, setTheme] = useState<DashboardTheme>('dark');

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') setTheme(stored);
  }, []);

  // Les Dialog Radix sont portés par un portal directement sous `body`.
  // Refléter le thème sur la racine garantit que leurs tokens restent alignés
  // avec le dashboard, y compris en mode clair.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(theme);
    return () => root.classList.remove('dark', 'light');
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      window.localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
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
