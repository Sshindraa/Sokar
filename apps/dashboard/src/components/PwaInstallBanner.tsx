'use client';

import { useState, useEffect } from 'react';
import { Share, Plus, X, Sparkles } from 'lucide-react';
import { triggerHaptic } from '@/lib/utils';

export default function PwaInstallBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Check if running on client-side
    if (typeof window === 'undefined') return;

    // Detect iOS
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;

    // Detect if app is already running in standalone mode (PWA installed)
    const isStandalone = 
      (window.navigator as any).standalone === true || 
      window.matchMedia('(display-mode: standalone)').matches;

    // Check localStorage to respect dismissal
    const isDismissed = localStorage.getItem('sokar_pwa_dismissed') === 'true';

    // Show banner only if on iOS, NOT installed already, and NOT dismissed
    if (isIOS && !isStandalone && !isDismissed) {
      // Delay showing for premium feel (1.5 seconds after page load)
      const timer = setTimeout(() => {
        setShow(true);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleDismiss = () => {
    triggerHaptic(10);
    setShow(false);
    localStorage.setItem('sokar_pwa_dismissed', 'true');
  };

  if (!show) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-[90] md:left-auto md:right-4 md:w-[380px] animate-in slide-in-from-bottom-5 fade-in duration-300">
      <div className="rounded-2xl border border-white/10 bg-black/80 p-5 shadow-2xl backdrop-blur-xl relative overflow-hidden">
        {/* Ambient background glow */}
        <div className="absolute -right-10 -bottom-10 h-28 w-28 rounded-full bg-cyan-500/10 blur-2xl pointer-events-none" />

        {/* Close Button */}
        <button 
          onClick={handleDismiss}
          className="absolute top-3 right-3 h-8 w-8 rounded-full border border-white/5 bg-white/5 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Dismiss banner"
        >
          <X size={15} />
        </button>

        {/* Header */}
        <div className="flex items-center gap-2 pr-6">
          <span className="h-8 w-8 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
            <Sparkles size={14} className="animate-pulse" />
          </span>
          <div>
            <h4 className="text-sm font-bold text-white tracking-wide">Installer Sokar AI</h4>
            <p className="text-[11px] text-white/40">Ajoutez l&apos;app sur votre écran d&apos;accueil</p>
          </div>
        </div>

        {/* Steps */}
        <div className="mt-4 space-y-3 border-t border-white/5 pt-3">
          <div className="flex items-center gap-3 text-xs text-white/70">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/5 border border-white/10 font-bold text-[10px] text-cyan-400">
              1
            </span>
            <p className="leading-snug">
              Appuyez sur le bouton de partage <span className="inline-flex items-center align-middle mx-0.5 px-1 py-0.5 rounded bg-white/10 text-white"><Share size={12} /></span> en bas de Safari.
            </p>
          </div>
          
          <div className="flex items-center gap-3 text-xs text-white/70">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/5 border border-white/10 font-bold text-[10px] text-cyan-400">
              2
            </span>
            <p className="leading-snug">
              Sélectionnez l&apos;option <span className="inline-flex items-center align-middle mx-0.5 px-1 py-0.5 rounded bg-white/10 text-white font-medium">Sur l&apos;écran d&apos;accueil <Plus size={12} className="ml-1" /></span>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
