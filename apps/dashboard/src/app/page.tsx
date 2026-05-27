import Link from 'next/link';
import { SignedIn, SignedOut } from '@clerk/nextjs';
import {
  ArrowUpRight,
  CalendarCheck,
  Headphones,
  MessageCircle,
  PhoneCall,
  Sparkles,
  Users,
} from 'lucide-react';

const navItems = [
  { label: 'Services', href: '#services' },
  { label: 'Tarifs', href: '/pricing' },
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Contact', href: '#contact' },
];

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
          filter: blur(34px);
          opacity: 0.75;
        }
        .home-atmosphere::before {
          width: 58rem;
          height: 14rem;
          left: -8rem;
          top: 3rem;
          transform: rotate(-18deg);
          border-radius: 9999px;
          background: linear-gradient(90deg, transparent, hsl(0 0% 100% / 0.82), transparent);
        }
        .home-atmosphere::after {
          width: 52rem;
          height: 16rem;
          right: -10rem;
          bottom: 3rem;
          transform: rotate(-22deg);
          border-radius: 9999px;
          background: linear-gradient(90deg, transparent, hsl(0 0% 100% / 0.55), transparent);
        }
        .liquid-field {
          background:
            radial-gradient(ellipse at 20% 62%, hsl(0 0% 100% / 0.42) 0%, hsl(0 0% 100% / 0.1) 18%, transparent 36%),
            radial-gradient(ellipse at 78% 66%, hsl(0 0% 100% / 0.28) 0%, hsl(0 0% 100% / 0.08) 20%, transparent 42%),
            radial-gradient(ellipse at 49% 83%, hsl(0 0% 100% / 0.34) 0%, hsl(0 0% 100% / 0.1) 16%, transparent 34%),
            linear-gradient(180deg, hsl(0 0% 2%) 0%, hsl(0 0% 0%) 100%);
        }
        .liquid-field::before {
          content: '';
          position: absolute;
          left: -8%;
          right: -6%;
          top: 31%;
          height: 33%;
          border-radius: 50%;
          transform: rotate(6deg);
          background:
            radial-gradient(ellipse at 18% 40%, hsl(0 0% 100% / 0.7), transparent 18%),
            radial-gradient(ellipse at 37% 66%, hsl(0 0% 100% / 0.45), transparent 15%),
            radial-gradient(ellipse at 62% 56%, hsl(0 0% 100% / 0.28), transparent 18%),
            radial-gradient(ellipse at 86% 42%, hsl(0 0% 100% / 0.35), transparent 17%);
          filter: blur(18px);
          opacity: 0.72;
        }
        .liquid-field::after {
          content: '';
          position: absolute;
          left: 24%;
          top: 20%;
          width: 52%;
          height: 56%;
          border-radius: 48%;
          border: 1px solid hsl(0 0% 100% / 0.11);
          transform: rotate(-12deg);
          filter: blur(1px);
          opacity: 0.7;
        }
      `}</style>

      <SignedIn>
        <main className="home-atmosphere relative flex min-h-screen items-stretch justify-center">
          <section className="relative flex w-full overflow-hidden bg-background p-8 text-center">
            <div className="liquid-field absolute inset-0 opacity-80" />
            <div className="relative z-10 mx-auto flex max-w-xl flex-col justify-center py-24">
              <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-4 py-2 text-xs text-muted-foreground backdrop-blur-xl">
                <Sparkles size={14} />
                Session active
              </p>
              <h1 className="mt-6 text-4xl font-semibold leading-none tracking-tight md:text-6xl">
                Votre restaurant est prêt.
              </h1>
              <p className="mx-auto mt-5 max-w-md text-sm leading-6 text-muted-foreground">
                Accédez au tableau de bord pour suivre vos appels, réservations et clients.
              </p>
              <Link
                href="/dashboard"
                className="mt-8 inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-all duration-200 hover:scale-[1.01] hover:bg-primary/90"
              >
                Ouvrir le dashboard
                <ArrowUpRight size={16} />
              </Link>
            </div>
          </section>
        </main>
      </SignedIn>

      <SignedOut>
        <main className="home-atmosphere relative flex min-h-screen items-stretch justify-center">
          <section className="relative flex min-h-screen w-full flex-col overflow-hidden bg-background">
            <div className="liquid-field absolute inset-0" />

            <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-6 py-6 md:px-10">
              <Link href="/" className="flex items-center gap-2 rounded-full transition-all duration-200 hover:opacity-80">
                <img src="/logo-nav.png" alt="Sokar" className="h-6 w-6 rounded-full" />
                <span className="text-sm font-semibold">Sokar</span>
              </Link>
              <nav className="hidden items-center gap-6 md:flex">
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="text-xs text-muted-foreground transition-all duration-200 hover:text-foreground"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <Link
                href="/register"
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-4 py-2 text-xs font-medium transition-all duration-200 hover:bg-primary hover:text-primary-foreground"
              >
                Essai gratuit
                <ArrowUpRight size={14} />
              </Link>
            </header>

            <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col items-center justify-center px-6 py-16 text-center md:px-10">
              <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-4 py-2 text-xs text-muted-foreground backdrop-blur-xl">
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
                  className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-all duration-200 hover:scale-[1.01] hover:bg-primary/90"
                >
                  Réserver une démo
                </Link>
                <Link
                  href="/pricing"
                  className="inline-flex items-center justify-center rounded-full border border-border bg-card/80 px-6 py-3 text-sm font-semibold transition-all duration-200 hover:bg-accent"
                >
                  Voir les tarifs
                </Link>
              </div>
            </div>

            <div className="relative z-10 mx-auto grid w-full max-w-7xl gap-4 px-6 pb-8 text-xs text-muted-foreground md:grid-cols-[1fr_auto_1fr] md:px-10">
              <div className="hidden items-center gap-3 md:flex">
                <span>Scroll</span>
                <span className="h-px flex-1 bg-border" />
                <span>pour découvrir</span>
              </div>
              <div className="mx-auto grid h-8 w-8 place-items-center rounded-full border border-border bg-card/70">
                <Headphones size={14} />
              </div>
              <div className="hidden items-center gap-3 md:flex">
                <span className="h-px flex-1 bg-border" />
                <span>pilotage temps réel</span>
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
      </SignedOut>
    </div>
  );
}
