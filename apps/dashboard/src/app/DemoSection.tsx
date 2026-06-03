'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { TrendingUp, Euro, PhoneCall, CalendarCheck } from 'lucide-react';
import { SIMULATOR_STEPS } from '@/app/constants';

/* ===== HELPER: RadialDial ===== */
function RadialDial({ value }: { value: number }) {
  const [currentValue, setCurrentValue] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setCurrentValue(value), 400);
    return () => clearTimeout(timer);
  }, [value]);
  const radius = 19;
  const normalizedRadius = radius - 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (currentValue / 100) * circumference;
  const innerRadius = normalizedRadius - 4;
  const innerCircumference = innerRadius * 2 * Math.PI;
  const innerStrokeDashoffset = innerCircumference - (Math.min(currentValue * 0.9, 100) / 100) * innerCircumference;
  return (
    <div className="relative flex items-center justify-center select-none pointer-events-none">
      <svg height={radius * 2} width={radius * 2} className="transform -rotate-90">
        <defs>
          <linearGradient id="cyanDialGradShowcase" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#06b6d4" />
            <stop offset="100%" stopColor="#0891b2" />
          </linearGradient>
        </defs>
        <circle stroke="rgba(255, 255, 255, 0.01)" fill="transparent" strokeWidth="1" r={normalizedRadius} cx={radius} cy={radius} />
        <circle stroke="rgba(6, 182, 212, 0.3)" fill="transparent" strokeWidth="1" strokeDasharray={circumference} strokeDashoffset={circumference} style={{ strokeDashoffset, transition: 'stroke-dashoffset 1.5s cubic-bezier(0.16, 1, 0.3, 1)' }} r={normalizedRadius} cx={radius} cy={radius} />
        <circle stroke="url(#cyanDialGradShowcase)" fill="transparent" strokeWidth="2.5" strokeDasharray={innerCircumference} strokeDashoffset={innerCircumference} style={{ strokeDashoffset: innerStrokeDashoffset, transition: 'stroke-dashoffset 1.5s cubic-bezier(0.16, 1, 0.3, 1)' }} r={innerRadius} cx={radius} cy={radius} />
      </svg>
      <span className="absolute text-[10px] sm:text-[8px] font-black text-white tracking-tight font-display">{currentValue}%</span>
    </div>
  );
}

/* ===== HELPER: AudioWaveform ===== */
function AudioWaveform() {
  return (
    <div className="flex items-end gap-[1.5px] h-10">
      {Array.from({ length: 14 }).map((_, i) => (
        <div key={i} className="w-[1.5px] min-h-[3px] bg-gradient-to-t from-cyan-600 via-cyan-400 to-white rounded-full transition-all duration-300 opacity-80"
          style={{ height: `${12 + Math.sin(i * 0.8) * 18 + Math.random() * 6}px`, animation: `wave-bounce ${1.2 + i * 0.15}s ease-in-out infinite`, animationDelay: `${i * 0.1}s` }} />
      ))}
    </div>
  );
}

