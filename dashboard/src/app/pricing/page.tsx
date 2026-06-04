'use client';

import { useState, useEffect } from 'react';

/* ===== DATA ===== */

const plans = [
  {
    label: 'Essential',
    price: '149',
    period: '€/mois',
    description: 'Pour automatiser vos premiers appels et réservations.',
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
    period: '€/mois',
    description: 'Pour les restaurants qui veulent maximiser chaque service.',
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
    period: '€/mois + 99€/site',
    description: 'Pour piloter plusieurs établissements avec une seule équipe.',
    features: [
      'Plan Pro sur tous vos établissements',
      'Un seul dashboard pour tout piloter',
      'Un numéro et un agent par site',
      'Une seule facture pour tout le groupe',
    ],
  },
];

function CheckIcon() {
  return (
    <span className="check-icon">
      <svg viewBox="0 0 12 12">
        <polyline points="2,6 5,9 10,3" />
      </svg>
    </span>
  );
}

/* ===== COMPONENT ===== */

export default function PricingPage() {
  const [yearly, setYearly] = useState(true);

  // Hide root layout header while on this page
  useEffect(() => {
    const styleId = 'pricing-hide-header';
    // Check if style already exists
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = 'body>header{display:none!important}';
      document.head.appendChild(style);
    }
    return () => {
      const el = document.getElementById(styleId);
      if (el) el.remove();
    };
  }, []);

  // Fix toggle ::after via CSS custom property
  useEffect(() => {
    const track = document.getElementById('toggle-track');
    if (track) {
      track.style.setProperty('--tx', yearly ? '20px' : '0px');
    }
  }, [yearly]);

  const toggleBilling = () => setYearly((v) => !v);

  return (
    <div className="pricing-root">
      {/* ---- STYLES ---- */}
      <style>{`
        :root {
          --font-body: 'Inter', system-ui, -apple-system, sans-serif;
          --text-xs: clamp(0.75rem, 0.7rem + 0.25vw, 0.875rem);
          --text-sm: clamp(0.875rem, 0.8rem + 0.35vw, 1rem);
          --text-base: clamp(1rem, 0.95rem + 0.25vw, 1.125rem);
          --text-hero: clamp(3rem, 2rem + 10vw, 16rem);
          --space-1: 0.25rem; --space-2: 0.5rem; --space-3: 0.75rem; --space-4: 1rem;
          --space-5: 1.25rem; --space-6: 1.5rem; --space-8: 2rem; --space-12: 3rem; --space-16: 4rem;
          --radius-sm: 0.375rem; --radius-md: 0.5rem; --radius-lg: 0.75rem;
          --radius-xl: 1rem; --radius-2xl: 1.5rem; --radius-full: 9999px;
          --transition: 180ms cubic-bezier(0.16, 1, 0.3, 1);
          --color-bg: hsl(0 0% 0%);
          --color-surface: hsla(0, 0%, 4%, 0.62);
          --color-border: rgba(255,255,255,0.18);
          --color-border-strong: rgba(147,226,255,0.75);
          --color-text: hsl(0 0% 94%);
          --color-text-muted: hsl(0 0% 70%);
        }
        .pricing-root {
          font-family: var(--font-body);
          background:
            radial-gradient(circle at 67% 16%, rgba(44, 174, 255, 0.42), transparent 18rem),
            radial-gradient(circle at 72% 62%, rgba(126, 244, 255, 0.46), transparent 17rem),
            radial-gradient(circle at 39% 92%, rgba(87, 214, 255, 0.52), transparent 18rem),
            linear-gradient(180deg, hsl(0 0% 0%) 0%, hsl(0 0% 2%) 52%, hsl(0 0% 0%) 100%);
          color: var(--color-text);
          min-height: 100vh;
          -webkit-font-smoothing: antialiased;
          overflow-x: hidden;
          position: relative;
        }
        .pricing-root::before,
        .pricing-root::after {
          content: '';
          position: fixed;
          pointer-events: none;
          z-index: 0;
          filter: blur(28px);
        }
        .pricing-root::before {
          width: 28rem;
          height: 42rem;
          left: 31%;
          top: 41%;
          transform: rotate(18deg);
          border-radius: 50%;
          background: linear-gradient(180deg, rgba(108, 234, 255, 0.85), rgba(255, 255, 255, 0.06) 48%, transparent 78%);
          opacity: 0.72;
        }
        .pricing-root::after {
          width: 22rem;
          height: 22rem;
          right: 17%;
          top: 2%;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(29, 126, 255, 0.78), transparent 68%);
          opacity: 0.68;
        }

        /* ---- Navbar ---- */
        .navbar-wrap {
          position: fixed;
          top: var(--space-5);
          left: 50%;
          transform: translateX(-50%);
          z-index: 100;
        }
        .navbar {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          background: rgba(14,14,14,0.68);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-full);
          padding: 0.35rem var(--space-2);
          white-space: nowrap;
        }
        .nav-close {
          width: 44px; height: 44px;
          border-radius: var(--radius-full);
          background: rgba(255,255,255,0.08);
          border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          color: var(--color-text); font-size: 15px;
          transition: background var(--transition); flex-shrink: 0;
        }
        .nav-close:hover { background: rgba(255,255,255,0.18); }
        .nav-links {
          display: flex; align-items: center; gap: var(--space-1);
          list-style: none; margin: 0; padding: 0;
        }
        .nav-links a {
          text-decoration: none;
          color: var(--color-text-muted);
          font-size: 0.82rem; font-weight: 400;
          padding: 0.42rem var(--space-3);
          border-radius: var(--radius-full);
          transition: color var(--transition), background var(--transition);
        }
        .nav-links a:hover { color: var(--color-text); background: rgba(255,255,255,0.05); }
        .nav-links a.active { color: var(--color-text); }
        .nav-download {
          background: hsl(0 0% 100%); color: hsl(0 0% 0%);
          font-size: 0.82rem; font-weight: 600;
          padding: 0.48rem var(--space-5);
          border-radius: var(--radius-full);
          border: none; cursor: pointer;
          transition: opacity var(--transition);
          text-decoration: none;
        }
        .nav-download:hover { opacity: 0.88; }

        /* ---- Hero ---- */
        .hero {
          padding-top: 98px;
          text-align: center;
          position: relative;
          z-index: 1;
        }
        .hero-title {
          font-size: var(--text-hero);
          font-weight: 800;
          letter-spacing: -0.075em;
          line-height: 0.66;
          color: rgba(255,255,255,0.08);
          background: linear-gradient(90deg, rgba(21, 100, 255, 0.12), rgba(111, 228, 255, 0.72), rgba(255,255,255,0.2));
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          pointer-events: none;
          user-select: none;
          padding-bottom: 0;
          text-shadow: 0 0 56px rgba(52, 174, 255, 0.45);
        }
        .hero-kicker {
          position: absolute;
          left: 63%;
          top: 96px;
          font-size: clamp(2.1rem, 4vw, 4.4rem);
          font-weight: 700;
          letter-spacing: -0.05em;
          color: rgba(235,250,255,0.88);
          text-shadow: 0 0 34px rgba(64, 187, 255, 0.55);
          white-space: nowrap;
        }

        /* ---- Pricing section ---- */
        .pricing-section {
          padding: 0 var(--space-8) var(--space-8);
          max-width: 1180px;
          margin: -1.8rem auto 0;
          position: relative;
          z-index: 2;
        }
        .cards-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: var(--space-6);
        }

        /* ---- Cards ---- */
        .card {
          min-height: 27rem;
          background:
            linear-gradient(135deg, rgba(255,255,255,0.09), rgba(255,255,255,0.015) 42%, rgba(255,255,255,0.055)),
            var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 2rem;
          padding: var(--space-8);
          display: flex;
          flex-direction: column;
          gap: var(--space-5);
          position: relative;
          overflow: hidden;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.14),
            0 1.5rem 4rem rgba(0,0,0,0.56);
          backdrop-filter: blur(28px) saturate(150%);
          -webkit-backdrop-filter: blur(28px) saturate(150%);
          transition: border-color var(--transition), transform var(--transition), box-shadow var(--transition);
        }
        .card:hover {
          border-color: var(--color-border-strong);
          transform: translateY(-5px);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.18),
            0 2rem 5rem rgba(0,0,0,0.62),
            0 0 3.5rem rgba(67, 197, 255, 0.18);
        }
        .card::before {
          content: '';
          position: absolute;
          top: -110px; left: 50%;
          transform: translateX(-50%);
          width: 300px; height: 300px;
          background: radial-gradient(circle, rgba(92,221,255,0.26) 0%, transparent 66%);
          pointer-events: none;
          border-radius: 50%;
          filter: blur(18px);
        }
        .card::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(124deg, transparent 18%, rgba(255,255,255,0.08) 44%, transparent 62%);
          opacity: 0.62;
          pointer-events: none;
        }
        .card.featured::before {
          background: radial-gradient(circle, rgba(107,234,255,0.5) 0%, transparent 66%);
        }
        .card.featured {
          border-color: rgba(129,232,255,0.58);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.16),
            0 1.5rem 4rem rgba(0,0,0,0.56),
            0 0 3.5rem rgba(77, 203, 255, 0.28);
        }

        .card-label {
          position: relative;
          z-index: 1;
          font-size: 1.25rem;
          color: var(--color-text);
          font-weight: 500;
          margin-bottom: 0.2rem;
        }
        .card-price {
          position: relative;
          z-index: 1;
          font-size: clamp(2.2rem, 4vw, 3.1rem);
          font-weight: 650;
          letter-spacing: -0.055em;
          color: var(--color-text);
          line-height: 1;
        }
        .card-price .period {
          font-size: clamp(1rem, 1.6vw, 1.35rem);
          font-weight: 400;
          color: var(--color-text);
          letter-spacing: -0.04em;
        }
        .card-description {
          position: relative;
          z-index: 1;
          margin-top: var(--space-4);
          max-width: 18rem;
          font-size: 0.82rem;
          color: rgba(255,255,255,0.68);
          line-height: 1.5;
        }

        /* ---- Features ---- */
        .features-list {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
          flex: 1;
          margin: 0; padding: 0;
          position: relative;
          z-index: 1;
        }
        .feature-item {
          display: flex;
          align-items: flex-start;
          gap: var(--space-3);
          font-size: var(--text-sm);
          color: rgba(255,255,255,0.76);
          line-height: 1.45;
        }
        .check-icon {
          width: 22px; height: 22px;
          border-radius: var(--radius-full);
          border: 1px solid rgba(255,255,255,0.28);
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; margin-top: 1px;
        }
        .check-icon svg {
          width: 12px; height: 12px;
          stroke: rgba(255,255,255,0.55);
          fill: none; stroke-width: 2.5;
          stroke-linecap: round; stroke-linejoin: round;
        }

        /* ---- CTA Buttons ---- */
        .cta-btn {
          align-self: center;
          width: auto;
          min-width: 9.25rem;
          padding: 0.72rem var(--space-6);
          border-radius: var(--radius-full);
          font-size: 0.82rem; font-weight: 600;
          cursor: pointer; border: none;
          position: relative;
          z-index: 1;
          transition: opacity var(--transition), transform var(--transition), box-shadow var(--transition);
          text-align: center; text-decoration: none; display: inline-block;
        }
        .cta-btn:hover { opacity: 0.94; transform: translateY(-1px) scale(1.01); box-shadow: 0 0.75rem 1.8rem rgba(255,255,255,0.12); }
        .cta-btn:active { transform: scale(0.99); }
        .cta-dark { background: hsl(0 0% 100%); color: hsl(0 0% 0%); }
        .cta-light { background: hsl(0 0% 100%); color: hsl(0 0% 0%); }

        /* ---- Billing ---- */
        .billing-row {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          padding: var(--space-8) var(--space-8) var(--space-16);
          max-width: 1180px;
          margin: 0 auto;
          position: relative;
          z-index: 2;
        }
        .toggle-label {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          cursor: pointer;
        }
        .toggle-track {
          width: 45px; height: 24px;
          background: ${yearly ? 'hsl(0 0% 100%)' : 'hsl(0 0% 19%)'};
          border: 1px solid rgba(255,255,255,0.22);
          border-radius: var(--radius-full);
          position: relative;
          transition: background var(--transition);
          flex-shrink: 0;
        }
        .toggle-track::after {
          content: '';
          position: absolute;
          top: 3px; left: 3px;
          width: 18px; height: 18px;
          background: ${yearly ? 'hsl(0 0% 0%)' : 'hsl(0 0% 100%)'};
          border-radius: var(--radius-full);
          transition: transform var(--transition);
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
          transform: translateX(var(--tx, 20px));
        }
        .billing-text {
          font-size: var(--text-sm);
          color: var(--color-text-muted);
        }

        /* ---- Footer ---- */
        .pricing-footer {
          border-top: 1px solid var(--color-border);
          padding: var(--space-6);
          text-align: center;
          font-size: var(--text-sm);
          color: var(--color-text-muted);
        }

        /* ---- Responsive ---- */
        @media (max-width: 768px) {
          .cards-grid { grid-template-columns: 1fr; }
          .pricing-section { margin-top: var(--space-8); padding: 0 var(--space-4) var(--space-12); }
          .navbar-wrap { top: var(--space-3); }
          .navbar { gap: var(--space-1); padding: var(--space-1) var(--space-2); }
          .nav-links a { padding: var(--space-1) var(--space-2); font-size: var(--text-xs); }
          .billing-row { padding: var(--space-4); }
          .hero { padding-top: 92px; }
          .hero-kicker { left: 50%; top: 98px; transform: translateX(-50%); font-size: clamp(1.6rem, 9vw, 3rem); }
          .card { min-height: auto; }
        }
      `}</style>

      {/* ---- NAVBAR ---- */}
      <div className="navbar-wrap">
        <nav className="navbar" aria-label="Main navigation">
          <button className="nav-close" aria-label="Close">✕</button>
          <ul className="nav-links">
            <li><a href="/">Accueil</a></li>
            <li><a href="/pricing" className="active">Tarifs</a></li>
            <li><a href="/#faq">FAQ</a></li>
            <li><a href="/#contact">Contact</a></li>
          </ul>
          <a href="/register" className="nav-download">Souscrire</a>
        </nav>
      </div>

      {/* ---- HERO ---- */}
      <section className="hero">
        <h1 className="hero-title">Tarifs</h1>
        <p className="hero-kicker">Sokar AI</p>
      </section>

      {/* ---- CARDS ---- */}
      <section className="pricing-section" aria-label="Pricing plans">
        <div className="cards-grid">
          {plans.map((plan) => (
            <div key={plan.label} className={`card${plan.featured ? ' featured' : ''}`}>
              <div>
                <p className="card-label">{plan.label}</p>
                <p className="card-price">
                  {displayPrice(plan.price, yearly)}
                  <span className="period">{plan.period}</span>
                </p>
                <p className="card-description">{plan.description}</p>
              </div>
              <ul className="features-list">
                {plan.features.map((feat) => (
                  <li key={feat} className="feature-item">
                    <CheckIcon />
                    {feat}
                  </li>
                ))}
              </ul>
              <a
                href="/register"
                className={`cta-btn ${plan.featured ? 'cta-light' : 'cta-dark'}`}
              >
                Souscrire
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* ---- BILLING ---- */}
      <div className="billing-row">
        <label className="toggle-label" aria-label="Toggle yearly billing">
          <div
            id="toggle-track"
            className="toggle-track"
            role="switch"
            aria-checked={yearly}
            tabIndex={0}
            onClick={toggleBilling}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                toggleBilling();
              }
            }}
          />
          <span className="billing-text">Facturation annuelle</span>
        </label>
      </div>

      {/* ---- FOOTER ---- */}
      <footer className="pricing-footer">
        &copy; {new Date().getFullYear()} Sokar. Tous droits réservés.
      </footer>
    </div>
  );
}

/* Helpers */

function displayPrice(price: string, yearly: boolean) {
  const num = parseInt(price, 10);
  return yearly ? Math.round(num * 0.8).toString() : price;
}
