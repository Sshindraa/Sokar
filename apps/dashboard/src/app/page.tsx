     1|'use client';
     2|
     3|import { useState, useEffect, useRef } from 'react';
     4|import Link from 'next/link';
     5|import { SignedIn, SignedOut } from '@clerk/nextjs';
     6|import { joinWaitlistAction } from './actions';
     7|import { 
     8|  ArrowUpRight, 
     9|  CheckCircle2, 
    10|  Loader2, 
    11|  Sparkles,
    12|  PhoneCall,
    13|  TrendingUp,
    14|  ChevronDown,
    15|  Check,
    16|  CalendarCheck,
    17|  Zap,
    18|  MessageSquare,
    19|  Euro,
    20|  Headphones
    21|} from 'lucide-react';
    22|
    23|const SIMULATOR_STEPS = [
    24|  { sender: 'client', text: 'Bonjour, je voudrais réserver une table pour ce soir.' },
    25|  { sender: 'assistant', text: 'Bonjour ! Avec plaisir. Pour combien de personnes ce soir ?' },
    26|  { sender: 'client', text: 'Nous serons 4 personnes.' },
    27|  { sender: 'assistant', text: "Parfait. J'ai de la disponibilité à 20h00 ou 21h30. Qu'est-ce qui vous convient ?" },
    28|  { sender: 'client', text: "20h c'est super !" },
    29|  { sender: 'assistant', text: 'C’est noté. Une table pour 4 personnes ce soir à 20h00 au nom de... ?' },
    30|  { sender: 'client', text: 'Au nom de Martin.' },
    31|  { sender: 'assistant', text: 'C’est réservé M. Martin ! Vous allez recevoir un SMS de confirmation à l’instant. À ce soir !' },
    32|  { sender: 'client', text: 'Parfait, merci beaucoup. Au revoir !' },
    33|  { sender: 'assistant', text: 'Merci à vous, au revoir et bon appétit !' },
    34|];
    35|
    36|const PLANS = [
    37|  {
    38|    label: 'Essential',
    39|    price: '149',
    40|    period: '€',
    41|    features: [
    42|      'Répond à chaque appel, 24h/24',
    43|      'Réservations prises sans intervention',
    44|      'Ton adapté à votre établissement',
    45|      'Rapport quotidien de vos appels',
    46|      '1 numéro dédié inclus',
    47|    ],
    48|  },
    49|  {
    50|    label: 'Pro',
    51|    price: '249',
    52|    period: '€',
    53|    features: [
    54|      "Tout l'Essential, sans limite",
    55|      'Vos clients reconnus à chaque appel',
    56|      'No-shows anticipés et gérés automatiquement',
    57|      'Revenus récupérés visibles en temps réel',
    58|      'Réservable depuis ChatGPT, Claude et les IA du marché',
    59|      'Support prioritaire 7j/7',
    60|    ],
    61|    featured: true,
    62|  },
    63|  {
    64|    label: 'Multi-site',
    65|    price: '249',
    66|    period: '€ + 99€/site suppl.',
    67|    features: [
    68|      'Plan Pro sur tous vos établissements',
    69|      'Un seul dashboard pour tout piloter',
    70|      'Un numéro et un agent par site',
    71|      'Une seule facture pour tout le groupe',
    72|    ],
    73|  },
    74|];
    75|
    76|const FAQS = [
    77|  {
    78|    question: "Comment fonctionne l'assistant vocal Sokar ?",
    79|    answer: "Sokar est branché directement sur votre ligne téléphonique actuelle. Lorsqu'un client vous appelle, Sokar répond automatiquement avec une voix chaleureuse et naturelle. Il comprend les demandes complexes, consulte vos disponibilités en temps réel sur votre logiciel de réservation, et valide la table. Le client reçoit ensuite un SMS de confirmation immédiat."
    80|  },
    81|  {
    82|    question: "S'intègre-t-il avec mon logiciel de réservation ou de caisse ?",
    83|    answer: "Oui. Sokar s'intègre nativement avec les principaux logiciels de réservation du marché (ZenChef, TheFork, Guestonline...) ainsi qu'avec vos outils de gestion de caisse pour valider instantanément les couverts sans aucun risque de doublon."
    84|  },
    85|  {
    86|    question: "Puis-je personnaliser le ton et les réponses de Sokar ?",
    87|    answer: "Absolument. Depuis votre tableau de bord, vous pouvez configurer l'attitude de votre assistant, le ton de sa voix (formel, amical, gastronomique), lui faire suggérer le plat du jour, lui indiquer de parler des allergènes, ou encore spécifier quand transférer un appel sensible vers un humain."
    88|  },
    89|  {
    90|    question: "Comment Sokar aide-t-il à réduire les no-shows ?",
    91|    answer: "Sokar réduit les no-shows de plus de 85% grâce à des processus de confirmation automatiques par SMS interactif. En cas de désistement, l'assistant annule immédiatement la table et la remet à disposition sur vos canaux pour garantir un taux d'occupation maximal."
    92|  },
    93|  {
    94|    question: "Y a-t-il un engagement sur les abonnements ?",
    95|    answer: "Nos forfaits mensuels sont totalement sans engagement, vous êtes libre d'arrêter quand vous le souhaitez. Si vous optez pour la facturation annuelle, vous vous engagez pour 12 mois et bénéficiez d'une réduction de 20% sur l'ensemble de vos mensualités."
    96|  }
    97|];
    98|
    99|function RadialDial({ value }: { value: number }) {
   100|  const [currentValue, setCurrentValue] = useState(0);
   101|
   102|  useEffect(() => {
   103|    const timer = setTimeout(() => {
   104|      setCurrentValue(value);
   105|    }, 150);
   106|    return () => clearTimeout(timer);
   107|  }, [value]);
   108|
   109|  const radius = 24;
   110|  const stroke = 2.5;
   111|  const normalizedRadius = radius - stroke * 2;
   112|  const circumference = normalizedRadius * 2 * Math.PI;
   113|  const strokeDashoffset = circumference - (currentValue / 100) * circumference;
   114|
   115|  const innerRadius = normalizedRadius - 4;
   116|  const innerCircumference = innerRadius * 2 * Math.PI;
   117|  const innerStrokeDashoffset = innerCircumference - (Math.min(currentValue * 0.9, 100) / 100) * innerCircumference;
   118|
   119|  return (
   120|    <div className="relative flex items-center justify-center select-none pointer-events-none">
   121|      <svg height={radius * 2} width={radius * 2} className="transform -rotate-90">
   122|        <circle
   123|          stroke="rgba(255, 255, 255, 0.03)"
   124|          fill="transparent"
   125|          strokeWidth={stroke}
   126|          r={normalizedRadius}
   127|          cx={radius}
   128|          cy={radius}
   129|        />
   130|        <circle
   131|          stroke="url(#cyanDialGradShowcase)"
   132|          fill="transparent"
   133|          strokeWidth={stroke}
   134|          strokeDasharray={circumference + ' ' + circumference}
   135|          style={{ 
   136|            strokeDashoffset,
   137|            transition: 'stroke-dashoffset 1.5s cubic-bezier(0.16, 1, 0.3, 1)'
   138|          }}
   139|          strokeLinecap="round"
   140|          r={normalizedRadius}
   141|          cx={radius}
   142|          cy={radius}
   143|        />
   144|        <circle
   145|          stroke="rgba(255, 255, 255, 0.01)"
   146|          fill="transparent"
   147|          strokeWidth={1}
   148|          r={innerRadius}
   149|          cx={radius}
   150|          cy={radius}
   151|        />
   152|        <circle
   153|          stroke="rgba(6, 182, 212, 0.3)"
   154|          fill="transparent"
   155|          strokeWidth={1}
   156|          strokeDasharray={innerCircumference + ' ' + innerCircumference}
   157|          style={{ 
   158|            strokeDashoffset: innerStrokeDashoffset,
   159|            transition: 'stroke-dashoffset 1.8s cubic-bezier(0.16, 1, 0.3, 1)'
   160|          }}
   161|          strokeLinecap="round"
   162|          r={innerRadius}
   163|          cx={radius}
   164|          cy={radius}
   165|        />
   166|        <defs>
   167|          <linearGradient id="cyanDialGradShowcase" x1="0%" y1="0%" x2="100%" y2="100%">
   168|            <stop offset="0%" stopColor="#06b6d4" />
   169|            <stop offset="100%" stopColor="#0891b2" />
   170|          </linearGradient>
   171|        </defs>
   172|      </svg>
   173|      <span className="absolute text-[8px] font-black text-white tracking-tight font-display">
   174|        {Math.round(currentValue)}%
   175|      </span>
   176|    </div>
   177|  );
   178|}
   179|
   180|function AudioWaveform() {
   181|  return (
   182|    <div className="flex items-center gap-[2.5px] h-7 px-3 rounded-lg border border-white/5 bg-white/[0.01] backdrop-blur-md shadow-inner relative overflow-hidden group select-none pointer-events-none">
   183|      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.01)_1px,transparent_1px)] bg-[size:100%_4px] opacity-35" />
   184|      {Array.from({ length: 18 }).map((_, i) => {
   185|        const speeds = [1.3, 1.7, 0.9, 1.5, 1.1, 1.9, 1.2];
   186|        const speed = speeds[i % speeds.length];
   187|        return (
   188|          <div
   189|            key={i}
   190|            className="w-[1.5px] min-h-[3px] bg-gradient-to-t from-cyan-600 via-cyan-400 to-white rounded-full transition-all duration-300 opacity-80"
   191|            style={{
   192|              animation: `wave-bounce ${speed}s ease-in-out infinite`,
   193|              animationDelay: `${i * 50}ms`,
   194|            }}
   195|          />
   196|        );
   197|      })}
   198|    </div>
   199|  );
   200|}
   201|
   202|function TelemetryTuner() {
   203|  const [speed, setSpeed] = useState(1.15);
   204|  const [pitch, setPitch] = useState(1.0);
   205|  const [threshold, setThreshold] = useState(-42);
   206|  const [latency, setLatency] = useState(140);
   207|  const [coords, setCoords] = useState({ x: 0, y: 0 });
   208|  const [isHovered, setIsHovered] = useState(false);
   209|
   210|  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
   211|    const rect = e.currentTarget.getBoundingClientRect();
   212|    setCoords({ x: e.clientX - rect.left, y: e.clientY - rect.top });
   213|  };
   214|
   215|  return (
   216|    <div 
   217|      onMouseMove={handleMouseMove}
   218|      onMouseEnter={() => setIsHovered(true)}
   219|      onMouseLeave={() => setIsHovered(false)}
   220|      className="rounded-2xl border border-white/5 bg-white/[0.01] p-5 flex flex-col justify-between shadow-xl relative overflow-hidden group transition-all duration-300 hover:border-white/10"
   221|    >
   222|      <div 
   223|        className={`absolute inset-0 pointer-events-none transition-opacity duration-300 ${isHovered ? 'opacity-100' : 'opacity-0'}`}
   224|        style={{
   225|          background: `radial-gradient(220px circle at ${coords.x}px ${coords.y}px, rgba(6, 182, 212, 0.06), transparent 80%)`,
   226|        }}
   227|      />
   228|      
   229|      <div className="absolute top-2 left-3.5 text-[7px] font-bold text-white/10 font-mono tracking-widest pointer-events-none select-none">+ 01_HMI_TUNER</div>
   230|      <div className="absolute top-2 right-3.5 text-[7px] font-bold text-white/10 font-mono tracking-widest pointer-events-none select-none">SYS_OK</div>
   231|      <div className="absolute bottom-2 left-3.5 text-[7px] font-bold text-white/10 font-mono tracking-widest pointer-events-none select-none">SOKAR_OS</div>
   232|      <div className="absolute bottom-2 right-3.5 text-[7px] font-bold text-white/10 font-mono tracking-widest pointer-events-none select-none">2026_V1</div>
   233|
   234|      <div className="z-10">
   235|        <div className="flex items-center justify-between gap-4">
   236|          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-cyan-500/20 bg-cyan-500/10 text-[9px] font-bold tracking-widest uppercase text-cyan-400">
   237|            <span className="h-1 w-1 rounded-full bg-cyan-500 animate-ping" />
   238|            Vocal Telemetry Equalizer
   239|          </div>
   240|          <AudioWaveform />
   241|        </div>
   242|        
   243|        <h3 className="mt-4 text-xl font-black leading-tight text-white font-display">
   244|          Pupitre Télémétrique Vocal
   245|        </h3>
   246|        <p className="mt-1 text-[10px] text-white/45 leading-relaxed font-sans">
   247|          Ajustez en temps réel les filtres neuronaux et le comportement spectral de l&apos;assistant de service.
   248|        </p>
   249|      </div>
   250|
   251|      <div className="mt-5 space-y-3.5 z-10">
   252|        <div className="space-y-1">
   253|          <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-wider text-white/55">
   254|            <span className="font-sans">Vitesse de parole</span>
   255|            <span className="font-mono text-cyan-400">{speed.toFixed(2)}x</span>
   256|          </div>
   257|          <div className="relative flex items-center">
   258|            <input 
   259|              type="range" 
   260|              min="0.8" 
   261|              max="1.5" 
   262|              step="0.05" 
   263|              value={speed}
   264|              onChange={(e) => setSpeed(parseFloat(e.target.value))}
   265|              className="w-full h-1 bg-white/5 rounded-lg appearance-none cursor-pointer accent-cyan-500 transition-all focus:outline-none focus:ring-0" 
   266|            />
   267|          </div>
   268|        </div>
   269|
   270|        <div className="space-y-1">
   271|          <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-wider text-white/55">
   272|            <span className="font-sans">Tonalité (Pitch)</span>
   273|            <span className="font-mono text-cyan-400">{pitch.toFixed(2)} Hz</span>
   274|          </div>
   275|          <div className="relative flex items-center">
   276|            <input 
   277|              type="range" 
   278|              min="0.7" 
   279|              max="1.3" 
   280|              step="0.05" 
   281|              value={pitch}
   282|              onChange={(e) => setPitch(parseFloat(e.target.value))}
   283|              className="w-full h-1 bg-white/5 rounded-lg appearance-none cursor-pointer accent-cyan-500 transition-all focus:outline-none focus:ring-0" 
   284|            />
   285|          </div>
   286|        </div>
   287|
   288|        <div className="space-y-1">
   289|          <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-wider text-white/55">
   290|            <span className="font-sans">Sensibilité Micro</span>
   291|            <span className="font-mono text-cyan-400">{threshold} dB</span>
   292|          </div>
   293|          <div className="relative flex items-center">
   294|            <input 
   295|              type="range" 
   296|              min="-60" 
   297|              max="-20" 
   298|              step="1" 
   299|              value={threshold}
   300|              onChange={(e) => setThreshold(parseInt(e.target.value, 10))}
   301|              className="w-full h-1 bg-white/5 rounded-lg appearance-none cursor-pointer accent-cyan-500 transition-all focus:outline-none focus:ring-0" 
   302|            />
   303|          </div>
   304|        </div>
   305|
   306|        <div className="space-y-1">
   307|          <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-wider text-white/55">
   308|            <span className="font-sans">Latence cible</span>
   309|            <span className="font-mono text-cyan-400">{latency} ms</span>
   310|          </div>
   311|          <div className="relative flex items-center">
   312|            <input 
   313|              type="range" 
   314|              min="80" 
   315|              max="240" 
   316|              step="5" 
   317|              value={latency}
   318|              onChange={(e) => setLatency(parseInt(e.target.value, 10))}
   319|              className="w-full h-1 bg-white/5 rounded-lg appearance-none cursor-pointer accent-cyan-500 transition-all focus:outline-none focus:ring-0" 
   320|            />
   321|          </div>
   322|        </div>
   323|      </div>
   324|
   325|      <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-[9px] font-bold text-white/35 uppercase tracking-widest z-10 font-mono">
   326|        <span className="flex items-center gap-1">
   327|          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
   328|          NEURONAL NETWORK ONLINE
   329|        </span>
   330|        <span className="text-white/20 text-[8px]">
   331|          TEMP_CORE: 38°C
   332|        </span>
   333|      </div>
   334|    </div>
   335|  );
   336|}
   337|
   338|function ShowcaseMetricCard({
   339|  label,
   340|  value,
   341|  icon: Icon,
   342|  trend,
   343|  isDial,
   344|  dialValue,
   345|  featured,
   346|}: {
   347|  label: string;
   348|  value: string;
   349|  icon: any;
   350|  trend?: string;
   351|  isDial?: boolean;
   352|  dialValue?: number;
   353|  featured?: boolean;
   354|}) {
   355|  const [coords, setCoords] = useState({ x: 0, y: 0 });
   356|  const [isHovered, setIsHovered] = useState(false);
   357|
   358|  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
   359|    const rect = e.currentTarget.getBoundingClientRect();
   360|    setCoords({ x: e.clientX - rect.left, y: e.clientY - rect.top });
   361|  };
   362|
   363|  return (
   364|    <div 
   365|      onMouseMove={handleMouseMove}
   366|      onMouseEnter={() => setIsHovered(true)}
   367|      onMouseLeave={() => setIsHovered(false)}
   368|      className={`relative overflow-hidden rounded-2xl border transition-all duration-300 p-4 select-none ${
   369|        featured 
   370|          ? 'border-cyan-500/25 bg-cyan-500/[0.01] shadow-[0_0_30px_rgba(6,182,212,0.03)]' 
   371|          : 'border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.03]'
   372|      }`}
   373|    >
   374|      <div 
   375|        className={`absolute inset-0 pointer-events-none transition-opacity duration-300 ${isHovered ? 'opacity-100' : 'opacity-0'}`}
   376|        style={{
   377|          background: `radial-gradient(150px circle at ${coords.x}px ${coords.y}px, rgba(6, 182, 212, 0.08), transparent 80%)`,
   378|        }}
   379|      />
   380|
   381|      <div className="absolute top-1 left-1.5 text-[6px] text-white/10 tracking-widest font-mono pointer-events-none select-none">+</div >
   382|      <div className="absolute top-1 right-1.5 text-[6px] text-white/10 tracking-widest font-mono pointer-events-none select-none">+</div >
   383|      <div className="absolute bottom-1 left-1.5 text-[6px] text-white/10 tracking-widest font-mono pointer-events-none select-none">+</div >
   384|      <div className="absolute bottom-1 right-1.5 text-[6px] text-white/10 tracking-widest font-mono pointer-events-none select-none">+</div >
   385|
   386|      {featured && (
   387|        <div className="absolute -top-12 -right-12 w-24 h-24 rounded-full bg-cyan-500/10 filter blur-xl pointer-events-none" />
   388|      )}
   389|      
   390|      <div className="relative z-10 flex items-center justify-between gap-3">
   391|        <span className={`h-8 w-8 rounded-full flex items-center justify-center border transition-all duration-200 ${
   392|          featured 
   393|            ? 'bg-cyan-500/10 border-cyan-500/25 text-cyan-400 animate-pulse' 
   394|            : 'bg-white/5 border-white/5 text-white/50'
   395|        }`}>
   396|          <Icon size={14} />
   397|        </span>
   398|        
   399|        {trend && (
   400|          <span className="flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold">
   401|            <span className="inline-block transform -rotate-45">→</span> {trend}
   402|          </span>
   403|        )}
   404|      </div>
   405|      
   406|      <div className="relative z-10 mt-6 flex items-baseline justify-between gap-2">
   407|        <div className="min-w-0">
   408|          <p className={`text-xl font-black font-display tracking-tight truncate ${
   409|            featured ? 'text-cyan-400' : 'text-white'
   410|          }`}>
   411|            {value}
   412|          </p>
   413|          <p className="mt-1 text-[9px] font-bold text-white/40 tracking-wider uppercase font-sans">
   414|            {label}
   415|          </p>
   416|        </div>
   417|
   418|        {isDial && dialValue !== undefined && (
   419|          <div className="flex-shrink-0">
   420|            <RadialDial value={dialValue} />
   421|          </div>
   422|        )}
   423|      </div>
   424|    </div>
   425|  );
   426|}
   427|
   428|export default function HomePage() {
   429|  const [email, setEmail] = useState('');
   430|  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
   431|  const [message, setMessage] = useState('');
   432|  const [yearly, setYearly] = useState(true);
   433|  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);
   434|
   435|  // États pour le simulateur conversationnel
   436|  const [visibleSteps, setVisibleSteps] = useState<typeof SIMULATOR_STEPS>([]);
   437|  const [currentStepIndex, setCurrentStepIndex] = useState(0);
   438|  const [isTyping, setIsTyping] = useState(false);
   439|  const chatContainerRef = useRef<HTMLDivElement>(null);
   440|
   441|  const handleSubmit = async (e: React.FormEvent) => {
   442|    e.preventDefault();
   443|    if (!email || !email.includes('@')) {
   444|      setStatus('error');
   445|      setMessage('Veuillez entrer une adresse email valide.');
   446|      return;
   447|    }
   448|
   449|    setStatus('loading');
   450|    
   451|    try {
   452|      const res = await joinWaitlistAction(email);
   453|      if (res.success) {
   454|        setStatus('success');
   455|        setMessage('Merci ! Vous avez été ajouté à notre liste d\'attente prioritaire.');
   456|        setEmail('');
   457|      } else {
   458|        setStatus('error');
   459|        setMessage(res.error || 'Une erreur est survenue lors de l\'inscription.');
   460|      }
   461|    } catch (err) {
   462|      console.error(err);
   463|      setStatus('error');
   464|      setMessage('Une erreur réseau ou serveur est survenue. Veuillez réessayer.');
   465|    }
   466|  };
   467|
   468|  // Boucle de simulation d'appels
   469|  useEffect(() => {
   470|    if (visibleSteps.length === 0) {
   471|      setIsTyping(true);
   472|      const timer = setTimeout(() => {
   473|        setVisibleSteps([SIMULATOR_STEPS[0]]);
   474|        setIsTyping(false);
   475|        setCurrentStepIndex(1);
   476|      }, 1500);
   477|      return () => clearTimeout(timer);
   478|    }
   479|
   480|    if (currentStepIndex < SIMULATOR_STEPS.length) {
   481|      const nextLine = SIMULATOR_STEPS[currentStepIndex];
   482|      const delay = nextLine.sender === 'assistant' ? 2400 : 1600;
   483|
   484|      const typingTimer = setTimeout(() => {
   485|        setIsTyping(true);
   486|      }, delay - 800);
   487|
   488|      const messageTimer = setTimeout(() => {
   489|        setVisibleSteps((prev) => [...prev, nextLine]);
   490|        setIsTyping(false);
   491|        setCurrentStepIndex((prev) => prev + 1);
   492|      }, delay);
   493|
   494|      return () => {
   495|        clearTimeout(typingTimer);
   496|        clearTimeout(messageTimer);
   497|      };
   498|    } else {
   499|      const resetTimer = setTimeout(() => {
   500|        setVisibleSteps([]);
   501|