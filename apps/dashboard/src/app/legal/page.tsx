import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, Mail } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Mentions légales — Sokar',
  description: 'Informations sur Sokar, ses contacts et son hébergement.',
  alternates: { canonical: '/legal' },
  robots: { index: false, follow: true },
};

/** Préparation locale : identification légale à finaliser avant livraison. */
export default function LegalPage() {
  return (
    <main
      id="main-content"
      className="mx-auto min-h-screen max-w-6xl px-5 pb-16 pt-28 text-foreground sm:px-8 sm:pt-32"
    >
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-all duration-200 hover:text-foreground"
      >
        <ArrowLeft size={14} aria-hidden="true" />
        Retour à l’accueil
      </Link>
      <div className="pb-10 pt-12 sm:pb-12 sm:pt-16">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Informations légales
        </p>
        <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          Mentions légales
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
          Les informations sur Sokar, son hébergement et les moyens de nous contacter.
        </p>
      </div>
      <div className="grid items-start gap-10 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16">
        <aside className="lg:sticky lg:top-8">
          <nav
            aria-label="Sommaire des mentions légales"
            className="rounded-2xl border border-border p-4"
          >
            <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Sur cette page
            </p>
            <div className="grid gap-1 sm:grid-cols-3 lg:grid-cols-1">
              {[
                { id: 'sokar', label: 'À propos de Sokar' },
                { id: 'hebergement', label: 'Hébergement' },
                { id: 'donnees', label: 'Données personnelles' },
              ].map(({ id, label }) => (
                <a
                  key={id}
                  href={`#${id}`}
                  className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-all duration-200 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {label}
                </a>
              ))}
            </div>
          </nav>
          <div className="mt-4 rounded-2xl bg-muted p-5">
            <Mail size={17} className="mb-3 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">Nous contacter</p>
            <a
              href="mailto:hello@sokar.tech"
              className="mt-2 inline-flex items-center gap-1 text-sm underline underline-offset-4 transition-all duration-200 hover:opacity-70"
            >
              hello@sokar.tech
              <ArrowUpRight size={13} aria-hidden="true" />
            </a>
          </div>
        </aside>
        <article
          aria-label="Mentions légales"
          className="min-w-0 max-w-3xl space-y-10 text-sm leading-7 sm:text-base sm:leading-7"
        >
          <aside
            aria-label="Statut des informations"
            className="rounded-2xl border border-border bg-muted/50 p-5 sm:p-6"
          >
            <p className="text-sm font-semibold">Informations en cours de finalisation</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Les informations d’identification de l’éditeur et de la direction de publication ne
              sont pas complètes. Cette page ne constitue pas des mentions légales finalisées.
            </p>
          </aside>
          <section
            id="sokar"
            aria-labelledby="sokar-title"
            className="scroll-mt-8 border-b border-border pb-10"
          >
            <SectionHeading id="sokar-title" number="01">
              À propos de Sokar
            </SectionHeading>
            <p className="text-muted-foreground">
              Sokar est le nom commercial du service de gestion des appels et des réservations pour
              restaurants.
            </p>
            <p className="mt-4 text-muted-foreground">
              Adresse de l’établissement : 9 rue Vaubecour, 69002 Lyon.
            </p>
            <p className="mt-4 text-muted-foreground">
              Contact général :{' '}
              <a
                href="mailto:hello@sokar.tech"
                className="text-foreground underline underline-offset-4 transition-all duration-200 hover:opacity-70"
              >
                hello@sokar.tech
              </a>
            </p>
          </section>
          <section
            id="hebergement"
            aria-labelledby="hebergement-title"
            className="scroll-mt-8 border-b border-border pb-10"
          >
            <SectionHeading id="hebergement-title" number="02">
              Hébergement
            </SectionHeading>
            <dl className="divide-y divide-border rounded-2xl border border-border px-5 sm:px-6">
              {[
                ['Hébergeur', 'OVH SAS (OVHcloud)'],
                ['Adresse', '2 rue Kellermann, 59100 Roubaix, France.'],
                ['Depuis la France', '1007'],
                ['Depuis l’étranger', '+33 9 72 10 10 07'],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="grid gap-1 py-4 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-4"
                >
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="text-sm font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section id="donnees" aria-labelledby="donnees-title" className="scroll-mt-8">
            <SectionHeading id="donnees-title" number="03">
              Données personnelles
            </SectionHeading>
            <p className="text-muted-foreground">
              Consultez notre{' '}
              <a
                href="/privacy"
                className="text-foreground underline underline-offset-4 transition-all duration-200 hover:opacity-70"
              >
                politique de confidentialité
              </a>{' '}
              pour comprendre comment vos données sont utilisées.
            </p>
            <p className="mt-4 text-muted-foreground">
              Pour une demande concernant vos données :{' '}
              <a
                href="mailto:privacy@sokar.tech"
                className="text-foreground underline underline-offset-4 transition-all duration-200 hover:opacity-70"
              >
                privacy@sokar.tech
              </a>
              .
            </p>
          </section>
        </article>
      </div>
    </main>
  );
}

function SectionHeading({
  id,
  number,
  children,
}: {
  id: string;
  number: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <span aria-hidden="true" className="mt-0.5 font-mono text-xs text-muted-foreground">
        {number}
      </span>
      <h2 id={id} className="text-lg font-semibold tracking-tight sm:text-xl">
        {children}
      </h2>
    </div>
  );
}
