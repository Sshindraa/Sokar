import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft, ArrowUpRight, Mail } from 'lucide-react';
import { AI_ASSISTANTS_METADATA } from '@/app/marketing-metadata';

export const metadata = AI_ASSISTANTS_METADATA;

/** Adresse du serveur MCP de production, à coller dans l'assistant. */
const MCP_URL = 'https://api.sokar.tech/mcp';

const ASSISTANTS = [
  {
    name: 'Claude',
    steps: [
      'Ouvrez Paramètres, puis Connecteurs.',
      'Choisissez « Ajouter un connecteur personnalisé ».',
      `Nommez-le Sokar et collez l’adresse ${MCP_URL}.`,
      'Connectez-vous : Sokar vous demande d’autoriser la lecture, la réservation et l’annulation.',
    ],
  },
  {
    name: 'ChatGPT',
    steps: [
      'Ouvrez Paramètres, puis Applications et connecteurs.',
      'Activez le mode développeur dans les paramètres avancés, puis créez un connecteur.',
      `Nommez-le Sokar, collez l’adresse ${MCP_URL} et choisissez l’authentification OAuth.`,
      'Autorisez Sokar dans la fenêtre qui s’ouvre.',
    ],
    note: 'La disponibilité des connecteurs dépend de votre offre ChatGPT et de votre pays.',
  },
  {
    name: 'Le Chat (Mistral)',
    steps: [
      'Ouvrez Connecteurs, puis « Ajouter un connecteur ».',
      'Choisissez l’onglet « Connecteur MCP personnalisé ».',
      `Nommez-le Sokar, collez l’adresse ${MCP_URL} et choisissez OAuth.`,
      'Autorisez Sokar dans la fenêtre qui s’ouvre.',
    ],
  },
];

const EXAMPLES = [
  'Trouvez-moi une table pour 4 vendredi soir vers 20 h à Lyon.',
  'Est-ce que ce restaurant a de la place samedi midi pour 2 ?',
  'Réservez à 19 h 30 au nom de Martin, mon numéro est le 06 12 34 56 78.',
  'Décalez ma réservation de demain à 20 h 30.',
  'Annulez ma réservation de ce soir.',
];

const TOOLS = [
  ['Rechercher un restaurant', 'Lecture', 'Restaurants qui acceptent les réservations par IA'],
  ['Consulter un restaurant', 'Lecture', 'Adresse, cuisine, horaires, taille de groupe acceptée'],
  ['Vérifier les disponibilités', 'Lecture', 'Créneaux libres et alternatives proches'],
  ['Garder un créneau', 'Écriture', 'Bloque la table quelques minutes pendant la confirmation'],
  ['Créer une réservation', 'Écriture', 'Avec votre accord explicite, nom et téléphone'],
  ['Modifier une réservation', 'Écriture', 'Heure ou nombre de personnes'],
  ['Annuler une réservation', 'Écriture', 'Annulation immédiate, le créneau est libéré'],
  ['Consulter une réservation', 'Lecture', 'Sur présentation du numéro utilisé à la réservation'],
  ['Liste d’attente', 'Écriture', 'Inscription et désinscription quand c’est complet'],
];

const SECTIONS = [
  { id: 'principe', label: 'Le principe' },
  { id: 'connecter', label: 'Connecter Sokar' },
  { id: 'exemples', label: 'Exemples' },
  { id: 'donnees', label: 'Vos données' },
  { id: 'restaurants', label: 'Pour les restaurants' },
  { id: 'reference', label: 'Référence technique' },
  { id: 'english', label: 'In English' },
];

