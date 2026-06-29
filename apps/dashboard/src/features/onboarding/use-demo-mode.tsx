'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';

export type PreviewData = {
  restaurant: Record<string, unknown>;
  calls: Array<Record<string, unknown>>;
  reservations: Array<Record<string, unknown>>;
  customers: Array<Record<string, unknown>>;
  isPreview: boolean;
};

type DemoModeContextValue = {
  demoMode: boolean;
  setDemoMode: (v: boolean) => void;
  previewData: PreviewData | null;
  loadingPreview: boolean;
};

const DemoModeContext = createContext<DemoModeContextValue | null>(null);

/**
 * Fournit un toggle "mode démo" qui fetch les données du restaurant
 * "Chez Sokar" via l'endpoint public /public/preview/restaurant.
 * Utilisé par les pages vues (aperçu, appels, résa, clients) pour
 * afficher des données peuplées quand l'utilisateur n'est pas encore onboardé.
 */
export function DemoModeProvider({ children }: { children: ReactNode }) {
  const [demoMode, setDemoModeState] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const setDemoMode = useCallback((v: boolean) => {
    setDemoModeState(v);
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem('sokar-demo-mode', v ? '1' : '0');
      } catch {
        // ignore
      }
    }
  }, []);

  // Restore from sessionStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = sessionStorage.getItem('sokar-demo-mode');
      if (stored === '1') setDemoModeState(true);
    } catch {
      // ignore
    }
  }, []);

  // Fetch preview data when demo mode is enabled
  useEffect(() => {
    if (!demoMode || previewData) return;
    setLoadingPreview(true);
    fetch('/api/proxy/public/preview/restaurant')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setPreviewData(data);
      })
      .catch(() => {
        // silent fail — demo mode just shows empty state
      })
      .finally(() => setLoadingPreview(false));
  }, [demoMode, previewData]);

  return (
    <DemoModeContext.Provider value={{ demoMode, setDemoMode, previewData, loadingPreview }}>
      {children}
    </DemoModeContext.Provider>
  );
}

export function useDemoMode() {
  const ctx = useContext(DemoModeContext);
  if (!ctx) {
    throw new Error('useDemoMode must be used inside DemoModeProvider');
  }
  return ctx;
}
