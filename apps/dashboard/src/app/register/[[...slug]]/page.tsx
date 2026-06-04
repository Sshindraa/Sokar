'use client';

import { SignUp, useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, Sparkles, PhoneCall, CalendarCheck, TrendingUp, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

// Scénario de l'assistant Sokar pour le simulateur conversationnel
const SIMULATOR_STEPS = [
  { sender: 'client', text: 'Bonjour, je voudrais réserver une table pour ce soir.' },
  { sender: 'assistant', text: 'Bonjour ! Avec plaisir. Pour combien de personnes ce soir ?' },
  { sender: 'client', text: 'Nous serons 4 personnes.' },
  { sender: 'assistant', text: "Parfait. J'ai de la disponibilité à 20h00 ou 21h30. Qu'est-ce qui vous convient ?" },
  { sender: 'client', text: "20h c'est super !" },
  { sender: 'assistant', text: 'C’est noté. Une table pour 4 personnes ce soir à 20h00 au nom de... ?' },
  { sender: 'client', text: 'Au nom de Martin.' },
  { sender: 'assistant', text: 'C’est réservé M. Martin ! Vous allez recevoir un SMS de confirmation à l’instant. À ce soir !' },
  { sender: 'client', text: 'Parfait, merci beaucoup. Au revoir !' },
  { sender: 'assistant', text: 'Merci à vous, au revoir et bon appétit !' },
];

export default function RegisterPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();

  // États pour le simulateur conversationnel
  const [visibleSteps, setVisibleSteps] = useState<typeof SIMULATOR_STEPS>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isTyping, setIsTyping] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Redirection si déjà connecté
  useEffect(() => {
    if (isLoaded && isSignedIn) {
      router.replace('/dashboard');
    }
  }, [isLoaded, isSignedIn, router]);

  // Boucle de simulation d'appels
  useEffect(() => {
    if (visibleSteps.length === 0) {
      setIsTyping(true);
      const timer = setTimeout(() => {
        setVisibleSteps([SIMULATOR_STEPS[0]]);
        setIsTyping(false);
        setCurrentStepIndex(1);
      }, 1500);
      return () => clearTimeout(timer);
    }

    if (currentStepIndex < SIMULATOR_STEPS.length) {
      const nextLine = SIMULATOR_STEPS[currentStepIndex];
      const delay = nextLine.sender === 'assistant' ? 2400 : 1600;

      const typingTimer = setTimeout(() => {
        setIsTyping(true);
      }, delay - 800);

      const messageTimer = setTimeout(() => {
        setVisibleSteps((prev) => [...prev, nextLine]);
        setIsTyping(false);
        setCurrentStepIndex((prev) => prev + 1);
      }, delay);

      return () => {
        clearTimeout(typingTimer);
        clearTimeout(messageTimer);
      };
    } else {
      const resetTimer = setTimeout(() => {
        setVisibleSteps([]);
        setCurrentStepIndex(0);
        setIsTyping(false);
      }, 4000);
      return () => clearTimeout(resetTimer);
    }
  }, [currentStepIndex, visibleSteps]);

  // Scroll automatique uniquement du conteneur du chat simulé (sans scroller la fenêtre principale)
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [visibleSteps, isTyping]);

  // Affichage du loader haut de gamme uniquement pendant la redirection (quand déjà connecté)
  if (isLoaded && isSignedIn) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center relative overflow-hidden">
        {/* Glow atmosphérique en arrière-plan */}
        <div className="absolute inset-0 bg-background" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[35rem] h-[35rem] rounded-full blur-3xl opacity-20 bg-primary" />
        
        <div className="relative flex flex-col items-center gap-6 z-10">
          <div className="relative flex items-center justify-center h-20 w-20 rounded-full border border-border bg-card/50 backdrop-blur-xl shadow-2xl">
            <div className="absolute inset-0 rounded-full border border-primary/30 border-t-primary animate-spin" />
            <Image src="/logo-nav.png" alt="Sokar" width={40} height={40} className="h-10 w-10 animate-pulse" />
          </div>
          <p className="text-sm font-medium tracking-wider text-muted-foreground animate-pulse">
            Redirection vers votre espace...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-background text-foreground flex items-stretch">
      {/* Colonne gauche : Formulaire */}
      <div className="w-full lg:w-[45%] flex flex-col justify-between p-6 sm:p-10 relative z-10 bg-background">
        
        {/* En-tête avec bouton retour & Logo */}
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/30 px-4 py-2.5 text-xs font-medium text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground active:scale-[0.98] min-h-[44px]"
          >
            <ArrowLeft size={14} />
            Accueil
          </Link>
          
          <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-90">
            <Image src="/logo-nav.png" alt="Sokar Logo" width={32} height={32} className="h-8 w-8" />
            <span className="text-lg font-bold tracking-tight text-foreground">Sokar</span>
          </Link>
        </div>

        {/* Formulaire d'authentification Clerk stylisé */}
        <div className="my-auto py-8">
          <div className="text-center max-w-sm mx-auto mb-6">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-3 py-1 text-xs font-semibold text-muted-foreground transition-all duration-300 hover:border-foreground/15">
              <Sparkles size={11} className="text-muted-foreground" />
              Essai gratuit de 14 jours sans carte
            </div>
            <h2 className="text-3xl font-bold tracking-tight mt-3">Créez votre compte</h2>
            <p className="text-sm text-muted-foreground mt-2">
              {"Rejoignez Sokar et automatisez l'accueil téléphonique de votre établissement dès aujourd'hui"}
            </p>
          </div>

          {!isLoaded ? (
            <div className="mx-auto w-full max-w-sm space-y-5">
              <div className="space-y-2">
                <div className="h-3 w-16 bg-secondary/80 rounded animate-pulse" />
                <div className="h-10 w-full bg-secondary/40 border border-border/80 rounded-lg animate-pulse" />
              </div>
              <div className="space-y-2">
                <div className="h-3 w-28 bg-secondary/80 rounded animate-pulse" />
                <div className="h-10 w-full bg-secondary/40 border border-border/80 rounded-lg animate-pulse" />
              </div>
              <div className="h-10 w-full bg-primary/20 rounded-lg animate-pulse" />
              <div className="h-px bg-border/40 my-6" />
              <div className="h-10 w-full bg-secondary/20 border border-border/80 rounded-lg animate-pulse" />
            </div>
          ) : (
            <SignUp
              appearance={{
                variables: {
                  colorPrimary: 'hsl(var(--foreground))',
                  colorBackground: 'hsl(var(--card))',
                  colorText: 'hsl(var(--foreground))',
                  colorTextSecondary: 'hsl(var(--muted-foreground))',
                  borderRadius: '0.75rem',
                },
                elements: {
                  rootBox: 'mx-auto w-full max-w-sm',
                  card: 'shadow-none border border-border bg-card/60 backdrop-blur-xl p-0 w-full rounded-2xl overflow-hidden',
                  main: 'p-6',
                  header: 'hidden', // On masque le header Clerk brut au profit du nôtre
                  socialButtonsBlockButton: 'border border-border bg-secondary/40 text-foreground hover:bg-accent hover:text-foreground transition-all duration-200 rounded-xl h-10',
                  formFieldLabel: 'text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1',
                  formFieldInput: 'flex h-10 w-full rounded-lg border border-input bg-background/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-all duration-200',
                  formButtonPrimary: 'bg-primary text-primary-foreground hover:bg-primary/95 transition-all duration-200 rounded-lg h-10 text-sm font-semibold shadow-md shadow-primary/10 active:scale-[0.98]',
                  footerActionText: 'text-xs text-muted-foreground',
                  footerActionLink: 'text-xs text-foreground font-semibold hover:underline transition-colors',
                  dividerLine: 'bg-border',
                  dividerText: 'text-muted-foreground text-xs uppercase font-bold tracking-widest',
                  identityPreviewCard: 'border border-border bg-secondary/30 rounded-xl p-3',
                  formResendCodeButton: 'text-foreground hover:text-muted-foreground transition-colors font-medium',
                },
              }}
            />
          )}
        </div>

        {/* Pied de page discret */}
        <div className="text-center text-xs text-muted-foreground border-t border-border/20 pt-4">
          <p>© {new Date().getFullYear()} Sokar. Tous droits réservés.</p>
        </div>
      </div>

      {/* Colonne droite : Preview interactive / Design Premium */}
      <div className="hidden lg:flex flex-1 relative overflow-hidden bg-muted flex-col justify-between p-8 xl:p-10 border-l border-border/40">
        
        {/* Atmosphère Lumineuse Dynamique */}
        <div className="absolute inset-0 bg-gradient-to-br from-background via-muted to-background z-0" />
        <div className="absolute top-[15%] left-[25%] w-[40rem] h-[25rem] rounded-full blur-3xl opacity-20 bg-foreground/10 mix-blend-screen pointer-events-none" />
        <div className="absolute -bottom-20 -right-20 w-[30rem] h-[30rem] rounded-full blur-3xl opacity-10 bg-primary/20 pointer-events-none" />

        {/* Top-right decorative badge */}
        <div className="self-end z-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 backdrop-blur-xl px-4 py-2 text-xs font-semibold shadow-sm transition-all duration-200">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            Simulation temps réel
          </div>
        </div>

        {/* Visual Showcase Center */}
        <div className="my-auto max-w-2xl mx-auto w-full z-10 space-y-6">
          
          {/* Métrique d'Aperçu Flottante */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-2xl border border-border bg-card/60 backdrop-blur-xl p-5 shadow-lg transition-all duration-300 hover:-translate-y-0.5">
              <div className="flex items-center justify-between gap-3">
                <span className="sokar-icon-button h-9 w-9 border-border bg-secondary/50">
                  <PhoneCall size={15} className="text-muted-foreground" />
                </span>
                <span className="rounded-full bg-primary/10 border border-primary/20 text-foreground px-2 py-0.5 text-xs font-bold uppercase tracking-wide">
                  Actif
                </span>
              </div>
              <p className="mt-5 text-3xl font-bold tracking-tight">412</p>
              <p className="mt-1 text-xs text-muted-foreground font-medium">Appels traités ce mois</p>
            </div>

            <div className="rounded-2xl border border-border bg-card/60 backdrop-blur-xl p-5 shadow-lg transition-all duration-300 hover:-translate-y-0.5">
              <div className="flex items-center justify-between gap-3">
                <span className="sokar-icon-button h-9 w-9 border-border bg-secondary/50">
                  <TrendingUp size={15} className="text-emerald-500" />
                </span>
                <span className="rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 text-xs font-bold uppercase tracking-wide">
                  +18.4%
                </span>
              </div>
              <p className="mt-5 text-3xl font-bold tracking-tight">98.4%</p>
              <p className="mt-1 text-xs text-muted-foreground font-medium">Taux de réponse garanti</p>
            </div>
          </div>

          {/* Simulateur d'Appel Conversationnel en Direct */}
          <div className="rounded-2xl border border-border bg-card/70 backdrop-blur-xl shadow-2xl overflow-hidden flex flex-col h-[320px] transition-all duration-300">
            {/* Header du Chat */}
            <div className="border-b border-border bg-secondary/20 px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-primary/10 border border-border flex items-center justify-center shadow-inner">
                  <Image src="/logo-nav.png" alt="Sokar AI" width={20} height={20} className="h-5 w-5 animate-pulse" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold tracking-tight text-foreground">Assistant Vocal Sokar</h4>
                  <p className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    En communication avec un client
                  </p>
                </div>
              </div>
              
              <div className="h-1.5 w-24 bg-border rounded-full overflow-hidden relative">
                <div className="h-full bg-gradient-to-r from-muted-foreground to-foreground rounded-full w-2/3 animate-pulse" />
              </div>
            </div>

            {/* Corps des messages du chat */}
            <div
              ref={chatContainerRef}
              className="flex-1 overflow-y-auto p-5 space-y-3 scrollbar-none flex flex-col justify-start"
            >
              {visibleSteps.map((step, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "flex flex-col max-w-[80%] rounded-2xl px-4 py-2.5 text-sm transition-all duration-300 scale-95 origin-bottom animate-in fade-in slide-in-from-bottom-2",
                    step.sender === 'assistant'
                      ? "bg-secondary text-foreground self-start rounded-tl-none border border-border"
                      : "bg-primary text-primary-foreground self-end rounded-tr-none shadow-md shadow-primary/5"
                  )}
                >
                  <p className="leading-relaxed font-medium">{step.text}</p>
                </div>
              ))}

              {/* Indicateur de saisie IA */}
              {isTyping && (
                <div className="flex items-center gap-1 bg-secondary text-foreground border border-border rounded-2xl rounded-tl-none px-4 py-3 self-start max-w-[80%] transition-opacity duration-300">
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Testimonial Block */}
        <div className="z-10 bg-card/40 border border-border/80 backdrop-blur-md rounded-2xl p-5 shadow-lg max-w-xl mx-auto w-full transition-all duration-200">
          <p className="text-sm italic leading-relaxed text-muted-foreground">
            {"\"Sokar gère 100% des appels entrants pendant les heures de pointe. L'assistant prend les réservations directement et envoie le SMS de confirmation. Mon équipe reste concentrée sur la cuisine et le service.\""}
          </p>
          <div className="mt-4 flex items-center justify-between border-t border-border/40 pt-3">
            <div>
              <p className="text-xs font-semibold text-foreground">Chef Matthieu</p>
              <p className="text-xs text-muted-foreground">Bistrot L’Ardoise — 2 étoiles Michelin</p>
            </div>
            <div className="flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2.5 py-1 text-xs font-semibold text-emerald-400">
              <CheckCircle size={10} />
              Partenaire Certifié
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
