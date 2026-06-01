'use client';

import { useEffect, useState } from 'react';
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
};

export default function DashboardPage() {
  const { get, orgId } = useApi();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activity, setActivity] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!orgId) return;

    async function fetchData() {
      try {
        const [s, a] = await Promise.all([
          get(`dashboard/stats?restaurantId=${orgId}`),
          get(`dashboard/recent-activity?restaurantId=${orgId}`),
        ]);

        setStats({
          totalCalls: s.total_calls ?? 0,
          totalReservations: s.total_reservations ?? 0,
          answeredRate: s.answered_rate ?? 0,
          revenueRecovered: s.revenue_recovered ?? 0,
        });
        setActivity(a);
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
      <div className="sokar-error border border-destructive/30 bg-destructive/10 text-destructive rounded-xl p-4 flex items-center gap-3">
        <AlertCircle size={18} />
        <span>{error}</span>
      </div>
    );
  }

  const recentReservations = Array.isArray(activity?.reservations)
    ? activity.reservations.slice(0, 4)
    : [];

  return (
    <div className="space-y-8 select-none">
      
      {/* ================= HEADER & OVERVIEW GRID ================= */}
      <section className="grid gap-5 lg:grid-cols-[1.1fr_2fr]">
        
        {/* Welcome Command Card with Slide-in Transition */}
        <div className="rounded-2xl border-l-4 border-l-orange-500 border border-y-white/5 border-r-white/5 bg-gradient-to-r from-orange-500/[0.02] to-transparent p-6 flex flex-col justify-between shadow-[inset_1px_1px_1px_rgba(255,255,255,0.02)] min-h-[220px] animate-in fade-in slide-in-from-left-4 duration-700 ease-out">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-orange-500/20 bg-orange-500/10 text-[10px] font-bold tracking-widest uppercase text-orange-400 shadow-[0_0_15px_rgba(249,115,22,0.1)]">
              <Sparkles size={10} className="text-orange-400" />
              Moniteur Vocal Sokar
            </div>
            <h2 className="mt-4 text-3xl md:text-4xl font-black leading-tight tracking-tight text-white font-display">
              La salle répond quand vous cuisinez.
            </h2>
            <p className="mt-3 text-xs text-white/50 leading-relaxed font-sans">
              Sokar gère l&apos;intégralité de vos appels et de vos réservations en arrière-plan. Votre équipe reste concentrée sur la qualité du service.
            </p>
          </div>
          <div className="mt-6 pt-4 border-t border-white/5 flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-semibold tracking-widest text-white/40 uppercase">Assistant Vocal Actif</span>
          </div>
        </div>

        {/* 4 Metrics Grid with Slide-in Transition */}
        <div className="grid gap-4 sm:grid-cols-2 animate-in fade-in slide-in-from-right-4 duration-700 ease-out">
          <MetricCard 
            label="Appels traités" 
            value={formatNum(stats?.totalCalls ?? 0)} 
            icon={PhoneCall} 
            trend="+12.4%"
          />
          <MetricCard
            label="Réservations prises"
            value={formatNum(stats?.totalReservations ?? 0)}
            icon={CalendarCheck}
            trend="+15.8%"
          />
          <MetricCard 
            label="Taux de réponse" 
            value={`${stats?.answeredRate ?? 0}%`} 
            icon={TrendingUp} 
            isDial 
            dialValue={stats?.answeredRate ?? 0}
          />
          <MetricCard 
            label="Revenus récupérés" 
            value={`${formatNum(stats?.revenueRecovered ?? 0)} €`} 
            icon={Euro} 
            featured
          />
        </div>
      </section>

      {/* ================= CHARTS & ACTIVITY GRID ================= */}
      <section className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        
        {/* Weekly Activity Bar Chart with Mount Transitions */}
        <div className="rounded-2xl border border-white/5 bg-white/[0.01] backdrop-blur-xl p-6 shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100 ease-out">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold tracking-tight text-white font-display">Activité hebdomadaire</h3>
              <p className="mt-1 text-xs text-white/40 font-sans font-medium">Répartition des demandes reçues ce mois-ci</p>
            </div>
            <button className="h-8 w-8 rounded-full border border-white/5 bg-white/5 text-white/60 flex items-center justify-center transition-all duration-200 hover:bg-white/10 hover:text-white" aria-label="Voir les rapports">
              <ArrowUpRight size={14} />
            </button>
          </div>
          
          <div className="grid h-64 grid-cols-7 items-end gap-3 px-2 pt-4 border-b border-white/5 pb-2">
            {[44, 58, 36, 72, 64, 88, 52].map((height, index) => (
              <div key={index} className="flex h-full flex-col justify-end gap-3 group cursor-pointer">
                <AnimatedBar height={height} delay={index * 80} />
                <span className="text-center text-[10px] font-bold uppercase tracking-wider text-white/35 group-hover:text-white transition-colors duration-200 font-sans">
                  {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'][index]}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Reservations List with Mount Transitions */}
        <div className="rounded-2xl border border-white/5 bg-white/[0.01] backdrop-blur-xl p-6 shadow-xl flex flex-col justify-between animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200 ease-out">
          <div>
            <div className="mb-6 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold tracking-tight text-white font-display">Dernières réservations</h3>
                <p className="mt-1 text-xs text-white/40 font-sans font-medium">Créées automatiquement par l&apos;assistant</p>
              </div>
              <MessageSquare size={16} className="text-white/40" />
            </div>

            {recentReservations.length === 0 ? (
              <div className="sokar-empty min-h-48 rounded-xl border border-dashed border-white/5 bg-white/[0.005] flex flex-col items-center justify-center gap-3 p-8 text-center text-white/30">
                <CalendarCheck size={38} className="opacity-30 text-white/50" />
                <p className="text-xs font-medium font-sans">Aucune réservation récente</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentReservations.map((reservation: any) => (
                  <div
                    key={reservation.id}
                    className="grid grid-cols-[1fr_auto] gap-3 rounded-xl border border-white/5 bg-white/[0.01] p-4 transition-all duration-300 hover:bg-white/[0.03] hover:border-white/10"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs sm:text-sm font-bold text-white">{reservation.customerName}</p>
                      <p className="mt-1 text-[10px] tracking-wide uppercase text-white/40 font-sans">
                        {reservation.partySize} couverts · {reservation.status?.toLowerCase() || 'nouveau'}
                      </p>
                    </div>
                    <span className="text-xs text-white/45 bg-white/5 border border-white/10 px-2.5 py-1 rounded-lg h-fit font-bold font-sans">
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

function AnimatedBar({ height, delay }: { height: number; delay: number }) {
  const [currentHeight, setCurrentHeight] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setCurrentHeight(height);
    }, delay);
    return () => clearTimeout(timer);
  }, [height, delay]);

  return (
    <div
      className="rounded-t-lg bg-gradient-to-t from-orange-500/20 to-orange-500/80 shadow-[0_0_15px_rgba(249,115,22,0.1)] group-hover:shadow-[0_0_20px_rgba(249,115,22,0.25)] border-t border-x border-orange-500/30 w-full"
      style={{ 
        height: `${currentHeight}%`,
        transition: 'height 1.2s cubic-bezier(0.16, 1, 0.3, 1)' 
      }}
    />
  );
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
  const stroke = 3;
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (currentValue / 100) * circumference;

  return (
    <div className="relative flex items-center justify-center">
      <svg height={radius * 2} width={radius * 2} className="transform -rotate-90">
        {/* Background track */}
        <circle
          stroke="rgba(255, 255, 255, 0.05)"
          fill="transparent"
          strokeWidth={stroke}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />
        {/* Glowing track */}
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
        <defs>
          <linearGradient id="orangeDialGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f97316" />
            <stop offset="100%" stopColor="#ea580c" />
          </linearGradient>
        </defs>
      </svg>
      <span className="absolute text-[9px] font-black text-white tracking-tight font-display transition-all duration-500">
        {Math.round(currentValue)}%
      </span>
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
  featured,
}: {
  label: string;
  value: string;
  icon: typeof PhoneCall;
  trend?: string;
  isDial?: boolean;
  dialValue?: number;
  featured?: boolean;
}) {
  return (
    <div className={`relative overflow-hidden rounded-2xl border transition-all duration-300 p-5 ${
      featured 
        ? 'border-orange-500/25 bg-orange-500/[0.01] shadow-[0_0_30px_rgba(249,115,22,0.03)]' 
        : 'border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.03]'
    }`}>
      {/* Background soft glow for featured */}
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
      
      <div className="mt-8 flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-2xl font-black font-display tracking-tight truncate ${
            featured ? 'text-orange-400' : 'text-white'
          }`}>
            {value}
          </p>
          <p className="mt-1.5 text-[10px] font-bold text-white/40 tracking-wider uppercase font-sans">
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

function DashboardSkeleton() {
  return (
    <div className="space-y-8">
      <div className="grid gap-5 lg:grid-cols-[1fr_2fr]">
        <Skeleton className="h-56 rounded-2xl bg-white/5 border border-white/5" />
        <div className="grid gap-4 sm:grid-cols-2">
          {[1, 2, 3, 4].map((item) => (
            <Skeleton key={item} className="h-[125px] rounded-2xl bg-white/5 border border-white/5" />
          ))}
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <Skeleton className="h-80 rounded-2xl bg-white/5 border border-white/5" />
        <Skeleton className="h-80 rounded-2xl bg-white/5 border border-white/5" />
      </div>
    </div>
  );
}

function formatNum(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString('fr-FR');
}
