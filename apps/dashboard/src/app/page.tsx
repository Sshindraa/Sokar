import Link from 'next/link';
import { ArrowUpRight, CalendarCheck, Headphones, MessageCircle, PhoneCall, Sparkles, Users } from 'lucide-react';
import AuthRedirect from '@/components/auth-redirect';

const services = [
  { label: 'Répondre', icon: PhoneCall },
  { label: 'Réserver', icon: CalendarCheck },
  { label: 'Qualifier', icon: MessageCircle },
  { label: 'Fidéliser', icon: Users },
];

export default function HomePage() {
  return (
    <div className="min-h-screen overflow-hidden bg-muted text-foreground">
      <style>{`
        body > header { display: none !important; }
        .home-atmosphere {
          background:
            linear-gradient(135deg, hsl(0 0% 86%) 0%, hsl(0 0% 48%) 46%, hsl(0 0% 86%) 100%);
        }
        .home-atmosphere::before,
        .home-atmosphere::after {
          content: '';
          position: absolute;
          inset: auto;
          pointer-events: none;
          filter: blur(38px);
          opacity: 0.78;
        }
        .home-atmosphere::before {
          width: 64rem;
          height: 12rem;
          left: -12rem;
          top: 1rem;
          transform: rotate(-14deg);
          border-radius: 9999px;
          background: linear-gradient(90deg, transparent, hsl(0 0% 100% / 0.85), transparent);
        }
        .home-atmosphere::after {
          width: 46rem;
          height: 18rem;
          right: -6rem;
          bottom: 6rem;
          transform: rotate(-28deg);
          border-radius: 9999px;
          background: linear-gradient(90deg, transparent, hsl(0 0% 100% / 0.5), transparent);
        }
        .liquid-field {
          background:
            radial-gradient(ellipse at 15% 45%, hsl(0 0% 100% / 0.44) 0%, hsl(0 0% 100% / 0.12) 20%, transparent 38%),
            radial-gradient(ellipse at 85% 72%, hsl(0 0% 100% / 0.3) 0%, hsl(0 0% 100% / 0.06) 18%, transparent 40%),
            radial-gradient(ellipse at 35% 88%, hsl(0 0% 100% / 0.36) 0%, hsl(0 0% 100% / 0.1) 15%, transparent 32%),
            linear-gradient(180deg, hsl(0 0% 2%) 0%, hsl(0 0% 0%) 100%);
        }
        .liquid-field::before {
          content: '';
          position: absolute;
          left: -12%;
          right: -4%;
          top: 28%;
          height: 36%;
          border-radius: 50%;
          transform: rotate(8deg);
          background:
            radial-gradient(ellipse at 12% 35%, hsl(0 0% 100% / 0.72), transparent 16%),
            radial-gradient(ellipse at 42% 70%, hsl(0 0% 100% / 0.48), transparent 14%),
            radial-gradient(ellipse at 58% 46%, hsl(0 0% 100% / 0.26), transparent 16%),
            radial-gradient(ellipse at 92% 52%, hsl(0 0% 100% / 0.38), transparent 15%);
          filter: blur(20px);
          opacity: 0.75;
        }
        .liquid-field::after {
          content: '';
          position: absolute;
          left: 28%;
          top: 16%;
          width: 48%;
          height: 60%;
          border-radius: 52%;
          border: 1px solid hsl(0 0% 100% / 0.13);
          transform: rotate(-16deg);
          filter: blur(1.5px);
          opacity: 0.65;
        }
      `}</style>

      <AuthRedirect />

      <main className="home-atmosphere relative flex min-h-screen items-stretch justify-center">
        <section className="relative flex min-h-screen w-full flex-col overflow-hidden bg-background">
          <div className="liquid-field absolute inset-0" />

          {/* Logo — top-left */}
          <Link
            href="/"
            className="fixed left-6 top-5 z-50 flex items-center gap-2 rounded-full transition-all duration-200 hover:opacity-80"
          >
            <img src="/logo-nav.png" alt="Sokar" className="h-11 w-11" />
            <span className="text-xl font-bold tracking-tight text-foreground">Sokar</span>
          </Link>

          {/* Floating navbar — nav links + CTA */}
          <div className="fixed left-1/2 top-5 z-50 -translate-x-1/2">
            <nav className="flex items-center gap-2 rounded-full border border-border bg-card/85 px-3 py-2 shadow-2xl shadow-background/40 backdrop-blur-xl">
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
                    className="rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
              <Link
                href="/register"
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-4 py-1.5 text-sm font-medium transition-all duration-300 hover:-translate-y-0.5 hover:bg-primary hover:text-primary-foreground hover:shadow-[0_0_15px_rgba(255,255,255,0.1)] active:scale-[0.98]"
              >
                Essai gratuit
                <ArrowUpRight size={14} />
              </Link>
            </nav>
          </div>

          <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col items-center justify-center px-6 py-16 text-center md:px-10">
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-5 py-2.5 text-xs text-muted-foreground backdrop-blur-xl transition-all duration-300 hover:border-foreground/20">
              <Sparkles size={14} />
              Assistant vocal pour restaurants
            </p>
            <h1 className="mt-6 max-w-5xl text-5xl font-semibold leading-[0.9] tracking-tight md:text-7xl lg:text-8xl">
              La salle répond quand vous cuisinez.
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
              Sokar prend les appels, confirme les réservations et transmet les bonnes infos à
              votre équipe sans casser le rythme du service.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/register"
                className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-all duration-300 hover:-translate-y-0.5 hover:scale-[1.01] hover:bg-primary/90 hover:shadow-[0_0_20px_rgba(255,255,255,0.12)] active:scale-[0.98]"
              >
                Réserver une démo
              </Link>
              <Link
                href="/pricing"
                className="inline-flex items-center justify-center rounded-full border border-border bg-card/80 px-6 py-3 text-sm font-semibold transition-all duration-300 hover:-translate-y-0.5 hover:bg-accent hover:border-foreground/30 hover:shadow-[0_0_15px_rgba(255,255,255,0.08)] active:scale-[0.98]"
              >
                Voir les tarifs
              </Link>
            </div>
          </div>

          <div className="relative z-10 mx-auto grid w-full max-w-7xl gap-4 px-6 pb-8 text-xs text-foreground/80 md:grid-cols-[1fr_auto_1fr] md:px-10">
            <div className="hidden items-center gap-3 md:flex">
              <span className="font-medium">Scroll</span>
              <span className="h-px flex-1 bg-border/40" />
              <span className="font-medium">pour découvrir</span>
            </div>
            <button className="group mx-auto flex items-center gap-2 rounded-full border border-border/40 bg-card/70 px-3 py-1.5 transition-all duration-300 hover:bg-foreground hover:text-background hover:scale-105 active:scale-95">
              <Headphones size={14} className="animate-pulse" />
              <span className="text-[10px] font-semibold tracking-wide uppercase text-foreground/80 group-hover:text-background transition-colors duration-300">
                écouter une démo
              </span>
            </button>
            <div className="hidden items-center gap-3 md:flex">
              <span className="h-px flex-1 bg-border/40" />
              <span className="font-medium">pilotage temps réel</span>
            </div>
          </div>
        </section>
      </main>

      <section id="services" className="bg-background px-4 pb-16 md:px-10">
        <div className="mx-auto grid max-w-6xl gap-3 border-t border-border pt-8 md:grid-cols-4">
          {services.map((service) => {
            const Icon = service.icon;

            return (
              <div
                key={service.label}
                className="flex items-center justify-center gap-2 rounded-full border border-border bg-card px-4 py-3 text-sm text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground"
              >
                <Icon size={16} />
                {service.label}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
