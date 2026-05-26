'use client';

import { useEffect, useState } from 'react';
import { useApi } from '../../lib/api';
import { AlertCircle } from 'lucide-react';

const S = {
  bg: '#1a1e22',
  panel: '#2a3036',
  panel2: '#353c43',
  panel3: '#3f5268',
  accent: '#6878a8',
  stroke: 'rgba(255,255,255,.06)',
  muted: '#9a9a9a',
  text: '#f3f3f3',
  cardStart: '#242424',
  cardEnd: '#202020',
  frameStart: '#212121',
  frameEnd: '#1b1b1b',
  green: '#77e58f',
};

export default function DashboardPage() {
  const { get, orgId } = useApi();

  useEffect(() => {
    const styleId = 'dash-hide-header';
    if (!document.getElementById(styleId)) {
      const s = document.createElement('style');
      s.id = styleId;
      s.textContent = 'body>header{display:none!important}';
      document.head.appendChild(s);
    }
    return () => { document.getElementById(styleId)?.remove(); };
  }, []);

  const [stats, setStats] = useState<any>(null);
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

  const threads = activity?.reservations?.length
    ? activity.reservations.slice(0, 3).map((r: any) => ({
        name: r.customerName,
        msg: `${r.partySize} couverts · ${r.estimatedRevenue || '?'}€ · ${r.status?.toLowerCase() || ''}`,
        time: new Date(r.reservedAt).toLocaleTimeString('fr', { hour: '2-digit', minute: '2-digit' }),
      }))
    : [
        { name: 'Sophie Martin',  msg: 'Réservation pour 4 personnes ce soir',    time: '19:30' },
        { name: 'Jean Dupont',    msg: 'Confirmation · 2 couverts',               time: '18:15' },
        { name: 'Marie Lambert',  msg: "Demande d'annulation · Table 7",           time: '17:00' },
      ];

  if (loading) {
    return (
      <div style={{ padding: 24, display: 'grid', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ height: 120, borderRadius: 22, background: S.cardStart, opacity: 0.5 }} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 16, borderRadius: 22, background: 'rgba(255,77,77,.1)', border: '1px solid rgba(255,77,77,.2)' }}>
          <AlertCircle size={20} style={{ color: '#ff4d4d' }} />
          <span style={{ color: '#ff4d4d', fontSize: 14 }}>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Topbar />
      <div style={{ display: 'grid', gridTemplateColumns: '1.05fr 1fr', gap: 14 }}>
        <WelcomeSection />
        <StatsGrid
          totalCalls={stats?.totalCalls ?? 0}
          totalReservations={stats?.totalReservations ?? 0}
          answeredRate={stats?.answeredRate ?? 0}
        />
      </div>
      <ChipRow />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
        <ChartCard />
        <HeatmapCard />
        <MessagesSection threads={threads} />
      </div>
    </div>
  );
}

/* ===== COMPOSANTS ===== */

function Topbar() {
  return (
    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <BrandIcon />
        <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {[
            { label: '🖥 Aperçu', active: true },
            { label: 'Analyses ▾', active: false },
            { label: 'Statistiques', active: false, badge: '?' },
            { label: 'Audiences', active: false },
            { label: 'Rapports', active: false },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                padding: '10px 14px',
                borderRadius: 12,
                background: item.active ? S.accent : S.panel2,
                border: `1px solid ${item.active ? 'transparent' : S.stroke}`,
                color: item.active ? '#fff' : '#d7d7d7',
                fontSize: 13,
                fontWeight: 500,
                lineHeight: 1,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                transition: 'opacity .18s',
              }}
            >
              {item.label}
              {item.badge && (
                <span
                  style={{
                    display: 'inline-grid',
                    placeItems: 'center',
                    width: 18,
                    height: 18,
                    borderRadius: 999,
                    background: '#e8c84a',
                    color: '#1a1a1a',
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  {item.badge}
                </span>
              )}
            </div>
          ))}
        </nav>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <IconBtn label="⌕" />
        <IconBtn label="🔔" />
        <ProfileAvatar />
      </div>
    </header>
  );
}

function BrandIcon() {
  return (
    <img
      src="/logo-nav.png"
      alt="Sokar"
      style={{ width: 36, height: 36, borderRadius: 12, flexShrink: 0 }}
    />
  );
}

