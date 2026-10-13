// Shared constants for the Sokar landing page
// Used by both server and client components

import { PLAN_PRICES_EUR } from '@sokar/shared';

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
    promise: 'Préparez la prochaine invitation de vos clients.',
    description: 'Pour un restaurant qui souhaite préparer ses actions de fidélisation.',
    features: [
      'Tout le socle Essential',
      'Préparation de groupes de clients',
      'Brouillons de campagnes pour vos invitations',
      'Aperçu des destinataires avant tout envoi',
      'Règles pour préparer vos actions de fidélisation',
    ],
    note: 'Aujourd’hui : préparation uniquement. L’envoi des campagnes et les profils clients avancés ne sont pas encore disponibles.',
  },
  {
    label: 'Multi-site',
    price: String(PLAN_PRICES_EUR.PREMIUM),
    sitePrice: '99',
    promise: 'L’esprit de chaque maison. Une vue d’ensemble.',
    description: 'Pour retrouver les réservations de plusieurs adresses depuis un même espace.',
    features: [
      'Le périmètre actuel de Pro par établissement',
      'Passage d’une adresse à l’autre dans votre espace',
      'Planning et fichier client propres à chaque restaurant',
      'Horaires et règles de réservation par adresse',
      'Un numéro dédié par établissement',
      'Une facturation réunie au niveau du groupe',
    ],
    note: 'Le partage des profils clients et la comparaison consolidée des résultats ne sont pas encore disponibles. Les accès des équipes sont validés lors de la mise en service.',
  },
];

export const FAQS = [
  {
    question: "Comment fonctionne l'assistant vocal Sokar ?",
    answer:
      "Sokar se branche sur votre numéro de téléphone professionnel (mise en service en cours de déploiement). Lorsqu'un client vous appelle, Sokar répond automatiquement avec une voix chaleureuse et naturelle. Il comprend les demandes complexes, consulte vos disponibilités en temps réel, et confirme la réservation. Le client reçoit ensuite un SMS de confirmation immédiat.",
  },
  {
    question: "Avec quels outils Sokar s'intègre-t-il ?",
    answer:
      "Sokar se connecte nativement à Google Calendar pour synchroniser vos disponibilités en temps réel. Les réservations prises par Sokar sont automatiquement ajoutées à votre planning, sans double saisie. D'autres intégrations (ZenChef, TheFork, Lightspeed) sont en cours de développement et arriveront progressivement.",
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
      'Oui. Sokar est conforme au RGPD : les données sont hébergées en Europe, chiffrées au repos et en transit, et jamais partagées avec des tiers. Chaque restaurant dispose de son propre espace isolé, et vous pouvez exporter ou supprimer vos données à tout moment depuis votre dashboard.',
  },
];

/** Montants en centimes avant formatage, sans arrondir l’équivalent annuel à l’euro. */
export const billingAmount = (price: string | number, yearly: boolean, annualTotal = false) =>
  Math.round(Number(price) * 100 * (yearly ? 0.8 : 1) * (annualTotal ? 12 : 1)) / 100;

export const formatPrice = (amount: number) =>
  amount.toLocaleString('fr-FR', {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });

export const DISPLAY_PRICE = (price: string, yearly: boolean) =>
  formatPrice(billingAmount(price, yearly));