export default function AiAssistantsPage() {
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
          Assistants IA
        </p>
        <h1 className="mt-4 max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          Réservez une table depuis Claude, ChatGPT ou Le Chat
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
          Connectez Sokar à votre assistant IA : il trouve un restaurant, vérifie les places et
          réserve pour vous, sans quitter la conversation.
        </p>
      </div>

      <div className="grid items-start gap-10 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16">
        <aside className="lg:sticky lg:top-8">
          <nav aria-label="Sommaire" className="rounded-2xl border border-border p-4">
            <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Sur cette page
            </p>
            <div className="grid gap-1 sm:grid-cols-3 lg:grid-cols-1">
              {SECTIONS.map(({ id, label }) => (
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
            <p className="text-sm font-medium">Support</p>
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
          aria-label="Réserver depuis un assistant IA"
          className="min-w-0 max-w-3xl space-y-10 text-sm leading-7 sm:text-base sm:leading-7"
        >
          <Section id="principe" number="01" title="Le principe">
            <p className="text-muted-foreground">
              Sokar est le chef de rang numérique des restaurants qui l’utilisent. Il publie leurs
              disponibilités réelles auprès des assistants IA grâce au protocole MCP (Model Context
              Protocol). Une réservation faite dans la conversation arrive directement dans le
              planning du restaurant, comme une réservation par téléphone ou sur son site.
            </p>
            <p className="mt-4 text-muted-foreground">
              Seuls les restaurants qui ont choisi d’être réservables par IA apparaissent.
            </p>
          </Section>

          <Section id="connecter" number="02" title="Connecter Sokar">
            <div className="rounded-2xl border border-border bg-muted/50 p-4 sm:p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Adresse du connecteur
              </p>
              <code className="mt-2 block break-all text-base font-semibold">{MCP_URL}</code>
            </div>
            <div className="mt-6 grid gap-4">
              {ASSISTANTS.map((assistant) => (
                <div key={assistant.name} className="rounded-2xl border border-border p-5 sm:p-6">
                  <h3 className="font-semibold">{assistant.name}</h3>
                  <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-muted-foreground">
                    {assistant.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                  {assistant.note && (
                    <p className="mt-3 text-sm text-muted-foreground">{assistant.note}</p>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Les intitulés des menus peuvent varier selon la version de l’assistant.
            </p>
          </Section>

          <Section id="exemples" number="03" title="Exemples">
            <ul className="space-y-2">
              {EXAMPLES.map((example) => (
                <li
                  key={example}
                  className="rounded-xl border border-border px-4 py-3 text-muted-foreground"
                >
                  « {example} »
                </li>
              ))}
            </ul>
            <p className="mt-4 text-muted-foreground">
              Avant de réserver, l’assistant vous montre le créneau et vous demande votre accord. La
              réservation arrive aussitôt dans le planning du restaurant.
            </p>
          </Section>

          <Section id="donnees" number="04" title="Vos données">
            <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
              <li>
                Pour réserver, Sokar a besoin de votre nom, de votre numéro de téléphone et du
                nombre de personnes. Ces informations sont transmises au seul restaurant choisi.
              </li>
              <li>
                Votre numéro sert aussi de preuve : sans lui, personne ne peut consulter, modifier
                ou annuler votre réservation depuis un assistant.
              </li>
              <li>Aucune utilisation marketing sans votre accord explicite.</li>
              <li>
                Vous pouvez retirer l’accès à Sokar à tout moment depuis les réglages de votre
                assistant.
              </li>
            </ul>
            <p className="mt-4 text-muted-foreground">
              Le détail figure dans notre{' '}
              <Link
                href="/privacy"
                className="text-foreground underline underline-offset-4 transition-all duration-200 hover:opacity-70"
              >
                politique de confidentialité
              </Link>
              .
            </p>
          </Section>

          <Section id="restaurants" number="05" title="Pour les restaurants">
            <p className="text-muted-foreground">
              La réservation par IA s’active dans votre espace Sokar, à l’étape de diffusion en
              ligne. Vous gardez la main : taille de groupe maximale, délai minimum avant le service
              et validation manuelle si vous le souhaitez. Les réservations arrivent dans votre
              planning, avec leur canal visible sur la page Pilotage.
            </p>
            <Link
              href="/demo"
              className="mt-4 inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4 transition-all duration-200 hover:opacity-70"
            >
              Demander une démonstration
              <ArrowUpRight size={13} aria-hidden="true" />
            </Link>
          </Section>

          <Section id="reference" number="06" title="Référence technique">
            <dl className="divide-y divide-border rounded-2xl border border-border px-5 sm:px-6">
              {[
                ['Transport', 'MCP, JSON-RPC 2.0 sur HTTPS (POST /mcp)'],
                ['Authentification', 'OAuth 2.0 avec PKCE (S256), enregistrement dynamique'],
                ['Autorisations', 'mcp:read (lecture), mcp:reserve, mcp:cancel'],
                ['Découverte', 'https://api.sokar.tech/.well-known/oauth-protected-resource'],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="grid gap-1 py-4 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-4"
                >
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="break-words text-sm font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-6 overflow-x-auto rounded-2xl border border-border">
              <table className="w-full border-collapse text-left text-sm">
                <caption className="sr-only">Outils exposés par le connecteur Sokar</caption>
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="p-3 font-semibold md:p-4">
                      Outil
                    </th>
                    <th scope="col" className="p-3 font-semibold md:p-4">
                      Type
                    </th>
                    <th scope="col" className="p-3 font-semibold md:p-4">
                      Rôle
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {TOOLS.map(([tool, kind, role]) => (
                    <tr key={tool} className="border-b border-border last:border-0">
                      <th scope="row" className="p-3 font-medium md:p-4">
                        {tool}
                      </th>
                      <td className="p-3 text-muted-foreground md:p-4">{kind}</td>
                      <td className="p-3 text-muted-foreground md:p-4">{role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="english" number="07" title="In English">
            <p className="text-muted-foreground">
              Sokar lets you book a table at participating restaurants from Claude, ChatGPT or Le
              Chat. Add a custom connector with the URL <code>{MCP_URL}</code> and sign in with
              OAuth. You can search restaurants, check availability, book, modify or cancel a
              booking, and join a waiting list. Booking requires your name and phone number, which
              are shared only with the chosen restaurant; the phone number is also required to read,
              change or cancel a booking. Support: hello@sokar.tech. Privacy policy:
              https://sokar.tech/privacy.
            </p>
          </Section>
        </article>
      </div>
    </main>
  );
}

function Section({
  id,
  number,
  title,
  children,
}: {
  id: string;
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-8 border-b border-border pb-10 last:border-0"
    >
      <div className="mb-5 flex items-baseline gap-3">
        <span className="text-xs font-semibold tabular-nums text-muted-foreground">{number}</span>
        <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight sm:text-xl">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}