function IconBtn({ label }: { label: string }) {
  return (
    <div style={{ width: 38, height: 38, borderRadius: '50%', border: `1px solid ${S.stroke}`, background: S.panel2, color: S.text, display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 16 }}>
      {label}
    </div>
  );
}

function ProfileAvatar() {
  return (
    <div style={{ width: 38, height: 38, borderRadius: '50%', background: `radial-gradient(circle at 35% 35%, ${S.accent} 0%, ${S.panel3} 55%, #1a1e22 100%)`, border: '1px solid rgba(255,255,255,.1)', position: 'relative' }}>
      <div style={{ position: 'absolute', inset: 8, borderRadius: '50%', background: 'rgba(255,255,255,.18)' }} />
    </div>
  );
}

function WelcomeSection() {
  return (
    <div style={{ padding: '18px 4px 12px 4px' }}>
      <div style={{ color: '#b8b8b8', fontSize: 13, marginBottom: 8 }}>Bon retour,</div>
      <h1 style={{ fontSize: 'clamp(28px, 3.5vw, 44px)', lineHeight: 0.95, letterSpacing: '-.04em', fontWeight: 600, maxWidth: 360, margin: 0, color: S.text }}>
        Restaurant<br />
        <span style={{ color: S.accent }}>Sokar</span>
      </h1>
      <div style={{ display: 'inline-flex', alignItems: 'center', marginTop: 18, padding: '6px 12px', borderRadius: 999, background: `rgba(104,120,168,.18)`, color: '#d7c8ff', border: '1px solid rgba(104,120,168,.28)', fontSize: 12, fontWeight: 500 }}>
        Premium
      </div>
    </div>
  );
}

function StatsGrid({ totalCalls, totalReservations, answeredRate }: { totalCalls: number; totalReservations: number; answeredRate: number }) {
  const items = [
    { label: 'Appels traités', value: formatNum(totalCalls), change: '+42.8%', lime: false },
    { label: 'Réservations', value: formatNum(totalReservations), change: '+26.3%', lime: false },
    { label: 'Taux de réponse', value: `${answeredRate}%`, change: '+18.4%', lime: true },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
      {items.map((item) => (
        <div
          key={item.label}
          style={{
            background: item.lime
              ? `linear-gradient(180deg, ${S.panel3} 0%, #35465a 100%)`
              : `linear-gradient(180deg, ${S.cardStart} 0%, ${S.cardEnd} 100%)`,
            border: `1px solid ${S.stroke}`,
            borderRadius: 22,
            padding: 16,
            position: 'relative', overflow: 'hidden',
            color: item.lime ? '#fff' : 'inherit',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, opacity: 0.92 }}>
              <span style={{ width: 22, height: 22, display: 'grid', placeItems: 'center', borderRadius: 999, border: `1px solid rgba(255,255,255,.09)`, background: 'rgba(255,255,255,.04)', fontSize: 11 }}>◎</span>
              {item.label}
            </div>
            <GoArrow light={item.lime} />
          </div>
          <div style={{ fontSize: 'clamp(24px, 2.4vw, 36px)', fontWeight: 600, lineHeight: 1, letterSpacing: '-.04em', marginBottom: 10 }}>
            {item.value}
          </div>
          <div style={{ fontSize: 12, color: item.lime ? 'rgba(255,255,255,.72)' : '#b8b8b8' }}>
            {item.change} vs semaine précédente
          </div>
        </div>
      ))}
    </div>
  );
}

function GoArrow({ light }: { light?: boolean }) {
  return (
    <div style={{ width: 32, height: 32, borderRadius: 999, display: 'grid', placeItems: 'center', background: light ? '#191919' : '#fff', color: light ? '#fff' : '#111', fontWeight: 700, fontSize: 14, boxShadow: '0 8px 16px rgba(0,0,0,.18)', cursor: 'pointer', flexShrink: 0 }}>
      ↗
    </div>
  );
}