/* ===== HELPER: TelemetryTuner ===== */
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

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const touch = e.touches[0];
    if (touch) {
      setCoords({ x: touch.clientX - rect.left, y: touch.clientY - rect.top });
    }
  };

  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.01] p-5 flex flex-col justify-between shadow-xl relative overflow-hidden group transition-all duration-300 hover:border-white/10"
      onMouseMove={handleMouseMove} onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}
      onTouchMove={handleTouchMove} onTouchStart={() => setIsHovered(true)} onTouchEnd={() => setIsHovered(false)}>
      <div className="absolute inset-0 pointer-events-none transition-opacity duration-300" style={{ opacity: isHovered ? 1 : 0, background: `radial-gradient(220px circle at ${coords.x}px ${coords.y}px, rgba(6, 182, 212, 0.06), transparent 80%)` }} />
      <div className="absolute top-2 left-3.5 text-[9px] sm:text-[7px] font-bold text-white/10 font-mono tracking-widest pointer-events-none select-none">+ 01_HMI_TUNER</div>
      <div className="absolute top-2 right-3.5 text-[9px] sm:text-[7px] font-bold text-white/10 font-mono tracking-widest pointer-events-none select-none">SYS_OK</div>
      <div className="absolute bottom-2 left-3.5 text-[9px] sm:text-[7px] font-bold text-white/10 font-mono tracking-widest pointer-events-none select-none">THRESHOLD: DYNAMIC</div>
      <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-cyan-500/20 bg-cyan-500/10 text-[10px] sm:text-[9px] font-bold tracking-widest uppercase text-cyan-400">
        <span className="h-1 w-1 rounded-full bg-cyan-500 animate-ping" /> LIVE
      </div>
      <div className="flex-1 flex items-center justify-center py-2 relative">
        <AudioWaveform />
      </div>
      <div className="space-y-2.5 mt-3 z-10">
        {[
          { label: 'SPEED', value: speed, setter: setSpeed, min: 0.3, max: 3.0, unit: 'x', fmt: (v: number) => v.toFixed(2) + 'x' },
          { label: 'PITCH', value: pitch, setter: setPitch, min: 0.5, max: 1.8, unit: 'Hz', fmt: (v: number) => v.toFixed(2) + ' Hz' },
          { label: 'THRESH', value: threshold, setter: setThreshold, min: -70, max: -10, unit: 'dB', fmt: (v: number) => v + ' dB' },
          { label: 'LATENCY', value: latency, setter: setLatency, min: 5, max: 500, unit: 'ms', fmt: (v: number) => v + ' ms' },
        ].map(({ label, value, setter, min, max, fmt }) => (
          <div key={label} className="flex items-center gap-2 sm:gap-3 text-[11px] sm:text-[9px] font-mono text-white/60">
            <span className="w-12 sm:w-14 text-right tracking-widest text-white/40">{label}</span>
            <input type="range" min={min} max={max} step={(max - min) / 200} value={value} onChange={(e) => setter(parseFloat(e.target.value))}
              className="w-full h-2 sm:h-1 bg-white/5 rounded-lg appearance-none cursor-pointer accent-cyan-500 transition-all focus:outline-none focus:ring-0" style={{ minHeight: 44 }} />
            <span className="font-mono text-cyan-400 w-16 sm:w-18 text-right">{fmt(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ===== HELPER: ShowcaseMetricCard ===== */
function ShowcaseMetricCard({ label, value, icon: Icon, trend, isDial, dialValue, featured }: {
  label: string; value: string; icon: React.ElementType; trend?: string; isDial?: boolean; dialValue?: number; featured?: boolean;
}) {
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setCoords({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const touch = e.touches[0];
    if (touch) {
      setCoords({ x: touch.clientX - rect.left, y: touch.clientY - rect.top });
    }
  };

  return (
    <div className={`rounded-2xl border transition-all duration-300 p-4 select-none ${featured ? 'border-cyan-500/25 bg-cyan-500/[0.01] shadow-[0_0_30px_rgba(6,182,212,0.03)]' : 'border-white/5 bg-white/[0.01] hover:border-white/10'}`}
      onMouseMove={handleMouseMove} onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}
      onTouchMove={handleTouchMove} onTouchStart={() => setIsHovered(true)} onTouchEnd={() => setIsHovered(false)}>
      <div className="absolute inset-0 pointer-events-none transition-opacity duration-300" style={{ opacity: isHovered ? 1 : 0, background: `radial-gradient(150px circle at ${coords.x}px ${coords.y}px, rgba(6, 182, 212, 0.08), transparent 80%)` }} />
      <div className={`absolute top-1 left-1.5 text-[8px] sm:text-[6px] text-white/10 tracking-widest font-mono pointer-events-none select-none ${featured ? 'text-cyan-400/30' : ''}`}>METRIC_CARD</div>
      <div className="relative z-10 flex items-center justify-between gap-3">
        <span className={`h-8 w-8 rounded-full flex items-center justify-center border transition-all duration-200 ${featured ? 'bg-cyan-500/10 border-cyan-500/25 text-cyan-400' : 'bg-white/5 border-white/5 text-white/50'}`}>
          <Icon size={14} />
        </span>
        {isDial && dialValue !== undefined ? <RadialDial value={dialValue} /> : trend && <span className="text-[10px] sm:text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2.5 py-0.5">{trend}</span>}
      </div>
      <div className="relative z-10 mt-3 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-xl font-black font-display tracking-tight truncate ${featured ? 'text-cyan-400' : 'text-white'}`}>{value}</p>
          <p className="mt-1 text-[10px] sm:text-[9px] font-bold text-white/40 tracking-wider uppercase font-sans">{label}</p>
        </div>
        {featured && <div className="absolute -top-12 -right-12 w-24 h-24 rounded-full bg-cyan-500/10 filter blur-xl pointer-events-none" />}
      </div>
    </div>
  );
}

/* ===== MAIN COMPONENT ===== */
export default function DemoSection() {
  const [visibleSteps, setVisibleSteps] = useState<typeof SIMULATOR_STEPS>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isTyping, setIsTyping] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({ top: chatContainerRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [visibleSteps, isTyping]);

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
      const typingTimer = setTimeout(() => setIsTyping(true), delay - 800);
      const messageTimer = setTimeout(() => {
        setVisibleSteps((prev) => [...prev, nextLine]);
        setIsTyping(false);
        setCurrentStepIndex((prev) => prev + 1);
      }, delay);
      return () => { clearTimeout(typingTimer); clearTimeout(messageTimer); };
    } else {
      const resetTimer = setTimeout(() => {
        setVisibleSteps([]);
        setCurrentStepIndex(0);
        setIsTyping(false);
      }, 4000);
      return () => clearTimeout(resetTimer);
    }
  }, [currentStepIndex, visibleSteps]);

  return (
    <section id="demo" className="w-full py-16 scroll-mt-24 flex flex-col items-center">
      <div className="text-center max-w-lg mb-10">
        <h2 className="text-2xl md:text-4xl font-bold tracking-tight text-white font-display">Le Tableau de Bord en Action</h2>
        <p className="mt-2 text-xs md:text-sm text-white/50 leading-relaxed font-sans">
          Admirez l&apos;interface de pilotage Sokar en temps réel. Le moniteur d&apos;activité affiche les statistiques de l&apos;assistant vocal en parallèle de la console de dialogue.
        </p>
      </div>

      <div className="w-full grid gap-6 lg:grid-cols-[1.1fr_1fr] bg-white/[0.01] border border-white/5 p-6 rounded-3xl backdrop-blur-2xl shadow-2xl relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[300px] bg-cyan-500/5 filter blur-3xl pointer-events-none rounded-full" />
        <div className="flex flex-col gap-4 justify-between">
          <TelemetryTuner />
          <div className="grid grid-cols-2 gap-3.5">
            <ShowcaseMetricCard label="Appels traités" value="412" icon={PhoneCall} trend="+12.4%" />
            <ShowcaseMetricCard label="Tables réservées" value="189" icon={CalendarCheck} trend="+15.8%" />
            <ShowcaseMetricCard label="Taux de réponse" value="98%" icon={TrendingUp} isDial dialValue={98} />
            <ShowcaseMetricCard label="Revenus récupérés" value="5 420 €" icon={Euro} featured />
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/60 shadow-xl overflow-hidden flex flex-col h-full min-h-[380px] transition-all duration-300 relative">
          <div className="border-b border-white/10 bg-white/[0.03] px-5 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shadow-inner">
                <Image src="/logo-nav.png" alt="Sokar AI" width={18} height={18} className="h-4.5 w-4.5" />
              </div>
              <div>
                <h4 className="text-[11px] sm:text-xs font-semibold tracking-tight text-white">Console de Dialogue Live</h4>
                <p className="text-[11px] sm:text-[9px] text-emerald-400 font-medium flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Appel client en cours
                </p>
              </div>
            </div>
            <div className="h-1.5 w-20 bg-white/10 rounded-full overflow-hidden relative">
              <div className="h-full bg-gradient-to-r from-cyan-400 to-cyan-600 rounded-full w-2/3" />
            </div>
          </div>
          <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3 flex flex-col justify-start scrollbar-none h-[280px]">
            {visibleSteps.map((step, idx) => (
              <div key={idx} className={`flex flex-col max-w-[85%] rounded-2xl px-3.5 py-2 text-xs transition-all duration-300 scale-95 origin-bottom animate-in fade-in slide-in-from-bottom-2 ${step.sender === 'assistant' ? "bg-white/[0.04] text-white self-start rounded-tl-none border border-white/10 font-sans" : "bg-white text-black self-end rounded-tr-none shadow-md font-sans"}`}>
                <p className="leading-relaxed font-semibold">{step.text}</p>
              </div>
            ))}
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
  );
}
