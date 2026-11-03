import {
  PRIVACY_ANONYMIZATION_REFERENCE,
  PRIVACY_DOCUMENT,
  PRIVACY_PROVIDERS,
  PRIVACY_RETENTION_RULES,
} from '@sokar/shared';

// New records reference the corrected disclosure; historical consent versions stay intact.
// This does not change consent purposes, flags or introduce an automatic renewal workflow.
export const CURRENT_PRIVACY_POLICY_VERSION = 'v1.1-2026-10-16';

export const PRIVACY_POLICY_SUMMARY = {
  version: CURRENT_PRIVACY_POLICY_VERSION,
  effectiveAt: PRIVACY_DOCUMENT.revision,
  // Preserve the public numeric field; additive fields below explicitly qualify its scope.
  retentionDays: PRIVACY_ANONYMIZATION_REFERENCE.reservationAgeDays,
  dataController: 'Sokar — nom commercial d’une entreprise individuelle',
  hosting: PRIVACY_DOCUMENT.hosting,
  dpo: PRIVACY_DOCUMENT.contact,
  contactEmail: PRIVACY_DOCUMENT.contact,
  documentationRevision: PRIVACY_DOCUMENT.revision,
  status: 'under_review',
  retentionDaysMeaning:
    'Seuil du mécanisme d’anonymisation des réservations, désactivé par défaut ; pas une durée générale de conservation.',
  automaticAnonymizationGuaranteed: false,
  anonymizationReference: PRIVACY_ANONYMIZATION_REFERENCE,
  retentionRules: PRIVACY_RETENTION_RULES,
  providers: PRIVACY_PROVIDERS,
} as const;

/**
 * Texte de la policy. Le summary + ce texte sont exposés via
 * GET /api/rgpd/privacy-policy pour que les agents IA puissent le lire.
 */
export const PRIVACY_POLICY_TEXT = `
# Politique de confidentialité Sokar

## Responsable du traitement
Sokar, nom commercial d’une entreprise individuelle. L’identification complète du responsable reste à compléter. Contact données personnelles : ${PRIVACY_DOCUMENT.contact}

Révision documentaire : ${PRIVACY_DOCUMENT.revision}.
${PRIVACY_DOCUMENT.review}
${PRIVACY_DOCUMENT.roles}

## Données collectées
- Numéro de téléphone (E.164)
- Nom du client
- Adresse e-mail saisie pour une réservation en ligne (envoi de sa confirmation)
- Consentements (réservation, SMS transactionnel, email transactionnel, marketing)
- Métadonnées de réservation (date, heure, nombre de personnes, demandes spéciales)
- Données de compte, de restaurant et de facturation
- Demandes de démonstration et échanges de suivi
- Métadonnées d’appels et, selon les fonctions de test activées, audio et dialogues de diagnostic

## Base légale
${PRIVACY_DOCUMENT.reservationProcessing}
- Gestion des comptes et du service : exécution du contrat
- Demandes de démonstration : intérêt légitime à répondre aux professionnels intéressés
- Sécurité du service : intérêt légitime à prévenir les abus et les accès non autorisés
- Pièces comptables : obligations légales applicables

## Durée de conservation
${PRIVACY_RETENTION_RULES.map((rule) => `- ${rule.category} : ${rule.description}`).join('\n')}

## Vos droits
- Accès (Article 15) : POST /api/rgpd/export
- Effacement (Article 17) : POST /api/rgpd/erase
- Portabilité (Article 20) : export JSON ci-dessus
- Rectification et limitation : contactez ${PRIVACY_DOCUMENT.contact}
- Opposition (Article 21) : selon les conditions légales applicables
- Retrait du consentement marketing : à tout moment, sans effet sur la licéité des traitements antérieurs
- Réclamation : CNIL (cnil.fr)

## Sous-traitants
${PRIVACY_DOCUMENT.transfers}
${PRIVACY_PROVIDERS.map((provider) => `- ${provider.name} : ${provider.purpose}`).join('\n')}
${PRIVACY_DOCUMENT.supplierInformation}

Hébergement : ${PRIVACY_DOCUMENT.hosting}

## Sécurité
${PRIVACY_DOCUMENT.security}

## Cookies
${PRIVACY_DOCUMENT.cookies}
`.trim();