function ChipRow() {
  const chips = ['Tout', 'Engagement', 'Visites', 'Posts'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {chips.map((chip, i) => (
          <div key={chip} style={{ padding: '10px 16px', borderRadius: 999, background: i === 0 ? S.accent : S.panel2, border: `1px solid ${i === 0 ? 'transparent' : S.stroke}`, fontSize: 13, color: i === 0 ? '#fff' : '#d2d2d2', cursor: 'pointer' }}>
            {chip}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 999, border: `1px solid ${S.stroke}`, background: S.panel2, display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 14, color: '#cfcfcf' }}>⏏</div>
        <div style={{ width: 36, height: 36, borderRadius: 999, border: `1px solid ${S.stroke}`, background: S.panel2, display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 14, color: '#cfcfcf' }}>📅</div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 999, background: S.panel2, border: `1px solid ${S.stroke}`, fontSize: 12, color: '#cfcfcf', cursor: 'pointer' }}>
          ⬇ Télécharger
        </div>
      </div>
    </div>
  );
}

function ChartCard() {
  const bars = [34, 56, 42, 78, 52, 63];
  const labels = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jui'];

  return (
    <div style={{ background: `linear-gradient(180deg, ${S.cardStart} 0%, ${S.cardEnd} 100%)`, border: `1px solid ${S.stroke}`, borderRadius: 22, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#ececec', fontWeight: 500 }}>
          <span style={{ width: 22, height: 22, display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'rgba(255,255,255,.05)', border: `1px solid ${S.stroke}`, color: '#cfcfcf', fontSize: 11 }}>⍜</span>
          Taux d&apos;engagement
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Seg label="Mensuel" />
          <Seg label="Annuel" active />
          <DotsMenu />
        </div>
      </div>

      <div style={{ height: 220, position: 'relative', padding: '14px 8px 8px 44px', background: `linear-gradient(to bottom, rgba(255,255,255,.05) 1px, transparent 1px) 0 0/100% 20%, linear-gradient(180deg, rgba(255,255,255,.01), rgba(255,255,255,0))`, borderRadius: 18 }}>
        <div style={{ position: 'absolute', left: 0, top: 10, bottom: 26, width: 40, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', color: '#797979', fontSize: 10 }}>
          {['12.5%', '10%', '7.5%', '5%', '2.5%', '0%'].map((l) => (<span key={l}>{l}</span>))}
        </div>

        <div style={{ position: 'absolute', top: 26, left: '50%', transform: 'translateX(-50%)', background: S.green, color: '#172116', padding: '5px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, zIndex: 3 }}>+12.8%</div>

        <div style={{ position: 'absolute', top: 58, left: '50%', transform: 'translateX(-50%)', background: S.panel2, border: `1px solid rgba(255,255,255,.08)`, color: '#fff', padding: '10px 12px', borderRadius: 16, width: 108, boxShadow: '0 12px 24px rgba(0,0,0,.28)', zIndex: 3 }}>
          <small style={{ display: 'block', color: '#9b9b9b', fontSize: 10, marginBottom: 4 }}>Avril 2025</small>
          <strong style={{ fontSize: 28, lineHeight: 1, letterSpacing: '-.04em' }}>379 502</strong>
        </div>

        <div style={{ height: '100%', display: 'grid', gridTemplateColumns: `repeat(${bars.length}, 1fr)`, alignItems: 'end', gap: 14 }}>
          {bars.map((h, i) => (
            <div key={i} style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'end', alignItems: 'center', gap: 8, position: 'relative' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: i === 3 ? S.accent : 'rgba(255,255,255,.3)', zIndex: 2, flexShrink: 0 }} />
              <div style={{
                width: '100%', maxWidth: 54, borderRadius: '22px 22px 16px 16px', height: `${h}%`,
                background: i === 3
                  ? `linear-gradient(180deg, ${S.accent} 0%, ${S.panel3} 100%)`
                  : `repeating-linear-gradient(-45deg, rgba(255,255,255,.16) 0 2px, rgba(255,255,255,0) 2px 6px), linear-gradient(180deg, rgba(104,120,168,.85) 0%, rgba(63,82,104,.78) 100%)`,
                boxShadow: i === 3 ? `0 14px 26px rgba(104,120,168,.28), inset 0 0 0 1px rgba(255,255,255,.08)` : `inset 0 0 0 1px rgba(255,255,255,.06)`,
                position: 'relative', flexShrink: 0,
              }} />
            </div>
          ))}
        </div>

        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: `repeat(${labels.length}, 1fr)`, gap: 14, color: '#7f7f7f', fontSize: 10, textAlign: 'center', paddingLeft: 2 }}>
          {labels.map((l) => (<span key={l}>{l}</span>))}
        </div>
      </div>
    </div>
  );
}

function HeatmapCard() {
  return (
    <div style={{ background: `linear-gradient(180deg, ${S.cardStart} 0%, ${S.cardEnd} 100%)`, border: `1px solid ${S.stroke}`, borderRadius: 22, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: '#ececec', fontWeight: 500 }}>Activité hebdo</div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 16, background: S.panel2, border: `1px solid ${S.stroke}`, fontSize: 12, color: '#cfcfcf', cursor: 'pointer' }}>
          📊 Rapports
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
        {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((day) => (
          <div key={day} style={{ textAlign: 'center' }}>
            <div style={{ color: '#777', fontSize: 10, marginBottom: 6 }}>{day}</div>
            <div style={{ display: 'grid', gap: 4 }}>
              {[70, 45, 90, 30, 60, 85, 50].map((val, h) => {
                const intensity = val / 100;
                return (
                  <div key={h} style={{ aspectRatio: '1/1', borderRadius: 6, background: `rgba(104,120,168,${intensity * 0.7})`, boxShadow: 'inset 0 0 0 1px rgba(104,120,168,.08)' }} />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MessagesSection({ threads }: { threads: { name: string; msg: string; time: string }[] }) {
  return (
    <div style={{ background: `linear-gradient(180deg, ${S.cardStart} 0%, ${S.cardEnd} 100%)`, border: `1px solid ${S.stroke}`, borderRadius: 22, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#ececec', fontWeight: 500 }}>
          <span style={{ width: 22, height: 22, display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'rgba(255,255,255,.05)', border: `1px solid ${S.stroke}`, color: '#cfcfcf', fontSize: 11 }}>✉</span>
          Messages
        </div>
        <div style={{ width: 28, height: 28, borderRadius: 999, border: `1px solid ${S.stroke}`, background: S.panel2, display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 14, color: '#cfcfcf' }}>+</div>
      </div>

      <div style={{ width: '100%', marginBottom: 12, padding: '12px 14px', borderRadius: 16, border: `1px solid ${S.stroke}`, outline: 'none', background: S.panel2, color: '#d9d9d9', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ opacity: 0.4 }}>⌕</span>
        <span>Rechercher un message</span>
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        {threads.map((thread, i) => (
          <div
            key={i}
            style={{ display: 'grid', gridTemplateColumns: '44px 1fr auto', gap: 10, alignItems: 'center', padding: '10px 4px', cursor: 'pointer', borderRadius: 12, transition: 'background .18s' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,.03)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <div style={{
              width: 44, height: 44, borderRadius: '50%', position: 'relative', overflow: 'hidden',
              background: i === 1 ? `linear-gradient(180deg, #98b0c4, ${S.accent})` : i === 2 ? `linear-gradient(180deg, #ffb06c, #8b5a2d)` : `linear-gradient(180deg, ${S.accent}, ${S.panel3})`,
            }}>
              <div style={{ position: 'absolute', width: 18, height: 18, borderRadius: '50%', background: 'rgba(255,255,255,.58)', left: 13, top: 8 }} />
              <div style={{ position: 'absolute', width: 28, height: 18, borderRadius: '18px 18px 10px 10px', background: 'rgba(255,255,255,.42)', left: 8, bottom: 4 }} />
            </div>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 500, color: S.text }}>{thread.name}</h4>
              <p style={{ margin: 0, color: '#adadad', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>{thread.msg}</p>
            </div>
            <span style={{ color: '#8a8a8a', fontSize: 11, alignSelf: 'start', whiteSpace: 'nowrap' }}>{thread.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Seg({ label, active }: { label: string; active?: boolean }) {
  return (
    <div style={{ padding: '8px 12px', borderRadius: 999, border: `1px solid ${active ? 'transparent' : S.stroke}`, background: active ? S.accent : S.panel2, color: active ? '#fff' : '#cfcfcf', fontSize: 12, cursor: 'pointer' }}>
      {label}
    </div>
  );
}

function DotsMenu() {
  return (
    <div style={{ width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center', background: S.panel2, color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>•••</div>
  );
}

function formatNum(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toLocaleString('fr-FR');
}
