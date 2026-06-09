'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { 
  AlertCircle, 
  ArrowUpRight, 
  CalendarCheck, 
  MessageSquare, 
  PhoneCall, 
  TrendingUp,
  Euro,
  Sparkles
} from 'lucide-react';
import { useApi } from '../../lib/api';
import { Skeleton } from '@/components/ui/skeleton';

type DashboardStats = {
  totalCalls: number;
  totalReservations: number;
  answeredRate: number;
  revenueRecovered: number;
  theforkSavings: number;
  roiMultiplier: number;
  period: string;
};

const DEFAULT_WEEKLY = [
  { day: 'Lundi', height: 0, calls: 0 },
  { day: 'Mardi', height: 0, calls: 0 },
  { day: 'Mercredi', height: 0, calls: 0 },
  { day: 'Jeudi', height: 0, calls: 0 },
  { day: 'Vendredi', height: 0, calls: 0 },
  { day: 'Samedi', height: 0, calls: 0 },
  { day: 'Dimanche', height: 0, calls: 0 },
];

export default function DashboardPage() {
  const { get, orgId } = useApi();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activity, setActivity] = useState<any>(null);
  const [weeklyData, setWeeklyData] = useState(DEFAULT_WEEKLY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!orgId) return;

    async function fetchData() {
      try {
        const [s, a, w] = await Promise.all([
          get(`dashboard/stats?restaurantId=${orgId}`),
          get(`dashboard/recent-activity?restaurantId=${orgId}`),
          get(`dashboard/weekly-calls?restaurantId=${orgId}`),
        ]);

        setStats({
          totalCalls: s.total_calls ?? 0,
          totalReservations: s.total_reservations ?? 0,
          answeredRate: s.answered_rate ?? 0,
          revenueRecovered: s.revenue_recovered ?? 0,
          theforkSavings: s.thefork_savings ?? 0,
          roiMultiplier: s.roi_multiplier ?? 0,
          period: s.period ?? '',
        });
        setActivity(a);
        setWeeklyData(w.data ?? DEFAULT_WEEKLY);
      } catch (err: any) {
        setError(err.message || 'Erreur de chargement');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [orgId, get]);

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (error) {
    return (
      <div className="sokar-error border border-destructive/30 bg-destructive/10 text-destructive rounded-xl p-4 flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-500">
        <AlertCircle size={18} />
        <span>{error}</span>
      </div>
    );
  }

  const recentReservations = Array.isArray(activity?.reservations)
    ? activity.reservations.slice(0, 4)
    : [];

  const isNew = stats && stats.totalCalls === 0 && stats.totalReservations === 0;

  return (
    <div className="space-y-4 md:space-y-5 select-none">

      {isNew && (
        <div className="rounded-xl border border-orange-500/20 bg-orange-500/[0.03] p-4 md:p-5 text-center animate-in fade-in slide-in-from-top-4 duration-500">
          <Sparkles size={20} className="mx-auto text-orange-400 mb-2" />
          <h2 className="text-base md:text-lg font-bold text-white font-display">Bienvenue sur Sokar</h2>
          <p className="mt-1 text-xs text-white/50 max-w-md mx-auto font-sans">
            Votre assistant est activé. Les statistiques apparaîtront dès le premier appel.
          </p>
        </div>
      )}

      {/* ================= HEADER & OVERVIEW GRID ================= */}
      <section className="grid gap-4 md:gap-5 lg:grid-cols-[1.3fr_2fr]">

        {/* Pupitre Télémétrique Vocal HMI */}
        <TelemetryTuner orgId={orgId} />

        {/* 4 Metrics Grid */}
        <div className="grid gap-2.5 sm:gap-4 grid-cols-2 animate-in fade-in slide-in-from-right-4 duration-700 ease-out">
          <MetricCard
            label="Appels traités"
            value={stats?.totalCalls ?? 0}
            icon={PhoneCall}
          />
          <MetricCard
            label="Réservations prises"
            value={stats?.totalReservations ?? 0}
            icon={CalendarCheck}
          />
          <MetricCard
            label="Taux de réponse"
            value={stats?.answeredRate ?? 0}
            icon={TrendingUp}
            isDial
            dialValue={stats?.answeredRate ?? 0}
          />
          <MetricCard
            label="Revenus récupérés"
            value={stats?.revenueRecovered ?? 0}
            icon={Euro}
            isRevenue
            featured
            subtitle={stats?.theforkSavings
              ? `+ ${stats.theforkSavings.toLocaleString('fr-FR')} € économisés sur TheFork`
              : undefined}
          />
        </div>
      </section>

      {/* ================= CHARTS & ACTIVITY GRID ================= */}
      <section className="grid gap-4 md:gap-5 lg:grid-cols-[1.2fr_0.8fr]">

        {/* Weekly Activity Bar Chart */}
        <div className="rounded-2xl border border-white/5 bg-white/[0.01] backdrop-blur-xl p-4 md:p-6 shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100 ease-out">
          <div className="mb-3 md:mb-4 flex items-center justify-between gap-4">
            <div>
              <h3 className="text-base md:text-lg font-bold tracking-tight text-white font-display">Activité hebdomadaire</h3>
              <p className="mt-0.5 text-[11px] md:text-xs text-white/40 font-sans font-medium">Répartition des demandes reçues ce mois-ci</p>
            </div>
            <button className="h-8 w-8 rounded-full border border-white/5 bg-white/5 text-white/60 flex items-center justify-center transition-all duration-200 hover:bg-white/10 hover:text-white flex-shrink-0" aria-label="Voir les rapports">
              <ArrowUpRight size={14} />
            </button>
          </div>

          <div className="grid h-48 sm:h-64 grid-cols-7 items-end gap-1.5 sm:gap-3 px-1 sm:px-2 pt-4 border-b border-white/5 pb-2">
            {weeklyData.map((item, index) => (
              <AnimatedBar
                key={item.day}
                height={item.height}
                delay={index * 80}
                day={item.day}
                calls={item.calls}
              />
            ))}
          </div>
        </div>

        {/* Recent Reservations List */}
        <div className="rounded-2xl border border-white/5 bg-white/[0.01] backdrop-blur-xl p-4 md:p-6 shadow-xl flex flex-col justify-between animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200 ease-out">
          <div>
            <div className="mb-3 md:mb-4 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-base md:text-lg font-bold tracking-tight text-white font-display">Dernières réservations</h3>
                <p className="mt-0.5 text-[11px] md:text-xs text-white/40 font-sans font-medium">Créées automatiquement par l&apos;assistant</p>
              </div>
              <MessageSquare size={16} className="text-white/40 flex-shrink-0" />
            </div>

            {recentReservations.length === 0 ? (
              <div className="sokar-empty min-h-40 sm:min-h-48 rounded-xl border border-dashed border-white/5 bg-white/[0.005] flex flex-col items-center justify-center gap-3 p-6 sm:p-8 text-center text-white/30">
                <CalendarCheck size={32} className="sm:hidden opacity-30 text-white/50 animate-pulse" />
                <CalendarCheck size={38} className="hidden sm:block opacity-30 text-white/50 animate-pulse" />
                <p className="text-[11px] sm:text-xs font-medium font-sans">Aucune réservation récente</p>
              </div>
            ) : (
              <div className="space-y-2 sm:space-y-3">
                {recentReservations.map((reservation: any) => (
                  <div
                    key={reservation.id}
                    className="grid grid-cols-[1fr_auto] gap-2 sm:gap-3 rounded-xl border border-white/5 bg-white/[0.01] p-3 sm:p-4 transition-all duration-300 hover:bg-white/[0.03] hover:border-white/10"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs sm:text-sm font-bold text-white">{reservation.customerName}</p>
                      <p className="mt-1 text-[10px] sm:text-[11px] tracking-wide uppercase text-white/40 font-sans">
                        {reservation.partySize} couverts · {reservation.status?.toLowerCase() || 'nouveau'}
                      </p>
                    </div>
                    <span className="text-[10px] sm:text-xs text-white/45 bg-white/5 border border-white/10 px-2 sm:px-2.5 py-1 rounded-lg h-fit font-bold font-sans flex-shrink-0">
                      {new Date(reservation.reservedAt).toLocaleTimeString('fr-FR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function AnimatedBar({ 
  height, 
  delay, 
  day, 
  calls 
}: { 
  height: number; 
  delay: number; 
  day: string; 
  calls: number;
}) {
  const [currentHeight, setCurrentHeight] = useState(0);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setCurrentHeight(height);
    }, delay);
    return () => clearTimeout(timer);
  }, [height, delay]);

  return (
    <div 
      className="flex h-full flex-col justify-end gap-3 group relative cursor-pointer"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Magnetic Hover Tooltip */}
      <div 
        className={`absolute -top-16 left-1/2 -translate-x-1/2 z-30 pointer-events-none px-3 py-2 rounded-xl border border-white/10 bg-black/90 backdrop-blur-md shadow-2xl flex flex-col items-center gap-0.5 transition-all duration-300 ${
          hovered ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-2 scale-95'
        }`}
      >
        <span className="text-xs sm:text-[11px] font-bold text-white/40 uppercase tracking-wider font-sans">{day}</span>
        <span className="text-sm sm:text-xs font-black text-orange-400 whitespace-nowrap font-sans">{calls} appels</span>
        {/* Tooltip arrow */}
        <div className="absolute bottom-[-4px] left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 bg-black border-r border-b border-white/10" />
      </div>

      <div
        className="rounded-t-lg bg-gradient-to-t from-orange-500/20 to-orange-500/80 shadow-[0_0_15px_rgba(249,115,22,0.1)] group-hover:shadow-[0_0_20px_rgba(249,115,22,0.25)] border-t border-x border-orange-500/30 w-full"
        style={{ 
          height: `${currentHeight}%`,
          transition: 'height 1.2s cubic-bezier(0.16, 1, 0.3, 1)' 
        }}
      />
      <span className="text-center text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-white/35 group-hover:text-white transition-colors duration-200 font-sans">
        <span className="sm:hidden">{day.slice(0, 1)}</span>
        <span className="hidden sm:inline">{day.slice(0, 3)}</span>
      </span>
    </div>
  );
}

function AnimatedNumber({ value, isRevenue }: { value: number; isRevenue?: boolean }) {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const end = value;
    if (end === 0) return;
    
    const duration = 1200; // ms
    const startTime = performance.now();
    let animationFrameId: number;

    function animate(currentTime: number) {
      const elapsedTime = currentTime - startTime;
      const progress = Math.min(elapsedTime / duration, 1);
      
      // easeOutExpo
      const easeProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      
      setCurrent(Math.floor(easeProgress * end));

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(animate);
      }
    }

    animationFrameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrameId);
  }, [value]);

  if (isRevenue) {
    return <span>{current.toLocaleString('fr-FR')} €</span>;
  }

  if (current >= 1000000) return <span>{(current / 1000000).toFixed(1)}M</span>;
  if (current >= 1000) return <span>{(current / 1000).toFixed(1)}K</span>;
  return <span>{current.toLocaleString('fr-FR')}</span>;
}

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
          stroke="url(#orangeDialGrad)"
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
          stroke="rgba(249, 115, 22, 0.3)"
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
          <linearGradient id="orangeDialGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f97316" />
            <stop offset="100%" stopColor="#ea580c" />
          </linearGradient>
        </defs>
      </svg>
      <span className="absolute text-xs sm:text-[11px] font-black text-white tracking-tight font-display">
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
            className="w-[1.5px] min-h-[3px] bg-gradient-to-t from-orange-600 via-orange-400 to-white rounded-full transition-all duration-300 opacity-80"
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

