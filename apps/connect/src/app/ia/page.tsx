/**
 * Sokar Connect — Page /ia
 *
 * Landing page pour les utilisateurs à l'aise avec les IA qui veulent
 * réserver directement via ChatGPT, Claude, ou Mistral sans passer
 * par la page web.
 *
 * 3 sections :
 * 1. Pitch : pourquoi connecter Sokar à votre IA
 * 2. Config : instructions step-by-step pour ChatGPT, Claude, Mistral
 * 3. Exemples : ce que vous pouvez dire à votre IA une fois configuré
 *
 * Page statique (○, pas de ƒ) — aucun fetch, aucun state.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Sokar x IA — Réservez avec ChatGPT, Claude et Mistral',
  description:
    "Connectez Sokar à votre assistant IA et réservez dans n'importe quel restaurant du réseau directement depuis la conversation. Configuration en 2 minutes.",
  robots: { index: true, follow: true },
  alternates: { canonical: '/ia' },
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'https://api.sokar.tech';

export default function IaPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      {/* ─── Hero ─── */}
      <div className="space-y-4">
        <div className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
          Pour les utilisateurs avancés
        </div>
        <h1 className="text-3xl font-bold text-ink sm:text-4xl">
          Réservez des restaurants avec votre IA
        </h1>
        <p className="text-lg text-muted-foreground">
          Sokar fonctionne avec ChatGPT, Claude et Mistral. Vous pouvez réserver une table
          directement dans la conversation, sans ouvrir de page web. Configuration en 2 minutes.
        </p>
      </div>

      {/* ─── Comment ça marche ─── */}
      <section className="mt-12 space-y-4">
        <h2 className="text-xl font-semibold text-ink">Comment ça marche</h2>
        <div className="space-y-3 text-muted-foreground">
          <p>
            Sokar expose un <strong className="text-ink">serveur MCP</strong> (Model Context
            Protocol) que votre assistant IA peut utiliser pour rechercher des restaurants, vérifier
            les disponibilités et créer des réservations — directement dans la conversation.
          </p>
          <p>
            Une fois configuré, vous pouvez dire « Réserve une table pour 4 chez Mario demain à 20h
            » et votre IA le fait. Pas de lien à cliquer, pas de formulaire à remplir.
          </p>
        </div>
      </section>

      {/* ─── Sans config (web crawl) ─── */}
      <section className="mt-10 rounded-lg border border-border bg-muted/30 p-6">
        <h2 className="text-lg font-semibold text-ink">Sans configuration : ça marche déjà</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Même sans configurer le MCP, votre IA peut trouver les restaurants Sokar. Si vous demandez
          « Trouve-moi un restaurant à Lyon », ChatGPT ou Perplexity trouvera les pages Sokar et
          vous donnera un lien de réservation pré-rempli. Le MCP rend l'expérience encore plus
          fluide en supprimant le clic.
        </p>
      </section>

      {/* ─── Configuration ─── */}
      <section className="mt-12 space-y-6">
        <h2 className="text-xl font-semibold text-ink">Configuration (2 minutes)</h2>

        {/* ChatGPT */}
        <div className="rounded-lg border border-border p-6">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-ink">
            <span className="text-2xl">💬</span> ChatGPT (OpenAI)
          </h3>
          <ol className="mt-4 space-y-3 text-sm text-muted-foreground">
            <li>
              <strong className="text-ink">1.</strong> Ouvrez ChatGPT → Paramètres → Connecteurs (ou
              « MCP Servers » selon la version).
            </li>
            <li>
              <strong className="text-ink">2.</strong> Cliquez « Ajouter un connecteur » et collez
              cette URL :
              <pre className="mt-2 overflow-x-auto rounded bg-muted p-3 text-xs text-ink">
                <code>{API_URL}/mcp</code>
              </pre>
            </li>
            <li>
              <strong className="text-ink">3.</strong> ChatGPT vous redirige vers une page
              d'autorisation Sokar. Connectez-vous (ou créez un compte) et autorisez l'accès.
            </li>
            <li>
              <strong className="text-ink">4.</strong> C'est prêt. Demandez à ChatGPT : « Cherche un
              restaurant à Lyon pour 4 personnes demain à 20h. »
            </li>
          </ol>
        </div>

        {/* Claude */}
        <div className="rounded-lg border border-border p-6">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-ink">
            <span className="text-2xl">🤖</span> Claude (Anthropic)
          </h3>
          <ol className="mt-4 space-y-3 text-sm text-muted-foreground">
            <li>
              <strong className="text-ink">1.</strong> Ouvrez Claude Desktop → Paramètres →
              Developer → Edit Config.
            </li>
            <li>
              <strong className="text-ink">2.</strong> Ajoutez Sokar dans la section{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">mcpServers</code> :
              <pre className="mt-2 overflow-x-auto rounded bg-muted p-3 text-xs text-ink">
                <code>{`{
  "mcpServers": {
    "sokar": {
      "url": "${API_URL}/mcp"
    }
  }
}`}</code>
              </pre>
            </li>
            <li>
              <strong className="text-ink">3.</strong> Redémarrez Claude Desktop. Au premier appel,
              Claude vous demandera d'autoriser Sokar.
            </li>
            <li>
              <strong className="text-ink">4.</strong> C'est prêt. Demandez à Claude : « Réserve une
              table pour 2 chez Mario vendredi à 19h30. »
            </li>
          </ol>
        </div>

        {/* Mistral */}
        <div className="rounded-lg border border-border p-6">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-ink">
            <span className="text-2xl">🇫🇷</span> Mistral Le Chat
          </h3>
          <ol className="mt-4 space-y-3 text-sm text-muted-foreground">
            <li>
              <strong className="text-ink">1.</strong> Ouvrez Le Chat → Paramètres → Connecteurs /
              MCP.
            </li>
            <li>
              <strong className="text-ink">2.</strong> Ajoutez un nouveau serveur MCP avec l'URL :
              <pre className="mt-2 overflow-x-auto rounded bg-muted p-3 text-xs text-ink">
                <code>{API_URL}/mcp</code>
              </pre>
            </li>
            <li>
              <strong className="text-ink">3.</strong> Autorisez Sokar quand Le Chat vous le
              demande.
            </li>
            <li>
              <strong className="text-ink">4.</strong> C'est prêt. Demandez à Le Chat : « Trouve-moi
              un bistrot à Lyon et réserve pour 3 personnes ce soir. »
            </li>
          </ol>
        </div>
      </section>

      {/* ─── Exemples ─── */}
      <section className="mt-12 space-y-4">
        <h2 className="text-xl font-semibold text-ink">Ce que vous pouvez dire</h2>
        <div className="space-y-3">
          {[
            '« Cherche un restaurant italien à Lyon pour 4 personnes vendredi soir. »',
            '« Réserve une table chez Mario pour 2 personnes demain à 20h. »',
            '« Quels restaurants sont disponibles à Paris pour 6 personnes samedi midi ? »',
            '« Annule ma réservation de chez Mario. »',
            '« Vérifie le statut de ma réservation chez Mario. »',
          ].map((example) => (
            <div
              key={example}
              className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm italic text-muted-foreground"
            >
              {example}
            </div>
          ))}
        </div>
      </section>

      {/* ─── Sécurité ─── */}
      <section className="mt-12 space-y-3">
        <h2 className="text-xl font-semibold text-ink">Sécurité et confidentialité</h2>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>
            • L'IA ne peut <strong className="text-ink">jamais</strong> réserver sans votre
            consentement explicite dans la conversation.
          </li>
          <li>
            • Votre numéro de téléphone est obligatoire pour une réservation (format E.164, ex :
            +33612345678).
          </li>
          <li>• Vous pouvez révoquer l'accès à tout moment depuis votre compte Sokar.</li>
          <li>
            • Sokar ne partage jamais vos données avec l'IA au-delà de ce qui est nécessaire pour la
            réservation.
          </li>
        </ul>
      </section>

      {/* ─── CTA ─── */}
      <section className="mt-12 rounded-lg bg-primary/5 p-6 text-center">
        <p className="text-lg font-medium text-ink">Pas envie de configurer ?</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Vous pouvez toujours réserver directement sur la page du restaurant.
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex items-center rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-all duration-200 hover:bg-primary/90"
        >
          Trouver un restaurant
        </Link>
      </section>
    </main>
  );
}
