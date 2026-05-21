import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-[var(--border)]">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="text-xl font-bold text-[var(--primary)]">Sokar</Link>
          <nav className="flex items-center gap-6">
            <Link href="/login" className="text-sm font-medium text-[var(--muted-foreground)]">Connexion</Link>
            <Link href="/register" className="rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white">Démarrer</Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <section className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
          <div className="text-center">
            <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
              Votre assistant vocal <span className="text-[var(--primary)]">24h/24</span> pour votre restaurant
            </h1>
            <p className="mt-6 text-lg leading-8 text-[var(--muted-foreground)]">
              Sokar répond à vos appels, prend les réservations et vous offre un tableau de bord complet.
            </p>
            <div className="mt-10 flex items-center justify-center gap-4">
              <Link href="/register" className="rounded-full bg-[var(--primary)] px-8 py-3 text-sm font-semibold text-white">Essai gratuit</Link>
              <Link href="/login" className="rounded-full border border-[var(--border)] px-8 py-3 text-sm font-semibold">Connexion</Link>
            </div>
          </div>
        </section>
        <section className="border-t border-[var(--border)] py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-8 sm:grid-cols-3">
              {[
                { title: '149 € / mois', desc: "Essential — Assistant vocal complet." },
                { title: 'Sans TheFork', desc: "Économisez jusqu'à 1 800 €/mois." },
                { title: 'Réservations 24/7', desc: "Ne perdez plus d'appels." },
              ].map((item) => (
                <div key={item.title} className="rounded-xl border border-[var(--border)] p-6">
                  <h3 className="text-lg font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm text-[var(--muted-foreground)]">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
      <footer className="border-t border-[var(--border)] py-6">
        <div className="mx-auto max-w-7xl px-4 text-center text-sm text-[var(--muted-foreground)]">
          &copy; Sokar.
        </div>
      </footer>
    </div>
  );
}
