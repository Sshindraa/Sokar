import Link from 'next/link';
import { SignedIn, SignedOut } from '@clerk/nextjs';

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Un client connecté voit un CTA vers le dashboard au lieu de la landing */}
      <SignedIn>
        <main className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight">
              Vous êtes connecté
            </h1>
            <p className="mt-2 text-muted-foreground">
              Accédez à votre tableau de bord pour gérer vos réservations et appels.
            </p>
            <Link
              href="/dashboard"
              className="mt-6 inline-flex items-center rounded-full bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition-all duration-200 hover:bg-primary/90"
            >
              Accéder au tableau de bord
            </Link>
          </div>
        </main>
      </SignedIn>
      <SignedOut>
        <main className="flex-1">
          <section className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
            <div className="text-center">
              <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
                Votre assistant vocal <span className="text-primary">24h/24</span> pour votre restaurant
              </h1>
              <p className="mt-6 text-lg leading-8 text-muted-foreground">
                Sokar répond à vos appels, prend les réservations et vous offre un tableau de bord complet.
              </p>
              <div className="mt-10 flex items-center justify-center gap-4">
                <Link href="/register" className="rounded-full bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition-all duration-200 hover:bg-primary/90">
                  Essai gratuit
                </Link>
                <Link href="/pricing" className="rounded-full border border-border px-8 py-3 text-sm font-semibold transition-all duration-200 hover:bg-muted">
                  Voir les tarifs
                </Link>
              </div>
            </div>
          </section>
          <section className="border-t border-border py-16">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="grid gap-8 sm:grid-cols-3">
                {[
                  { title: 'Assistant vocal 24h/24', desc: "Ne manquez plus jamais un appel. Sokar répond, prend les réservations et gère les demandes." },
                  { title: 'Réservations intelligentes', desc: "Gérez votre carnet de réservations sans TheFork. Économisez jusqu'à 1 800 €/mois de commissions." },
                  { title: 'CRM clients', desc: "Gardez l'historique de vos clients, leurs préférences et gérez les relations facilement." },
                ].map((item) => (
                  <div key={item.title} className="rounded-xl border border-border p-6 transition-all duration-200 hover:shadow-md">
                    <h3 className="text-lg font-semibold">{item.title}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </main>
        <footer className="border-t border-border py-6">
          <div className="mx-auto max-w-7xl px-4 text-center text-sm text-muted-foreground">
            &copy; Sokar.
          </div>
        </footer>
      </SignedOut>
    </div>
  );
}
