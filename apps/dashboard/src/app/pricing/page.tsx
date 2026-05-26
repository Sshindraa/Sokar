'use client';

import { useState, useEffect } from 'react';

/* ===== DATA ===== */

const plans = [
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
          --text-hero: clamp(5rem, 2rem + 10vw, 11rem);
          --space-1: 0.25rem; --space-2: 0.5rem; --space-3: 0.75rem; --space-4: 1rem;
          --space-5: 1.25rem; --space-6: 1.5rem; --space-8: 2rem; --space-12: 3rem; --space-16: 4rem;
          --radius-sm: 0.375rem; --radius-md: 0.5rem; --radius-lg: 0.75rem;
          --radius-xl: 1rem; --radius-2xl: 1.5rem; --radius-full: 9999px;
          --transition: 180ms cubic-bezier(0.16, 1, 0.3, 1);
          --color-bg: #0a0a0a;
          --color-surface: #111111;
          --color-border: rgba(255,255,255,0.08);
          --color-border-strong: rgba(255,255,255,0.15);
          --color-text: #f0f0f0;
          --color-text-muted: #888888;
        }
        .pricing-root {
          font-family: var(--font-body);
          background: var(--color-bg);
          color: var(--color-text);
          min-height: 100vh;
          -webkit-font-smoothing: antialiased;
          overflow-x: hidden;
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
          background: rgba(20,20,20,0.85);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-full);
          padding: var(--space-2) var(--space-3);
          white-space: nowrap;
        }
        .nav-close {
          width: 28px; height: 28px;
          border-radius: var(--radius-full);
          background: rgba(255,255,255,0.1);
          border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          color: var(--color-text); font-size: 13px;
          transition: background var(--transition); flex-shrink: 0;
        }
        .nav-close:hover { background: rgba(255,255,255,0.2); }
        .nav-links {
          display: flex; align-items: center; gap: var(--space-1);
          list-style: none; margin: 0; padding: 0;
        }
        .nav-links a {
          text-decoration: none;
          color: var(--color-text-muted);
          font-size: var(--text-sm); font-weight: 400;
          padding: var(--space-1) var(--space-3);
          border-radius: var(--radius-full);
          transition: color var(--transition), background var(--transition);
        }
        .nav-links a:hover { color: var(--color-text); background: rgba(255,255,255,0.05); }
        .nav-links a.active { color: var(--color-text); }
        .nav-download {
          background: #fff; color: #000;
          font-size: var(--text-sm); font-weight: 500;
          padding: var(--space-1) var(--space-4);
          border-radius: var(--radius-full);
          border: none; cursor: pointer;
          transition: opacity var(--transition);
          text-decoration: none;
        }
        .nav-download:hover { opacity: 0.88; }

        /* ---- Hero ---- */
        .hero { padding-top: 80px; text-align: center; }
        .hero-title {
          font-size: var(--text-hero);
          font-weight: 700;
          letter-spacing: -0.03em;
          line-height: 0.88;
          color: var(--color-text);
          pointer-events: none;
          user-select: none;
          padding-bottom: 2rem;
        }

        /* ---- Pricing section ---- */
        .pricing-section {
          padding: 0 var(--space-8) var(--space-8);
          max-width: 1100px;
          margin: -2rem auto 0;
        }
        .cards-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: var(--space-4);
        }

        /* ---- Cards ---- */
        .card {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-2xl);
          padding: var(--space-6);
          display: flex;
          flex-direction: column;
          gap: var(--space-5);
          position: relative;
          overflow: hidden;
          transition: border-color var(--transition), transform var(--transition);
        }
        .card:hover { border-color: var(--color-border-strong); transform: translateY(-2px); }
        .card::before {
          content: '';
          position: absolute;
          top: -80px; left: 50%;
          transform: translateX(-50%);
          width: 220px; height: 220px;
          background: radial-gradient(circle, rgba(255,255,255,0.11) 0%, transparent 65%);
          pointer-events: none;
          border-radius: 50%;
          filter: blur(15px);
        }
        .card.featured::before {
          background: radial-gradient(circle, rgba(255,255,255,0.17) 0%, transparent 65%);
        }

        .card-label {
          font-size: var(--text-xs);
          color: var(--color-text-muted);
          font-weight: 400;
          margin-bottom: var(--space-2);
        }
        .card-price {
          font-size: clamp(2rem, 4vw, 3.25rem);
          font-weight: 700;
          letter-spacing: -0.03em;
          color: var(--color-text);
          line-height: 1;
        }
        .card-price .period {
          font-size: var(--text-base);
          font-weight: 400;
          color: var(--color-text-muted);
        }

        /* ---- Features ---- */
        .features-list {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
          flex: 1;
          margin: 0; padding: 0;
        }
        .feature-item {
          display: flex;
          align-items: flex-start;
          gap: var(--space-3);
          font-size: var(--text-xs);
          color: var(--color-text-muted);
          line-height: 1.45;
        }
        .check-icon {
          width: 18px; height: 18px;
          border-radius: var(--radius-full);
          border: 1px solid rgba(255,255,255,0.28);
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; margin-top: 1px;
        }
        .check-icon svg {
          width: 10px; height: 10px;
          stroke: rgba(255,255,255,0.55);
          fill: none; stroke-width: 2.5;
          stroke-linecap: round; stroke-linejoin: round;
        }

        /* ---- CTA Buttons ---- */
        .cta-btn {
          width: 100%;
          padding: var(--space-3) var(--space-4);
          border-radius: var(--radius-lg);
          font-size: var(--text-sm); font-weight: 500;
          cursor: pointer; border: none;
          transition: opacity var(--transition), transform var(--transition);
          text-align: center; text-decoration: none; display: inline-block;
        }
        .cta-btn:hover { opacity: 0.88; transform: scale(1.01); }
        .cta-btn:active { transform: scale(0.99); }
        .cta-dark { background: #1e1e1e; color: var(--color-text); }
        .cta-light { background: #fff; color: #000; }

        /* ---- Billing ---- */
        .billing-row {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          padding: var(--space-8) var(--space-8) var(--space-16);
          max-width: 1100px;
          margin: 0 auto;
        }
        .toggle-label {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          cursor: pointer;
        }
        .toggle-track {
          width: 44px; height: 24px;
          background: ${yearly ? '#2a7af3' : '#444'};
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
          background: white;
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
          .pricing-section { padding: 0 var(--space-4) var(--space-12); }
          .navbar-wrap { top: var(--space-3); }
          .navbar { gap: var(--space-1); padding: var(--space-1) var(--space-2); }
          .nav-links a { padding: var(--space-1) var(--space-2); font-size: var(--text-xs); }
          .billing-row { padding: var(--space-4); }
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
