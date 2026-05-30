'use client';

import { useState } from 'react';
import Link from 'next/link';
import { SignedIn, SignedOut } from '@clerk/nextjs';
import { 
  ArrowUpRight, 
  CheckCircle2, 
  Loader2, 
  Sparkles 
} from 'lucide-react';

export default function HomePage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      setStatus('error');
      setMessage('Veuillez entrer une adresse email valide.');
      return;
    }

    setStatus('loading');
    
    // Simuler une requête API avec un effet premium de chargement
    await new Promise((resolve) => setTimeout(resolve, 1200));
    
    setStatus('success');
    setMessage('Merci ! Vous avez été ajouté à notre liste d\'attente prioritaire.');
    setEmail('');
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#070709] text-foreground flex flex-col justify-between items-center px-6 py-8 select-none font-sans">
      <style>{`
        /* Masquer le header global du layout sur cette page */
        body > header { display: none !important; }
        
        .glow-text {
          text-shadow: 0 0 40px rgba(255, 255, 255, 0.15);
        }
        
        .stroke-text {
          font-family: inherit;
          color: transparent;
          -webkit-text-stroke: 1px rgba(255, 255, 255, 0.04);
        }
        
        .glass-card {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.08);
          backdrop-filter: blur(24px);
          box-shadow: 
            0 4px 30px rgba(0, 0, 0, 0.4),
            inset 0 1px 1px rgba(255, 255, 255, 0.05);
        }

        .orange-glow {
          background: radial-gradient(circle, rgba(249,115,22,0.18) 0%, rgba(249,115,22,0) 70%);
          filter: blur(60px);
        }
        
        .blue-glow {
          background: radial-gradient(circle, rgba(59,130,246,0.12) 0%, rgba(59,130,246,0) 75%);
          filter: blur(80px);
        }
      `}</style>

      {/* Arrière-plans lumineux premium */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        {/* Glow principal orange/amber */}
        <div className="orange-glow absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[450px] animate-pulse duration-[8000ms]" />
        {/* Glow secondaire bleu pour le contraste de couleur haut de gamme */}
        <div className="blue-glow absolute top-1/3 left-1/3 w-[800px] h-[500px]" />
      </div>

      {/* Floating Header */}
      <header className="relative z-10 w-full max-w-7xl flex items-center justify-between">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 rounded-full transition-all duration-300 hover:opacity-85"
        >
          <img src="/logo-nav.png" alt="Sokar" className="h-10 w-10" />
          <span className="text-lg font-bold tracking-tight text-white glow-text">Sokar</span>
        </Link>

        {/* CTA si déjà connecté */}
        <SignedIn>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-semibold tracking-wide text-white transition-all duration-300 active:scale-95"
          >
            Accéder au Dashboard
            <ArrowUpRight size={14} />
          </Link>
        </SignedIn>
      </header>

      {/* Main Content Area */}
      <main className="relative z-10 my-auto flex flex-col items-center text-center w-full max-w-xl">
        {/* Floating Waitlist Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/10 bg-white/[0.03] backdrop-blur-md text-[11px] font-medium tracking-wider uppercase text-white/80 shadow-lg shadow-black/20">
          <Sparkles size={12} className="text-orange-400 animate-pulse" />
          Waitlist
        </div>

        {/* Coming soon Title */}
        <h1 className="mt-6 text-4xl md:text-6xl font-extrabold tracking-tight text-white glow-text leading-tight">
          Coming soon!
        </h1>

        {/* Waitlist Glassmorphism Box */}
        <div className="glass-card w-full mt-8 p-8 md:p-10 rounded-3xl transition-all duration-500 hover:border-white/12">
          {status !== 'success' ? (
            <>
              <h2 className="text-xl md:text-2xl font-bold tracking-tight text-white">
                Join our waitlist!
              </h2>
              <p className="mt-3 text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
                Sign up for our newsletter to receive the latest updates and insights straight to your inbox.
              </p>

              {/* Formulaire d'inscription */}
              <form onSubmit={handleSubmit} className="mt-8 flex flex-col sm:flex-row gap-3 w-full max-w-md mx-auto">
                <input
                  type="email"
                  placeholder="Enter email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={status === 'loading'}
                  className="flex-1 px-4 py-3 rounded-full bg-white/[0.04] border border-white/10 text-white placeholder-white/30 text-sm outline-none transition-all duration-300 focus:border-white/20 focus:bg-white/[0.06] focus:ring-1 focus:ring-white/20"
                  required
                />
                <button
                  type="submit"
                  disabled={status === 'loading'}
                  className="px-6 py-3 rounded-full bg-white text-black font-semibold text-sm transition-all duration-300 hover:bg-white/90 hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(255,255,255,0.25)] active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {status === 'loading' ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Connexion...
                    </>
                  ) : (
                    'Join Waitlist'
                  )}
                </button>
              </form>

              {status === 'error' && (
                <p className="mt-4 text-xs text-red-400 bg-red-500/10 border border-red-500/20 py-2 px-3 rounded-xl animate-fade-in">
                  {message}
                </p>
              )}
            </>
          ) : (
            /* Succès avec animation premium */
            <div className="flex flex-col items-center py-4 animate-fade-in">
              <div className="h-12 w-12 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center text-green-400">
                <CheckCircle2 size={24} className="animate-bounce" />
              </div>
              <h2 className="mt-4 text-lg font-bold text-white">Inscription Réussie !</h2>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed max-w-sm">
                {message}
              </p>
              <button
                onClick={() => setStatus('idle')}
                className="mt-6 px-4 py-1.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-semibold text-white transition-all duration-300 active:scale-95"
              >
                Retour
              </button>
            </div>
          )}
        </div>

        {/* Social Icons row */}
        <div className="flex items-center gap-3 mt-8">
          <Link
            href="#"
            className="h-10 w-10 rounded-full border border-white/10 bg-white/[0.03] flex items-center justify-center text-white/65 transition-all duration-300 hover:text-white hover:bg-white/[0.08] hover:border-white/20 active:scale-95 shadow-md shadow-black/10"
            aria-label="Twitter"
          >
            <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </Link>
          <Link
            href="#"
            className="h-10 w-10 rounded-full border border-white/10 bg-white/[0.03] flex items-center justify-center text-white/65 transition-all duration-300 hover:text-white hover:bg-white/[0.08] hover:border-white/20 active:scale-95 shadow-md shadow-black/10"
            aria-label="Facebook"
          >
            <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24">
              <path d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15H8v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3v3h-3v6.95c4.56-.93 8-4.96 8-9.75z" />
            </svg>
          </Link>
          <Link
            href="#"
            className="h-10 w-10 rounded-full border border-white/10 bg-white/[0.03] flex items-center justify-center text-white/65 transition-all duration-300 hover:text-white hover:bg-white/[0.08] hover:border-white/20 active:scale-95 shadow-md shadow-black/10"
            aria-label="Instagram"
          >
            <svg className="h-4 w-4 stroke-current fill-none stroke-2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
              <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
              <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
            </svg>
          </Link>
        </div>
      </main>

      {/* Footer Area with Massive outline text */}
      <footer className="relative z-10 w-full flex flex-col items-center pointer-events-none">
        {/* Waitlist Gigantic Outline Text */}
        <span className="stroke-text font-black tracking-[0.2em] text-7xl md:text-[9rem] select-none leading-none select-none select-none uppercase">
          Waitlist
        </span>
        <div className="mt-6 text-[10px] tracking-widest uppercase text-white/30 flex items-center gap-2">
          <span>&copy; {new Date().getFullYear()} Sokar OS</span>
          <span className="h-1 w-1 rounded-full bg-white/20" />
          <span>Coming Soon</span>
        </div>
      </footer>
    </div>
  );
}
