import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Mail, ShieldCheck } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Politique de confidentialité — Sokar',
  description:
    'Comment Sokar collecte, traite et protège les données personnelles, conformément au RGPD.',
  robots: { index: true, follow: true },
};

const LAST_UPDATED = '22 juillet 2026';

const COMPANY = {
  // [À REMPLIR] Raison sociale
  legalName: '[À REMPLIR — Raison sociale]',
  // [À REMPLIR] Forme juridique (SAS, SARL, SA…)
  legalForm: '[À REMPLIR — Forme juridique]',
  // [À REMPLIR] SIREN (9 chiffres)
  siren: '[À REMPLIR — SIREN 9 chiffres]',
  // [À REMPLIR] SIRET du siège (14 chiffres)
  siret: '[À REMPLIR — SIRET 14 chiffres]',
  // [À REMPLIR] Ville d'immatriculation RCS
  rcsCity: '[À REMPLIR — Ville RCS]',
  // [À REMPLIR] Capital social
  shareCapital: '[À REMPLIR — Capital social]',
  // [À REMPLIR] Adresse du siège social
  headquartersAddress: '[À REMPLIR — Adresse du siège social]',
  // [À REMPLIR] Prénom Nom du représentant légal
  legalRepresentative: '[À REMPLIR — Représentant légal]',
  // [À REMPLIR] Email de contact DPO/privacy
  dpoEmail: '[À REMPLIR — dpo@sokar.tech]',
  // Hébergeur principal : DigitalOcean, LLC (datacenter nyc1, USA)
  hostingProvider: 'DigitalOcean, LLC (datacenter nyc1, New York, USA)',
  // Localisation des serveurs = hors UE (USA)
  hostingLocation:
    'New York, États-Unis — transfert hors UE couvert par SCC et EU-US Data Privacy Framework',
};

// Sous-traitants : nom → finalité → localisation
const SUBPROCESSORS = [
  {
    name: 'Clerk',
    purpose: 'Authentification des utilisateurs et gestion des organisations.',
    location: 'États-Unis (clauses contractuelles types SCC signées).',
    status: 'DPA à formaliser',
  },
  {
    name: 'Telnyx',
    purpose: 'Téléphonie VoIP, acheminement des appels entrants et sortants.',
    location: 'États-Unis.',
    status: 'DPA à formaliser',
  },
  {
    name: 'Deepgram',
    purpose: 'Transcription vocale (speech-to-text) des appels.',
    location: 'États-Unis.',
    status: 'DPA à formaliser',
  },
  {
    name: 'Cartesia',
    purpose: "Synthèse vocale (text-to-speech) des réponses de l'assistant.",
    location: 'États-Unis.',
    status: 'DPA à formaliser',
  },
  {
    name: 'Stripe',
    purpose: 'Traitement des paiements par carte bancaire.',
    location: 'États-Unis / Irlande (UE).',
    status: 'DPA standard Stripe actif',
  },
  {
    name: 'Redis (auto-hébergé)',
    purpose: "Cache applicatif, files d'attente de jobs, sessions OAuth.",
    location: COMPANY.hostingLocation,
    status: 'Auto-hébergé',
  },
  {
    name: 'PostgreSQL (auto-hébergé)',
    purpose: 'Base de données principale.',
    location: COMPANY.hostingLocation,
    status: 'Auto-hébergé',
  },
];

// Catégories de données, finalités, base légale, durée
const DATA_CATEGORIES = [
  {
    category: 'Données de compte',
    examples: 'Email, prénom, nom, mot de passe (hashé bcrypt), organisation.',
    purpose: 'Création et gestion de votre compte Sokar.',
    legalBasis: 'Exécution du contrat (CGU).',
    retention: 'Durée du contrat + 3 ans (preuve de la relation commerciale).',
  },
  {
    category: 'Données de votre restaurant',
    examples: 'Nom, adresse, numéro SIREN, horaires, menu, personality, voice_id.',
    purpose: 'Fourniture du service de gestion et de réservation.',
    legalBasis: 'Exécution du contrat.',
    retention: 'Durée du contrat + 3 ans.',
  },
  {
    category: 'Données de vos clients finaux',
    examples: 'Nom, numéro de téléphone (E.164), adresse email, historique des réservations.',
    purpose:
      'Prise, gestion et annulation des réservations. Envoi de SMS de confirmation. Suivi des préférences (allergies, VIP).',
    legalBasis:
      'Exécution du contrat (prise de réservation) + consentement explicite (marketing, communications optionnelles).',
    retention:
      'Conservation tant que le client reste actif dans votre base + 3 ans après la dernière interaction. Export et effacement à votre demande.',
  },
  {
    category: "Enregistrements d'appels",
    examples: 'Audio des conversations téléphoniques, transcription textuelle.',
    purpose: 'Amélioration du service, contrôle qualité, gestion des litiges.',
    legalBasis:
      "Intérêt légitime (amélioration du service) — le client final est informé en début d'appel.",
    retention:
      "30 jours au maximum pour l'audio, puis suppression automatique du stockage privé. Transcription supprimée à l'effacement de la réservation.",
  },
  {
    category: 'Données de paiement',
    examples:
      "Derniers 4 chiffres de la carte, marque, date d'expiration. Le numéro complet est géré exclusivement par Stripe.",
    purpose: 'Facturation et recouvrement.',
    legalBasis: 'Exécution du contrat + obligations légales comptables.',
    retention: '10 ans (obligation comptable).',
  },
  {
    category: 'Logs techniques',
    examples: 'Adresse IP, user agent, horodatage, endpoint appelé.',
    purpose: 'Sécurité, débogage, détection des abus.',
    legalBasis: 'Intérêt légitime (sécurité du service).',
    retention: '90 jours.',
  },
];

