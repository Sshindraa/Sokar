'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { SignedIn, SignedOut } from '@clerk/nextjs';
import { joinWaitlistAction } from './actions';
import { 
  ArrowUpRight, 
  CheckCircle2, 
  Loader2, 
  Sparkles,
  PhoneCall,
  TrendingUp,
  ArrowRight,
  ChevronDown,
  HelpCircle,
  Check,
  CalendarCheck,
  Zap,
  MessageSquare,
  Euro
} from 'lucide-react';

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

const PLANS = [
  {
    label: 'Essential',
    price: '149',
    period: '€',
    features: [
      'Répond à chaque appel, 24h/24',
      'Réservations prises sans intervention',
      'Ton adapté à votre établissement',
      'Rapport quotidien de vos appels',
      '1 numéro dédié inclus',
    ],
  },
  {
    label: 'Pro',
    price: '249',
    period: '€',
    features: [
      "Tout l'Essential, sans limite",
      'Vos clients reconnus à chaque appel',
      'No-shows anticipés et gérés automatiquement',
      'Revenus récupérés visibles en temps réel',
      'Réservable depuis ChatGPT, Claude et les IA du marché',
      'Support prioritaire 7j/7',
    ],
    featured: true,
  },
  {
    label: 'Multi-site',
    price: '249',
    period: '€ + 99€/site suppl.',
    features: [
      'Plan Pro sur tous vos établissements',
      'Un seul dashboard pour tout piloter',
      'Un numéro et un agent par site',
      'Une seule facture pour tout le groupe',
    ],
  },
];

const FAQS = [
  {
    question: "Comment fonctionne l'assistant vocal Sokar ?",
    answer: "Sokar est branché directement sur votre ligne téléphonique actuelle. Lorsqu'un client vous appelle, Sokar répond automatiquement avec une voix chaleureuse et naturelle. Il comprend les demandes complexes, consulte vos disponibilités en temps réel sur votre logiciel de réservation, et valide la table. Le client reçoit ensuite un SMS de confirmation immédiat."
  },
  {
    question: "S'intègre-t-il avec mon logiciel de réservation ou de caisse ?",
    answer: "Oui. Sokar s'intègre nativement avec les principaux logiciels de réservation du marché (ZenChef, TheFork, Guestonline...) ainsi qu'avec vos outils de gestion de caisse pour valider instantanément les couverts sans aucun risque de doublon."
  },
  {
    question: "Puis-je personnaliser le ton et les réponses de Sokar ?",
    answer: "Absolument. Depuis votre tableau de bord, vous pouvez configurer l'attitude de votre assistant, le ton de sa voix (formel, amical, gastronomique), lui faire suggérer le plat du jour, lui indiquer de parler des allergènes, ou encore spécifier quand transférer un appel sensible vers un humain."
  },
  {
    question: "Comment Sokar aide-t-il à réduire les no-shows ?",
    answer: "Sokar réduit les no-shows de plus de 85% grâce à des processus de confirmation automatiques par SMS interactif. En cas de désistement, l'assistant annule immédiatement la table et la remet à disposition sur vos canaux pour garantir un taux d'occupation maximal."
  },
  {
    question: "Y a-t-il un engagement sur les abonnements ?",
    answer: "Nos forfaits mensuels sont totalement sans engagement, vous êtes libre d'arrêter quand vous le souhaitez. Si vous optez pour la facturation annuelle, vous vous engagez pour 12 mois et bénéficiez d'une réduction de 20% sur l'ensemble de vos mensualités."
  }
];

function RadialDial({ value }: { value: number }) {
  const radius = 24;
  const stroke = 3;
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (value / 100) * circumference;

  return (
    <div className="relative flex items-center justify-center">
      <svg height={radius * 2} width={radius * 2} className="transform -rotate-90">
        <circle
          stroke="rgba(255, 255, 255, 0.05)"
          fill="transparent"
          strokeWidth={stroke}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />
        <circle
          stroke="url(#orangeDialGradShowcase)"
          fill="transparent"
          strokeWidth={stroke}
          strokeDasharray={circumference + ' ' + circumference}
          style={{ strokeDashoffset }}
          strokeLinecap="round"
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />
        <defs>
          <linearGradient id="orangeDialGradShowcase" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f97316" />
            <stop offset="100%" stopColor="#ea580c" />
          </linearGradient>
        </defs>
      </svg>
      <span className="absolute text-[9px] font-black text-white tracking-tight font-display">{value}%</span>
    </div>
  );
}

