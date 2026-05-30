'use client';

import { useState } from 'react';
import Link from 'next/link';
import { SignedIn } from '@clerk/nextjs';
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
    await new Promise((resolve) => setTimeout(resolve, 1400));
    
    setStatus('success');
    setMessage('Merci ! Vous avez été ajouté à notre liste d\'attente prioritaire.');
    setEmail('');
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#030303] text-foreground flex flex-col justify-between items-center px-6 py-10 select-none font-sans antialiased">
      {/* Importation des polices premium de Google Fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap');

        /* Masquer le header global du layout sur cette page */
        body > header { display: none !important; }
        
        .font-display {
          font-family: 'Outfit', sans-serif;
        }
        
        .font-sans {
          font-family: 'Plus Jakarta Sans', sans-serif;
        }

        .glow-title {
          text-shadow: 0 0 40px rgba(255, 255, 255, 0.1);
        }
        
        .stroke-text {
          font-family: 'Outfit', sans-serif;
          color: transparent;
          -webkit-text-stroke: 1.5px rgba(255, 255, 255, 0.05);
          letter-spacing: 0.25em;
          text-shadow: 0 0 30px rgba(255, 255, 255, 0.01);
        }
        
        .glass-card {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.07);
          backdrop-filter: blur(30px);
          -webkit-backdrop-filter: blur(30px);
          box-shadow: 
            0 30px 70px rgba(0, 0, 0, 0.8),
            inset 0 1px 1px rgba(255, 255, 255, 0.05);
        }

        .orange-glow-light {
          background: radial-gradient(circle, rgba(249,115,22,0.22) 0%, rgba(249,115,22,0) 70%);
          filter: blur(70px);
        }
      `}</style>

      {/* Abstract Glowing Fluid Curves & Background (WOW Factor) */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden select-none">
        {/* Halo central orange juste derrière le titre */}
        <div className="orange-glow-light absolute top-[28%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[350px] pointer-events-none z-0" />
        
        <svg className="absolute w-[130%] h-[130%] -left-[15%] -top-[15%] filter blur-[60px] opacity-75" viewBox="0 0 1000 1000" fill="none">
          <defs>
            <linearGradient id="orange-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#f97316" stopOpacity="0.7" />
              <stop offset="40%" stopColor="#ea580c" stopOpacity="0.5" />
              <stop offset="70%" stopColor="#c2410c" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#7c2d12" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="blue-grad" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#1d4ed8" stopOpacity="0.25" />
              <stop offset="50%" stopColor="#1e3a8a" stopOpacity="0.1" />
              <stop offset="100%" stopColor="#0f172a" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Deep blue ambiance behind */}
          <circle cx="200" cy="500" r="400" fill="url(#blue-grad)" />
          <circle cx="800" cy="300" r="350" fill="url(#blue-grad)" />
          
          {/* Orange glowing fluid lines matching the reference screenshot */}
          <path d="M-50 350 C 200 420, 350 150, 650 300 C 850 400, 750 780, 1050 550" stroke="url(#orange-grad)" strokeWidth="45" strokeLinecap="round" />
          <path d="M150 750 C 350 580, 550 820, 800 480" stroke="url(#orange-grad)" strokeWidth="22" strokeLinecap="round" />
        </svg>
      </div>

      {/* Floating Header */}
      <header className="relative z-10 w-full max-w-7xl flex items-center justify-between">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 rounded-full transition-all duration-300 hover:opacity-80"
        >
          <img src="/logo-nav.png" alt="Sokar" className="h-10 w-10 filter drop-shadow-[0_0_10px_rgba(255,255,255,0.15)]" />
          <span className="text-xl font-bold tracking-tight text-white glow-title font-display">Sokar</span>
        </Link>

        {/* CTA si déjà connecté */}
        <SignedIn>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 px-4  py-1.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-semibold tracking-wide text-white transition-all duration-300 hover:-translate-y-0.5 active:scale-95 shadow-[0_4px_12px_rgba(0,0,0,0.3)]"
          >
            Accéder au Dashboard
            <ArrowUpRight size={14} />
          </Link>
        </SignedIn>
      </header>

      {/* Main Content Area */}
      <main className="relative z-10 my-auto flex flex-col items-center text-center w-full max-w-2xl">
        {/* Floating Waitlist Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-orange-500/20 bg-orange-500/10 text-[10px] font-bold tracking-widest uppercase text-orange-400 shadow-[0_0_15px_rgba(249,115,22,0.15)] animate-pulse">
          <Sparkles size={11} className="text-orange-400" />
          Waitlist
        </div>

        {/* Coming soon Title */}
        <h1 className="mt-6 text-5xl md:text-7xl font-black tracking-tight text-white glow-title font-display leading-[1.05]">
          Coming soon!
        </h1>

        {/* Waitlist Glassmorphism Box */}
        <div className="glass-card w-full max-w-xl mt-8 p-8 md:p-12 rounded-3xl transition-all duration-500 hover:border-white/12">
          {status !== 'success' ? (
            <>
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white font-display">
                Join our waitlist!
              </h2>
              <p className="mt-3 text-sm text-white/50 max-w-sm mx-auto leading-relaxed font-sans">
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
                  className="flex-1 px-5 py-3.5 rounded-full bg-[#0b0b0e]/80 border border-white/10 text-white placeholder-white/30 text-sm outline-none transition-all duration-300 focus:border-white/20 focus:bg-white/[0.05] focus:ring-1 focus:ring-white/20"
                  required
                />
                <button
                  type="submit"
                  disabled={status === 'loading'}
                  className="px-8 py-3.5 rounded-full bg-white text-black font-bold text-sm tracking-wide transition-all duration-300 hover:bg-white/95 hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(255,255,255,0.4)] active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
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
                <p className="mt-4 text-xs text-red-400 bg-red-500/10 border border-red-500/20 py-2 px-4 rounded-full animate-fade-in font-sans">
                  {message}
                </p>
              )}
            </>
          ) : (
            /* Succès avec animation premium */
            <div className="flex flex-col items-center py-4 animate-fade-in">
              <div className="h-14 w-14 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center text-green-400 shadow-[0_0_20px_rgba(34,197,94,0.15)]">
                <CheckCircle2 size={26} className="animate-bounce" />
              </div>
              <h2 className="mt-5 text-xl font-bold text-white font-display">Inscription Réussie !</h2>
              <p className="mt-2 text-sm text-white/60 leading-relaxed max-w-sm font-sans">
                {message}
              </p>
              <button
                onClick={() => setStatus('idle')}
                className="mt-8 px-5 py-2 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-semibold text-white transition-all duration-300 active:scale-95"
              >
                Retour
              </button>
            </div>
          )}
        </div>

        {/* Social Icons row */}
        <div className="flex items-center gap-4 mt-10">
          {[
            { 
              label: "Twitter",
              path: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
              isSvgStroke: false
            },
            { 
              label: "Facebook",
              path: "M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15H8v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3v3h-3v6.95c4.56-.93 8-4.96 8-9.75z",
              isSvgStroke: false
            }
          ].map((soc, idx) => (
            <Link
              key={idx}
              href="#"
              aria-label={soc.label}
              className="h-11 w-11 rounded-full border border-white/10 bg-white/[0.03] flex items-center justify-center text-white/60 transition-all duration-300 hover:text-white hover:bg-white/[0.08] hover:border-white/20 active:scale-95 shadow-md shadow-black/10"
            >
              <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24">
                <path d={soc.path} />
              </svg>
            </Link>
          ))}
          <Link
            href="#"
            aria-label="Instagram"
            className="h-11 w-11 rounded-full border border-white/10 bg-white/[0.03] flex items-center justify-center text-white/60 transition-all duration-300 hover:text-white hover:bg-white/[0.08] hover:border-white/20 active:scale-95 shadow-md shadow-black/10"
          >
            <svg className="h-4 w-4 stroke-current fill-none stroke-2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
              <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
              <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
            </svg>
          </Link>
        </div>
      </main>

      {/* Footer Area with Massive outline text (Waitlist) */}
      <footer className="relative z-10 w-full flex flex-col items-center pointer-events-none">
        <span className="stroke-text font-black text-7xl md:text-[10rem] select-none leading-none select-none uppercase">
          Waitlist
        </span>
        <div className="mt-8 text-[10px] tracking-[0.2em] font-medium uppercase text-white/30 flex items-center gap-2 font-sans">
          <span>&copy; {new Date().getFullYear()} Sokar OS</span>
          <span className="h-1 w-1 rounded-full bg-white/20" />
          <span>Coming Soon</span>
        </div>
      </footer>
    </div>
  );
}