const USER_RIGHTS = [
  {
    title: "Droit d'accès",
    body: 'Vous pouvez obtenir une copie de toutes les données personnelles que nous détenons sur vous et sur les clients de votre restaurant, dans un format structuré et lisible (JSON).',
  },
  {
    title: 'Droit de rectification',
    body: 'Vous pouvez corriger toute donnée inexacte ou incomplète directement depuis le dashboard, ou en nous contactant.',
  },
  {
    title: "Droit à l'effacement",
    body: "Vous pouvez demander la suppression d'une donnée ou d'un ensemble de données. L'effacement est irréversible et journalisé (événement `rgpd_erasure`).",
  },
  {
    title: 'Droit à la portabilité',
    body: "Vous pouvez exporter l'intégralité de vos données Sokar (réservations, clients, paramètres) à tout moment depuis Réglages → Données.",
  },
  {
    title: "Droit d'opposition",
    body: 'Vous pouvez vous opposer au traitement de vos données pour des raisons tenant à votre situation particulière, ou retirer votre consentement à tout moment.',
  },
  {
    title: 'Droit à la limitation',
    body: "Vous pouvez demander la suspension temporaire d'un traitement pendant que nous examinons une contestation.",
  },
];

const SECURITY_MEASURES = [
  'Chiffrement TLS 1.3 pour toutes les communications.',
  'Mots de passe hashés en bcrypt (cost factor 12).',
  'Authentification forte via Clerk (WebAuthn / 2FA disponibles).',
  'Tokens OAuth stockés en Redis opaque (chiffrés au repos), expiration automatique.',
  'Rate limiting sur tous les endpoints (60 req/60s par client, 10 req/min sur OAuth).',
  'PKCE S256 obligatoire pour tout client OAuth, méthode `plain` rejetée.',
  'CSRF tokens one-time sur tous les formulaires de consentement.',
  'PII redaction systématique dans les réponses du Model Context Protocol.',
  'Audit log horodaté pour les événements RGPD (export, effacement, consentement).',
  'Backups PostgreSQL chiffrés, restaurables, testés tous les 90 jours.',
  'Hébergeur DigitalOcean certifié ISO 27001, SOC 2 Type II et PCI DSS (Level 1).',
  'Code audité (interne) avant chaque release, scan automatisé des secrets.',
];

