/**
 * Sokar Connect — Politique de confidentialité.
 *
 * Page statique (○, pas de ƒ) — aucun fetch, aucun state.
 * RGPD : Sokar est un SaaS B2F (business-to-food) traitant des données
 * de réservation pour le compte de restaurants clients.
 */

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Politique de confidentialité',
  description:
    'Politique de confidentialité de Sokar — traitement des données personnelles dans le cadre des réservations en ligne pour restaurants.',
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <main id="main-content" className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-bold text-ink sm:text-4xl">Politique de confidentialité</h1>
      <p className="mt-2 text-sm text-muted-foreground">Dernière mise à jour : 22 juillet 2026</p>

      <div className="mt-8 space-y-8 text-ink">
        <section>
          <h2 className="mb-3 text-xl font-semibold text-ink">1. Responsable du traitement</h2>
          <p className="text-muted-foreground">
            Sokar édite une plateforme SaaS de réservation en ligne pour restaurants. Dans le cadre
            de ce service, Sokar agit en qualité de responsable de traitement pour les données
            collectées via les pages publiques de réservation (apps/connect).
          </p>
          <p className="mt-2 text-muted-foreground">
            Pour toute question relative à vos données, vous pouvez nous contacter à{' '}
            <a
              href="mailto:privacy@sokar.tech"
              className="text-foreground underline transition-all duration-200 hover:text-blue"
            >
              privacy@sokar.tech
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-ink">2. Données traitées</h2>
          <p className="text-muted-foreground">
            Lors d&apos;une réservation en ligne, nous collectons les données suivantes :
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-6 text-muted-foreground">
            <li>Prénom et nom (pour personnaliser la confirmation)</li>
            <li>Numéro de téléphone au format international (pour le SMS de confirmation)</li>
            <li>Adresse e-mail (optionnelle, pour une confirmation par e-mail)</li>
            <li>Demandes spéciales éventuelles (allergies, accès, etc.)</li>
            <li>
              Pour les appels téléphoniques : audio de la conversation et transcription, après
              information donnée au début de l&apos;appel
            </li>
            <li>
              Métadonnées de navigation : source (Google, QR code, etc.) et hash de l&apos;adresse
              IP (jamais l&apos;IP en clair)
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-ink">3. Finalités et base légale</h2>
          <ul className="list-disc space-y-2 pl-6 text-muted-foreground">
            <li>
              <strong className="text-ink">Exécution du contrat</strong> : création et gestion de la
              réservation auprès du restaurant.
            </li>
            <li>
              <strong className="text-ink">Intérêt légitime</strong> : mesures d&apos;anti-fraude
              (honeypot, rate-limiting), analytics agrégées (compteurs Prometheus, sans PII) et
              contrôle qualité des appels annoncés au client.
            </li>
            <li>
              <strong className="text-ink">Consentement</strong> : SMS et e-mail transactionnels de
              confirmation, recueillis au moment de la réservation.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-ink">4. Durée de conservation</h2>
          <p className="text-muted-foreground">
            Les données de réservation sont conservées par le restaurant pour la durée nécessaire à
            la gestion de ses opérations (annulation, modification, no-show). Les métadonnées
            analytics agrégées ne contiennent aucune PII et sont conservées sous forme de compteurs
            anonymisés. Les enregistrements audio sont stockés de manière privée pendant 30 jours au
            maximum, puis supprimés automatiquement.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-ink">5. Vos droits</h2>
          <p className="text-muted-foreground">
            Conformément au RGPD, vous disposez d&apos;un droit d&apos;accès, de rectification, de
            suppression et d&apos;opposition concernant vos données. Pour exercer ces droits,
            contactez-nous à{' '}
            <a
              href="mailto:privacy@sokar.tech"
              className="text-foreground underline transition-all duration-200 hover:text-blue"
            >
              privacy@sokar.tech
            </a>{' '}
            ou directement auprès du restaurant concerné.
          </p>
          <p className="mt-2 text-muted-foreground">
            Vous pouvez également introduire une réclamation auprès de la CNIL (
            <a
              href="https://www.cnil.fr/fr/plaintes"
              className="text-foreground underline transition-all duration-200 hover:text-blue"
              target="_blank"
              rel="noopener noreferrer"
            >
              www.cnil.fr/fr/plaintes
            </a>
            ).
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-ink">6. Cookies et tracking</h2>
          <p className="text-muted-foreground">
            Les pages publiques de réservation Sokar ne déposent aucun cookie de tracking. L&apos;IP
            est hashée côté client avant envoi (pas de stockage de l&apos;IP en clair). Aucun script
            tiers (Google Analytics, Meta Pixel, etc.) n&apos;est chargé.
          </p>
        </section>
      </div>
    </main>
  );
}
