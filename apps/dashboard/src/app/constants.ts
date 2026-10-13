// Shared constants for the Sokar landing page
// Used by both server and client components

import {
  PLAN_PRICES_EUR,
  PRICING_CATALOG,
  ANNUAL_DISCOUNT_PERCENT,
  annualPriceCents,
  formatPriceCents,
  formatMonthlyEquivalent,
} from '@sokar/shared';

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

export interface PricingPlan {
  label: 'Essential' | 'Pro' | 'Multi-site';
  /** Prix mensuel sans engagement, en euros. */
  price: string;
  /** Prix mensuel par établissement (Multi-site uniquement), en euros. */
  sitePrice?: string;
  description: string;
  promise: string;
  note?: string;
  demoFirst?: boolean;
  features: string[];
  featured?: boolean;
}

export const PLANS: PricingPlan[] = [
  {
    label: 'Essential',
    price: String(PLAN_PRICES_EUR.ESSENTIAL),
    promise: 'Vos appels et vos réservations, au même endroit.',
    description: 'Pour une équipe qui veut préparer le service et garder son attention en salle.',
    features: [
      'Un assistant pour les réservations par téléphone',
      'Les réservations téléphone, web et en salle dans un planning commun',
      'Votre page Connect et votre widget de réservation',
      'Plan de salle et liste d’attente pour organiser les couverts',
      'Un fichier client et le suivi des absences',
      'Un numéro dédié, configuré lors de la mise en service',
    ],
  },
  {
    label: 'Pro',
    price: String(PLAN_PRICES_EUR.PRO),
    promise: 'Gardez la main quand le service change.',
    description:
      'Retards, tables bientôt disponibles, clients en attente : Sokar vous propose des actions, votre équipe décide.',
    demoFirst: true,
    features: [
      'Tout le socle Essential',
      'Des suggestions pour traiter les retards',
      'Une estimation des tables bientôt disponibles, avec indication de fiabilité',
      'Des rapprochements entre tables et clients en attente',
      'L’analyse d’une réorganisation et l’application d’un plan validé par l’équipe',
      'L’historique des plans de retard et un retour arrière sous conditions',
    ],
    note: 'Découvrez le copilote en démonstration avant de choisir. Une estimation ne vaut pas une table libre. En complément : préparation de segments et brouillons marketing, sans envoi.',
  },
  {
    label: 'Multi-site',
    price: String(PLAN_PRICES_EUR.PREMIUM),
    sitePrice: String(PRICING_CATALOG['multi-site-addon'].monthlyCents / 100),
    demoFirst: true,
    promise: 'L’esprit de chaque maison. Une vue d’ensemble.',
    description: 'Pour retrouver les réservations de plusieurs adresses depuis un même espace.',
    features: [
      'Essential et le copilote Pro par établissement',
      'Passage d’une adresse à l’autre dans votre espace',
      'Planning et fichier client propres à chaque restaurant',
      'Horaires et règles de réservation par adresse',
      'Un numéro dédié par établissement',
      'Une facturation réunie au niveau du groupe',
    ],
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
    answer: `Essential à ${PLAN_PRICES_EUR.ESSENTIAL} € HT/mois, Pro à ${PLAN_PRICES_EUR.PRO} € HT/mois et Multi-site à ${PLAN_PRICES_EUR.PREMIUM} € HT/mois pour le premier établissement, puis ${PRICING_CATALOG['multi-site-addon'].monthlyCents / 100} € HT/mois par établissement supplémentaire. Le paiement annuel engage douze mois avec ${ANNUAL_DISCOUNT_PERCENT} % de réduction. Consultez les inclusions actuelles sur la page Tarifs.`,
  },
  {
    question: 'Y a-t-il un engagement de durée ?',
    answer: `Nos forfaits mensuels sont totalement sans engagement, vous êtes libre d'arrêter quand vous le souhaitez. Si vous optez pour la facturation annuelle, vous vous engagez pour 12 mois et bénéficiez d'une réduction de ${ANNUAL_DISCOUNT_PERCENT}% sur l'ensemble de vos mensualités.`,
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

/** Montants en centimes avant formatage, sans arrondir l’équivalent annuel à l’euro. */
// Compatibility helpers for existing consumers; the shared catalogue owns billing and formatting.
export const billingAmount = (price: string | number, yearly: boolean, annualTotal = false) => {
  const monthlyCents = Math.round(Number(price) * 100);
  const totalCents = yearly ? annualPriceCents(monthlyCents) : monthlyCents;
  return totalCents / (yearly && !annualTotal ? 1200 : 100);
};

export const formatPrice = (amount: number) => formatPriceCents(Math.round(amount * 100));

export const DISPLAY_PRICE = (price: string, yearly: boolean) => {
  const monthlyCents = Math.round(Number(price) * 100);
  return formatMonthlyEquivalent(yearly ? annualPriceCents(monthlyCents) : monthlyCents, yearly);
};
