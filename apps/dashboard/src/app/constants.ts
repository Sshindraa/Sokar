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
  description: string;
  /** Formule précédente incluse en entier, affichée en tête de liste. */
  inherits?: string;
  /** Fonctionnalités introduites par cette formule, avec leur statut. */
  features: PlanFeatureLine[];
  featured?: boolean;
}

const PLAN_DESCRIPTIONS: Record<PlanLabel, string> = {
  Essential: 'Pour démarrer.',
  Pro: 'Pour maximiser chaque service.',
  'Multi-site': 'Pour plusieurs établissements.',
};

const toFeatureLines = (plan: PlanLabel): PlanFeatureLine[] =>
  featuresIntroducedIn(plan).map(({ label, status }) => ({ label, status }));

export const PLANS: PricingPlan[] = [
  {
    label: 'Essential',
    price: String(pricingFor('Essential').monthlyEur),
    description: PLAN_DESCRIPTIONS.Essential,
    features: toFeatureLines('Essential'),
  },
  {
    label: 'Pro',
    price: String(pricingFor('Pro').monthlyEur),
    description: PLAN_DESCRIPTIONS.Pro,
    inherits: "Tout l'Essential",
    features: toFeatureLines('Pro'),
    featured: true,
  },
  {
    label: 'Multi-site',
    price: String(pricingFor('Multi-site').monthlyEur),
    sitePrice: String(pricingFor('Multi-site').sitePriceEur),
    description: PLAN_DESCRIPTIONS['Multi-site'],
    inherits: 'Tout le Pro, sur chaque établissement',
    features: toFeatureLines('Multi-site'),
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
      'Trois forfaits : Essential à 199 € HT/mois, Pro à 299 € HT/mois (recommandé), et Multi-site à partir de 249 € HT/mois, plus 99 € HT par site supplémentaire. Les forfaits mensuels sont sans engagement. La facturation annuelle vous fait bénéficier de 20 % de réduction, avec un engagement de 12 mois. Le détail des fonctionnalités est sur notre page Tarifs.',
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
