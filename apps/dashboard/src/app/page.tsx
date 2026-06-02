'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { SignedIn, SignedOut } from '@clerk/nextjs';
import { Outfit, Plus_Jakarta_Sans } from 'next/font/google';
import { joinWaitlistAction } from './actions';
import { 
  ArrowUpRight, 
  CheckCircle2, 
  Loader2, 
  Sparkles,
  PhoneCall,
  TrendingUp,
  ChevronDown,
  Check,
  CalendarCheck,
  Zap,
  MessageSquare,
  Euro,
  Headphones
} from 'lucide-react';

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800', '900'],
  display: 'swap',
  variable: '--font-display',
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-sans',
});

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
  const [currentValue, setCurrentValue] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setCurrentValue(value);
    }, 150);
    return () => clearTimeout(timer);
  }, [value]);

  const radius = 24;
  const stroke = 2.5;
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (currentValue / 100) * circumference;

  const innerRadius = normalizedRadius - 4;
  const innerCircumference = innerRadius * 2 * Math.PI;
  const innerStrokeDashoffset = innerCircumference - (Math.min(currentValue * 0.9, 100) / 100) * innerCircumference;

  return (
    <div className="relative flex items-center justify-center select-none pointer-events-none">
      <svg height={radius * 2} width={radius * 2} className="transform -rotate-90">
        <circle
          stroke="rgba(255, 255, 255, 0.03)"
          fill="transparent"
          strokeWidth={stroke}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />
        <circle
          stroke="url(#cyanDialGradShowcase)"
          fill="transparent"
          strokeWidth={stroke}
          strokeDasharray={circumference + ' ' + circumference}
          style={{ 
            strokeDashoffset,
            transition: 'stroke-dashoffset 1.5s cubic-bezier(0.16, 1, 0.3, 1)'
          }}
          strokeLinecap="round"
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />
        <circle
          stroke="rgba(255, 255, 255, 0.01)"
          fill="transparent"
          strokeWidth={1}
          r={innerRadius}
          cx={radius}
          cy={radius}
        />
        <circle
          stroke="rgba(6, 182, 212, 0.3)"
          fill="transparent"
          strokeWidth={1}
          strokeDasharray={innerCircumference + ' ' + innerCircumference}
          style={{ 
            strokeDashoffset: innerStrokeDashoffset,
            transition: 'stroke-dashoffset 1.8s cubic-bezier(0.16, 1, 0.3, 1)'
          }}
          strokeLinecap="round"
          r={innerRadius}
          cx={radius}
          cy={radius}
        />
        <defs>
          <linearGradient id="cyanDialGradShowcase" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#06b6d4" />
            <stop offset="100%" stopColor="#0891b2" />
          </linearGradient>
        </defs>
      </svg>
      <span className="absolute text-[8px] font-black text-white tracking-tight font-display">
        {Math.round(currentValue)}%
      </span>
    </div>
  );
}

function AudioWaveform() {
  return (
    <div className="flex items-center gap-[2.5px] h-7 px-3 rounded-lg border border-white/5 bg-white/[0.01] backdrop-blur-md shadow-inner relative overflow-hidden group select-none pointer-events-none">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.01)_1px,transparent_1px)] bg-[size:100%_4px] opacity-35" />
      {Array.from({ length: 18 }).map((_, i) => {
        const speeds = [1.3, 1.7, 0.9, 1.5, 1.1, 1.9, 1.2];
        const speed = speeds[i % speeds.length];
        return (
          <div
            key={i}
            className="w-[1.5px] min-h-[3px] bg-gradient-to-t from-cyan-600 via-cyan-400 to-white rounded-full transition-all duration-300 opacity-80"
            style={{
              animation: `wave-bounce ${speed}s ease-in-out infinite`,
              animationDelay: `${i * 50}ms`,
            }}
          />
        );
      })}
    </div>
  );
}

