'use client';

import { useState } from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { joinWaitlistAction } from '@/app/actions';

export default function WaitlistSection() {
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

    try {
      const res = await joinWaitlistAction(email);
      if (res.success) {
        setStatus('success');
        setMessage(res.message || 'Vous êtes inscrit !');
      } else {
        setStatus('error');
        setMessage(res.message || 'Une erreur est survenue.');
      }
    } catch {
      setStatus('error');
      setMessage('Impossible de contacter le serveur.');
    }
  };

  return (
    <section id="waitlist" className="w-full py-16 scroll-mt-24 flex flex-col items-center">
      <div className="glass-card w-full max-w-2xl p-8 md:p-12 rounded-3xl transition-all duration-500 hover:border-white/12 text-center">
        {status !== 'success' ? (
          <>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white font-display">
              Rejoindre la waitlist privée !
            </h2>
            <p className="mt-3 text-xs md:text-sm text-white/50 max-w-md mx-auto leading-relaxed font-sans">
              Entrez votre adresse email pour faire partie des premiers établissements partenaires à tester Sokar dès son lancement.
            </p>

            <form onSubmit={handleSubmit} className="mt-8 flex flex-col sm:flex-row gap-3 w-full max-w-md mx-auto">
              <input
                type="email"
                placeholder="Entrez votre email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={status === 'loading'}
                className="flex-1 px-5 py-3.5 rounded-full bg-[#0b0b0e]/80 border border-white/10 text-white placeholder-white/30 text-sm outline-none transition-all duration-300 focus:border-white/20 focus:bg-white/[0.05] focus:ring-1 focus:ring-white/20 font-sans"
                required
              />
              <button
                type="submit"
                disabled={status === 'loading'}
                className="px-8 py-3.5 rounded-full bg-white text-black font-bold text-sm tracking-wide transition-all duration-300 hover:bg-white/95 hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(255,255,255,0.4)] active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2 font-sans"
              >
                {status === 'loading' ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Connexion...
                  </>
                ) : (
                  'Valider'
                )}
              </button>
            </form>

            {status === 'error' && (
              <p className="mt-4 text-xs text-red-400 bg-red-500/10 border border-red-500/20 py-2 px-4 rounded-full animate-fade-in font-sans max-w-xs mx-auto">
                {message}
              </p>
            )}
          </>
        ) : (
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
              className="mt-8 px-5 py-2 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-semibold text-white transition-all duration-300 active:scale-95 font-sans"
            >
              Retour
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
