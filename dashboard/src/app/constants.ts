// Shared constants for the Sokar landing page
// Used by both server and client components

export const SIMULATOR_STEPS = [
  { sender: 'client', text: 'Bonjour, je voudrais réserver une table pour ce soir.' },
  { sender: 'assistant', text: 'Bonjour ! Avec plaisir. Pour combien de personnes ce soir ?' },
  { sender: 'client', text: 'Nous serons 4 personnes.' },
  { sender: 'assistant', text: "Parfait. J'ai de la disponibilité à 20h00 ou 21h30. Qu'est-ce qui vous convient ?" },
  { sender: 'client', text: "20h c'est super !" },
  { sender: 'assistant', text: 'C\'est noté. Une table pour 4 personnes ce soir à 20h00 au nom de... ?' },
  { sender: 'client', text: 'Au nom de Martin.' },
  { sender: 'assistant', text: 'C\'est réservé M. Martin ! Vous allez recevoir un SMS de confirmation à l\'instant. À ce soir !' },
  { sender: 'client', text: 'Parfait, merci beaucoup. Au revoir !' },
  { sender: 'assistant', text: 'Merci à vous, au revoir et bon appétit !' },
];

export const PLANS = [
  {
    label: 'Essential',
    price: '149',
    period: '€',
    features: [
      'Répond à chaque appel, 24h/24',
      'Réservations prises sans intervention',
      'Ton adapté à votre établissement',
      'Rapport quotidien de vos appels',
      '1 numéro dédié inclus',
    ],
  },
  {
    label: 'Pro',
    price: '249',
    period: '€',
    features: [
      "Tout l'Essential, sans limite",
      'Vos clients reconnus à chaque appel',
      'No-shows anticipés et gérés automatiquement',
      'Revenus récupérés visibles en temps réel',
      'Réservable depuis ChatGPT, Claude et les IA du marché',
      'Support prioritaire 7j/7',
    ],
    featured: true,
  },
  {
    label: 'Multi-site',
    price: '249',
    period: '€ + 99€/site suppl.',
    features: [
      'Plan Pro sur tous vos établissements',
      'Un seul dashboard pour tout piloter',
      'Un numéro et un agent par site',
      'Une seule facture pour tout le groupe',
    ],
  },
];

export const FAQS = [
  {
    question: "Comment fonctionne l'assistant vocal Sokar ?",
    answer: "Sokar est branché directement sur votre ligne téléphonique actuelle. Lorsqu'un client vous appelle, Sokar répond automatiquement avec une voix chaleureuse et naturelle. Il comprend les demandes complexes, consulte vos disponibilités en temps réel sur votre logiciel de réservation, et valide la table. Le client reçoit ensuite un SMS de confirmation immédiat."
  },
  {
    question: "S'intègre-t-il avec mon logiciel de réservation ou de caisse ?",
    answer: "Oui, totalement. Sokar se connecte en lecture/écriture avec les API des principales solutions de réservation comme ZenChef, TheFork, ou Lightspeed. Toute réservation prise vocalement par Sokar est automatiquement ajoutée à votre planning. Aucune double saisie pour votre équipe."
  },
  {
    question: "Quel type de restaurant peut utiliser Sokar ?",
    answer: "Tous. Des bistrots de quartier aux restaurants étoilés, Sokar s'adapte à votre flux d'appels. Il gère les réservations simples comme les demandes très spécifiques (allergies, anniversaire, table en terrasse, etc.). Il prend aussi les commandes à emporter si vous le souhaitez."
  },
  {
    question: "Y a-t-il un engagement de durée ?",
    answer: "Nos forfaits mensuels sont totalement sans engagement, vous êtes libre d'arrêter quand vous le souhaitez. Si vous optez pour la facturation annuelle, vous vous engagez pour 12 mois et bénéficiez d'une réduction de 20% sur l'ensemble de vos mensualités."
  },
  {
    question: "Comment se passe l'installation ?",
    answer: "Tout se fait à distance en moins de 24h. Il vous suffit de nous fournir un accès en lecture à votre logiciel de réservation. Nous configurons votre agent vocal selon vos horaires, votre carte, et vos consignes. Le transfert d'appel est ensuite activé sur votre ligne existante. Aucun matériel à installer."
  },
];

export const DISPLAY_PRICE = (price: string, yearly: boolean) => {
  const num = parseInt(price, 10);
  return yearly ? Math.round(num * 0.8).toString() : price;
};