const PROFILE_VALUES = ['BISTROT_BRASSERIE', 'SEMI_GASTRO', 'GASTRONOMIQUE'];
const PROFILE_LABELS = ['Bistrot & Brasserie', 'Semi-gastro', 'Gastronomique'];

const STYLE_VALUES = ['WARM', 'FORMAL', 'CASUAL'];
const STYLE_LABELS = ['Chaleureux', 'Professionnel', 'Décontracté'];

const SPEED_VALUES = [0.8, 1.15, 1.5];
const SPEED_LABELS = ['Posé', 'Normal', 'Dynamique'];

const PITCH_VALUES = [0.7, 1.0, 1.3];
const PITCH_LABELS = ['Chaude', 'Neutre', 'Claire'];

function SegmentedSlider({
  label,
  value,
  labels,
  onChange,
}: {
  label: string;
  value: number;
  labels: string[];
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-white/55">
        <span className="min-w-0 truncate font-sans">{label}</span>
        <span className="shrink-0 text-right font-mono text-orange-400">{labels[value]}</span>
      </div>
      <div className="relative flex h-8 items-center">
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 bg-white/10 rounded-full" />
        <div className="absolute inset-x-[2px] top-1/2 -translate-y-1/2 flex justify-between pointer-events-none">
          {labels.map((_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-all duration-200 ${
                i === value ? 'bg-orange-400 scale-125' : 'bg-white/25'
              }`}
            />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={labels.length - 1}
          step={1}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value, 10))}
          className="relative z-10 w-full h-full appearance-none cursor-pointer accent-orange-500 bg-transparent transition-all focus:outline-none focus:ring-0"
          style={{ minHeight: 44 }}
        />
      </div>
    </div>
  );
}

function TelemetryTuner({ orgId }: { orgId: string | undefined }) {
  const { get, patch } = useApi();
  const [profileIdx, setProfileIdx] = useState(0);
  const [styleIdx, setStyleIdx] = useState(2);
  const [speedIdx, setSpeedIdx] = useState(1);
  const [pitchIdx, setPitchIdx] = useState(1);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!orgId) return;
    get(`restaurants/${orgId}/personality`).then((p: any) => {
      if (!p) return;
      const pi = Math.max(0, PROFILE_VALUES.indexOf(p.profileType ?? 'BISTROT_BRASSERIE'));
      const si = Math.max(0, STYLE_VALUES.indexOf(p.fillerStyle ?? 'CASUAL'));
      const spi = Math.max(0, SPEED_VALUES.indexOf(Number(p.speakingRate ?? 1.15)));
      const pi2 = Math.max(0, PITCH_VALUES.indexOf(Number(p.pitchShift ?? 1.0)));
      setProfileIdx(pi);
      setStyleIdx(si);
      setSpeedIdx(spi >= 0 ? spi : 1);
      setPitchIdx(pi2 >= 0 ? pi2 : 1);
    }).catch(() => {});
  }, [orgId, get]);

  const save = useCallback(
    (updates: Record<string, any>) => {
      if (!orgId) return;
      setSaving(true);
      if (saveRef.current) clearTimeout(saveRef.current);
      saveRef.current = setTimeout(async () => {
        try {
          await patch(`restaurants/${orgId}/personality`, updates);
        } catch {
          // silent
        } finally {
          setSaving(false);
        }
      }, 500);
    },
    [orgId, patch]
  );

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
    <div 
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onTouchMove={handleTouchMove}
      onTouchStart={() => setIsHovered(true)}
      onTouchEnd={() => setIsHovered(false)}
      className="rounded-2xl border border-white/5 bg-white/[0.01] p-5 md:p-6 flex flex-col justify-between shadow-xl relative overflow-hidden group transition-all duration-300 hover:border-white/10"
    >
      <div 
        className={`absolute inset-0 pointer-events-none transition-opacity duration-300 ${isHovered ? 'opacity-100' : 'opacity-0'}`}
        style={{
          background: `radial-gradient(220px circle at ${coords.x}px ${coords.y}px, rgba(249, 115, 22, 0.06), transparent 80%)`,
        }}
      />
      
      <div className="absolute top-3 left-4 text-[7px] font-bold text-white/10 font-mono tracking-widest pointer-events-none select-none hidden sm:block">+ 01_HMI_TUNER</div>
      <div className="absolute top-3 right-4 text-[7px] font-bold text-white/10 font-mono tracking-widest pointer-events-none select-none hidden sm:block">SYS_OK</div>
      <div className="absolute bottom-3 left-4 text-[7px] font-bold text-white/10 font-mono tracking-widest pointer-events-none select-none hidden sm:block">SOKAR_OS</div>
      <div className="absolute bottom-3 right-4 text-[7px] font-bold text-white/10 font-mono tracking-widest pointer-events-none select-none hidden sm:block">2026_V1</div>

      <div className="z-10">
        <div className="flex items-center justify-between gap-4">
          <div className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1 text-[10px] sm:text-[11px] font-bold tracking-widest uppercase text-orange-400">
            <span className="h-1 w-1 rounded-full bg-orange-500 animate-ping" />
            Personnalité de l&apos;Agent
          </div>
          <AudioWaveform />
        </div>
        
        <h3 className="mt-2 md:mt-2.5 text-base md:text-lg font-black leading-tight text-white font-display">
          Pupitre Télémétrique Vocal
        </h3>
        <p className="mt-0.5 text-[10px] sm:text-[11px] text-white/40 leading-relaxed font-sans">
          Personnalisez le comportement et le style de votre assistant pour qu&apos;il corresponde à l&apos;ambiance de votre établissement.
        </p>
      </div>

      <div className="mt-5 space-y-4 z-10">
        <SegmentedSlider
          label="Ambiance de l&apos;établissement"
          value={profileIdx}
          labels={PROFILE_LABELS}
          onChange={(v) => { setProfileIdx(v); save({ profileType: PROFILE_VALUES[v] }); }}
        />
        <SegmentedSlider
          label="Personnalité de l&apos;agent"
          value={styleIdx}
          labels={STYLE_LABELS}
          onChange={(v) => { setStyleIdx(v); save({ fillerStyle: STYLE_VALUES[v] }); }}
        />
        <SegmentedSlider
          label="Rapidité de parole"
          value={speedIdx}
          labels={SPEED_LABELS}
          onChange={(v) => { setSpeedIdx(v); save({ speakingRate: SPEED_VALUES[v] }); }}
        />
        <SegmentedSlider
          label="Timbre de la voix"
          value={pitchIdx}
          labels={PITCH_LABELS}
          onChange={(v) => { setPitchIdx(v); save({ pitchShift: PITCH_VALUES[v] }); }}
        />
      </div>

      <div className="mt-5 pt-3 border-t border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-3 text-[10px] md:text-[11px] font-bold text-white/35 uppercase tracking-widest z-10 font-mono">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          NEURONAL NETWORK ONLINE
        </span>
        <span className="text-white/20 text-xs sm:text-[11px]">
          TEMP_CORE: 38°C
        </span>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  trend,
  isDial,
  dialValue,
  isRevenue,
  featured,
  subtitle,
}: {
  label: string;
  value: number;
  icon: typeof PhoneCall;
  trend?: string;
  isDial?: boolean;
  dialValue?: number;
  isRevenue?: boolean;
  featured?: boolean;
  subtitle?: string;
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
    <div 
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onTouchMove={handleTouchMove}
      onTouchStart={() => setIsHovered(true)}
      onTouchEnd={() => setIsHovered(false)}
      className={`relative overflow-hidden rounded-2xl border transition-all duration-300 p-4 md:p-5 select-none ${
        featured 
          ? 'border-orange-500/25 bg-orange-500/[0.01] shadow-[0_0_30px_rgba(249,115,22,0.03)]' 
          : 'border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.03]'
      }`}
    >
      <div 
        className={`absolute inset-0 pointer-events-none transition-opacity duration-300 ${isHovered ? 'opacity-100' : 'opacity-0'}`}
        style={{
          background: `radial-gradient(150px circle at ${coords.x}px ${coords.y}px, rgba(249, 115, 22, 0.08), transparent 80%)`,
        }}
      />

      <div className="absolute top-1.5 left-2 text-[9px] sm:text-[7px] text-white/10 tracking-widest font-mono pointer-events-none select-none">+</div >
      <div className="absolute top-1.5 right-2 text-[9px] sm:text-[7px] text-white/10 tracking-widest font-mono pointer-events-none select-none">+</div >
      <div className="absolute bottom-1.5 left-2 text-[9px] sm:text-[7px] text-white/10 tracking-widest font-mono pointer-events-none select-none">+</div >
      <div className="absolute bottom-1.5 right-2 text-[9px] sm:text-[7px] text-white/10 tracking-widest font-mono pointer-events-none select-none">+</div >

      {featured && (
        <div className="absolute -top-12 -right-12 w-24 h-24 rounded-full bg-orange-500/10 filter blur-xl pointer-events-none animate-pulse" />
      )}
      
      <div className="relative z-10 flex items-center justify-between gap-3">
        <span className={`h-8 w-8 rounded-full flex items-center justify-center border transition-all duration-200 ${
          featured 
            ? 'bg-orange-500/10 border-orange-500/25 text-orange-400 animate-pulse' 
            : 'bg-white/5 border-white/5 text-white/50'
        }`}>
          <Icon size={14} />
        </span>
        
        {trend && (
          <span className="flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold">
            <span className="inline-block transform -rotate-45">→</span> {trend}
          </span>
        )}
      </div>
      
      <div className="relative z-10 mt-5 md:mt-8 flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-xl md:text-2xl font-black font-display tracking-tight truncate ${
            featured ? 'text-orange-400' : 'text-white'
          }`}>
            <AnimatedNumber value={value} isRevenue={isRevenue} />
          </p>
          <p className="mt-1 text-[11px] md:text-xs font-bold text-white/40 tracking-wider uppercase font-sans">
            {label}
          </p>
          {subtitle && (
            <p className="mt-0.5 text-[10px] text-white/25 font-sans truncate">
              {subtitle}
            </p>
          )}
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

function DashboardSkeleton() {
  return (
    <div className="space-y-4 md:space-y-8">
      <div className="grid gap-3 md:gap-5 lg:grid-cols-[1fr_2fr]">
        <Skeleton className="h-40 sm:h-56 rounded-2xl bg-white/5 border border-white/5" />
        <div className="grid gap-2.5 sm:gap-4 grid-cols-2">
          {[1, 2, 3, 4].map((item) => (
            <Skeleton key={item} className="h-[90px] sm:h-[125px] rounded-2xl bg-white/5 border border-white/5" />
          ))}
        </div>
      </div>
      <div className="grid gap-3 md:gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <Skeleton className="h-48 sm:h-80 rounded-2xl bg-white/5 border border-white/5" />
        <Skeleton className="h-48 sm:h-80 rounded-2xl bg-white/5 border border-white/5" />
      </div>
    </div>
  );
}