const COOKIES = [
  {
    name: '__session',
    purpose: 'Session Clerk authentifiée.',
    duration: 'Session navigateur (renouvelée à chaque connexion).',
    type: 'Strictement nécessaire',
  },
  {
    name: '__client_uat',
    purpose: 'Token Clerk inter-onglets.',
    duration: '1 heure.',
    type: 'Strictement nécessaire',
  },
  {
    name: '__stripe_mid',
    purpose: 'Prévention de fraude lors des paiements.',
    duration: '1 an.',
    type: 'Tiers (Stripe)',
  },
];

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      {/* ── HERO ──────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-white/8">
        <div className="absolute inset-0 liquid-field pointer-events-none" aria-hidden="true" />
        <div className="relative z-10 mx-auto max-w-4xl px-5 pb-16 pt-32 sm:px-8">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/8 px-4 py-2 text-[11px] font-semibold text-white/76 shadow-2xl shadow-black/20">
            <ShieldCheck size={13} />
            Politique de confidentialité
            <ArrowRight size={12} />
          </p>

          <h1 className="mt-7 text-[2.5rem] font-semibold leading-[0.98] tracking-tight text-white sm:text-5xl md:text-6xl font-display">
            Vos données, votre contrôle
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-sm leading-6 text-white/62 md:text-base">
            Sokar est conforme au RGPD. Cette politique décrit les données que nous collectons, leur
            finalité, leur durée de conservation, et les droits dont vous disposez.
          </p>

          <p className="mt-6 text-xs uppercase tracking-wider text-white/40">
            Dernière mise à jour : {LAST_UPDATED}
          </p>
        </div>
      </section>

      <main className="mx-auto max-w-3xl space-y-16 px-5 py-16 sm:px-8">
        {/* ── 1. RESPONSABLE DE TRAITEMENT ────────────────── */}
        <Section title="1. Responsable de traitement">
          <p>Le responsable du traitement des données personnelles collectées via Sokar est :</p>
          <DefList
            items={[
              { label: 'Société', value: `${COMPANY.legalName} (${COMPANY.legalForm})` },
              { label: 'SIREN', value: COMPANY.siren },
              { label: 'SIRET', value: COMPANY.siret },
              { label: 'Immatriculée au RCS de', value: COMPANY.rcsCity },
              { label: 'Capital social', value: COMPANY.shareCapital },
              { label: 'Siège social', value: COMPANY.headquartersAddress },
              { label: 'Représentant légal', value: COMPANY.legalRepresentative },
              { label: 'Contact privacy / DPO', value: COMPANY.dpoEmail },
            ]}
          />
        </Section>

        {/* ── 2. DONNÉES COLLECTÉES ───────────────────────── */}
        <Section title="2. Quelles données collectons-nous ?">
          <div className="mt-6 space-y-4">
            {DATA_CATEGORIES.map((d) => (
              <div
                key={d.category}
                className="rounded-2xl border border-white/8 bg-white/[0.02] p-6"
              >
                <h3 className="text-base font-semibold text-white">{d.category}</h3>
                <DefList
                  compact
                  items={[
                    { label: 'Exemples', value: d.examples },
                    { label: 'Finalité', value: d.purpose },
                    { label: 'Base légale', value: d.legalBasis },
                    { label: 'Conservation', value: d.retention },
                  ]}
                />
              </div>
            ))}
          </div>
        </Section>

        {/* ── 3. SOUS-TRAITANTS ───────────────────────────── */}
        <Section title="3. Sous-traitants et transferts hors UE">
          <p>
            Sokar fait appel à des sous-traitants pour fournir certaines fonctionnalités. Tous
            traitent les données conformément à nos instructions et, lorsqu&apos;ils sont situés
            hors de l&apos;Union européenne, dans le cadre de clauses contractuelles types (SCC) ou
            de décisions d&apos;adéquation.
          </p>
          <p className="mt-3">
            <strong>Note spécifique DigitalOcean (hébergeur principal) :</strong> les serveurs de
            production sont situés à New York (USA). Le transfert de données vers les États-Unis est
            encadré par les clauses contractuelles types (SCC) de la Commission européenne et
            bénéficie du cadre de transfert de données UE-États-Unis (EU-US Data Privacy Framework)
            adopté en juillet 2023, auquel DigitalOcean a adhéré. Les données sont chiffrées en
            transit (TLS 1.3 systématique) ; les disques de stockage ne sont pas chiffrés au repos
            (chiffrement LUKS non activé sur le droplet — décision documentée, à durcir avant le
            passage à l&apos;hébergement en production à grande échelle).
          </p>
          <div className="mt-6 overflow-hidden rounded-2xl border border-white/8">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-[10px] uppercase tracking-wider text-white/60">
                <tr>
                  <th className="px-4 py-3 font-semibold">Sous-traitant</th>
                  <th className="px-4 py-3 font-semibold">Finalité</th>
                  <th className="px-4 py-3 font-semibold">Localisation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-white/80">
                {SUBPROCESSORS.map((s) => (
                  <tr key={s.name}>
                    <td className="px-4 py-3 align-top">
                      <div className="font-semibold text-white">{s.name}</div>
                      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-white/40">
                        {s.status}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">{s.purpose}</td>
                    <td className="px-4 py-3 align-top">{s.location}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-white/50">
            Hébergeur principal : {COMPANY.hostingProvider} ({COMPANY.hostingLocation}).
          </p>
        </Section>

        {/* ── 4. DROITS UTILISATEUR ───────────────────────── */}
        <Section title="4. Vos droits">
          <p>
            Conformément au RGPD (articles 15 à 22), vous disposez à tout moment des droits
            suivants. Leur exercice est gratuit et nous nous engageons à y répondre dans un délai
            d&apos;un mois.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {USER_RIGHTS.map((r) => (
              <div key={r.title} className="rounded-2xl border border-white/8 bg-white/[0.02] p-5">
                <h3 className="text-sm font-semibold text-white">{r.title}</h3>
                <p className="mt-2 text-sm leading-6 text-white/70">{r.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-6">
            Pour exercer ces droits, écrivez à{' '}
            <a
              href={`mailto:${COMPANY.dpoEmail}`}
              className="inline-flex items-center gap-1.5 text-[hsl(var(--pricing-accent))] hover:underline"
            >
              <Mail size={14} />
              {COMPANY.dpoEmail}
            </a>
            . En cas de réclamation, vous pouvez saisir la CNIL (
            <a
              href="https://www.cnil.fr/fr/plaintes"
              target="_blank"
              rel="noreferrer"
              className="text-[hsl(var(--pricing-accent))] hover:underline"
            >
              www.cnil.fr
            </a>
            ).
          </p>
        </Section>

        {/* ── 5. SÉCURITÉ ────────────────────────────────── */}
        <Section title="5. Sécurité des données">
          <p>
            Sokar applique les mesures techniques et organisationnelles appropriées pour protéger
            vos données contre tout accès non autorisé, perte, altération ou divulgation :
          </p>
          <ul className="mt-6 space-y-2 text-sm text-white/80">
            {SECURITY_MEASURES.map((m) => (
              <li key={m} className="flex items-start gap-3">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[hsl(var(--pricing-accent))]" />
                <span className="leading-6">{m}</span>
              </li>
            ))}
          </ul>
        </Section>

        {/* ── 6. COOKIES ─────────────────────────────────── */}
        <Section title="6. Cookies">
          <p>
            Sokar utilise uniquement des cookies strictement nécessaires au fonctionnement du
            service. Aucun cookie publicitaire, analytique tiers ou de tracking cross-site.
          </p>
          <div className="mt-6 overflow-hidden rounded-2xl border border-white/8">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-[10px] uppercase tracking-wider text-white/60">
                <tr>
                  <th className="px-4 py-3 font-semibold">Cookie</th>
                  <th className="px-4 py-3 font-semibold">Finalité</th>
                  <th className="px-4 py-3 font-semibold">Durée</th>
                  <th className="px-4 py-3 font-semibold">Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-white/80">
                {COOKIES.map((c) => (
                  <tr key={c.name}>
                    <td className="px-4 py-3 font-mono text-xs text-white">{c.name}</td>
                    <td className="px-4 py-3">{c.purpose}</td>
                    <td className="px-4 py-3">{c.duration}</td>
                    <td className="px-4 py-3 text-white/60">{c.type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ── 7. MODIFICATIONS ────────────────────────────── */}
        <Section title="7. Modifications de cette politique">
          <p>
            Nous pouvons être amenés à modifier cette politique pour refléter les évolutions du
            service, du cadre légal ou de nos sous-traitants. Toute modification substantielle sera
            notifiée par email et signalée par un changement de la date de « dernière mise à jour »
            en haut de cette page. La version précédente est disponible sur demande.
          </p>
        </Section>

        {/* ── 8. CONTACT ─────────────────────────────────── */}
        <Section title="8. Contact">
          <p>Pour toute question relative à cette politique ou à vos données personnelles :</p>
          <p className="mt-4">
            <a
              href={`mailto:${COMPANY.dpoEmail}`}
              className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/90"
            >
              <Mail size={14} />
              Contacter le DPO
            </a>
          </p>
        </Section>

        <div className="pt-8 text-center text-xs text-white/40">
          <Link href="/" className="hover:text-foreground transition-all duration-200">
            ← Retour à l&apos;accueil
          </Link>
        </div>
      </main>
    </div>
  );
}

/* ─── Helpers ──────────────────────────────────────────────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl font-display">
        {title}
      </h2>
      <div className="mt-4 text-sm leading-7 text-white/72 sm:text-base">{children}</div>
    </section>
  );
}

function DefList({
  items,
  compact = false,
}: {
  items: { label: string; value: string }[];
  compact?: boolean;
}) {
  return (
    <dl className={`mt-${compact ? 3 : 4} space-y-${compact ? 1.5 : 2}`}>
      {items.map((item) => (
        <div
          key={item.label}
          className={`flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-4 ${
            compact ? 'py-1' : 'py-2'
          }`}
        >
          <dt className="min-w-[140px] text-[10px] font-semibold uppercase tracking-wider text-white/50">
            {item.label}
          </dt>
          <dd className="text-sm text-white/80">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