function ShowcaseMetricCard({
  label,
  value,
  icon: Icon,
  trend,
  isDial,
  dialValue,
  featured,
}: {
  label: string;
  value: string;
  icon: any;
  trend?: string;
  isDial?: boolean;
  dialValue?: number;
  featured?: boolean;
}) {
  return (
    <div className={`relative overflow-hidden rounded-2xl border transition-all duration-300 p-4 ${
      featured 
        ? 'border-orange-500/25 bg-orange-500/[0.01] shadow-[0_0_30px_rgba(249,115,22,0.03)]' 
        : 'border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.03]'
    }`}>
      {featured && (
        <div className="absolute -top-12 -right-12 w-24 h-24 rounded-full bg-orange-500/10 filter blur-xl pointer-events-none" />
      )}
      
      <div className="flex items-center justify-between gap-3">
        <span className={`h-8 w-8 rounded-full flex items-center justify-center border transition-all duration-200 ${
          featured 
            ? 'bg-orange-500/10 border-orange-500/25 text-orange-400' 
            : 'bg-white/5 border-white/5 text-white/50'
        }`}>
          <Icon size={14} />
        </span>
        
        {trend && (
          <span className="flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold">
            <span className="inline-block transform -rotate-45">→</span> {trend}
          </span>
        )}
      </div>
      
      <div className="mt-6 flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-xl font-black font-display tracking-tight truncate ${
            featured ? 'text-orange-400' : 'text-white'
          }`}>
            {value}
          </p>
          <p className="mt-1 text-[9px] font-bold text-white/40 tracking-wider uppercase font-sans">
            {label}
          </p>
        </div>

        {isDial && dialValue !== undefined && (
          <div className="flex-shrink-0">
            <RadialDial value={dialValue} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function HomePage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [yearly, setYearly] = useState(true);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

  // États pour le simulateur conversationnel
  const [visibleSteps, setVisibleSteps] = useState<typeof SIMULATOR_STEPS>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isTyping, setIsTyping] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);

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
        setMessage('Merci ! Vous avez été ajouté à notre liste d\'attente prioritaire.');
        setEmail('');
      } else {
        setStatus('error');
        setMessage(res.error || 'Une erreur est survenue lors de l\'inscription.');
      }
    } catch (err) {
      console.error(err);
      setStatus('error');
      setMessage('Une erreur réseau ou serveur est survenue. Veuillez réessayer.');
    }
  };

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

  // Scroll automatique uniquement du conteneur du chat simulé
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [visibleSteps, isTyping]);

  const displayPrice = (price: string, isYearly: boolean) => {
    const num = parseInt(price, 10);
    return isYearly ? Math.round(num * 0.8).toString() : price;
  };

  const toggleFaq = (index: number) => {
    setOpenFaqIndex(openFaqIndex === index ? null : index);
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#030303] text-foreground flex flex-col justify-between items-center select-none font-sans antialiased">
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
          text-shadow: 0 0 40px rgba(255, 255, 255, 0.15);
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
          background: radial-gradient(circle, rgba(249,115,22,0.18) 0%, rgba(249,115,22,0) 70%);
          filter: blur(70px);
        }
      `}</style>

      {/* Abstract Glowing Fluid Curves & Background (WOW Factor) */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden select-none">
        {/* Halo central orange juste derrière le titre */}
        <div className="orange-glow-light absolute top-[20%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[450px] pointer-events-none z-0" />
        
        <svg className="absolute w-[130%] h-[130%] -left-[15%] -top-[15%] filter blur-[60px] opacity-75" viewBox="0 0 1000 1000" fill="none">
          <defs>
            <linearGradient id="orange-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#f97316" stopOpacity="0.6" />
              <stop offset="40%" stopColor="#ea580c" stopOpacity="0.4" />
              <stop offset="70%" stopColor="#c2410c" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#7c2d12" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="blue-grad" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#1d4ed8" stopOpacity="0.2" />
              <stop offset="50%" stopColor="#1e3a8a" stopOpacity="0.08" />
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
      <header className="fixed top-5 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-5xl rounded-full border border-white/10 bg-black/40 backdrop-blur-xl px-4 py-2 flex items-center justify-between shadow-2xl transition-all duration-300">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 rounded-full transition-all duration-300 hover:opacity-80 px-2"
        >
          <img src="/logo-nav.png" alt="Sokar" className="h-9 w-9 filter drop-shadow-[0_0_10px_rgba(255,255,255,0.15)]" />
          <span className="text-lg font-bold tracking-tight text-white glow-title font-display">Sokar</span>
        </Link>

        {/* Center menu */}
        <nav className="hidden md:flex items-center gap-1">
          <a href="#demo" className="text-xs font-semibold tracking-wide text-white/60 hover:text-white px-3 py-1.5 rounded-full hover:bg-white/5 transition-all duration-200">
            Démonstration
          </a>
          <a href="#tarifs" className="text-xs font-semibold tracking-wide text-white/60 hover:text-white px-3 py-1.5 rounded-full hover:bg-white/5 transition-all duration-200">
            Tarifs
          </a>
          <a href="#faq" className="text-xs font-semibold tracking-wide text-white/60 hover:text-white px-3 py-1.5 rounded-full hover:bg-white/5 transition-all duration-200">
            FAQ
          </a>
        </nav>

        {/* Action Button */}
        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="text-xs font-semibold text-white/60 hover:text-white px-3 py-1.5 rounded-full hover:bg-white/5 transition-all duration-200"
          >
            Connexion
          </Link>
          <a
            href="#waitlist"
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full border border-orange-500/20 bg-orange-500/10 hover:bg-orange-500/20 text-xs font-semibold tracking-wide text-orange-400 transition-all duration-300 hover:-translate-y-0.5 active:scale-95 shadow-[0_4px_12px_rgba(0,0,0,0.3)]"
          >
            Rejoindre la Waitlist
            <ArrowRight size={12} />
          </a>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="relative z-10 w-full max-w-5xl px-6 pt-32 flex flex-col items-center">
        
        {/* ================= HERO SECTION ================= */}
        <section className="flex flex-col items-center text-center max-w-3xl my-12 md:my-20">
          {/* Floating Waitlist Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-orange-500/20 bg-orange-500/10 text-[10px] font-bold tracking-widest uppercase text-orange-400 shadow-[0_0_15px_rgba(249,115,22,0.15)] animate-pulse">
            <Sparkles size={11} className="text-orange-400" />
            Waitlist de la bêta privée
          </div>

          {/* Coming soon Title */}
          <h1 className="mt-6 text-4xl sm:text-6xl md:text-7xl font-black tracking-tight text-white glow-title font-display leading-[1.05]">
            L&apos;assistant vocal intelligent pour votre restaurant.
          </h1>

          <p className="mt-6 text-sm sm:text-base text-white/50 max-w-xl mx-auto leading-relaxed font-sans">
            Sokar répond à vos appels clients, gère 100% de vos réservations en direct sur votre logiciel et éradique les no-shows. Vos équipes restent concentrées sur la salle.
          </p>

          {/* CTAs */}
          <div className="mt-8 flex flex-col sm:flex-row items-center gap-4 justify-center">
            <a
              href="#waitlist"
              className="px-8 py-3.5 rounded-full bg-white text-black font-bold text-sm tracking-wide transition-all duration-300 hover:bg-white/95 hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(255,255,255,0.4)] active:scale-[0.98]"
            >
              Rejoindre la Waitlist
            </a>
            <a
              href="#demo"
              className="px-6 py-3.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 text-white font-semibold text-sm tracking-wide transition-all duration-300"
            >
              Voir la démo
            </a>
          </div>
        </section>

        {/* ================= SIMULATOR / DEMO SECTION ================= */}
        <section id="demo" className="w-full py-16 scroll-mt-24 flex flex-col items-center">
          <div className="text-center max-w-lg mb-10">
            <h2 className="text-2xl md:text-4xl font-bold tracking-tight text-white font-display">
              Le Tableau de Bord en Action
            </h2>
            <p className="mt-2 text-xs md:text-sm text-white/50 leading-relaxed font-sans">
              Admirez l&apos;interface de pilotage Sokar en temps réel. Le moniteur d&apos;activité affiche les statistiques de l&apos;assistant vocal en parallèle de la console de dialogue.
            </p>
          </div>

          {/* Interactive HMI Dashboard Showcase (Pinterest Style) */}
          <div className="w-full grid gap-6 lg:grid-cols-[1.1fr_1fr] bg-white/[0.01] border border-white/5 p-6 rounded-3xl backdrop-blur-2xl shadow-2xl relative overflow-hidden">
            {/* Ambient Background glow behind showcase */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[300px] bg-orange-500/5 filter blur-3xl pointer-events-none rounded-full" />
            
            {/* Left side: Showcase Metrics & Status */}
            <div className="flex flex-col gap-4 justify-between">
              
              {/* Mini Welcome panel with active indicator */}
              <div className="rounded-2xl border-l-4 border-l-orange-500 border border-y-white/5 border-r-white/5 bg-gradient-to-r from-orange-500/[0.02] to-transparent p-5 flex flex-col justify-between shadow-[inset_1px_1px_1px_rgba(255,255,255,0.02)]">
                <div>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-orange-500/20 bg-orange-500/10 text-[9px] font-bold tracking-widest uppercase text-orange-400">
                    <Sparkles size={9} />
                    Moniteur d&apos;activité IA
                  </div>
                  <h3 className="mt-3 text-xl font-black leading-tight text-white font-display">
                    La salle répond quand vous cuisinez.
                  </h3>
                  <p className="mt-2 text-[10px] sm:text-xs text-white/45 leading-relaxed font-sans">
                    Découvrez ci-dessous comment les appels sont interceptés, les tables créées et le chiffre d&apos;affaires sécurisé en temps réel.
                  </p>
                </div>
                
                <div className="mt-4 pt-3 border-t border-white/5 flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[9px] font-bold tracking-widest text-white/40 uppercase">Assistant Vocal en ligne</span>
                </div>
              </div>

              {/* 4 Metric cards showcase grid */}
              <div className="grid grid-cols-2 gap-3.5">
                <ShowcaseMetricCard 
                  label="Appels traités" 
                  value="412" 
                  icon={PhoneCall} 
                  trend="+12.4%"
                />
                <ShowcaseMetricCard
                  label="Tables réservées"
                  value="189"
                  icon={CalendarCheck}
                  trend="+15.8%"
                />
                <ShowcaseMetricCard 
                  label="Taux de réponse" 
                  value="98%" 
                  icon={TrendingUp} 
                  isDial 
                  dialValue={98}
                />
                <ShowcaseMetricCard 
                  label="Revenus récupérés" 
                  value="5 420 €" 
                  icon={Euro} 
                  featured
                />
              </div>
            </div>

            {/* Right side: Live Conversational Simulator in Showcase mock frame */}
            <div className="rounded-2xl border border-white/10 bg-black/60 shadow-xl overflow-hidden flex flex-col h-full min-h-[380px] transition-all duration-300 relative">
              {/* Header du Chat */}
              <div className="border-b border-white/10 bg-white/[0.03] px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shadow-inner">
                    <img src="/logo-nav.png" alt="Sokar AI" className="h-4.5 w-4.5 animate-pulse" />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold tracking-tight text-white">Console de Dialogue Live</h4>
                    <p className="text-[9px] text-emerald-400 font-medium flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Appel client en cours
                    </p>
                  </div>
                </div>
                
                <div className="h-1.5 w-20 bg-white/10 rounded-full overflow-hidden relative">
                  <div className="h-full bg-gradient-to-r from-orange-400 to-orange-600 rounded-full w-2/3 animate-pulse" />
                </div>
              </div>

              {/* Corps des messages du chat */}
              <div
                ref={chatContainerRef}
                className="flex-1 overflow-y-auto p-4 space-y-3 flex flex-col justify-start scrollbar-none h-[280px]"
              >
                {visibleSteps.map((step, idx) => (
                  <div
                    key={idx}
                    className={`flex flex-col max-w-[85%] rounded-2xl px-3.5 py-2 text-xs transition-all duration-300 scale-95 origin-bottom animate-in fade-in slide-in-from-bottom-2 ${
                      step.sender === 'assistant'
                        ? "bg-white/[0.04] text-white self-start rounded-tl-none border border-white/10 font-sans"
                        : "bg-white text-black self-end rounded-tr-none shadow-md font-sans"
                    }`}
                  >
                    <p className="leading-relaxed font-semibold">{step.text}</p>
                  </div>
                ))}

                {/* Indicateur de saisie IA */}
                {isTyping && (
                  <div className="flex items-center gap-1 bg-white/[0.04] text-white border border-white/10 rounded-2xl rounded-tl-none px-3.5 py-2.5 self-start max-w-[80%] transition-opacity duration-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-white/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-white/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-white/60 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ================= FEATURES SECTION ================= */}
        <section className="w-full py-16 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="glass-card p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-all duration-300 flex flex-col gap-4">
            <span className="h-10 w-10 rounded-full bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-400">
              <PhoneCall size={18} />
            </span>
            <h3 className="text-lg font-bold text-white font-display">100% des appels traités</h3>
            <p className="text-xs text-white/50 leading-relaxed font-sans">
              Sokar gère plusieurs appels simultanés lors des pics de service. Finis les clients frustrés qui tombent sur messagerie.
            </p>
          </div>

          <div className="glass-card p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-all duration-300 flex flex-col gap-4">
            <span className="h-10 w-10 rounded-full bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-400">
              <CalendarCheck size={18} />
            </span>
            <h3 className="text-lg font-bold text-white font-display">Zéro double saisie</h3>
            <p className="text-xs text-white/50 leading-relaxed font-sans">
              Intégration transparente et bidirectionnelle avec vos logiciels de réservation (ZenChef, TheFork) et de caisse.
            </p>
          </div>

          <div className="glass-card p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-all duration-300 flex flex-col gap-4">
            <span className="h-10 w-10 rounded-full bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-400">
              <Zap size={18} />
            </span>
            <h3 className="text-lg font-bold text-white font-display">Intelligence locale</h3>
            <p className="text-xs text-white/50 leading-relaxed font-sans">
              Sokar connaît vos plats du jour, vos allergènes et prend des décisions complexes selon les consignes que vous lui donnez.
            </p>
          </div>
        </section>

        {/* ================= PRICING SECTION ================= */}
        <section id="tarifs" className="w-full py-16 scroll-mt-24 flex flex-col items-center">
          <div className="text-center max-w-lg mb-10 flex flex-col items-center">
            <h2 className="text-2xl md:text-4xl font-bold tracking-tight text-white font-display">
              Des tarifs adaptés à chaque restaurant
            </h2>
            <p className="mt-2 text-xs md:text-sm text-white/50 leading-relaxed font-sans">
              Pas de frais cachés, sans engagement. Choisissez la formule qui convient le mieux à votre activité.
            </p>

            {/* Toggle Yearly */}
            <div className="mt-6 flex items-center gap-3">
              <span className={`text-xs font-semibold ${!yearly ? 'text-white' : 'text-white/40'} transition-all duration-200`}>Mensuel</span>
              <button 
                onClick={() => setYearly(!yearly)}
                className={`relative w-12 h-6 rounded-full border border-white/10 transition-colors duration-300 focus:outline-none ${yearly ? 'bg-orange-500/20' : 'bg-white/5'}`}
              >
                <span className={`absolute top-0.5 left-0.5 h-4.5 w-4.5 rounded-full bg-white transition-all duration-300 ${yearly ? 'translate-x-6' : 'translate-x-0'}`} />
              </button>
              <span className={`text-xs font-semibold ${yearly ? 'text-white' : 'text-white/40'} transition-all duration-200 flex items-center gap-1.5`}>
                Annuel 
                <span className="px-2 py-0.5 text-[9px] bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded-full font-bold">
                  -20%
                </span>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full mt-6">
            {PLANS.map((plan) => (
              <div 
                key={plan.label} 
                className={`glass-card p-8 rounded-3xl border flex flex-col justify-between gap-6 transition-all duration-500 hover:scale-[1.01] ${
                  plan.featured 
                    ? 'border-orange-500/30 bg-orange-500/[0.01] shadow-[0_0_50px_rgba(249,115,22,0.05)]' 
                    : 'border-white/5'
                }`}
              >
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-xs uppercase tracking-widest font-bold text-white/45 font-sans">
                      {plan.label}
                    </span>
                    {plan.featured && (
                      <span className="px-2 py-0.5 text-[9px] font-bold tracking-wide uppercase bg-orange-500/10 border border-orange-500/20 text-orange-400 rounded-full">
                        Recommandé
                      </span>
                    )}
                  </div>
                  
                  <div className="flex items-baseline gap-1 mt-2">
                    <span className="text-4xl md:text-5xl font-black text-white font-display tracking-tight">
                      {displayPrice(plan.price, yearly)}
                    </span>
                    <span className="text-sm font-medium text-white/50 font-sans">
                      {plan.period}
                    </span>
                  </div>

                  <ul className="mt-8 space-y-3.5 flex flex-col">
                    {plan.features.map((feat) => (
                      <li key={feat} className="flex items-start gap-2.5 text-xs text-white/60 leading-relaxed font-sans">
                        <Check size={14} className="text-orange-400 mt-0.5 flex-shrink-0" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <a 
                  href="#waitlist"
                  className={`w-full py-3 rounded-xl font-bold text-xs tracking-wider text-center transition-all duration-300 block ${
                    plan.featured 
                      ? 'bg-orange-500 text-white hover:bg-orange-600 hover:shadow-[0_0_20px_rgba(249,115,22,0.3)] active:scale-[0.98]' 
                      : 'bg-white/5 text-white hover:bg-white/10 active:scale-[0.98]'
                  }`}
                >
                  Rejoindre la Waitlist
                </a>
              </div>
            ))}
          </div>
        </section>

        {/* ================= FAQ SECTION ================= */}
        <section id="faq" className="w-full py-16 scroll-mt-24 flex flex-col items-center">
          <div className="text-center max-w-lg mb-10">
            <h2 className="text-2xl md:text-4xl font-bold tracking-tight text-white font-display">
              Foire Aux Questions
            </h2>
            <p className="mt-2 text-xs md:text-sm text-white/50 leading-relaxed font-sans">
              Tout ce que vous devez savoir pour déployer Sokar dans votre établissement.
            </p>
          </div>

          <div className="w-full max-w-3xl flex flex-col gap-4 mt-6">
            {FAQS.map((faq, idx) => (
              <div 
                key={idx} 
                className="glass-card rounded-2xl border border-white/5 overflow-hidden transition-all duration-300 hover:border-white/10"
              >
                <button
                  onClick={() => toggleFaq(idx)}
                  className="w-full px-6 py-5 flex items-center justify-between text-left focus:outline-none transition-colors duration-200 hover:bg-white/[0.02]"
                >
                  <span className="text-sm md:text-base font-semibold text-white font-sans pr-4">
                    {faq.question}
                  </span>
                  <ChevronDown 
                    size={16} 
                    className={`text-white/40 transition-transform duration-300 flex-shrink-0 ${
                      openFaqIndex === idx ? 'rotate-180 text-orange-400' : 'rotate-0'
                    }`} 
                  />
                </button>

                <div 
                  className={`transition-all duration-300 ease-in-out overflow-hidden ${
                    openFaqIndex === idx ? 'max-h-[200px] border-t border-white/5' : 'max-h-0'
                  }`}
                >
                  <p className="px-6 py-5 text-xs md:text-sm text-white/50 leading-relaxed font-sans bg-white/[0.01]">
                    {faq.answer}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ================= WAITLIST SECTION ================= */}
        <section id="waitlist" className="w-full py-16 scroll-mt-24 flex flex-col items-center">
          {/* Waitlist Glassmorphism Box */}
          <div className="glass-card w-full max-w-2xl p-8 md:p-12 rounded-3xl transition-all duration-500 hover:border-white/12 text-center">
            {status !== 'success' ? (
              <>
                <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white font-display">
                  Rejoindre la waitlist privée !
                </h2>
                <p className="mt-3 text-xs md:text-sm text-white/50 max-w-md mx-auto leading-relaxed font-sans">
                  Entrez votre adresse email pour faire partie des premiers établissements partenaires à tester Sokar dès son lancement.
                </p>

                {/* Formulaire d'inscription */}
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
                  className="mt-8 px-5 py-2 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-semibold text-white transition-all duration-300 active:scale-95 font-sans"
                >
                  Retour
                </button>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Footer Area */}
      <footer className="relative z-10 w-full border-t border-white/5 bg-black/40 backdrop-blur-md pt-16 pb-12 mt-20 px-6 flex flex-col items-center">
        {/* Massive outline background text (SOKAR) */}
        <div className="absolute inset-x-0 bottom-0 overflow-hidden pointer-events-none select-none flex justify-center -z-10 opacity-30">
          <span className="stroke-text font-black text-[12vw] tracking-[0.1em] uppercase leading-none select-none">
            SOKAR
          </span>
        </div>

        <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
          {/* Brand Info */}
          <div className="flex flex-col gap-4">
            <Link href="/" className="flex items-center gap-2">
              <img src="/logo-nav.png" alt="Sokar" className="h-8 w-8 filter drop-shadow-[0_0_10px_rgba(255,255,255,0.15)]" />
              <span className="text-lg font-bold text-white font-display">Sokar</span>
            </Link>
            <p className="text-xs text-white/40 leading-relaxed font-sans max-w-xs">
              L&apos;assistant vocal intelligent qui révolutionne la prise de réservations et la gestion des appels de votre restaurant.
            </p>
            {/* Social Icons inside Brand column */}
            <div className="flex items-center gap-3 mt-2">
              {[
                { 
                  label: "Twitter",
                  path: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
                },
                { 
                  label: "Facebook",
                  path: "M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15H8v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3v3h-3v6.95c4.56-.93 8-4.96 8-9.75z"
                }
              ].map((soc, idx) => (
                <Link
                  key={idx}
                  href="#"
                  aria-label={soc.label}
                  className="h-9 w-9 rounded-full border border-white/10 bg-white/[0.03] flex items-center justify-center text-white/60 transition-all duration-300 hover:text-white hover:bg-white/[0.08] hover:border-white/20 active:scale-95 shadow-md shadow-black/10"
                >
                  <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
                    <path d={soc.path} />
                  </svg>
                </Link>
              ))}
              <Link
                href="#"
                aria-label="Instagram"
                className="h-9 w-9 rounded-full border border-white/10 bg-white/[0.03] flex items-center justify-center text-white/60 transition-all duration-300 hover:text-white hover:bg-white/[0.08] hover:border-white/20 active:scale-95 shadow-md shadow-black/10"
              >
                <svg className="h-3.5 w-3.5 stroke-current fill-none stroke-2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                  <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                  <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                </svg>
              </Link>
            </div>
          </div>

          {/* Links Column 1: Produit */}
          <div className="flex flex-col gap-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white/80 font-sans">Produit</h4>
            <a href="#demo" className="text-xs text-white/45 hover:text-white transition-colors duration-200 font-sans">
              Démonstration
            </a>
            <a href="#tarifs" className="text-xs text-white/45 hover:text-white transition-colors duration-200 font-sans">
              Tarifs
            </a>
            <a href="#faq" className="text-xs text-white/45 hover:text-white transition-colors duration-200 font-sans">
              FAQ
            </a>
          </div>

          {/* Links Column 2: Entreprise */}
          <div className="flex flex-col gap-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white/80 font-sans">Entreprise</h4>
            <a href="#waitlist" className="text-xs text-white/45 hover:text-white transition-colors duration-200 font-sans">
              Waitlist Bêta
            </a>
            <Link href="/login" className="text-xs text-white/45 hover:text-white transition-colors duration-200 font-sans">
              Espace Partenaire
            </Link>
          </div>

          {/* Links Column 3: Légal */}
          <div className="flex flex-col gap-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white/80 font-sans">Légal</h4>
            <a href="#" className="text-xs text-white/45 hover:text-white transition-colors duration-200 font-sans">
              Mentions Légales
            </a>
            <a href="#" className="text-xs text-white/45 hover:text-white transition-colors duration-200 font-sans">
              Confidentialité
            </a>
          </div>
        </div>

        {/* Bottom border and copyright */}
        <div className="w-full max-w-5xl border-t border-white/5 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-[10px] tracking-[0.1em] uppercase text-white/30 font-sans">
            &copy; {new Date().getFullYear()} SOKAR OS. TOUS DROITS RÉSERVÉS.
          </p>
          <div className="flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase text-white/45 bg-white/5 border border-white/10 px-3 py-1 rounded-full font-bold">
            <span className="h-1.5 w-1.5 rounded-full bg-orange-400 animate-pulse" />
            Bêta Privée
          </div>
        </div>
      </footer>
    </div>
  );
}
