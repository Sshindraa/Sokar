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
    period: '€/mois',
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
    period: '€/mois',
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
    period: '€/mois + 99€/site',
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
    answer: "Sokar se branche sur votre numéro de téléphone professionnel (mise en service en cours de déploiement). Lorsqu'un client vous appelle, Sokar répond automatiquement avec une voix chaleureuse et naturelle. Il comprend les demandes complexes, consulte vos disponibilités en temps réel, et confirme la réservation. Le client reçoit ensuite un SMS de confirmation immédiat."
  },
  {
    question: "Avec quels outils Sokar s'intègre-t-il ?",
    answer: "Sokar se connecte nativement à Google Calendar pour synchroniser vos disponibilités en temps réel. Les réservations prises par Sokar sont automatiquement ajoutées à votre planning, sans double saisie. D'autres intégrations (ZenChef, TheFork, Lightspeed) sont en cours de développement et arriveront progressivement."
  },
  {
    question: "Quel type de restaurant peut utiliser Sokar ?",
    answer: "Tous. Des bistrots de quartier aux restaurants étoilés, Sokar s'adapte à votre flux d'appels. Il gère les réservations simples comme les demandes spécifiques (allergies, anniversaire, table en terrasse, etc.)."
  },
  {
    question: "Combien coûte Sokar ?",
    answer: "Trois forfaits, sans engagement : Essential à 149€/mois, Pro à 249€/mois (recommandé), et Multi-site à partir de 249€/mois + 99€/site supplémentaire. La facturation annuelle vous fait bénéficier de 20% de réduction. Le détail des fonctionnalités est sur notre page Tarifs."
  },
  {
    question: "Y a-t-il un engagement de durée ?",
    answer: "Nos forfaits mensuels sont totalement sans engagement, vous êtes libre d'arrêter quand vous le souhaitez. Si vous optez pour la facturation annuelle, vous vous engagez pour 12 mois et bénéficiez d'une réduction de 20% sur l'ensemble de vos mensualités."
  },
  {
    question: "Comment se passe l'installation ?",
    answer: "Tout se fait à distance, sans aucun matériel à installer. Nous configurons votre agent vocal selon vos horaires, votre carte, et vos consignes. Vous gardez votre numéro de téléphone existant, sur lequel le transfert d'appel est activé."
  },
  {
    question: "Mes données et celles de mes clients sont-elles protégées ?",
    answer: "Oui. Sokar est conforme au RGPD : les données sont hébergées en Europe, chiffrées au repos et en transit, et jamais partagées avec des tiers. Chaque restaurant dispose de son propre espace isolé, et vous pouvez exporter ou supprimer vos données à tout moment depuis votre dashboard."
  },
];

export const DISPLAY_PRICE = (price: string, yearly: boolean) => {
  const num = parseInt(price, 10);
  return yearly ? Math.round(num * 0.8).toString() : price;
};
