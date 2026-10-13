// Shared constants for the Sokar landing page
// Used by both server and client components

import {
  featuresIntroducedIn,
  pricingFor,
  type FeatureStatus,
  type PlanLabel,
} from '@/app/pricing-catalog';

export const SIMULATOR_STEPS = [
  { sender: 'client', text: 'Bonjour, je voudrais réserver une table pour ce soir.' },
  { sender: 'assistant', text: 'Bonjour ! Avec plaisir. Pour combien de personnes ce soir ?' },
  { sender: 'client', text: 'Nous serons 4 personnes.' },
  {
    sender: 'assistant',
    text: "Parfait. J'ai de la disponibilité à 20h00 ou 21h30. Qu'est-ce qui vous convient ?",
  },
  { sender: 'client', text: "20h c'est super !" },
  {
    sender: 'assistant',
    text: "C'est noté. Une table pour 4 personnes ce soir à 20h00 au nom de... ?",
  },
  { sender: 'client', text: 'Au nom de Martin.' },
  {
    sender: 'assistant',
    text: "C'est réservé M. Martin ! Vous allez recevoir un SMS de confirmation à l'instant. À ce soir !",
  },
  { sender: 'client', text: 'Parfait, merci beaucoup. Au revoir !' },
  { sender: 'assistant', text: 'Merci à vous, au revoir et bon appétit !' },
];

export interface PlanFeatureLine {
  label: string;
  status: FeatureStatus;
}

export interface PricingPlan {
  label: PlanLabel;
  /** Prix mensuel sans engagement, en euros HT. */
  price: string;
  /** Prix mensuel HT par établissement supplémentaire (Multi-site uniquement). */
  sitePrice?: string;
  /** Accroche affichée en tête de carte. */
  promise: string;
  description: string;
  /** Formule précédente incluse en entier, affichée en tête de liste. */
  inherits?: string;
  /** Précision sur ce qui n’est pas encore disponible. */
  note?: string;
  /** Fonctionnalités introduites par cette formule, avec leur statut. */
  features: PlanFeatureLine[];
  /** Parcours démo avant l’inscription : la carte propose « Découvrir » au lieu de « Choisir ». */
  demoFirst?: boolean;
  featured?: boolean;
}

const toFeatureLines = (plan: PlanLabel): PlanFeatureLine[] =>
  featuresIntroducedIn(plan).map(({ label, status }) => ({ label, status }));

export const PLANS: PricingPlan[] = [
  {
    label: 'Essential',
    price: String(pricingFor('Essential').monthlyEur),
    promise: 'Vos appels et vos réservations, au même endroit.',
    description: 'Pour une équipe qui veut préparer le service et garder son attention en salle.',
    features: toFeatureLines('Essential'),
  },
  {
    label: 'Pro',
    price: String(pricingFor('Pro').monthlyEur),
    promise: 'Gardez la main quand le service change.',
    description:
      'Retards, tables bientôt disponibles, clients en attente : Sokar vous propose des actions, votre équipe décide.',
    demoFirst: true,
    inherits: 'Tout le socle Essential',
    features: toFeatureLines('Pro'),
    note: 'Découvrez le copilote en démonstration avant de choisir. Une estimation ne vaut pas une table libre. En complément : préparation de segments et brouillons marketing, sans envoi.',
  },
  {
    label: 'Multi-site',
    price: String(pricingFor('Multi-site').monthlyEur),
    sitePrice: String(pricingFor('Multi-site').sitePriceEur),
    demoFirst: true,
    promise: 'L’esprit de chaque maison. Une vue d’ensemble.',
    description: 'Pour retrouver les réservations de plusieurs adresses depuis un même espace.',
    inherits: 'Essential et le copilote Pro par établissement',
    features: toFeatureLines('Multi-site'),
    note: 'Une présentation précède le choix du copilote pour vos équipes. Le partage des profils clients et la comparaison consolidée des résultats ne sont pas encore disponibles.',
  },
];

export const FAQS = [
  {
    question: "Comment fonctionne l'assistant vocal Sokar ?",
    answer:
      "Sokar se branche sur votre numéro de téléphone professionnel (mise en service en cours de déploiement). Lorsqu'un client vous appelle, Sokar répond automatiquement avec une voix chaleureuse et naturelle. Il comprend les demandes complexes, consulte vos disponibilités, et confirme la réservation. Le client reçoit ensuite un SMS de confirmation immédiat.",
  },
  {
    question: "Avec quels outils Sokar s'intègre-t-il ?",
    answer:
      "Sokar peut se connecter à Google Agenda pour consulter vos disponibilités et ajouter les réservations à votre planning. Nous ne proposons pas encore de synchronisation avec d'autres logiciels de réservation, comme ZenChef, TheFork ou Lightspeed.",
  },
  {
    question: 'Quel type de restaurant peut utiliser Sokar ?',
    answer:
      "Tous. Des bistrots de quartier aux restaurants étoilés, Sokar s'adapte à votre flux d'appels. Il gère les réservations simples comme les demandes spécifiques (allergies, anniversaire, table en terrasse, etc.).",
  },
  {
    question: 'Combien coûte Sokar ?',
    answer:
      'Essential à 199 € HT/mois, Pro à 299 € HT/mois et Multi-site à 249 € HT/mois pour le premier établissement, puis 99 € HT/mois par établissement supplémentaire. Le paiement annuel engage douze mois avec 20 % de réduction. Consultez les inclusions actuelles sur la page Tarifs.',
  },
  {
    question: 'Y a-t-il un engagement de durée ?',
    answer:
      "Nos forfaits mensuels sont totalement sans engagement, vous êtes libre d'arrêter quand vous le souhaitez. Si vous optez pour la facturation annuelle, vous vous engagez pour 12 mois et bénéficiez d'une réduction de 20% sur l'ensemble de vos mensualités.",
  },
  {
    question: "Comment se passe l'installation ?",
    answer:
      "Tout se fait à distance, sans aucun matériel à installer. Nous configurons votre agent vocal selon vos horaires, votre carte, et vos consignes. Vous gardez votre numéro de téléphone existant, sur lequel le transfert d'appel est activé.",
  },
  {
    question: 'Mes données et celles de mes clients sont-elles protégées ?',
    answer:
      "Oui. Chaque restaurant dispose de son propre espace isolé. Notre politique de confidentialité détaille les données traitées, les sous-traitants et leur localisation. Vous pouvez demander l'export ou l'effacement de vos données.",
  },
];
