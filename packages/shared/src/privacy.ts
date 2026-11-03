/** Public notice only; technical checks and supplier evidence stay in the internal runbook. */
export const PRIVACY_DOCUMENT = {
  revision: '2026-10-16',
  updatedLabel: '16 octobre 2026',
  contact: 'privacy@sokar.tech',
  hosting: 'OVHcloud',
  review:
    'Version en cours de finalisation : l’identification du responsable, certaines durées et les garanties de transfert restent à valider avant publication.',
  roles:
    'Sokar détermine les finalités du traitement des demandes de démonstration, de la gestion de ses comptes et de la sécurité de son service. Pour la gestion des réservations et de la clientèle, le restaurant détermine les finalités et Sokar traite les données sur ses instructions.',
  reservationProcessing:
    'La prise et la gestion d’une réservation reposent sur l’exécution du contrat avec le restaurant. Les confirmations suivent les choix de communication recueillis lors de la réservation. Le marketing nécessite un consentement distinct : une réservation ne vaut pas inscription à une campagne.',
  transfers:
    'Selon les fonctionnalités utilisées, certains prestataires peuvent traiter des données hors de l’Espace économique européen. Les pays concernés et les garanties de transfert doivent être précisés dans la documentation applicable au service ; leur vérification est en cours.',
  supplierInformation:
    'Pour connaître les prestataires concernés par votre utilisation du service, leurs pays de traitement et les garanties applicables, contactez privacy@sokar.tech. La liste nominative relève de la documentation de traitement des données destinée aux clients restaurateurs.',
  security:
    'Nous utilisons des connexions chiffrées, des contrôles d’accès et des mesures de surveillance pour protéger les données et limiter les accès non autorisés.',
  cookies:
    'Les cookies nécessaires à la connexion, à la sécurité et au paiement sont utilisés lorsque vous accédez aux fonctionnalités concernées. Les cookies non nécessaires, s’ils sont proposés, nécessitent votre accord préalable. Les durées précises des cookies restent à vérifier avant publication.',
} as const;

// Functional recipient categories, not a public inventory of the technical stack.
export const PRIVACY_PROVIDERS = [
  {
    id: 'infrastructure',
    name: 'Hébergement et sécurité',
    purpose: 'Héberger le service, acheminer les requêtes et protéger les accès.',
  },
  {
    id: 'accounts',
    name: 'Gestion des comptes',
    purpose: 'Permettre la connexion et gérer les accès des équipes.',
  },
  {
    id: 'communications',
    name: 'Communications et assistance vocale',
    purpose: 'Traiter les appels et envoyer les messages liés au service et aux réservations.',
  },
  {
    id: 'payments',
    name: 'Paiement et facturation',
    purpose: 'Gérer les paiements, les abonnements et les justificatifs associés.',
  },
  {
    id: 'integrations',
    name: 'Services connectés et assistance',
    purpose:
      'Fournir les intégrations que vous utilisez, répondre à vos demandes et diagnostiquer les incidents.',
  },
] as const;

export const PRIVACY_RETENTION = {
  accounts:
    'Les données nécessaires au compte et au restaurant sont utilisées pendant la relation de service. Les délais après clôture restent à préciser.',
  demo: 'Les demandes sans suite sont à supprimer douze mois après le dernier échange, ou après la demande en l’absence d’échange. La revue et la suppression sont manuelles, sans purge automatique.',
  reservations:
    'Les données de réservation et de clientèle sont conservées selon les finalités et les instructions du restaurant. Le délai maximal applicable reste à préciser ; aucune suppression automatique générale n’est garantie.',
  reservationEmail:
    'L’adresse e-mail saisie pour une réservation en ligne sert à gérer cette réservation, notamment sa confirmation. Elle est conservée avec la réservation jusqu’à son anonymisation : ce mécanisme est désactivé par défaut, aucune suppression automatique n’est garantie. L’effacement peut être demandé.',
  calls:
    'Les données et transcriptions d’appels sont traitées pour la gestion des appels et des réservations. Leur durée de conservation reste à préciser, indépendamment de celle des enregistrements audio.',
  recordings:
    'Les enregistrements et rapports sont limités aux appels de test autorisés. L’accès à l’audio expire dans un délai configuré de un à trente jours. La suppression effective et les copies conservées par les prestataires restent à vérifier.',
  debugDialogue:
    'Les textes de diagnostic des tests autorisés ont une échéance de quatorze jours. La suppression effective et les copies restent à vérifier.',
  billing:
    'Les pièces comptables et justificatifs soumis à cette obligation sont conservés dix ans à compter de la clôture de l’exercice. Cette durée ne s’applique pas à toutes les données de paiement.',
  logs: 'Les journaux techniques servent à la sécurité et au diagnostic des incidents. Leur durée effective de conservation reste à préciser.',
  backups:
    'Les sauvegardes et copies suivent des cycles distincts, encore à documenter. Une suppression dans le service ne signifie pas un effacement immédiat de toutes les copies.',
} as const;

export const PRIVACY_RETENTION_RULES = [
  { id: 'accounts', category: 'Comptes et restaurants', description: PRIVACY_RETENTION.accounts },
  { id: 'demo', category: 'Demandes de démonstration', description: PRIVACY_RETENTION.demo },
  {
    id: 'reservations',
    category: 'Réservations et clientèle',
    description: PRIVACY_RETENTION.reservations,
  },
  {
    id: 'reservationEmail',
    category: 'Adresse e-mail de la réservation',
    description: PRIVACY_RETENTION.reservationEmail,
  },
  {
    id: 'calls',
    category: 'Données et transcriptions d’appels',
    description: PRIVACY_RETENTION.calls,
  },
  {
    id: 'recordings',
    category: 'Audio et rapports de test',
    description: PRIVACY_RETENTION.recordings,
  },
  {
    id: 'debugDialogue',
    category: 'Diagnostic des tests',
    description: PRIVACY_RETENTION.debugDialogue,
  },
  { id: 'billing', category: 'Facturation', description: PRIVACY_RETENTION.billing },
  { id: 'logs', category: 'Journaux techniques', description: PRIVACY_RETENTION.logs },
  { id: 'backups', category: 'Sauvegardes et copies', description: PRIVACY_RETENTION.backups },
] as const;

// Kept for the historical API contract; this is not a general retention commitment.
export const PRIVACY_ANONYMIZATION_REFERENCE = {
  reservationAgeDays: 730,
  noRecentReservationDays: 180,
  enabledByDefault: false,
  scope: 'reservation-fields-only',
} as const;
