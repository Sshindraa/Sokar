import type { Metadata } from 'next';
import Link from 'next/link';

// Brouillon : la page reste non indexable et hors sitemap tant que la preuve vocale (VOICE-01) et le
// parcours de démonstration ne sont pas qualifiés. La publication retire `robots` et ajoute la route au
// sitemap et au maillage.
export const metadata: Metadata = {
  title: 'Assistant téléphonique pour restaurant — Sokar',
  description:
    'Un assistant téléphonique pour votre restaurant : il répond aux appels que vous lui transférez et enregistre les réservations.',
  alternates: { canonical: '/solutions/assistant-telephonique-restaurant' },
  robots: { index: false, follow: true },
};

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
    question: 'Les réservations rejoignent-elles mon logiciel actuel ?',
    answer:
      'Elles sont enregistrées dans le carnet Sokar, avec les réservations en ligne. Si vous utilisez un autre logiciel, vérifiez avec nous votre organisation avant activation : une synchronisation avec Zenchef, TheFork ou votre caisse n’est pas annoncée comme disponible.',
  },
  {
    question: 'Peut-il prendre les commandes à emporter ou répondre sur les allergènes ?',
    answer:
      'Cette page présente la réservation de tables. Les commandes à emporter ne font pas partie de ce parcours. Une demande sur les allergènes ou une information non renseignée doit être vérifiée par votre équipe ; ne l’utilisez pas comme réponse automatique garantie.',
  },
  {
    question: "Que se passe-t-il si l'assistant ne sait pas répondre ?",
    answer:
      'Les demandes hors des règles de réservation doivent revenir à votre équipe. Le transfert dépend du numéro de secours et de sa configuration : nous le vérifions avec vous avant activation.',
  },
  {
    question: 'Puis-je reprendre la main ?',
    answer:
      'Vous pouvez désactiver le renvoi depuis votre ligne. Une fois un appel renvoyé, la reprise dépend du transfert configuré ; elle doit être vérifiée lors de votre essai.',
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
            href="/demo?source=assistant-telephonique"
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
        <h2 className="text-2xl font-bold tracking-tight text-foreground">
          Voir le parcours avant de vous équiper
        </h2>
        <div className="rounded-2xl border border-border bg-card p-6 text-sm leading-6 text-muted-foreground">
          <p>
            La vitrine présente une simulation visuelle du parcours appel et réservation. Elle
            illustre l’interface ; ce n’est ni un appel réel ni un résultat client.
          </p>
          <Link
            href="/#demo"
            className="mt-4 inline-block font-semibold text-foreground underline underline-offset-4 transition-all duration-200"
          >
            Voir la simulation de l’accueil
          </Link>
          <p className="mt-4">
            Pour vérifier la voix, les disponibilités et le résultat dans le carnet Sokar sur votre
            situation, demandez une démonstration à Hamza. Aucun délai de réponse n’est annoncé.
          </p>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground">Ce que l&apos;assistant fait</h2>
          <ul className="mt-4 space-y-2 text-sm leading-6 text-muted-foreground">
            <li>Répond aux demandes de réservation</li>
            <li>Propose les créneaux disponibles</li>
            <li>Enregistre le créneau et le nombre de couverts dans le carnet Sokar</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-semibold text-foreground">Ce qu&apos;il ne fait pas</h2>
          <ul className="mt-4 space-y-2 text-sm leading-6 text-muted-foreground">
            <li>
              Les informations pratiques dépendent des consignes renseignées et de leur activation
            </li>
            <li>Il ne remplace pas votre jugement sur une demande particulière</li>
          </ul>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">
          Préparer votre service
        </h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
          <li>Renseigner vos horaires, services, durée des repas et règles de réservation</li>
          <li>Faire attribuer votre numéro Sokar et définir un numéro de secours</li>
          <li>Renvoi depuis votre ligne actuelle</li>
          <li>Passer un appel de test et vérifier la réservation dans le carnet Sokar</li>
          <li>Activation du tableau de bord</li>
        </ol>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Tarifs</h2>
        <div className="rounded-2xl border border-border bg-card p-6 text-sm leading-6 text-muted-foreground">
          <p>
            Comparez les offres et les minutes d’appel incluses sur la page tarifs. La formule
            dépend de votre organisation et de vos besoins.
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
          href="/demo?source=assistant-telephonique"
          className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-all duration-200 hover:opacity-90"
        >
          Demander une démonstration
        </Link>
      </section>
    </main>
  );
}
