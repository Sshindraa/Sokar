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
  // Light (esprit cockpit / WindFarm) est désormais le défaut du dashboard.
  // Dark reste disponible via le toggle et persiste par navigateur.
  const [theme, setTheme] = useState<DashboardTheme>('light');

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') setTheme(stored);
  }, []);

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