function TelemetryTuner() {
  const [speed, setSpeed] = useState(1.15);
  const [pitch, setPitch] = useState(1.0);
  const [threshold, setThreshold] = useState(-42);
  const [latency, setLatency] = useState(140);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setCoords({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div 
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="rounded-2xl border border-white/5 bg-white/[0.01] p-5 flex flex-col justify-between shadow-xl relative overflow-hidden group transition-all duration-300 hover:border-white/10"
    >
      <div 
        className={`absolute inset-0 pointer-events-none transition-opacity duration-300 ${isHovered ? 'opacity-100' : 'opacity-0'}`}
        style={{
          background: `radial-gradient(220px circle at ${coords.x}px ${coords.y}px, rgba(6, 182, 212, 0.06), transparent 80%)`,
        }}
      />
      
      <div className="absolute top-2 left-3.5 text-[7px] font-bold text-white/10 font-mono tracking-widest pointer-events-none select-none">+ 01_HMI_TUNER</div>
      <div className="absolute top-2 right-3.5 text-[7px] font-bold text-white/10 font-mono tracking-widest pointer-events-none select-none">SYS_OK</div>
      <div className="absolute bottom-2 left-3.5 text-[7px] font-bold text-white/10 font-mono tracking-widest pointer-events-none select-none">SOKAR_OS</div>
      <div className="absolute bottom-2 right-3.5 text-[7px] font-bold text-white/10 font-mono tracking-widest pointer-events-none select-none">2026_V1</div>

      <div className="z-10">
        <div className="flex items-center justify-between gap-4">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-cyan-500/20 bg-cyan-500/10 text-[9px] font-bold tracking-widest uppercase text-cyan-400">
            <span className="h-1 w-1 rounded-full bg-cyan-500 animate-ping" />
            Vocal Telemetry Equalizer
          </div>
          <AudioWaveform />
        </div>
        
        <h3 className="mt-4 text-xl font-black leading-tight text-white font-display">
          Pupitre Télémétrique Vocal
        </h3>
        <p className="mt-1 text-[10px] text-white/45 leading-relaxed font-sans">
          Ajustez en temps réel les filtres neuronaux et le comportement spectral de l&apos;assistant de service.
        </p>
      </div>

      <div className="mt-5 space-y-3.5 z-10">
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-wider text-white/55">
            <span className="font-sans">Vitesse de parole</span>
            <span className="font-mono text-cyan-400">{speed.toFixed(2)}x</span>
          </div>
          <div className="relative flex items-center">
            <input 
              type="range" 
              min="0.8" 
              max="1.5" 
              step="0.05" 
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
              className="w-full h-1 bg-white/5 rounded-lg appearance-none cursor-pointer accent-cyan-500 transition-all focus:outline-none focus:ring-0" 
            />
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-wider text-white/55">
            <span className="font-sans">Tonalité (Pitch)</span>
            <span className="font-mono text-cyan-400">{pitch.toFixed(2)} Hz</span>
          </div>
          <div className="relative flex items-center">
            <input 
              type="range" 
              min="0.7" 
              max="1.3" 
              step="0.05" 
              value={pitch}
              onChange={(e) => setPitch(parseFloat(e.target.value))}
              className="w-full h-1 bg-white/5 rounded-lg appearance-none cursor-pointer accent-cyan-500 transition-all focus:outline-none focus:ring-0" 
            />
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-wider text-white/55">
            <span className="font-sans">Sensibilité Micro</span>
            <span className="font-mono text-cyan-400">{threshold} dB</span>
          </div>
          <div className="relative flex items-center">
            <input 
              type="range" 
              min="-60" 
              max="-20" 
              step="1" 
              value={threshold}
              onChange={(e) => setThreshold(parseInt(e.target.value, 10))}
              className="w-full h-1 bg-white/5 rounded-lg appearance-none cursor-pointer accent-cyan-500 transition-all focus:outline-none focus:ring-0" 
            />
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-wider text-white/55">
            <span className="font-sans">Latence cible</span>
            <span className="font-mono text-cyan-400">{latency} ms</span>
          </div>
          <div className="relative flex items-center">
            <input 
              type="range" 
              min="80" 
              max="240" 
              step="5" 
              value={latency}
              onChange={(e) => setLatency(parseInt(e.target.value, 10))}
              className="w-full h-1 bg-white/5 rounded-lg appearance-none cursor-pointer accent-cyan-500 transition-all focus:outline-none focus:ring-0" 
            />
          </div>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-[9px] font-bold text-white/35 uppercase tracking-widest z-10 font-mono">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          NEURONAL NETWORK ONLINE
        </span>
        <span className="text-white/20 text-[8px]">
          TEMP_CORE: 38°C
        </span>
      </div>
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
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setCoords({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <div 
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`relative overflow-hidden rounded-2xl border transition-all duration-300 p-4 select-none ${
        featured 
          ? 'border-cyan-500/25 bg-cyan-500/[0.01] shadow-[0_0_30px_rgba(6,182,212,0.03)]' 
          : 'border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.03]'
      }`}
    >
      <div 
        className={`absolute inset-0 pointer-events-none transition-opacity duration-300 ${isHovered ? 'opacity-100' : 'opacity-0'}`}
        style={{
          background: `radial-gradient(150px circle at ${coords.x}px ${coords.y}px, rgba(6, 182, 212, 0.08), transparent 80%)`,
        }}
      />

      <div className="absolute top-1 left-1.5 text-[6px] text-white/10 tracking-widest font-mono pointer-events-none select-none">+</div >
      <div className="absolute top-1 right-1.5 text-[6px] text-white/10 tracking-widest font-mono pointer-events-none select-none">+</div >
      <div className="absolute bottom-1 left-1.5 text-[6px] text-white/10 tracking-widest font-mono pointer-events-none select-none">+</div >
      <div className="absolute bottom-1 right-1.5 text-[6px] text-white/10 tracking-widest font-mono pointer-events-none select-none">+</div >

      {featured && (
        <div className="absolute -top-12 -right-12 w-24 h-24 rounded-full bg-cyan-500/10 filter blur-xl pointer-events-none" />
      )}
      
      <div className="relative z-10 flex items-center justify-between gap-3">
        <span className={`h-8 w-8 rounded-full flex items-center justify-center border transition-all duration-200 ${
          featured 
            ? 'bg-cyan-500/10 border-cyan-500/25 text-cyan-400' 
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
      
      <div className="relative z-10 mt-6 flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-xl font-black font-display tracking-tight truncate ${
            featured ? 'text-cyan-400' : 'text-white'
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
    <div className={`relative min-h-screen w-full overflow-hidden bg-[#030303] text-foreground flex flex-col justify-between items-center select-none font-sans antialiased ${outfit.variable} ${jakarta.variable}`}>

      {/* Liquid Field Background — old elegant grayscale glow */}
      <div className="liquid-field absolute inset-0 pointer-events-none z-0 overflow-hidden select-none" />

      {/* Logo — top-left fixed */}
      <Link
        href="/"
        className="fixed left-6 top-5 z-50 flex items-center gap-2 rounded-full transition-all duration-200 hover:opacity-80"
      >
        <Image src="/logo-nav.png" alt="Sokar" width={44} height={44} className="h-11 w-11" priority />
        <span className="text-xl font-bold tracking-tight text-white font-display">Sokar</span>
      </Link>

      {/* Floating navbar — nav links + CTA */}
      <div className="fixed left-1/2 top-5 z-50 -translate-x-1/2">
        <nav className="flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-2 shadow-2xl backdrop-blur-xl">
          <div className="hidden items-center gap-1 md:flex">
            {[
              { label: 'Services', href: '#services' },
              { label: "Cas d'usage", href: '#cases' },
              { label: 'Tarifs', href: '/pricing' },
              { label: 'Contact', href: '#contact' },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-full px-3 py-1.5 text-sm text-white/60 transition-colors hover:bg-white/5 hover:text-white"
              >
                {item.label}
              </Link>
            ))}
          </div>
          <SignedOut>
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm font-medium transition-all duration-300 hover:-translate-y-0.5 hover:bg-white hover:text-black hover:shadow-[0_0_15px_rgba(255,255,255,0.1)] active:scale-[0.98]"
            >
              Essai gratuit
              <ArrowUpRight size={14} />
            </Link>
          </SignedOut>
          <SignedIn>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm font-medium transition-all duration-300 hover:-translate-y-0.5 hover:bg-white hover:text-black hover:shadow-[0_0_15px_rgba(255,255,255,0.1)] active:scale-[0.98]"
            >
              Dashboard
              <ArrowUpRight size={14} />
            </Link>
          </SignedIn>
        </nav>
      </div>

      {/* Main Content Area */}
      <main className="relative z-10 w-full max-w-7xl px-6 pt-32 flex flex-col items-center">
        
        {/* ================= HERO SECTION ================= */}
        <section className="relative flex flex-col items-center justify-center text-center w-full min-h-[85vh]">
          <div className="flex flex-col items-center max-w-5xl px-6 pt-20 pb-8">
            {/* Badge */}
            <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-5 py-2.5 text-xs text-white/70 backdrop-blur-xl transition-all duration-300 hover:border-white/20">
              <Sparkles size={14} />
              Assistant vocal pour restaurants
            </p>

            {/* Title */}
            <h1 className="mt-6 max-w-5xl text-5xl font-semibold leading-[0.9] tracking-tight text-white md:text-7xl lg:text-8xl font-display">
              La salle répond quand vous cuisinez.
            </h1>

            <p className="mx-auto mt-5 max-w-xl text-sm leading-6 text-white/50 md:text-base font-sans">
              Sokar prend les appels, confirme les réservations et transmet les bonnes infos à votre équipe sans casser le rythme du service.
            </p>

            {/* CTAs */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <SignedOut>
                <Link
                  href="/register"
                  className="inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition-all duration-300 hover:-translate-y-0.5 hover:scale-[1.01] hover:bg-white/90 hover:shadow-[0_0_20px_rgba(255,255,255,0.12)] active:scale-[0.98]"
                >
                  Réserver une démo
                </Link>
              </SignedOut>
              <SignedIn>
                <Link
                  href="/dashboard"
                  className="inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition-all duration-300 hover:-translate-y-0.5 hover:scale-[1.01] hover:bg-white/90 hover:shadow-[0_0_20px_rgba(255,255,255,0.12)] active:scale-[0.98]"
                >
                  Accéder au Dashboard
                </Link>
              </SignedIn>
              <Link
                href="/pricing"
                className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-6 py-3 text-sm font-semibold text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/5 hover:border-white/20 hover:shadow-[0_0_15px_rgba(255,255,255,0.08)] active:scale-[0.98]"
              >
                Voir les tarifs
              </Link>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="relative z-10 mx-auto grid w-full max-w-7xl gap-4 px-6 pb-8 text-xs text-white/80 md:grid-cols-[1fr_auto_1fr] md:px-10">
            <div className="hidden items-center gap-3 md:flex">
              <span className="font-medium">Scroll</span>
              <span className="h-px flex-1 bg-white/10" />
              <span className="font-medium">pour découvrir</span>
            </div>
            <button className="group mx-auto flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 transition-all duration-300 hover:bg-white hover:text-black hover:scale-105 active:scale-95">
              <Headphones size={14} />
              <span className="text-[10px] font-semibold tracking-wide uppercase text-white/80 group-hover:text-black transition-colors duration-300">
                écouter une démo
              </span>
            </button>
            <div className="hidden items-center gap-3 md:flex">
              <span className="h-px flex-1 bg-white/10" />
              <span className="font-medium">pilotage temps réel</span>
            </div>
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
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[300px] bg-cyan-500/5 filter blur-3xl pointer-events-none rounded-full" />
            
            {/* Left side: Showcase Metrics & Status */}
            <div className="flex flex-col gap-4 justify-between">
              
              {/* Pupitre Télémétrique Vocal HMI */}
              <TelemetryTuner />

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
                  <div className="h-8 w-8 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shadow-inner">
                    <Image src="/logo-nav.png" alt="Sokar AI" width={18} height={18} className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold tracking-tight text-white">Console de Dialogue Live</h4>
                    <p className="text-[9px] text-emerald-400 font-medium flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Appel client en cours
                    </p>
                  </div>
                </div>
                
                <div className="h-1.5 w-20 bg-white/10 rounded-full overflow-hidden relative">
                  <div className="h-full bg-gradient-to-r from-cyan-400 to-cyan-600 rounded-full w-2/3" />
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
            <span className="h-10 w-10 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
              <PhoneCall size={18} />
            </span>
            <h3 className="text-lg font-bold text-white font-display">100% des appels traités</h3>
            <p className="text-xs text-white/50 leading-relaxed font-sans">
              Sokar gère plusieurs appels simultanés lors des pics de service. Finis les clients frustrés qui tombent sur messagerie.
            </p>
          </div>

          <div className="glass-card p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-all duration-300 flex flex-col gap-4">
            <span className="h-10 w-10 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
              <CalendarCheck size={18} />
            </span>
            <h3 className="text-lg font-bold text-white font-display">Zéro double saisie</h3>
            <p className="text-xs text-white/50 leading-relaxed font-sans">
              Intégration transparente et bidirectionnelle avec vos logiciels de réservation (ZenChef, TheFork) et de caisse.
            </p>
          </div>

          <div className="glass-card p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-all duration-300 flex flex-col gap-4">
            <span className="h-10 w-10 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
              <Zap size={18} />
            </span>
            <h3 className="text-lg font-bold text-white font-display">Intelligence locale</h3>
            <p className="text-xs text-white/50 leading-relaxed font-sans">
              Sokar connaît vos plats du jour, vos allergènes et prend des décisions complexes selon les consignes que vous lui donnez.
            </p>
          </div>
        </section>

        {/* ================= PRICING SECTION — Cyan/Blue Glassmorphism ================= */}
        <section id="tarifs" className="pricing-section-wrapper w-full py-16 scroll-mt-24 relative">
          <div className="flex flex-col items-center">
            {/* Mini Hero */}
            <div className="text-center mb-6">
              <h2 className="pricing-hero-title text-center">Tarifs</h2>
              <p className="pricing-hero-kicker absolute left-1/2 -translate-x-1/2" style={{ top: '1.5rem' }}>Sokar AI</p>
            </div>

            {/* Toggle Billing */}
            <div className="flex items-center justify-center gap-3 mb-10 relative z-10">
              <span className={`pricing-toggle-text ${!yearly ? '!text-white' : ''}`}>Mensuel</span>
              <label className="pricing-toggle-label" aria-label="Toggle yearly billing">
                <div
                  className={`pricing-toggle-track${yearly ? ' active' : ''}`}
                  role="switch"
                  aria-checked={yearly}
                  tabIndex={0}
                  onClick={() => setYearly(!yearly)}
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      setYearly(!yearly);
                    }
                  }}
                />
              </label>
              <span className={`pricing-toggle-text ${yearly ? '!text-white' : ''} flex items-center gap-1.5`}>
                Annuel
                <span className="px-2 py-0.5 text-[9px] bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded-full font-bold">
                  -20%
                </span>
              </span>
            </div>

            {/* Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-6xl px-4">
              {PLANS.map((plan) => (
                <div 
                  key={plan.label} 
                  className={`pricing-card${plan.featured ? ' featured' : ''}`}
                >
                  <div>
                    <div className="flex justify-between items-center">
                      <p className="pricing-card-label">{plan.label}</p>
                      {plan.featured && (
                        <span className="px-2 py-0.5 text-[9px] font-bold tracking-wide uppercase bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 rounded-full">
                          Recommandé
                        </span>
                      )}
                    </div>
                    <p className="pricing-card-price">
                      {displayPrice(plan.price, yearly)}
                      <span className="period"> {plan.period === '€' ? '€/mois' : plan.period}</span>
                    </p>
                    <p className="pricing-card-desc">
                      {plan.label === 'Essential' && 'Pour automatiser vos premiers appels et réservations.'}
                      {plan.label === 'Pro' && 'Pour les restaurants qui veulent maximiser chaque service.'}
                      {plan.label === 'Multi-site' && 'Pour piloter plusieurs établissements avec une seule équipe.'}
                    </p>
                  </div>

                  <ul className="pricing-features">
                    {plan.features.map((feat) => (
                      <li key={feat} className="pricing-feature-item">
                        <span className="pricing-check-icon">
                          <svg viewBox="0 0 12 12">
                            <polyline points="2,6 5,9 10,3" />
                          </svg>
                        </span>
                        {feat}
                      </li>
                    ))}
                  </ul>

                  <a 
                    href="#waitlist"
                    className={`pricing-cta${plan.featured ? ' featured-cta' : ''}`}
                  >
                    Rejoindre la Waitlist
                  </a>
                </div>
              ))}
            </div>
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
                      openFaqIndex === idx ? 'rotate-180 text-cyan-400' : 'rotate-0'
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
              <Image src="/logo-nav.png" alt="Sokar" width={32} height={32} className="h-8 w-8 filter drop-shadow-[0_0_10px_rgba(255,255,255,0.15)]" />
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
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
            Bêta Privée
          </div>
        </div>
      </footer>
    </div>
  );
}
