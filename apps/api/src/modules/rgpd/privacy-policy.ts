/**
 * Privacy policy versionnée.
 *
 * La version est stockée en DB (dans customer_consents.privacyPolicyVersion)
 * à chaque consentement collecté. Quand la policy change, on incrémente
 * la version et tous les consents existants doivent être renouvelés.
 *
 * Source de vérité : ce fichier. Pas de DB, pas d'admin (Phase 5 MVP).
 */

export const CURRENT_PRIVACY_POLICY_VERSION = 'v1.0-2026-06';

export const PRIVACY_POLICY_SUMMARY = {
  version: CURRENT_PRIVACY_POLICY_VERSION,
  effectiveAt: '2026-06-01',
  retentionDays: 730, // 2 ans
  dataController: 'Sokar SAS',
  hosting: 'France (OVHcloud)',
  dpo: 'dpo@sokar.tech',
} as const;

/**
 * Texte de la policy. Le summary + ce texte sont exposés via
 * GET /api/rgpd/privacy-policy pour que les agents IA puissent le lire.
 */
export const PRIVACY_POLICY_TEXT = `
# Politique de confidentialité Sokar

## Responsable du traitement
Sokar SAS, contact DPO : dpo@sokar.tech

## Données collectées
- Numéro de téléphone (E.164)
- Nom du client
- Consentements (réservation, SMS transactionnel, email transactionnel, marketing)
- Métadonnées de réservation (date, heure, nombre de personnes, demandes spéciales)

## Base légale
- Réservation : exécution du contrat (article 6.1.b RGPD)
- SMS/email transactionnel : exécution du contrat
- Marketing : consentement explicite (article 6.1.a RGPD)

## Durée de conservation
- 2 ans à compter de la dernière interaction
- Anonymisation automatique (PII effacée, structure conservée pour les stats)
- Conservation des données comptables : 10 ans (obligation légale)

## Vos droits
- Accès (Article 15) : POST /api/rgpd/export
- Effacement (Article 17) : POST /api/rgpd/erase
- Portabilité (Article 20) : export JSON ci-dessus
- Opposition (Article 21) : retirer le consentement marketing
- Réclamation : CNIL (cnil.fr)

## Sous-traitants
- Twilio (SMS, USA + EU) : DPA à formaliser, SCC 2021/914 à valider
- Brevo (email, France) : DPA à formaliser
- Postmark (email transactionnel, USA) : DPA à formaliser, SCC 2021/914 à valider
- Telnyx (téléphonie, USA + EU) : DPA à formaliser, SCC 2021/914 à valider
- Deepgram (STT, USA) : DPA à formaliser, SCC 2021/914 à valider
- Cartesia (TTS, USA) : DPA à formaliser, SCC 2021/914 à valider

## Sécurité
- Chiffrement at-rest (AES-256)
- Chiffrement in-transit (TLS 1.3)
- Logs d'audit append-only (toute mutation tracée)
- Aucune PII dans les tool responses MCP
- Origine allowlistée pour les clients MCP
`.trim();
