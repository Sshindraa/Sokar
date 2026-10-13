import type { Metadata } from 'next';
import Link from 'next/link';
import { PLAN_PRICES_EUR } from '@sokar/shared';

// Brouillon : la page reste non indexable et hors sitemap tant que la preuve vocale (VOICE-01) et le
// parcours de démonstration ne sont pas qualifiés. La publication retire `robots` et ajoute la route au
// sitemap et au maillage.
export const metadata: Metadata = {
  title: 'Assistant téléphonique pour restaurant — Sokar',
  description:
    'Un assistant téléphonique pour votre restaurant : il répond aux appels que vous lui transférez et enregistre les réservations.',
  alternates: { canonical: '/solutions/assistant-telephonique-restaurant' },
  robots: { index: false, follow: false },
};

const ESSENTIAL_PRICE = PLAN_PRICES_EUR.ESSENTIAL;
const ESSENTIAL_MONTHLY = ESSENTIAL_PRICE == null ? null : `${ESSENTIAL_PRICE}\u00a0€\u00a0HT/mois`;
const ESSENTIAL_ANNUAL_MONTHLY =
  ESSENTIAL_PRICE == null
    ? null
    : `${(ESSENTIAL_PRICE * 0.8).toFixed(2).replace('.', ',')}\u00a0€\u00a0HT/mois`;

const STEPS = [
  {
    title: 'Vous transférez',
    text: 'Le renvoi part de votre ligne actuelle vers le numéro dédié Sokar.',
  },
  {
    title: "L'assistant répond",
    text: 'Il comprend la demande, vérifie les disponibilités de votre établissement et propose un créneau.',
  },
  {
    title: 'La réservation apparaît',
    text: 'Elle est enregistrée dans votre tableau de bord, avec son créneau et son effectif.',
  },
];

const FAQ = [
  {
    question: "Que se passe-t-il si l'assistant ne sait pas répondre ?",
    answer:
      "Il ne donne pas d'information non vérifiée. Selon la configuration, il transfère l'appel ou transmet la demande.",
  },
  {
    question: 'Puis-je reprendre la main ?',
    answer: 'Oui. Vous décrochez à tout moment, ou désactivez le renvoi depuis votre ligne.',
  },
  {
    question: 'Le numéro de mon restaurant change-t-il ?',
    answer: 'Non. Vous gardez votre numéro et transférez vos appels vers le numéro dédié Sokar.',
  },
  {
    question: 'Quelles données sont enregistrées ?',
    answer:
      'Les informations nécessaires à la réservation. Le détail figure dans la politique de confidentialité.',
  },
];

export default function VoiceSolutionPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-16 px-4 pb-20 pt-32 sm:px-6">
      <header className="space-y-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Assistant téléphonique
        </p>
        <h1 className="text-4xl font-bold tracking-tight text-foreground md:text-5xl">
          Un assistant téléphonique pour votre restaurant
        </h1>
        <p className="max-w-2xl text-base leading-7 text-muted-foreground">
          Pendant le service, personne ne peut décrocher. Sokar répond aux appels que vous lui
          transférez, propose un créneau disponible et enregistre la réservation dans votre tableau
          de bord.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/demo"
            className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-all duration-200 hover:opacity-90"
          >
            Demander une démonstration
          </Link>
          <Link
            href="/pricing"
            className="inline-flex items-center justify-center rounded-full border border-border px-6 py-3 text-sm font-semibold text-foreground transition-all duration-200 hover:bg-secondary"
          >
            Voir les tarifs
          </Link>
        </div>
      </header>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">
          Quand l&apos;équipe est en salle, personne ne décroche
        </h2>
        <p className="max-w-2xl text-base leading-7 text-muted-foreground">
          Pendant le service, les appels arrivent sans personne pour y répondre. Sokar prend le
          relais sur les appels que vous lui transférez, depuis votre ligne actuelle.
        </p>
      </section>

      <section className="space-y-6">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Comment ça marche</h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map((step) => (
            <li
              key={step.title}
              className="rounded-2xl border border-border bg-card p-6 transition-all duration-200"
            >
              <h3 className="text-lg font-semibold text-foreground">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Écouter un appel</h2>
        <div
          data-testid="voice-proof-slot"
          className="rounded-2xl border border-dashed border-border bg-card/60 p-6 text-sm leading-6 text-muted-foreground"
        >
          Exemple d&apos;appel : audio et transcription publiés après la qualification de la
          démonstration vocale.
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground">Ce que l&apos;assistant fait</h2>
          <ul className="mt-4 space-y-2 text-sm leading-6 text-muted-foreground">
            <li>Répond aux demandes de réservation</li>
            <li>Propose les créneaux disponibles</li>
            <li>Confirme la réservation avant de raccrocher</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground">Ce qu&apos;il ne fait pas</h2>
          <ul className="mt-4 space-y-2 text-sm leading-6 text-muted-foreground">
            <li>Il ne donne pas d&apos;information qu&apos;il ne peut pas vérifier</li>
            <li>Il ne remplace pas votre jugement sur une demande particulière</li>
          </ul>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">
          Installation en quatre étapes
        </h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
          <li>Attribution d&apos;un numéro dédié</li>
          <li>Renvoi depuis votre ligne actuelle</li>
          <li>Appel de test</li>
          <li>Activation du tableau de bord</li>
        </ol>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Tarifs</h2>
        <div className="rounded-2xl border border-border bg-card p-6 text-sm leading-6 text-muted-foreground">
          <p>Essential : {ESSENTIAL_MONTHLY}</p>
          <p className="mt-2">
            En facturation annuelle : {ESSENTIAL_ANNUAL_MONTHLY}, engagement de 12 mois.
          </p>
          <Link
            href="/pricing"
            className="mt-4 inline-block font-semibold text-foreground underline"
          >
            Voir toutes les offres
          </Link>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Questions pratiques</h2>
        <div className="divide-y divide-border rounded-2xl border border-border bg-card">
          {FAQ.map((item) => (
            <details key={item.question} className="group p-6">
              <summary className="cursor-pointer list-none text-base font-semibold text-foreground">
                {item.question}
              </summary>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-border bg-card p-8 text-center">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">
          Voir Sokar sur votre situation
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Nous vous montrons le fonctionnement sur votre établissement.
        </p>
        <Link
          href="/demo"
          className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-all duration-200 hover:opacity-90"
        >
          Demander une démonstration
        </Link>
      </section>
    </main>
  );
}
